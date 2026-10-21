**English** | [日本語](README.ja.md)

# ⌬ Cyber Miner

A Chrome extension that turns **YouTube** and **Netflix** subtitles into Anki sentence cards, in the Cyber Tracker look. It shows the subtitle line in its own bar over the video. Click a word and it pauses, records the line's audio as MP3, grabs the frame and looks the word up. The card is built in Chrome's side panel and sent to Anki through AnkiConnect. It also logs your watch time and mined cards to [Cyber Tracker](../README.md), so immersion and mining show up in the same statistics.

Languages: **Japanese**, **Chinese (simplified)** and **Italian**, with English as the translation line.

![Italian lesson on YouTube: the subtitle bar on the video and the card editor in the side panel](../docs/images/readme-4.png)

Plain JavaScript (ES modules), Manifest V3, no build step, no npm dependencies. Loaded unpacked; not in the Chrome Web Store. Design and build plan: [docs/EXTENSION_DESIGN.md](../docs/EXTENSION_DESIGN.md). Choices made during the build: [docs/DECISIONS.md](../docs/DECISIONS.md) (the "Cyber Miner" sections).

## Features

### Subtitle bar
- Replaces the site's own captions with one bar inside the player: the target-language line, and the English line under it.
- **Translation line**: blurred until you hover it (default), always shown, or hidden. Set it in Options > Languages; **Alt+S** switches it for the current video.
- **Click a character** to mine the line with the word starting there (longest dictionary match). **Drag** across characters to pick exactly those.
- **⌬ button** mines the line without a word.
- **A / D** jump to the previous / next line; **Alt+R** replays the current line.
- **Moving the bar**: press and hold it for 0.4 s, then drag it anywhere in the video. The position is kept for every video and synced between your machines. **⟲** on the bar (on hover) or "Reset subtitle position" in the popup puts it back.
- Sized to the player, not the window, so it fits a small player, theater mode and fullscreen. It moves down when the player's controls hide.

![Subtitle bar moved to the top of the video](../docs/images/readme-10.png)

### Making a card
Mining pauses the video, leaves fullscreen and opens the **side panel** next to the video.

<p align="center"><img src="../docs/images/readme-5.png" alt="Card editor for a Japanese line: picture, audio, picked word with reading and pitch accent" width="420"></p>

- **Picture**: the video frame (YouTube: drawn from the video; Netflix: a screenshot of the tab with the controls hidden, cropped to the picture).
- **Audio**: the line is replayed in real time and recorded, then encoded to MP3. A player in the app's style plays it back (Space plays/pauses).
- **Clip controls**: move the start or end by 0.5 s, or take in the previous / next subtitle line ("⏮ + line", "+ line ⏭"). Each change records again. The timing readout warns when a replay stopped early.
- **Sentence**: click a word or drag a selection; the selected word is what the card is about. ✎ Edit to fix the text.
- **Dictionary lookup** (offline, in the browser):
  - Japanese: JMdict with readings and pitch accent (Kanjium), and deinflection (食べなかった → 食べる).
  - Chinese: CC-CEDICT with pinyin.
  - Italian: Wiktionary (kaikki.org) with inflected forms and clitics (dimmelo → dire).
  - "Use" fills Target word, Reading and Definition. Every field can be edited by hand.
- **Send to Anki** (Ctrl+Enter). A duplicate in the deck is flagged with "Send anyway". If Anki is closed, the card waits and is sent when Anki is back.
- **Quick mine** (**Alt+Shift+M**): sends the line straight away without the side panel.

### The card in Anki
Own note type **Cyber Sentence**, one deck per language (`Mining::Japanese`, `Mining::Chinese`, `Mining::Italian`), styled like the tracker (same theme colours and fonts, pushed to Anki from Options).

Fields: Sentence, SentenceTranslation, Word, WordReading, WordPitch, WordDefinition, Audio, Picture, Source ("Frieren S1E3 · 12:41"), SourceUrl (link back to that moment), Lang, Notes. Japanese gets furigana on the target word and a pitch accent graph. Tags: `cyber-miner`, the site, `show::<name>` and `mined::<date>`.

![A Cyber Sentence card in Anki](../docs/images/readme-7.png)

### Netflix
Works like YouTube:
- **Subtitles**: Netflix lists every subtitle track for the episode; the extension downloads the target track and the English one directly. Furigana in Japanese Netflix subtitles is dropped from the sentence.
- **Target language**: the **audio language playing** picks the subtitle track, because Netflix offers subtitles in many languages. Audio that is not ja/zh/it shows a message instead.
- **Seeking** uses Netflix's own player (setting the video time directly breaks it).
- **Pictures** need **Options > Cards > "Allow Netflix pictures"** once (Chrome only allows tab screenshots with access to all sites; the extension still runs only on YouTube and Netflix).
- **Audio** comes from Chrome's **"Share this tab"** prompt: on the first click on ⌬ or a word in a Netflix tab, allow it with "Also share tab audio" ticked. It stays shared until the tab closes or reloads.
- On **Windows**, Netflix screenshots are often black (hardware DRM); the card then goes without a picture.

![Japanese episode on Netflix with the card editor open (purple theme)](../docs/images/readme-6.png)

