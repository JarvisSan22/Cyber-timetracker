# Decisions

Choices made while building v1 where DESIGN.md was silent or unclear. Simplest option that fits the doc.

## Build plan

DESIGN.md has no "Build plan" section, so the milestones were defined here, following the doc's own order:

1. **Foundation**: config, SQLite engine (WAL), models, Alembic migration run on startup, `/api/health`, Dockerfile, docker-compose, backup script.
2. **Timer**: projects with starter tags, timer service (start, pause, resume, stop, restart, duration), Timer page with project picker, tag chips, running timers (Alpine ticker, 30 s re-poll), session list grouped by day, edit, delete with undo, add past session, demo seed.
3. **Statistics**: stats service (totals, longest, day record, streak, per-day, per-tag), Statistics page with stat cards, range switch, bar chart with goal line, time-per-tag bars, year heatmap.
4. **Other pages and API**: Projects, Ideas, Settings (timezone, day start, export CSV/JSON, import JSON, DB backup), JSON API, PWA (manifest, service worker, icons), README.
5. **Skipped (as asked)**: later integrations the doc mentions as future work (AnkiConnect, scripts, remote access via Tailscale).

## Answers given with the task

- Total time sums session durations even when sessions overlap; a note under the stats says so.
- No login.
- Weeks start on Monday. Default timezone Asia/Tokyo, changeable in Settings.
- Docker image has no platform pin (builds on x86_64 and arm64).

## Choices

