#!/usr/bin/env python3
"""Download the Cyber Miner dictionaries and shrink them into what the side panel's lookup needs.

    python3 scripts/fetch-dicts.py              # ja, zh, it
    python3 scripts/fetch-dicts.py ja zh        # only some
    python3 scripts/fetch-dicts.py --force it   # download again

Raw downloads go to extension/dicts/raw/ (kept, so a rebuild needs no download). Each language becomes
extension/dicts/<lang>.jsonl.gz: one JSON object per line, imported into IndexedDB from Options > Dictionaries.
Line types: "h" header, "e" entry, "k" lookup key -> entry ids, "p" pitch (ja), "f" inflected form (it).
Standard library only. Sources and licenses: docs/EXTENSION_DESIGN.md, "Dictionary sources and download".
"""

import argparse
import gzip
import hashlib
import json
import re
import shutil
import sys
import tarfile
import unicodedata
import urllib.error
import urllib.request
from collections import defaultdict
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "extension" / "dicts"
RAW = OUT / "raw"
FORMAT = 1

JMDICT_RELEASES = "https://api.github.com/repos/scriptin/jmdict-simplified/releases/latest"
KANJIUM_ACCENTS = "https://raw.githubusercontent.com/mifunetoshiro/kanjium/master/data/source_files/raw/accents.txt"
CEDICT = "https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.txt.gz"
KAIKKI_ITALIAN = "https://kaikki.org/dictionary/Italian/kaikki.org-dictionary-Italian.jsonl.gz"
# Fallback if kaikki.org drops the per-language file (it is marked deprecated): every language, ~3 GB.
KAIKKI_ALL = "https://kaikki.org/dictionary/raw-wiktextract-data.jsonl.gz"

MAX_SENSES = 5
MAX_GLOSSES = 4


# --- downloads ---


def download(url: str, dest: Path, force: bool) -> Path:
    if dest.exists() and not force:
        print(f"  cached  {dest.relative_to(ROOT)}")
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    print(f"  get     {url}")
    req = urllib.request.Request(url, headers={"User-Agent": "cyber-miner-fetch-dicts"})
    with urllib.request.urlopen(req, timeout=60) as res, open(tmp, "wb") as f:
        total = int(res.headers.get("Content-Length") or 0)
        done = 0
        while chunk := res.read(1 << 20):
            f.write(chunk)
            done += len(chunk)
            if total:
                print(f"\r          {done / 1e6:6.1f} / {total / 1e6:.1f} MB", end="", flush=True)
    print()
    tmp.replace(dest)
    return dest


def jmdict_asset() -> tuple[str, str]:
    """URL and version of the newest jmdict-eng-*.json.tgz (not the -common or -examples variants)."""
    req = urllib.request.Request(JMDICT_RELEASES, headers={"User-Agent": "cyber-miner-fetch-dicts"})
    with urllib.request.urlopen(req, timeout=30) as res:
        release = json.load(res)
    for asset in release["assets"]:
        if re.fullmatch(r"jmdict-eng-\d.*\.json\.tgz", asset["name"]):
            return asset["browser_download_url"], release["tag_name"]
    raise SystemExit("No jmdict-eng-*.json.tgz in the latest jmdict-simplified release")


# --- output ---


class Writer:
    """Collects lines for one language and writes <lang>.jsonl.gz with a header first."""

    def __init__(self, lang: str):
        self.lang = lang
        self.path = OUT / f"{lang}.jsonl.gz"
        self.tmp = OUT / f"{lang}.jsonl.part"
        self.file = open(self.tmp, "w", encoding="utf-8")
        self.counts: dict[str, int] = defaultdict(int)

    def line(self, obj: dict) -> None:
        self.file.write(json.dumps(obj, ensure_ascii=False, separators=(",", ":")) + "\n")
        self.counts[obj["t"]] += 1

    def finish(self, header: dict) -> dict:
        self.file.close()
        header = {"t": "h", "lang": self.lang, "format": FORMAT, "built": date.today().isoformat(), **header, "counts": dict(self.counts)}
        with gzip.open(self.path, "wt", encoding="utf-8", compresslevel=9) as out, open(self.tmp, encoding="utf-8") as body:
            out.write(json.dumps(header, ensure_ascii=False, separators=(",", ":")) + "\n")
            shutil.copyfileobj(body, out)
        self.tmp.unlink()
        digest = hashlib.sha256(self.path.read_bytes()).hexdigest()
        size = self.path.stat().st_size
        print(f"  wrote   {self.path.relative_to(ROOT)}  {size / 1e6:.1f} MB  {dict(self.counts)}")
        return {**{k: v for k, v in header.items() if k != "t"}, "file": self.path.name, "bytes": size, "sha256": digest}


def keys_out(w: Writer, keys: dict[str, list[int]]) -> None:
    for key, ids in keys.items():
        w.line({"t": "k", "k": key, "i": ids})


# --- Japanese: JMdict + Kanjium pitch ---


