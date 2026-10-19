// @ts-check
/** "Cyber Sentence" note type and turning a card draft into an AnkiConnect note. */

import { cssVars } from "./theme.js";

/** Field order of the note type. Never reorder: Anki matches fields by position on update. */
export const FIELDS = [
  "Sentence",
  "SentenceTranslation",
  "Word",
  "WordReading",
  "WordPitch",
  "WordDefinition",
  "Audio",
  "Picture",
  "Source",
  "SourceUrl",
  "Lang",
  "Notes",
];

/** Fonts copied into Anki's media folder; a leading "_" keeps Anki's "Check media" from deleting them. */
export const FONT_MEDIA = [
  { file: "_cyber_rajdhani-600.woff2", src: "vendor/fonts/rajdhani-latin-600.woff2", family: "Rajdhani", weight: 600 },
  { file: "_cyber_rajdhani-700.woff2", src: "vendor/fonts/rajdhani-latin-700.woff2", family: "Rajdhani", weight: 700 },
  { file: "_cyber_share-tech-mono-400.woff2", src: "vendor/fonts/share-tech-mono-latin-400.woff2", family: "Share Tech Mono", weight: 400 },
];

const CJK_FONTS = {
  ja: '"Noto Sans CJK JP", "Noto Sans JP", "Hiragino Sans", "Yu Gothic UI", "Yu Gothic", Meiryo',
  zh: '"Noto Sans CJK SC", "Noto Sans SC", "PingFang SC", "Microsoft YaHei"',
};

export const FRONT = `<div class="cm cm-lang-{{Lang}}" lang="{{Lang}}">
  <div class="cm-panel">
    <div class="cm-label">⌬ Sentence</div>
    <div class="cm-sentence">{{Sentence}}</div>
    <div class="cm-audio">{{Audio}}</div>
  </div>
</div>`;

export const BACK = `{{FrontSide}}
<div id="answer" class="cm cm-back cm-lang-{{Lang}}" lang="{{Lang}}">
  {{#SentenceTranslation}}<div class="cm-translation" lang="en">{{SentenceTranslation}}</div>{{/SentenceTranslation}}
  {{#Picture}}<div class="cm-picture">{{Picture}}</div>{{/Picture}}
  {{#Word}}
  <div class="cm-panel cm-word-box">
    <div class="cm-word cm-word-ruby">{{furigana:WordReading}}</div>
    <div class="cm-word cm-word-plain">{{Word}}</div>
    <div class="cm-reading">{{WordReading}}</div>
    {{#WordPitch}}<div class="cm-pitch">{{WordPitch}}</div>{{/WordPitch}}
    {{#WordDefinition}}<div class="cm-definition" lang="en">{{WordDefinition}}</div>{{/WordDefinition}}
  </div>
  {{/Word}}
  {{#Notes}}<div class="cm-notes">{{Notes}}</div>{{/Notes}}
  <div class="cm-source">{{#SourceUrl}}<a href="{{SourceUrl}}">{{Source}}</a>{{/SourceUrl}}{{^SourceUrl}}{{Source}}{{/SourceUrl}}</div>
</div>`;

/**
 * Card CSS for the note type, from the theme's tokens.
 * @param {import("./theme.js").Theme} theme
 */
export function cardCss(theme) {
  const fonts = FONT_MEDIA.map(
    (f) => `@font-face { font-family: "${f.family}"; font-weight: ${f.weight}; src: url("${f.file}") format("woff2"); }`,
  ).join("\n");
  return `/* Cyber Miner: generated from theme "${theme.name}". Options > Anki > "Push theme to Anki" rewrites this. */
${fonts}

.card {
${cssVars(theme)}
  margin: 0; padding: 18px 14px; text-align: left;
  background: var(--bg); color: var(--text);
  font-family: var(--font-body); font-weight: 600; font-size: 20px; line-height: 1.5;
}
.cm { max-width: 720px; margin: 0 auto; }
.cm-panel {
  background: var(--card); padding: 14px 16px; margin: 0 0 12px;
  border-left: 3px solid var(--accent);
  clip-path: polygon(0 0, calc(100% - 14px) 0, 100% 14px, 100% 100%, 14px 100%, 0 calc(100% - 14px));
}
.cm-label { color: var(--muted); font-size: 12px; font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase; }
.cm-sentence { font-size: 30px; line-height: 1.6; margin: 4px 0; }
.cm-sentence b { color: var(--accent); font-weight: 700; }
.cm-lang-ja .cm-sentence, .cm-lang-ja .cm-word { font-family: "Rajdhani", ${CJK_FONTS.ja}, sans-serif; }
.cm-lang-zh .cm-sentence, .cm-lang-zh .cm-word { font-family: "Rajdhani", ${CJK_FONTS.zh}, sans-serif; }
.cm-audio .replay-button svg circle { fill: var(--accent); }
.cm-audio .replay-button svg path { fill: var(--accent-ink); stroke: var(--accent-ink); }
#answer { border: 0; }
.cm-translation { color: var(--accent-2); font-size: 20px; margin: 0 0 12px; padding: 0 16px; }
.cm-picture img { display: block; max-width: 100%; max-height: 360px; margin: 0 auto 12px; border: 1px solid var(--line); }
.cm-word { font-size: 34px; font-weight: 700; color: var(--accent); }
.cm-word rt { font-size: 15px; color: var(--muted); }
.cm-lang-ja .cm-word-plain, .cm-lang-ja .cm-reading { display: none; }
.cm:not(.cm-lang-ja) .cm-word-ruby { display: none; }
.cm-reading { font-family: var(--font-mono); color: var(--accent-2); font-size: 20px; }
.cm-pitch { color: var(--accent-2); margin-top: 4px; }
.cm-pitch svg { vertical-align: middle; }
.cm-pitch-num { font-family: var(--font-mono); font-size: 14px; color: var(--muted); margin: 0 10px 0 4px; }
.cm-definition { font-size: 18px; color: var(--text); margin-top: 6px; }
.cm-definition ol { margin: 0; padding-left: 1.4em; }
.cm-notes { color: var(--muted); font-size: 16px; padding: 0 16px; margin-bottom: 8px; }
.cm-source { font-family: var(--font-mono); font-size: 13px; color: var(--muted); padding: 0 16px; }
.cm-source a { color: var(--muted); }
.mobile .cm-sentence { font-size: 24px; }
`;
}

