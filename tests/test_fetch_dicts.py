"""scripts/fetch-dicts.py on tiny inputs (no downloads)."""

import gzip
import importlib.util
import json
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parent.parent / "scripts" / "fetch-dicts.py"
spec = importlib.util.spec_from_file_location("fetch_dicts", SCRIPT)
fd = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fd)


@pytest.mark.parametrize(
    ("numbered", "marked"),
    [("xue2 xi2", "xué xí"), ("nu:3", "nǚ"), ("lu:4 you2", "lǜ yóu"), ("er2 r5", "ér r"), ("gou3", "gǒu"), ("Zhong1 guo2", "Zhōng guó"), ("A A", "A A"), ("liu2", "liú")],
)
def test_pinyin_marks(numbered, marked):
    assert fd.pinyin_marks(numbered) == marked


def test_strip_accents_keeps_written_final_accent():
    assert fd.strip_accents("dìco") == "dico"
    assert fd.strip_accents("parlò") == "parlò"
    assert fd.strip_accents("") == ""


def test_compound_lemma():
    find = lambda t: fd.COMPOUND_LEMMA.findall(t)[-1].rstrip("'")  # noqa: E731
    assert find("compound of di', the second-person singular imperative form of dire, with me and lo") == "dire"
    assert find("compound of the infinitive parlare with lo") == "parlare"


def read(path: Path) -> list[dict]:
    with gzip.open(path, "rt", encoding="utf-8") as f:
        return [json.loads(line) for line in f]


@pytest.fixture
def out_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(fd, "OUT", tmp_path)
    monkeypatch.setattr(fd, "ROOT", tmp_path)
    return tmp_path


def test_build_zh(out_dir, monkeypatch):
    src = out_dir / "cedict.txt.gz"
    with gzip.open(src, "wt", encoding="utf-8") as f:
        f.write("#! date=2026-10-14T21:50:50Z\n學習 学习 [xue2 xi2] /to learn/to study/\n女兒 女儿 [nu:3 er2] /daughter/\nbad line\n")
    monkeypatch.setattr(fd, "download", lambda url, dest, force: src)
    info = fd.build_zh(False)
    lines = read(out_dir / "zh.jsonl.gz")
    assert lines[0]["t"] == "h" and lines[0]["version"] == "2026-10-14T21:50:50Z" and info["license"] == "CC BY-SA 4.0"
    entries = [o for o in lines if o["t"] == "e"]
    assert entries[0]["s"] == "学习" and entries[0]["tr"] == "學習" and entries[0]["py"] == "xué xí" and entries[0]["g"] == ["to learn", "to study"]
    keys = {o["k"]: o["i"] for o in lines if o["t"] == "k"}
    assert keys["学习"] == keys["學習"] == [entries[0]["id"]]


def test_build_it(out_dir, monkeypatch):
    src = out_dir / "it.jsonl.gz"
    rows = [
        {"word": "dire", "lang_code": "it", "pos": "verb", "senses": [{"glosses": ["to say, tell"]}],
         "forms": [{"form": "dìre", "tags": ["canonical"]}, {"form": "dìco", "links": [["dìco", "dico"]], "tags": ["first-person", "present", "singular"]}]},
        {"word": "dire addio", "lang_code": "it", "pos": "verb", "senses": [{"glosses": ["to say goodbye"]}],
         "forms": [{"form": "dìco addio", "links": [["dìco", "dico"]], "tags": ["first-person"]}]},
        {"word": "andiamo", "lang_code": "it", "pos": "verb", "senses": [{"glosses": ["inflection of andare:", "first-person plural"], "form_of": [{"word": "andare"}]}]},
        {"word": "dimmelo", "lang_code": "it", "pos": "verb", "senses": [{"glosses": ["compound of di', the imperative form of dire, with me and lo"], "tags": ["compound-of"]}]},
        {"word": "hello", "lang_code": "en", "pos": "intj", "senses": [{"glosses": ["hi"]}]},
    ]
    with gzip.open(src, "wt", encoding="utf-8") as f:
        f.writelines(json.dumps(r) + "\n" for r in rows)
    monkeypatch.setattr(fd, "italian_source", lambda force: (src, False))
    fd.build_it(False)
    lines = read(out_dir / "it.jsonl.gz")
    entries = {o["w"]: o for o in lines if o["t"] == "e"}
    assert set(entries) == {"dire", "dire addio", "dimmelo"}  # andiamo is a form, hello is English
    assert entries["dimmelo"]["l"] == "dire"
    forms = {o["f"]: o["l"] for o in lines if o["t"] == "f"}
    assert forms["andiamo"] == [["andare", "inflection of andare:; first-person plural"]]
    assert forms["dico"] == [["dire", "first-person, present, singular"]]  # not "dire addio"