def build_ja(force: bool) -> dict:
    url, version = jmdict_asset()
    tgz = download(url, RAW / "jmdict-eng.json.tgz", force)
    accents = download(KANJIUM_ACCENTS, RAW / "kanjium-accents.txt", force)
    with tarfile.open(tgz) as tar:
        member = next(m for m in tar.getmembers() if m.name.endswith(".json"))
        data = json.load(tar.extractfile(member))  # ~120 MB; fine once on a laptop
    if not data.get("version", "").startswith("3."):
        raise SystemExit(f"Unexpected jmdict-simplified version {data.get('version')} (this script reads 3.x)")

    w = Writer("ja")
    keys: dict[str, list[int]] = defaultdict(list)
    for word in data["words"]:
        wid = int(word["id"])
        # Search-only spellings (sK/sk) are found but never shown.
        kanji = [[k["text"], int(k["common"])] for k in word["kanji"] if "sK" not in k["tags"]]
        kana = [[r["text"], int(r["common"]), r["appliesToKanji"]] for r in word["kana"] if "sk" not in r["tags"]]
        senses = []
        for s in word["sense"][:MAX_SENSES]:
            glosses = [g["text"] for g in s["gloss"] if g.get("lang", "eng") == "eng"][:MAX_GLOSSES]
            if glosses:
                senses.append({"p": s["partOfSpeech"], "g": glosses})
        if not senses:
            continue
        common = any(k[1] for k in kanji) or any(r[1] for r in kana)
        w.line({"t": "e", "id": wid, "k": kanji, "r": kana, "s": senses, "c": int(common)})
        for text in {k["text"] for k in word["kanji"]} | {r["text"] for r in word["kana"]}:
            keys[text].append(wid)
    keys_out(w, keys)

    for line in accents.read_text(encoding="utf-8").splitlines():
        parts = line.split("\t")
        if len(parts) == 3:
            pitch = [int(n) for n in re.findall(r"\d+", parts[2])]
            if pitch:
                w.line({"t": "p", "w": parts[0], "r": parts[1], "p": pitch})

    return w.finish({
        "name": "JMdict (English) + Kanjium pitch accents",
        "version": f"jmdict-simplified {version}, JMdict {data.get('dictDate', '')}",
        "source": "https://github.com/scriptin/jmdict-simplified, https://github.com/mifunetoshiro/kanjium",
        "license": "CC BY-SA 4.0",
        "attribution": "JMdict © Electronic Dictionary Research and Development Group (EDRDG); pitch accents © Kanjium (Uros O.)",
    })


# --- Chinese: CC-CEDICT ---

TONE_MARKS = {"a": "āáǎà", "e": "ēéěè", "i": "īíǐì", "o": "ōóǒò", "u": "ūúǔù", "ü": "ǖǘǚǜ"}


def pinyin_syllable(syllable: str) -> str:
    """'xue2' -> 'xué', 'nu:3' -> 'nǚ', 'r5' -> 'r'. Non-syllables (letters, punctuation) pass through."""
    m = re.fullmatch(r"([A-Za-z:üÜ]+)([1-5])", syllable)
    if not m:
        return syllable.replace("u:", "ü").replace("U:", "Ü")
    letters, tone = m.group(1).replace("u:", "ü").replace("U:", "Ü"), int(m.group(2))
    if tone == 5:
        return letters
    lower = letters.lower()
    # Mark goes on a or e; on the o of "ou"; otherwise on the last vowel.
    if "a" in lower:
        at = lower.index("a")
    elif "e" in lower:
        at = lower.index("e")
    elif "ou" in lower:
        at = lower.index("o")
    else:
        at = max((i for i, c in enumerate(lower) if c in "iouü"), default=-1)
    if at < 0:
        return letters
    vowel = lower[at]
    marked = TONE_MARKS[vowel][tone - 1]
    if letters[at].isupper():
        marked = marked.upper()
    return letters[:at] + marked + letters[at + 1:]


def pinyin_marks(numbered: str) -> str:
    return " ".join(pinyin_syllable(s) for s in numbered.split())


CEDICT_LINE = re.compile(r"^(\S+) (\S+) \[([^\]]*)\] /(.*)/\s*$")


def build_zh(force: bool) -> dict:
    src = download(CEDICT, RAW / "cedict.txt.gz", force)
    w = Writer("zh")
    keys: dict[str, list[int]] = defaultdict(list)
    released = ""
    with gzip.open(src, "rt", encoding="utf-8") as f:
        for n, line in enumerate(f):
            if line.startswith("#"):
                if line.startswith("#! date="):
                    released = line.split("=", 1)[1].strip()
                continue
            m = CEDICT_LINE.match(line)
            if not m:
                continue
            trad, simp, pinyin, glosses = m.groups()
            gloss_list = [g for g in glosses.split("/") if g][: MAX_GLOSSES * 2]
            w.line({"t": "e", "id": n, "s": simp, "tr": trad, "py": pinyin_marks(pinyin), "g": gloss_list})
            keys[simp].append(n)
            if trad != simp:
                keys[trad].append(n)
    keys_out(w, keys)
    return w.finish({
        "name": "CC-CEDICT",
        "version": released or date.today().isoformat(),
        "source": "https://www.mdbg.net/chinese/dictionary?page=cc-cedict",
        "license": "CC BY-SA 4.0",
        "attribution": "CC-CEDICT © MDBG and contributors",
    })


