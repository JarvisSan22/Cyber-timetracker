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
- **Moves are followed on the window** (capture phase) while the bar is held, not only on the bar: Netflix takes the pointer for its own player element, so the bar got no moves there and could not be dragged.
- **Reset**: ⟲ on the bar (shown on hover once moved) and "Reset subtitle position" in the popup (shown while moved), in case the bar ends up hard to grab.

## Cyber Miner M4a: site adapters

Groundwork for Netflix with no change in behaviour on YouTube.

- **`app.js` talks only to the adapter** (`content/sites/index.js` holds the interface and picks it by hostname). The adapter owns everything a site does differently: watch page and navigation, player element, ad check, control-bar autohide, video info (`title`, `show`, `tracks`), subtitle loading, seeking, source URL and the CSS that hides native captions.
- **Subtitles are callbacks**: `subtitles(video, target, {lang, translationLang, onPrimary, onTranslation, onError})` returns a stop function. YouTube's json3 capture, refetch and `tlang` translation moved there from `app.js`; Netflix will download both tracks from its manifest behind the same call.
- **Seeking goes through the adapter and is awaited** (recording, replay, return after recording), because Netflix breaks when `currentTime` is set. YouTube's `seek` sets `currentTime` and waits for `seeked` (3 s at most).
- **Page hook in two files**, both MAIN world at document_start: `content/page-hook.js` (shared: copies fetch/XHR responses whose URL the site wants, keeps the last 30, message plumbing, `dump`) and `content/hooks/<site>.js` (registers its URL filter and player commands through a one-shot `__cyberMinerRegister`). The bridge event is now `captured` instead of `timedtext`.

## Cyber Miner M4b: Netflix subtitles