/**
 * Parameters for AnkiConnect createModel.
 * @param {string} modelName
 * @param {import("./theme.js").Theme} theme
 */
export function noteTypeModel(modelName, theme) {
  return {
    modelName,
    inOrderFields: FIELDS,
    css: cardCss(theme),
    isCloze: false,
    cardTemplates: [{ Name: "Recognition", Front: FRONT, Back: BACK }],
  };
}

/** @param {string} text */
export function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}

/**
 * Escape the sentence and bold the target: the selected range when given (the form as it appears,
 * e.g. 食べられなかった while Word holds 食べる), else the first occurrence of the word.
 * @param {string} sentence plain text
 * @param {string} word plain text
 * @param {{start: number, end: number} | null} [range] character offsets in sentence
 */
export function highlightWord(sentence, word, range = null) {
  if (range && range.start >= 0 && range.end > range.start && range.end <= sentence.length) {
    const { start, end } = range;
    return `${escapeHtml(sentence.slice(0, start))}<b>${escapeHtml(sentence.slice(start, end))}</b>${escapeHtml(sentence.slice(end))}`;
  }
  const escaped = escapeHtml(sentence);
  if (!word) return escaped;
  const target = escapeHtml(word);
  const at = escaped.indexOf(target);
  if (at < 0) return escaped;
  return `${escaped.slice(0, at)}<b>${target}</b>${escaped.slice(at + target.length)}`;
}

/**
 * Anki tag: no spaces, and no "::" inside a value (that would nest tags).
 * @param {string} text
 */