# --- Italian: English Wiktionary via kaikki.org ---

FORM_SKIP_TAGS = {"canonical", "table-tags", "inflection-template", "class", "romanization", "auxiliary"}
COMPOUND_LEMMA = re.compile(r"\bof (?:the infinitive |the gerund |the past participle )?([^\s,]+?),?(?= with\b|$)")


def strip_accents(text: str) -> str:
    """'dìco' -> 'dico' (dictionary stress marks) but keeps real final accents written in Italian ('parlò')."""
    if not text:
        return text
    body, last = text[:-1], text[-1]
    plain = "".join(c for c in unicodedata.normalize("NFD", body) if unicodedata.category(c) != "Mn")
    return unicodedata.normalize("NFC", plain) + last


def italian_source(force: bool) -> tuple[Path, bool]:
    """The Italian-only file; the full multi-language dump if kaikki.org has removed it."""
    try:
        return download(KAIKKI_ITALIAN, RAW / "kaikki-italian.jsonl.gz", force), False
    except urllib.error.HTTPError as e:
        print(f"  Italian file not available ({e.code}); falling back to the full Wiktionary dump (~3 GB)")
        return download(KAIKKI_ALL, RAW / "kaikki-all.jsonl.gz", force), True


def build_it(force: bool) -> dict:
    src, filter_lang = italian_source(force)
    w = Writer("it")
    keys: dict[str, list[int]] = defaultdict(list)
    forms: dict[str, dict[str, str]] = defaultdict(dict)  # form -> {lemma: note}
    next_id = 0
    with gzip.open(src, "rt", encoding="utf-8") as f:
        for line in f:
            if filter_lang and '"lang_code": "it"' not in line:
                continue
            e = json.loads(line)
            if e.get("lang_code") != "it":
                continue
            word = e.get("word", "")
            pos = e.get("pos", "")
            glosses, lemma = [], ""
            for s in e.get("senses", []):
                text = "; ".join(g for g in s.get("glosses", []) if g)
                if not text:
                    continue
                if s.get("form_of"):
                    # "andiamo": inflection of andare -> a form, not an entry of its own.
                    for target in s["form_of"]:
                        forms[word.lower()].setdefault(target["word"], text)
                    continue
                if "compound-of" in s.get("tags", []) and not lemma:
                    found = COMPOUND_LEMMA.findall(text)
                    lemma = found[-1].rstrip("'") if found else ""
                glosses.append(text)
            if glosses:
                next_id += 1
                entry = {"t": "e", "id": next_id, "w": word, "pos": pos, "g": glosses[:MAX_SENSES]}
                if lemma:
                    entry["l"] = lemma
                w.line(entry)
                keys[word.lower()].append(next_id)
            # The lemma's conjugation/declension table: "dìco" -> dire. Phrases ("dire addio") are skipped:
            # their tables would map the first word's forms to the phrase.
            for form in e.get("forms", []) if " " not in word else []:
                tags = set(form.get("tags", []))
                if tags & FORM_SKIP_TAGS:
                    continue
                links = form.get("links") or []
                written = links[0][1] if links and len(links[0]) > 1 else strip_accents(form.get("form", ""))
                if written and " " not in written and written.lower() != word.lower():
                    forms[written.lower()].setdefault(word, ", ".join(sorted(tags)))
    keys_out(w, keys)
    for form, lemmas in forms.items():
        w.line({"t": "f", "f": form, "l": [[lemma, note] for lemma, note in lemmas.items()]})
    return w.finish({
        "name": "Wiktionary (English) Italian entries",
        "version": f"kaikki.org {date.today().isoformat()}",
        "source": "https://kaikki.org/dictionary/Italian/",
        "license": "CC BY-SA 4.0 and GFDL",
        "attribution": "Wiktionary contributors, extracted with wiktextract (kaikki.org)",
    })


BUILDERS = {"ja": build_ja, "zh": build_zh, "it": build_it}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("langs", nargs="*", metavar="LANG", help="ja, zh, it (default: all)")
    parser.add_argument("--force", action="store_true", help="download again even if cached")
    args = parser.parse_args()
    langs = args.langs or list(BUILDERS)
    if unknown := [lang for lang in langs if lang not in BUILDERS]:
        parser.error(f"unknown language {', '.join(unknown)} (choose from {', '.join(BUILDERS)})")
    OUT.mkdir(parents=True, exist_ok=True)
    manifest_path = OUT / "manifest.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    for lang in langs:
        print(f"[{lang}]")
        manifest[lang] = BUILDERS[lang](args.force)
        manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    print(f"Done. Reload Cyber Miner on chrome://extensions, then Options > Dictionaries > Import.")


if __name__ == "__main__":
    sys.exit(main())