- **Repo root** is this folder (the doc's `hobby-tracker/`). DESIGN.md stays at `docs/DESIGN.md` instead of the root.
- **Datetimes** are timezone-aware UTC in Python; SQLModel 0.0.47's `UTCDateTime` type stores them in SQLite.
- **`tzdata`** is added to requirements so `zoneinfo` works in `python:3.13-slim`, which ships no system zone files.
- **httpx** is kept for the test client as the doc lists it; Starlette's deprecation warning about it is filtered in `pytest.ini`.
- **Timezone env**: `APP_TIMEZONE`, falling back to `TZ`, then `Asia/Tokyo`, is the default until changed in Settings. Settings are stored in the `setting` table and win over env.
- **Selected project** comes from `?project=`, then a `project_id` cookie, then the first active project. Statistics also accepts `?project=all`.
- **HTMX refresh pattern**: timer buttons swap `#running-timers` directly; anything that changes the session list sends an `HX-Trigger: sessions-changed` event and the list reloads itself (`GET /ui/sessions`). This keeps each route returning one fragment.
- **Fragments of full pages** (edit dialog, undo toast, list blocks on Projects/Ideas/Settings) are `{% block %}`s inside the page template rendered on their own, so the template folder matches the outline exactly.
- **Undo delete**: the session is really deleted; the toast carries a JSON snapshot that `POST /ui/sessions/restore` re-inserts (same id, same tags). The toast disappears after 8 s. No soft-delete column needed.
- **Tag pencil** on the Timer page links to the project's card on the Projects page, where tags are renamed, recolored or deleted. "+ New tag" adds a tag inline.
- **Tag delete** is blocked while sessions use the tag (as in the API table); rename it instead.
- **Session list** shows finished sessions of the selected project, 50 at a time with "Show older sessions". Running timers show for all projects.
- **Tab title** shows the number of running timers and the longest one's elapsed time.
- **Edit dialog** changes title, start, end, paused minutes, tags and note. Moving a session to another project is not supported in v1.
- **Running timer clock**: the server sends elapsed seconds at render time and Alpine adds local wall-clock time, so a phone with a wrong clock still shows the right elapsed time.
- **Demo seed** (`SEED_DEMO=1`) runs only when the database has no projects, with a fixed random seed: 3 projects, 40 sessions over the last 30 days.
- **Stat cards are all-time** (Total time, Sessions, Longest, Day record, Streak). The range switch (7 days, 30 days, 12 months, all time) controls the bar chart, the time-per-tag bars and an extra "selected range" card.
- **12 months / all time** charts use one bar per month; 7 and 30 days use one bar per day, today on the right.
- **Streak** counts consecutive days with logged time ending today, or ending yesterday when nothing is logged yet today (so the streak does not read 0 every morning).
- **Running timers count** in stats with their time so far.
- **"All projects"** stats include archived projects and merge tags with the same name across projects into one bar.
- **Time per tag** uses plain CSS bars instead of a second Chart.js chart (simpler, same look).
- **Heatmap** shows the last 53 weeks, weeks starting Monday, with fixed levels (<15 min, <45 min, <90 min, more) and the project color. On phones it opens scrolled to the newest weeks.
- **Daily goal line** shows on the day-based charts when the selected project has a goal.
- **Port 8686** instead of the doc's 8080: on the build machine 8080 was already taken by another service, so the app uses 8686 everywhere (uvicorn command, container port, healthcheck, compose, backup script). It is free there, and 8765 was avoided because AnkiConnect uses it. The compose host port can still be changed with `TRACKER_PORT`. DESIGN.md is unchanged and still says 8080.
- **Ideas service functions** live in `services/projects.py` so the services folder keeps the outline's four modules and routes never touch SQL.
- **Projects page** handles rename, recolor, type, daily goal, archive/unarchive, and tag add/rename/recolor/delete. Projects are never hard-deleted.
- **Import** replaces all data with the JSON export in one transaction (with a confirm prompt in the UI). Partial merges are not supported.
- **CSV export** is one row per session with local times; JSON export is the full database and is what import reads.
- **`/api/backup`** uses SQLite's online backup API, so the copy is consistent while the app writes.
- **API extras**: the full table from DESIGN.md is implemented. `PATCH /api/ideas` takes the idea id in the body because the table lists no `/api/ideas/{id}` path. Errors: 400 bad input, 404 unknown id, 409 conflicts (pausing a stopped timer, deleting a used tag, duplicate tag name).
- **Service worker** caches only `/static/` files (stale-while-revalidate); pages and `/ui/` fragments always go to the server so timers stay live.
- **PWA icons** are generated PNGs (192, 512) plus an SVG stopwatch.
- **FastAPI `/docs`** still loads Swagger UI from a CDN, as FastAPI does by default. It is a developer tool, not one of the app's pages, so it was left as is; the app pages load nothing from a CDN.

## Theme update (after v1)

- **augmented-ui 2.0.0** instead of the v1 linked in the request: same idea, current release, valid `data-augmented-ui` attribute. Vendored as `app/static/vendor/augmented-ui.min.css` (BSD-2).
- **Shapes** go on containers (panels, cards, timer cards, stat cards, chips, Start button, dialog, toast). Their children carry `data-augmented-ui-reset` where augmented elements nest. Other buttons get a matching cut corner with plain `clip-path`, since augmented-ui borders use `::before`/`::after`, which Pico uses on form controls.
- **Fonts**: Rajdhani (body) and Share Tech Mono (clocks, numbers), vendored from Fontsource with their OFL licenses. Old tech green uses the mono font everywhere; Japan sakura uses the system font.
- **Themes** are presets in `app/config.py` (`THEMES`). The active preset and any changed colors are stored in the `setting` table (`theme`, `theme_colors`) and written into `<html style="--bg: ...">` by the server, so every device shows the same theme and JSON export/import carries it. Only colors that differ from the preset are stored, so picking a preset and saving resets them.
- **Text on accent/danger buttons** (black or white) is chosen automatically from the color's luminance, so any picked accent stays readable.
- **Japan sakura** is the one light theme; the others are dark with faint scanlines.
- **Chart bars** keep the project's color; the daily goal line uses the theme's second accent.

## Production setup and rename

- **Name**: the app is called **Cyber Tracker**. The icon is a hexagon with an inner ring (⌬) in Cyberpunk yellow and cyan. The header shows it as inline SVG, because the ⌬ character is missing from many phone fonts; the browser tab title uses the character. DESIGN.md keeps the original name.
- **Exports** now say `"app": "cyber-tracker"`; files exported before the rename (`"hobby-tracker"`) still import.
- **Target is a Raspberry Pi 3** on 64-bit Raspberry Pi OS Lite. The image also builds for armv7 (32-bit OS), but Docker Engine 28 is the last release for 32-bit Raspberry Pi OS, so 64-bit is the documented path.
- **Container**: runs as `PUID:PGID` from `.env` (default 1000), one uvicorn worker, no access log, Docker logs capped at 3 × 1 MB, `init: true`, 256 MB memory cap, health check every 60 s with a 60 s start period for the slow Pi 3 start.
- **Requirements split**: `requirements.txt` is runtime only; `requirements-dev.txt` adds pytest and httpx.
- **`scripts/install-pi.sh`** does the one-time Pi setup (Docker check or install, `.env`, `./data` ownership, build, health wait, optional backup cron). It asks before installing Docker or touching crontab.
- **Exposure**: the app binds to all interfaces so the LAN can reach it. Internet exposure is not supported (no login); the README says to use Tailscale instead of port forwarding.

## Cyber Miner M0: tracker API for the extension

Plan: [EXTENSION_DESIGN.md](EXTENSION_DESIGN.md), milestone 0.

- **`MinedCard`** table (migration `0002`) with `session_id` as `ON DELETE SET NULL`: deleting a session keeps its cards in the count. Undo-delete restores the session but not the link from its cards.
- **`POST /api/cards` takes an optional `created_at`** (timezone-aware), so cards queued by the extension while the tracker was offline count on the day they were mined. 404 for an unknown project or session.
- **Cards count on the local day they were mined**, with the same timezone and day-start rule as sessions.
- **`services/cards.py`** is a fifth service module; cards are their own concern, like timers and stats.
- **Stats**: `/api/stats` gains `cards: {total, today, range}`. The Statistics page shows the "Cards mined" card only when the selected project has cards, so the page looks the same for anyone not using the extension.
- **Export/import**: JSON export carries a `cards` list. `EXPORT_VERSION` stays 1 because the change only adds a key; exports without `cards` import with zero cards. CSV export is unchanged (sessions only).
- **`GET /api/theme`** returns `{name, label, scheme, vars}`; `vars` are the same CSS custom properties the server writes into `<html style>` (colors, `accent-ink`, `danger-ink`, fonts). `Theme.css_vars` now feeds both.
- **`extension/shared/themes.json`** uses the same `vars` shape as `/api/theme`, so the extension treats the live theme and the bundled presets alike. It is written by `scripts/sync-extension.py` (see M1).
- **`extension/`** is in `.dockerignore` (the Pi image does not need it); `extension/dicts/` is in `.gitignore`.

## Cyber Miner M1: skeleton, theme and Anki

- **No Alpine in the extension.** Alpine's CSP build (the only one MV3 allows) evaluates plain property paths only: no arguments, no `!`, and `x-model` works only with getter/setter objects. The options form would have been mostly boilerplate, so popup and options use plain JS with `shared/bind.js`: `data-field="anki.decks.ja"` binds a control to the settings object both ways; a checkbox with a `value` toggles membership of an array (target languages); a `<select>` whose current value is a number stays a number.
- **`scripts/sync-extension.py`** copies `app/static/app.css` to `extension/styles/tracker.css` (font URLs rewritten), Pico, augmented-ui and the fonts to `extension/vendor/`, and `THEMES` to `extension/shared/themes.json`. It replaces `export-themes.py`. The copies are committed so the folder loads unpacked as is; re-run the script after changing the tracker's look.
- **Fixed extension ID** `cefkpipdhcgbgpljnndingfpdpknkahf` from the public `key` in `manifest.json`, so Linux and Windows get the same ID and AnkiConnect's permission carries over. The private key was not kept: it is only needed to pack a `.crx`, which we do not do.
- **Icons** are `app/static/icons/icon-512.png` resized to 16/32/48/128 (Pillow, once). Regenerate by hand if the tracker icon changes.
- **Permissions**: `storage` plus host access to AnkiConnect at `127.0.0.1:8765` and `localhost:8765`. The tracker URL (and an AnkiConnect URL on another address) is requested at runtime with `chrome.permissions.request`, called first in the click handler so the user gesture is not lost.
- **Settings** live in `chrome.storage.sync` (shared between your machines by Chrome sync), merged over defaults on load; stored values of the wrong type fall back to the default. The tracker theme is cached in `chrome.storage.local`, so the look stays when the Pi is off.
- **AnkiConnect setup**: Connect calls `requestPermission` (Anki shows its dialog; the call waits up to 2 min for the click). "Set up decks + note type" creates missing decks for the enabled languages, creates the note type or adds fields it lacks (`modelFieldAdd`, by position), copies the fonts into Anki's media folder and pushes the theme. "Send test note" adds a Japanese test note with the icon as picture (duplicates allowed) and opens it in Anki's browser.
- **Card fonts** are stored in Anki's media folder as `_cyber_*.woff2` (a leading underscore keeps them through "Check media"). Japanese and Chinese text falls back to Noto Sans CJK / Hiragino / Yu Gothic / Microsoft YaHei, picked by the card's `lang` attribute.
- **Japanese reading**: when a word is typed without a reading, `WordReading` gets the word itself, because the Japanese back shows `{{furigana:WordReading}}` and would otherwise be empty.
- **Tag values** replace spaces, `:` and quotes with `_` so a show called "Frieren: Beyond Journey's End" cannot create nested tags.
- **Tests**: `extension/package.json` only sets `"type": "module"` for Node; there are no dependencies. Node 22 needs a glob: `node --test 'tests/*.test.js'`.
- **CORS for the extension on the tracker.** On Chrome 155 a runtime-granted host permission for the Pi (`http://192.168.0.101:8686/*`, stored and active in the profile) still did not lift CORS for the extension's service worker: "No 'Access-Control-Allow-Origin' header". A copy of the extension with the address in the manifest's `host_permissions` worked in headless Chrome, but the tracker URL cannot be known at build time. So the tracker now answers CORS for the extension's origin only (`CORSMiddleware`, `allow_origins` from `EXTENSION_ORIGINS`, default `chrome-extension://cefkpipdhcgbgpljnndingfpdpknkahf`), including Chrome's private-network preflight (`allow_private_network=True`). Web pages still get no CORS headers. `starlette==1.7.0` is pinned because older releases lack `allow_private_network`.
- **Tracker errors show the browser's reason** (`TypeError: Failed to fetch`, `TimeoutError`), tracker requests get 5 s and one retry, and Test connection says so when the tracker is too old to have `/api/theme`.

## Cyber Miner M2: YouTube mining

- **Audio from the `<video>` element, not `tabCapture`.** On YouTube (no DRM) `video.captureStream()` gives the audio without any permission, and playback keeps sounding normal. `tabCapture.getMediaStreamId` only works after the user invokes the extension (hotkey or toolbar), so the in-page ⌬ button could not have used it. Netflix (M4, DRM) will still need `tabCapture`.
- **Recording replays the line**: seek to `start − 250 ms`, play at 1×, record with `MediaRecorder` (WebM/Opus) until `end + 500 ms`, pause and return to where you were. The offscreen document decodes the clip (`OfflineAudioContext`, 44.1 kHz mono) and encodes MP3 with lamejs 1.2.1 (vendored unmodified, LGPL-3.0, `vendor/LICENSE-lamejs.txt`). Offscreen reason: `BLOBS`.
- **Screenshot from the video element** (`drawImage` on a canvas), scaled to the screenshot width; an all-black or unreadable frame gives a card without a picture.
- **Subtitles**: `content/page-hook.js` runs in the page's world at `document_start`, wraps `fetch` and `XMLHttpRequest`, and copies every `/api/timedtext` response (keeping the last 30 for a content script that starts later). It also answers `info` (video id, title, channel, caption tracks from the player response) and `enableTrack` (turns on the chosen track with `setOption("captions", "track", …)`, so the player fetches it with its own token). Responses that are not json3 are fetched again with `fmt=json3`.
- **Translation track**: built from the player's primary URL (it carries the proof-of-origin token): a manual track in the translation language when there is one, otherwise YouTube's auto-translate (`tlang=en`). Fetched by the content script, same origin.
- **Which track to mine**: an auto-generated (asr) track in a target language marks the spoken language and wins; otherwise the first target language (options order) with a manual track. Manual beats asr in the same language; Chinese prefers simplified. A video with only translated tracks (e.g. a Japanese vlog with zh-Hant but no ja) mines the translated track — acceptable for now.
- **Overlay** is a Shadow DOM inside `#movie_player` (stays in fullscreen), styled with constructable stylesheets (`adoptedStyleSheets`, not affected by YouTube's CSP); fonts are declared at document level because `@font-face` does not work inside a shadow root. The DOM is built with `h()`, never `innerHTML` (YouTube enforces Trusted Types). Clicks and keys inside the overlay stop at the shadow root so YouTube's player and shortcuts do not react. Native captions are hidden while the overlay shows the same track.
- **Content scripts load modules** through `import(chrome.runtime.getURL("content/app.js"))` (content scripts cannot be ES modules), so `content/*`, `shared/*`, the overlay CSS, augmented-ui and fonts are web-accessible on youtube.com. `use_dynamic_url` is off: it breaks dynamic imports from content scripts.
- **Sending**: the worker checks `canAddNotesWithErrorDetail` first; a duplicate opens the "Send anyway" choice. When Anki is unreachable the whole draft (with media) is queued in `chrome.storage.local` (`unlimitedStorage`), the toolbar badge shows the count, and the popup sends them. Cards mined per day are counted in `chrome.storage.local` (two weeks kept) for the popup and toast. Sending to the tracker (`POST /api/cards`) waits for M3, which adds the language → project mapping.
- **Hotkeys** reach the content script through `chrome.commands` → worker → `tabs.sendMessage`. A/D (previous/next line) are page keys, ignored while typing.
- **Headless test note**: on install the extension opens its Options tab, which leaves a YouTube tab in the background where Chrome does not start the video. Focus the YouTube tab when testing.

## Cyber Miner M2b: card side bar and word lookup

After testing M2, the card panel inside the player covered the subtitles. Card editing moved to Chrome's side panel, and the dictionaries planned for M5 moved forward so the selected word gets its definition.

- **Chrome side panel** (`sidePanel` permission, `side_panel.default_path`), one page for all tabs that shows the active tab's draft. `chrome.sidePanel.open()` needs a user gesture, so it is called before any `await`: in the `commands.onCommand` handler for Alt+M, in the worker's message listener for a click in the page (⌬ button, subtitle character), and in the popup's "Card side bar" button with the window id fetched when the popup opens. If Chrome refuses the click from the page, the toast says to press Alt+M.
- **Fullscreen**: mining from the side bar first leaves fullscreen (Chrome hides the side panel there). Quick mine stays in fullscreen.
- **Drafts** live in the worker as `storage.session["draft:<tabId>"]` (`{draftId, tabId, draft, meta: {deck, audio: {state}, pick}}`). The content script owns recording and updates the draft; the side bar reads it and follows `storage.onChanged`, so it updates live when the MP3 is ready. Re-record goes side bar → content script; Discard and Send clear the draft and stop a recording in progress. Drafts are removed when their tab closes.
- **Clicks on the subtitle bar**: each character is a span carrying its offset in the mined sentence (`lineOffsets()`; lines are joined with "" for ja/zh and " " for it, the same as `sentenceText()`). A click passes `{start}`, a drag `{start, end}` to the side bar, which does the lookup.
- **Word picking in the side bar**: click = longest dictionary match from that character; drag = exactly the dragged text (also looked up). Without a dictionary, a click picks a run of the same script (魔法の → 魔法; Chinese: one character) or the letters of an Italian word.
- **Card bolding** uses the selected range (`draft.highlight`) when there is one, so the card shows 昨日は**食べられなかった** while Word holds 食べる. Without a range, the first occurrence of the word is bolded as before.
- **Dictionary files** are JSON Lines (`<lang>.jsonl.gz`, one object per line: header, entries, keys, pitch, forms) so the browser can stream the import. Keys (word → entry ids) are precomputed by the script, so the import is plain puts. `extension/dicts/manifest.json` lists the built files for the options page.
- **Japanese**: JMdict search-only spellings (`sK`/`sk`) are indexed but not shown. Deinflection is a generated rule table (godan rows × suffixes, plus ichidan, 来る, する, ます, て-auxiliaries and i-adjective forms) applied Yomitan-style; a candidate only counts when an entry sense's part of speech fits. Results with fewer conjugation steps come first, so 食べられなかった lists 食べられる (its own JMdict entry) before 食べる; both are offered.
- **Italian**: forms come from `form_of` senses and from each lemma's `forms` table (stress marks removed via the table's links; written final accents like *parlò* kept); tables of multi-word lemmas ("dire addio") are skipped so *dico* maps only to *dire*/*dicere*. Compound entries (*dimmelo*) record their lemma from the gloss ("… of dire, with …").
- **Pitch** is drawn on the card as inline SVG (kana above, dots high/low, hollow dot for the particle) per downstep value, from the reading's kana; it is cleared when you retype the word by hand.
- **Tests**: dictionary fixtures are small excerpts of the built files (`extension/tests/fixtures/dict-*.jsonl`, attribution in the test file); `tests/test_fetch_dicts.py` runs the Chinese and Italian builders on tiny inputs and checks pinyin conversion.

## Cyber Miner: short audio clips

Reported: a subtitle line with about 10 s of speech gave a clip of only its first part. Without the video at hand, all likely causes are handled and the side bar now shows the timing so the next case can be read off.

- **Auto-generated lines are not cut before their last word.** A line still on screen when the next starts ends where the next starts, but never before its last word's timing (from the json3 word offsets) + 0.6 s.
- **The replay runs to the end time.** If the page pauses the video during recording (YouTube's player sometimes does after a seek), the recorder presses play again (up to 5 times) instead of stopping. It reports the span it actually played.
- **Side bar timing**: "Line 12:41.2–12:51.0 · clip 12:40.9–12:51.5 (10.6 s)", plus "replay stopped at …" when the recording ended more than 0.3 s early.
- **Clip controls** in the side bar: start/end −0.5 / +0.5 s (clicks within 0.6 s are sent as one change), "⏮ + line" and "+ line ⏭" to take in the previous/next subtitle line. Adding a line rewrites the sentence and translation from the subtitles (a hand edit of the sentence is replaced) and keeps the selected word on the same text. Every change records again.

## Cyber Miner M3: watch time and card counts

All in the extension; the tracker endpoints already existed (sessions) or came with M0 (cards, CORS). Anki is not involved.

- **The page polls the player once a second** (`content/watcher.js`) instead of listening to media events: our own replays, YouTube's buffering and ads all fire play/pause events. A session starts after 10 s of real playback of a video with a ja/zh/it track; ads count as paused; a heartbeat goes out every minute while playing; the video ending, leaving it (navigation, page unload) or 10 min paused (Options) stops it. Ticks are capped at 5 s so a throttled background tab does not count as long playback.
- **Making a card is study time**: while a card is being mined (draft open) or a line replayed, the session keeps its state even though the video is paused. Closing the draft with the video paused then pauses the session.
- **The worker keeps one session per tab** (`background/watch.js`, records in `storage.local` so they survive a browser restart). It counts pauses itself and, at the end, stops the session and PATCHes `ended_at` and `paused_sec`, so a missed pause call does not matter. A paused session ends where the pause began; one whose tab or browser closed ends at its last heartbeat (on browser start and on extension reload, which orphans the old content scripts).
- **Projects per language** are tracker project ids in the settings (0 = not logged), chosen in Options from the tracker's projects, with "Create" for a missing Japanese/Chinese/Italian project (language type, so it gets the starter tags). Tag names (default "Watching, YouTube" / "Watching, Netflix") are resolved to ids at session start and created when missing.
- **Tracker unreachable**: the session is kept locally and sent as a past session (`POST /api/sessions` + `paused_sec`) when it ends, noted "Logged by Cyber Miner while the tracker was unreachable". Every tracker write goes through one queue in `storage.local`, sent in order and retried every 5 minutes (`alarms` permission) and after each event. A call the tracker refuses (404/409, e.g. a session deleted meanwhile) is dropped rather than blocking the queue; a session stopped in the tracker while paused is replaced by a new one on resume.
- **Mined cards** are counted after Anki accepts them (`POST /api/cards` with project, the tab's session if one is running, site, video title, word and Anki note id). Quick mine and the side bar both pass the tab. If the session is gone the card is counted without it. Cards that waited for Anki are counted when they reach it, without a session.
- **Popup**: this tab's state ("Watching · Japanese", "Paused", "no tracker project set", offline), a live clock, how many calls wait for the tracker, and "Don't track this tab" (ends the running session; kept until the browser closes).

## Cyber Miner: movable subtitle bar

- **Press and hold for 0.4 s** anywhere on the bar picks it up (a line fills along its bottom edge while holding); it then follows the pointer (pointer capture, so a fast pointer leaving the bar keeps it). Moving more than 6 px before that is a text drag, and a quick click a word pick, as before; releasing a moved bar never picks a word.
- **Position** is `{x, y}` in % of the player: x = the bar's centre, y = its bottom edge from the player's bottom, so the bar grows upwards when a line wraps or the translation shows. It is clamped so the whole bar stays inside the player, again whenever the player is resized (theater mode, fullscreen). A moved bar stays put when YouTube's controls hide; the default spot still drops to the bottom.
- **One position for every video**, saved on release in the synced settings (`overlay.position`, null = default). Every open YouTube tab follows the settings change.
- **Reset**: ⟲ on the bar (shown on hover once moved) and "Reset subtitle position" in the popup (shown while moved), in case the bar ends up hard to grab.