export function tagPart(text) {
  return text
    .trim()
    .replace(/[\s:"]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 60);
}

/**
 * @typedef {object} CardDraft
 * @property {"ja" | "zh" | "it"} lang
 * @property {string} sentence plain text of the subtitle line
 * @property {{start: number, end: number} | null} [highlight] selected word's offsets in sentence
 * @property {string} [translation]
 * @property {string} [word]
 * @property {string} [wordReading] Japanese: furigana syntax 食[た]べる; Chinese: pinyin
 * @property {number[]} [pitch] Japanese downstep positions from the dictionary ([2] for 食べる)
 * @property {string} [pitchHtml] ready-made pitch markup (overrides pitch), trusted
 * @property {string[]} [definitions]
 * @property {string} [source] "Frieren S1E3 · 12:41"
 * @property {string} [sourceUrl]
 * @property {string} [site] "youtube" | "netflix"
 * @property {string} [show] show or channel, for the tag
 * @property {string} [notes]
 * @property {{data: string, ext: string}} [audio] base64
 * @property {{data: string, ext: string}} [picture] base64
 */

/**
 * Note fields (HTML) from a draft.
 * @param {CardDraft} draft
 */
export function buildFields(draft) {
  const word = (draft.word ?? "").trim();
  // Offsets refer to the sentence as shown, so trim only from the end (a leading trim would shift them).
  const sentence = draft.sentence.trimEnd();
  // Japanese shows {{furigana:WordReading}}, so a typed word without a reading still needs to be there.
  const reading = (draft.wordReading ?? "").trim() || (draft.lang === "ja" ? word : "");
  const definitions = (draft.definitions ?? []).filter(Boolean);
  return {
    Sentence: highlightWord(sentence, word, draft.highlight),
    SentenceTranslation: escapeHtml((draft.translation ?? "").trim()),
    Word: escapeHtml(word),
    WordReading: escapeHtml(reading),
    WordPitch: draft.pitchHtml ?? (draft.lang === "ja" && draft.pitch?.length ? pitchHtml(furiganaKana(reading), draft.pitch) : ""),
    WordDefinition: definitions.length ? `<ol>${definitions.map((d) => `<li>${escapeHtml(d)}</li>`).join("")}</ol>` : "",
    Audio: "",
    Picture: "",
    Source: escapeHtml(draft.source ?? ""),
    SourceUrl: escapeHtml(draft.sourceUrl ?? ""),
    Lang: draft.lang,
    Notes: escapeHtml(draft.notes ?? "").replace(/\n/g, "<br>"),
  };
}

/** 食[た]べる / お 茶[ちゃ] -> たべる / おちゃ (the kana of Anki furigana syntax). */
export function furiganaKana(/** @type {string} */ text) {
  return text.replace(/\s?[^\s[\]]+\[([^\]]*)\]/g, "$1").replace(/\s/g, "");
}

const SMALL_KANA = /[ゃゅょぁぃぅぇぉゎャュョァィゥェォヮ]/;

/** たべる -> [た, べ, る]; きょう -> [きょ, う]. */
export function morae(/** @type {string} */ kana) {
  /** @type {string[]} */
  const out = [];
  for (const ch of kana) {
    if (SMALL_KANA.test(ch) && out.length) out[out.length - 1] += ch;
    else out.push(ch);
  }
  return out;
}

/**
 * High (true) / low (false) for each mora and the following particle, for a downstep position:
 * 0 heiban (low-high…, particle high), 1 atamadaka, n the pitch drops after mora n.
 * @param {number} count morae
 * @param {number} drop
 */
export function pitchPattern(count, drop) {
  return Array.from({ length: count + 1 }, (_, i) => {
    if (drop === 0) return i > 0;
    if (drop === 1) return i === 0;
    return i > 0 && i < drop;
  });
}

/**
 * Small inline SVG pitch graph (kana above, line below, hollow dot for the particle) per pitch value.
 * @param {string} kana
 * @param {number[]} drops
 */
export function pitchHtml(kana, drops) {
  const mora = morae(kana);
  if (!mora.length) return "";
  const step = 22;
  const graphs = [...new Set(drops)].map((drop) => {
    const pattern = pitchPattern(mora.length, drop);
    const xy = pattern.map((high, i) => [11 + i * step, high ? 26 : 42]);
    const line = xy.map(([x, y]) => `${x},${y}`).join(" ");
    const dots = xy
      .map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="4" fill="${i < mora.length ? "currentColor" : "none"}" stroke="currentColor" stroke-width="1.5"/>`)
      .join("");
    const text = mora.map((m, i) => `<text x="${11 + i * step}" y="14" text-anchor="middle" font-size="13" fill="currentColor">${escapeHtml(m)}</text>`).join("");
    const width = 22 + mora.length * step;
    return `<svg class="cm-pitch-graph" width="${width}" height="50" viewBox="0 0 ${width} 50">${text}<polyline points="${line}" fill="none" stroke="currentColor" stroke-width="1.5"/>${dots}</svg><span class="cm-pitch-num">[${drop}]</span>`;
  });
  return graphs.join(" ");
}

/**
 * @param {Date} date
 * @returns {string} YYYY-MM-DD in local time
 */
export function localDate(date) {
  const pad = (/** @type {number} */ n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * @param {CardDraft} draft
 * @param {Date} now
 */
export function buildTags(draft, now) {
  const tags = ["cyber-miner"];
  if (draft.site) tags.push(tagPart(draft.site).toLowerCase());
  const show = draft.show ? tagPart(draft.show) : "";
  if (show) tags.push(`show::${show}`);
  tags.push(`mined::${localDate(now)}`);
  return tags;
}

/**
 * Media file id: time + random, so two machines never write the same file name.
 * @param {Date} now
 */
export function mediaId(now) {
  const stamp = now.toISOString().replace(/\D/g, "").slice(0, 14);
  return `${stamp}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * AnkiConnect note for addNote / canAddNotesWithErrorDetail.
 * @param {CardDraft} draft
 * @param {import("./settings.js").Settings} settings
 * @param {{now?: Date, id?: string, allowDuplicate?: boolean}} [options]
 */
export function buildNote(draft, settings, { now = new Date(), id = mediaId(now), allowDuplicate = false } = {}) {
  const note = {
    deckName: settings.anki.decks[draft.lang],
    modelName: settings.anki.noteType,
    fields: buildFields(draft),
    tags: buildTags(draft, now),
    options: { allowDuplicate, duplicateScope: "deck" },
    /** @type {{data: string, filename: string, fields: string[]}[]} */
    audio: [],
    /** @type {{data: string, filename: string, fields: string[]}[]} */
    picture: [],
  };
  // AnkiConnect saves the files and appends [sound:...] / <img> to the named fields.
  if (draft.audio) note.audio.push({ data: draft.audio.data, filename: `cyber_${id}.${draft.audio.ext}`, fields: ["Audio"] });
  if (draft.picture) note.picture.push({ data: draft.picture.data, filename: `cyber_${id}.${draft.picture.ext}`, fields: ["Picture"] });
  return note;
}
