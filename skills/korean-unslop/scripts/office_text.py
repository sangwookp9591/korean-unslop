#!/usr/bin/env python3
"""PPTX에서 문단 텍스트를 뽑고, 고친 텍스트를 서식을 유지한 채 다시 넣는다.

표준 라이브러리만 쓴다(python-pptx 불필요). .pptx는 XML을 zip으로 묶은 것이므로
슬라이드 XML에서 문단(<a:p>) 안의 텍스트 노드(<a:t>)만 바꾸고 나머지 바이트는 그대로 둔다.

사용법:
    # 1) 문단 뽑기: id와 텍스트를 JSON으로, 읽기용 텍스트를 .md로
    python3 office_text.py extract deck.pptx --json deck.paras.json --md deck.txt [--notes]

    # 2) 고친 문단만 담은 JSON 작성: {"slide3:p2": "새 문장", ...}

    # 3) 새 파일로 적용 (원본은 그대로)
    python3 office_text.py apply deck.pptx edits.json deck.unslop.pptx

적용 규칙: 문단의 첫 텍스트 조각(run)에 새 텍스트를 넣고 나머지 조각은 비운다.
그래서 문단 안에서 일부만 굵게 하는 식의 혼합 서식은 첫 조각의 서식으로 합쳐진다.
줄바꿈(<a:br/>)이 있는 문단은 첫 줄 자리에 전체가 들어가므로, 새 텍스트에 줄바꿈을 넣지 말고
필요하면 문단을 나누지 않는 쪽으로 고친다.

PDF는 이 스크립트로 다루지 않는다. Claude의 Read 도구로 페이지를 읽고, 고친 글은 페이지별로 돌려준다.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import zipfile
from xml.sax.saxutils import escape, unescape

PARA_RE = re.compile(r"<a:p(?:\s[^>]*)?>.*?</a:p>|<a:p\s*/>", re.S)
TEXT_RE = re.compile(r"(<a:t(?:\s[^>]*)?>)(.*?)(</a:t>)|<a:t\s*/>", re.S)
SLIDE_RE = re.compile(r"^ppt/(slides|notesSlides)/(slide|notesSlide)(\d+)\.xml$")
ENT = {"&quot;": '"', "&apos;": "'"}


def parts(z: zipfile.ZipFile, notes: bool) -> list[tuple[str, str]]:
    """(part 이름, id 접두어)를 슬라이드 번호 순으로."""
    out = []
    for name in z.namelist():
        m = SLIDE_RE.match(name)
        if not m:
            continue
        is_note = m.group(1) == "notesSlides"
        if is_note and not notes:
            continue
        prefix = ("note" if is_note else "slide") + m.group(3)
        out.append((int(m.group(3)), is_note, name, prefix))
    out.sort()
    return [(name, prefix) for _n, _is_note, name, prefix in out]


def para_text(p: str) -> str:
    texts = [unescape(m.group(2), ENT) for m in TEXT_RE.finditer(p) if m.group(2) is not None]
    return "".join(texts)


def extract(path: str, notes: bool) -> list[dict]:
    rows = []
    with zipfile.ZipFile(path) as z:
        for name, prefix in parts(z, notes):
            xml = z.read(name).decode("utf-8")
            for i, m in enumerate(PARA_RE.finditer(xml)):
                text = para_text(m.group(0))
                if text.strip():
                    rows.append({"id": f"{prefix}:p{i}", "part": name, "text": text})
    return rows


def replace_para(p: str, new_text: str) -> str:
    first = True

    def sub(m: re.Match) -> str:
        nonlocal first
        if m.group(1) is None:  # <a:t/>
            return m.group(0)
        if first:
            first = False
            open_tag = m.group(1)
            if new_text != new_text.strip() and "xml:space" not in open_tag:
                open_tag = open_tag[:-1] + ' xml:space="preserve">'
            return open_tag + escape(new_text) + m.group(3)
        return m.group(1) + m.group(3)

    out = TEXT_RE.sub(sub, p)
    if first:
        raise ValueError("텍스트 노드가 없는 문단")
    return out


def apply(src: str, edits_path: str, dst: str) -> None:
    with open(edits_path, encoding="utf-8") as f:
        edits: dict[str, str] = json.load(f)
    pending = dict(edits)
    with zipfile.ZipFile(src) as zin:
        targets = {name: prefix for name, prefix in parts(zin, notes=True)}
        with zipfile.ZipFile(dst, "w") as zout:
            for info in zin.infolist():
                data = zin.read(info.filename)
                prefix = targets.get(info.filename)
                if prefix and any(k.startswith(prefix + ":") for k in pending):
                    xml = data.decode("utf-8")
                    idx = -1

                    def sub(m: re.Match) -> str:
                        nonlocal idx
                        idx += 1
                        key = f"{prefix}:p{idx}"
                        if key in pending:
                            return replace_para(m.group(0), pending.pop(key))
                        return m.group(0)

                    data = PARA_RE.sub(sub, xml).encode("utf-8")
                zout.writestr(info, data)
    applied = len(edits) - len(pending)
    print(f"적용 {applied}/{len(edits)} → {dst}")
    if pending:
        print("찾지 못한 id: " + ", ".join(sorted(pending)), file=sys.stderr)
        sys.exit(1)


def to_md(rows: list[dict]) -> str:
    out, cur = [], None
    for r in rows:
        slide = r["id"].split(":")[0]
        if slide != cur:
            out.append(f"\n## {slide}\n")
            cur = slide
        out.append(r["text"])
    return "\n".join(out).strip() + "\n"


def main() -> None:
    ap = argparse.ArgumentParser(description="PPTX 문단 추출·적용 (표준 라이브러리)")
    sub = ap.add_subparsers(dest="cmd", required=True)
    e = sub.add_parser("extract")
    e.add_argument("pptx")
    e.add_argument("--json", help="문단 id와 텍스트를 저장할 JSON 경로")
    e.add_argument("--md", help="count_tells.py로 셀 읽기용 텍스트 경로")
    e.add_argument("--notes", action="store_true", help="발표자 노트도 포함")
    a = sub.add_parser("apply")
    a.add_argument("pptx")
    a.add_argument("edits", help='{"slide3:p2": "새 텍스트"} 형식 JSON')
    a.add_argument("out", help="새 파일 경로 (원본과 달라야 함)")
    args = ap.parse_args()

    if not args.pptx.lower().endswith(".pptx"):
        sys.exit(".pptx만 지원한다. .ppt는 PowerPoint에서 .pptx로 저장한 뒤 쓴다. PDF는 Read 도구로 읽는다.")

    if args.cmd == "extract":
        rows = extract(args.pptx, args.notes)
        if args.json:
            with open(args.json, "w", encoding="utf-8") as f:
                json.dump(rows, f, ensure_ascii=False, indent=2)
        if args.md:
            with open(args.md, "w", encoding="utf-8") as f:
                f.write(to_md(rows))
        if not args.json and not args.md:
            print(to_md(rows))
        else:
            print(f"문단 {len(rows)}개")
    else:
        if args.out == args.pptx:
            sys.exit("원본을 덮어쓰지 않는다. 다른 경로를 준다.")
        apply(args.pptx, args.edits, args.out)


if __name__ == "__main__":
    main()