- **Manifest after decryption, not by URL**: the manifest request (`/msl/playapi/cadmium/licensedmanifest/1`) and its response are MSL-encrypted (`{"headerdata": …}`), so copying the network response is useless. `content/hooks/netflix.js` watches JSON.parse (and `Response.json()`) for the decrypted result with `movieId` and `timedtexttracks` (older) or `textTracks` (newer; each track's formats under `ttDownloadables` or `downloadables`), and passes on `{movieId, timedtexttracks, audio}` through the shared capture list, so a content script that loads late still gets it (`dump`). /metadata is plain JSON and is copied by URL. Same approach as Tithen-Firion's "Netflix - subtitle downloader" userscript (MIT).
- **Text formats are asked for**: the hook adds `imsc1.1`, `dfxp-ls-sdh`, `webvtt-lssdh-ios8` and `simplesdh` to the `profiles` of the manifest request (the JSON.stringify'd object whose `url` names the manifest) and sets `showAllSubDubTracks`. Without that Netflix may list only image subtitles or only some languages.
- **Both tracks are downloaded directly** from the manifest URLs by the content script (no track switching, unlike YouTube). Format preference: imsc1.1, dfxp-ls-sdh, simplesdh, webvtt. Track order per language: subtitles, then closed captions (sound descriptions), then image-only (`nflx-cmisc`; shown as "Image subtitles: cannot be read").
- **The spoken language picks the target**: Netflix offers subtitles in many languages, so the target is the language of the audio playing (player API `getAudioTrack()`, else the manifest's original audio). Audio not ja/zh/it shows "Audio is en, not ja/zh/it". Switching the audio track needs a page reload.
- **Parsers** (`shared/subformats.js`, no DOMParser so Node tests run them): TTML with tick, clock, frame and offset times; ruby text dropped (by `tts:ruby="text"` on the span or on a referenced style), ruby base kept; layout line breaks in the file ignored (no space in ja/zh), `<br/>` kept. WebVTT with cue settings, tags and `<rt>` stripped.
- **Title**: "Show S1E3" from /metadata, else the player's title bar, else the page title.
- **Navigation**: Netflix has no navigation event; the adapter polls the address every 0.5 s, so the next episode (`/watch/<new id>`) sets up again.
- **Bar position**: the default spot sits higher on Netflix (15% of the player above the bottom, 6% while the controls are hidden); a moved bar uses the same saved position on both sites.
- **Seek** uses Netflix's player API already (A/D keys, replay). Audio recording and the picture still use the YouTube way and fail on Netflix's DRM video until M4c.

## Cyber Miner M4c (part): Netflix screenshot

- **Tab screenshot instead of canvas** on Netflix (adapter `frame: "tab"`): DRM video draws black on a canvas. The page asks the worker (`capture-frame`), which calls `chrome.tabs.captureVisibleTab`, crops to the picture and scales it in an OffscreenCanvas, and returns the same `{data, ext: "jpg"}` at the same width and JPEG quality as YouTube's canvas frames.
- **Clean frame**: for the capture the page hides our subtitle bar and, with a temporary style, everything in Netflix's player that is neither the video nor a box containing it (controls, title, pause dimming); it waits 300 ms and two frames so the page has repainted and settled after the side panel opened or fullscreen ended, then restores both.
- **Crop** is the picture inside the `<video>` element (`shared/frame.js` `pictureRect`, letterbox bars left out), converted to screenshot pixels by screenshot width / `innerWidth` (device pixel ratio and zoom).
- **Black frame** (hardware DRM on Windows): no picture, the card goes without one; the console says so. Same black check as the canvas path, shared in `shared/frame.js`.
- **Permission**: Chrome refuses captureVisibleTab with only a host permission ("Either the '<all_urls>' or 'activeTab' permission is required"). `activeTab` (hotkey or toolbar icon in the tab) did not work in testing on Netflix, so Options → Cards → "Allow Netflix pictures" requests the optional `<all_urls>` host permission (removable there). Without it the card goes without a picture and the toast points to Options. The content scripts still match only YouTube and Netflix.

## Cyber Miner M4c (part): Netflix audio

- **Chrome's "Share this tab" prompt** (`getDisplayMedia` with `preferCurrentTab`, from the content script) instead of `chrome.tabCapture`: tabCapture needs the same activeTab grant that did not work for screenshots, and no install-time or Options permission turns either on. The prompt appears on the first click on ⌬ or a word in a Netflix tab (it needs a click in the page; Alt+M alone cannot show it, and recording then says to click ⌬ once). "Also share tab audio" must stay ticked.
- **One stream per page**: the video track is stopped at once, the audio track is kept until the tab closes or reloads or "Stop sharing" is pressed, and every recording and re-recording in the tab uses it. `suppressLocalAudioPlayback: false`, so the video stays audible.
- **Same recording flow as YouTube**: `recordRange` gets the shared tab's audio tracks (adapter `audio: "tab"`) instead of `video.captureStream()`, replays the clip in real time through Netflix's player seek and leaves the stream open. Then the same MP3 encoding. Everything the tab plays is recorded, so a muted tab gives a silent clip.

## Cyber Miner: translation line setting

- **Options → Languages → "Translation line under the subtitle"**: blurred until hover (default), always shown, or hidden (`overlay.translation`, synced). Every page starts with it; Alt+S still cycles the three for the current page, and a new choice in Options applies to open tabs at once.

## Cyber Miner: audio player

- A slider to retake the picture at another moment of the clip was tried and taken out again (it broke the pictures); the picture is taken when mining, as before.

- **Audio player** in the app's style instead of Chrome's `<audio controls>`: ⌬-yellow play/pause button with a cut corner, a gradient progress bar (click to jump), mono time readout; Space plays/pauses outside text fields. Theme tokens only, so it follows the tracker theme.

## Cyber Miner M3b: known words from Anki

- **Sources**: the Cyber Miner decks' Word field always counts; other decks are added in Options > Known words as deck + field + language (field names read from up to 50 notes of the deck). The worker reads every card with `findCards` + `cardsInfo` (500 per call) and keeps one entry per word: status, interval, deck. The best card wins (known > learning > new, then the longer interval).
- **Status**: new (card not studied, type 0), learning (interval under the threshold), known (interval at least `known.matureDays`, default 21 = Anki's "mature"). "Unknown" = in none of the decks.
- **Field text to words**: HTML, `[sound:…]`, Anki furigana `食[た]べる` and bracketed notes are removed; commas, slashes, 、 and line breaks split several words. Italian is lower-cased.
- **The list** lives in `storage.local` (`knownWords`). It is rebuilt when older than an hour (5-minute alarm, browser start, install), on first use, and by "Refresh from Anki"; a mined card's word is added as "new" at once. One rebuild at a time.
- **Bar colours**: the worker (which has the extension's IndexedDB) splits each line the way a click does: the dictionary's longest match at each position, inflected forms matched by their dictionary form. Grammar words stay uncoloured (Japanese particles, auxiliaries, copula, single hiragana; Italian articles, prepositions, pronouns and words of 1–2 letters; a short list of Chinese function characters), and so does text the dictionary does not know. Default look: unknown = accent colour, new or learning = dotted underline, known = plain. Each of the three can be set in Options to no colour, a theme colour (accent, second accent, warning, red, dimmed) or an underline, e.g. colour only the known words while a new deck makes almost everything unknown. The choice goes to the overlay as CSS variables (`--w-<status>-color/-deco`), so it follows the theme. Marks are cached per sentence; the next two lines are asked for ahead.
- **Side panel badge** under Target word: "New word · not in your Anki decks", "Learning · 5 d · deck", "Known · 45 d · deck", or, when the card is in a Cyber Miner deck, "Already mined in Mining::Japanese" in the warning colour. Sending is never blocked (Anki's own duplicate check on the sentence stays).
- **Mining tag**: the first card mined during a watch session adds the tag from Options (`tracker.miningTag`, default "Mining") to that session: a queued PATCH with the whole tag list, because the tracker replaces a session's tags. A session still offline gets it when it is sent as a past session.
- **Tracker projects** are now matched by name when a language has none: Japanese / 日本語, Chinese / 中文 / 中国語, Italian / Italiano. Before, a project named 日本語 was not found and nothing was logged.

## Cyber Miner M4d (part): Netflix audio language

- The audio language is asked from Netflix's player for up to 5 s (it picks its track a moment after the manifest arrives) and only trusted when the manifest lists that language for the video; otherwise the original audio. The console says which ("audio ja (player)").
- Every 3 s the player's audio language is checked again; picking another audio track in Netflix's menu sets up the video again, so the target subtitles follow without a reload.

## Cyber Miner: cards today per language

- The extension's own "cards today" count (toast and popup) is kept per day **and language** (`minedCounts[day] = {ja: 5, it: 20}`), not one number for all languages. The toast says "Card mined · 20 Italian today"; the popup lists each language mined today. A day saved by an older version (one number) starts again from 0. The tracker's "Cards mined" was already per project.

## Cyber Miner M5: transcript

- **Side panel tabs** Card and Transcript. The panel opens on Transcript when the tab has no card in progress and has lines; a new card switches to Card, Send or Discard goes back.
- **Lines** (`shared/transcript.js` `transcriptRows`: index, start/end, the line as one sentence, the translation by overlap) are sent by the content script when the subtitles or the translation arrive (`transcript-set`), stored by the worker in `storage.session` as `transcript:<tabId>` (content scripts cannot use storage.session), removed on a new video and when the tab closes.
- **Position and commands** over a port (`transcript`) the panel opens to the tab: the content script posts `{videoId, index, playing}` only when it changes (checked in the 100 ms tick); the panel sends `seek {index}` (to the line's start) and `mine {index}` (pause, seek 50 ms into the line, mine it; `mine()` takes `cueIndex`). A reloaded page drops the port; the panel connects again when new lines arrive.
- **Following**: the current line is highlighted and scrolled to the middle while "Follow video" is on; a wheel or touch scroll in the list turns it off.
- **Word colours** in the panel itself (it has the dictionaries and `knownWords`), for rows within 300 px of the screen (IntersectionObserver), one row at a time, same `markWords` and the same colour settings as the bar. Each row shows how many words are not in Anki; "Lines with new words" checks every row (progress in the header) and hides the rest.
- **Netflix**: mining from the panel cannot show Chrome's "Share this tab" prompt (it needs a click in the page), so it works once the tab audio was shared from the video; otherwise the Card tab shows the usual message to click ⌬ on the video once.

## Cyber Miner M6: several lines in one card, picture choices

- **Several lines**: Shift-click in the Transcript selects from the last clicked line (or the current one) to the clicked line, at most 10 lines; "⌬ Mine as one card" (or ⌬ on a selected line) sends `mine {index, last}`. The content script joins the lines like "+ line" does (`joinCues`: sentence, translation by overlap, clip from the first start to the last end) and keeps first/last so the clip controls still work.
- **Picture choices instead of a retake slider**: the slider that seeked the paused video to take a new picture broke pictures and was taken out. Now the frames come from the replay that records the audio anyway: `recordRange` grabs pictures at the middle of 4 equal parts of the clip while it plays (no extra seeking). Netflix's tab screenshots are limited to 2 a second, so a short clip gets fewer (one per 600 ms), and the bar and Netflix's controls stay hidden during that replay. The side panel shows them as thumbnails next to the picture taken when mining; the chosen one is sent, the others are not. Quick mine takes none.

## Cyber Miner M7: condensed audio

Plan: [EXTENSION_DESIGN.md](EXTENSION_DESIGN.md), milestone 7.

- **Subtitles find the pauses**, not loudness: the extension plays only the lines (padded 250 ms before, 400 ms after) and seeks over gaps of 1.5 s or more. Recording is real time (both sites only give audio by playing it), so it takes as long as the condensed MP3, not the whole video. Spans are at most 60 s and never overlap (`shared/condense.js` `planSpans`).
- **Span by span with the card recorder** (`recordRange`) and the card MP3 encoder (offscreen lamejs). lamejs writes bare MP3 frames with the same rate, channels and bitrate every time, so the parts joined are one valid file.
- **Saved where the user picks**: Start opens Chrome's save dialog (`showSaveFilePicker`, fixed `id` and `startIn: "downloads"`), so it opens in Downloads the first time and in the last folder used after that. Chosen over `chrome.downloads` (needs a new permission, cannot point at a folder, and blob URLs from the page are awkward there) and over an `<a download>` from the page (always Downloads). The dialog needs a click, so it comes before recording, and the panel writes the parts into the file as they arrive; cancel, errors and a closed tab remove the file.
- **Own port** (`condense`) per recording instead of the transcript port: the panel's transcript port is dropped when the panel follows another tab, which would have stopped the recording. Closing the panel cancels it.
- **Ads**: the adapter's existing `isAd()` (YouTube and Netflix) is used; no new `adShowing()`. The span an ad cuts is redone after the ad.
- **The user moving the video**: the player's own controls cannot be blocked, so a move is undone: the span is redone from its start. A `seeking` event alone missed YouTube timeline clicks in testing, so the runner also checks the time against the span (more than 1 s before or 3 s after counts; 3 s also covers a late check in a slowed tab). Our own seeks and 1.5 s after them are not counted (players nudge the position once more). At most 20 redos, then an error.
- **Asking before stopping**: jumping to or mining a line from the transcript shows a dialog ("Stop the recording and jump to this line?"); on the page (bar, A/D, Alt+R) the first press shows a toast and a second within 4 s stops it, because a dialog would leave fullscreen. A note under the progress bar says not to touch the video and flashes red when it was moved.
- **Netflix** works the same with the shared tab audio (click ⌬ once first). Tab audio is the tab's output, so Netflix's volume slider sets the file's loudness. Next-episode autoplay before the end cancels the recording (a new video); keeping the part already recorded is left for later.
- Tested by hand on YouTube and Netflix 2026-10-27.

## Cyber Miner popup: open Cyber Tracker

- **Open Cyber Tracker** button in the popup: switches to a tab that already shows the tracker (`chrome.tabs.query` on the tracker address, which works with the tracker's host permission asked when the address is saved), else opens it in a new tab; with no address set it opens Options.