### Watch time in Cyber Tracker
- A video with a ja/zh/it track starts a **watch session** in Cyber Tracker after 10 s of playback, under the project you picked for that language, with the tags "Watching, YouTube" or "Watching, Netflix".
- The session pauses with the video and during ads; making a card counts as study time.
- It stops when the video ends, you leave it, or after 10 min paused.
- **Mined cards** are counted in Cyber Tracker ("Cards mined" on the Statistics page).
- **Tracker offline**: sessions and cards are kept and sent later.
- The **popup** shows this tab's session with a live clock, cards today, and "Don't track this tab".

<p align="center"><img src="../docs/images/readme-8.png" alt="Toolbar popup: Anki and tracker status, this tab, cards today" width="420"></p>

### Keys

| Key | What it does |
| --- | --- |
| Alt+M | Mine the current line (opens the side panel) |
| Alt+Shift+M | Quick mine: send without the side panel |
| Alt+R | Replay the current line |
| Alt+S | Translation line: blurred / shown / hidden |
| A / D | Previous / next line |
| Ctrl+Enter | Send the card (side panel) |
| Space | Play / pause the card audio (side panel) |

Change the Alt shortcuts at `chrome://extensions/shortcuts`.

## Setup

<p align="center"><img src="../docs/images/readme-9.png" alt="Options: Anki, languages, dictionaries" width="520"></p>

### 1. Load the extension
1. Chrome 116 or newer. Open `chrome://extensions` and turn on **Developer mode**.
2. **Load unpacked** and pick the `extension/` folder of this repo. The extension ID is always `cefkpipdhcgbgpljnndingfpdpknkahf` (fixed key in the manifest), which the tracker's CORS setting expects.
3. After pulling a new version, press the reload button on the extension card, then **reload any open YouTube/Netflix tabs**. Tabs left open from before cannot reach the reloaded extension ("refresh this tab" in the console).

### 2. Anki
1. Install the [AnkiConnect](https://ankiweb.net/shared/info/2055492159) add-on (code `2055492159`) and keep Anki open.
2. In **Options > Anki**, press **Connect** and allow Cyber Miner in the dialog Anki shows.
3. Press **Set up decks + note type**. It creates the decks and the Cyber Sentence note type, and copies the fonts and theme to Anki.
4. **Send test note** to check the card style.

### 3. Dictionaries
They are downloaded once and shrunk to what the lookup needs (about 30 MB for all three; not committed to git):

```bash
python3 scripts/fetch-dicts.py            # ja, zh, it
python3 scripts/fetch-dicts.py ja         # only some
```

Then reload the extension and press **Import** per language in **Options > Dictionaries**. Lookups work offline from then on.

### 4. Cyber Tracker (optional)
1. In **Options > Cyber Tracker**, enter the tracker's address (for example `http://192.168.0.50:8686`) and press **Test**. Chrome asks for access to that address.
2. Pick a project per language (or **Create** the missing ones) and the watch tags.

The tracker allows the extension's origin by default (`EXTENSION_ORIGINS`, see `app/config.py`).

### 5. Netflix
- **Pictures**: **Options > Cards > Allow Netflix pictures**.
- **Audio**: allow "Share this tab" (with tab audio) the first time you click ⌬ or a word in a Netflix tab.

## Development

```bash
cd extension
npm test                                  # node --test tests/*.test.js, Node 22, no dependencies
```

- **Shared look**: `scripts/sync-extension.py` copies the tracker's CSS, vendored libraries, fonts and theme presets into `extension/`. Run it after changing `app/static/app.css` or the themes.
- **Site support**: everything site-specific is in `content/sites/<site>.js` (adapter) and `content/hooks/<site>.js` (runs inside the page). The rest of the code is shared.
- **Debugging**: open the page console and filter on `Cyber Miner` to see each setup step (subtitle list found, track picked, lines loaded, recording and screenshot errors).

```text
background/   service worker: Anki, tracker, watch sessions, tab screenshots, MP3 encoding (offscreen/)
content/      page side: overlay, recorder, watcher, tab audio, sites/ adapters, hooks/ page scripts
shared/       settings, subtitles and formats (json3, TTML, WebVTT), card building, dictionaries
sidepanel/    card editor
popup/        toolbar popup
options/      settings page
tests/        node --test, with fixtures
```

## To do

Next up:
- **Netflix, the rest of M4**:
  - Check that autoplay to the next episode starts a new watch session and loads its subtitles.
  - The "Image subtitles: cannot be read" message on titles with picture subtitles only.
  - Watch sessions under the Netflix tags.
  - Check that the audio language picks the right track (one Japanese episode picked the Italian subtitles).
- **Known words from Anki (M3b)**: read your existing Anki decks to mark words you already know, and show whether a word is already mined.
- **Transcript (M5)**: all lines of the video in the side panel, the current one highlighted, click to seek, ⌬ per line.

Later (M6, polish):
- Retake the picture at another moment of the clip (a first try was taken out again).
- Shift-click transcript lines to merge several into one card.
- Load a subtitle file by hand (SRT, VTT, ASS) for Netflix titles with picture subtitles.
- Export and import the extension's settings.
- "Report a broken site" note into the tracker's Ideas list.
- A better track choice when a YouTube video only has machine-translated tracks; YouTube Shorts.

Known limits:
- Netflix screenshots are often black on Windows (the card goes without a picture).
- Picture-only subtitles cannot be read (no OCR).
- Changing the Netflix audio language needs a page reload.
- YouTube and Netflix change their players now and then; site code is kept in the adapters so a fix stays in one place.

Personal use only: no store release, no video downloading.
