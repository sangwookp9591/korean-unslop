#!/usr/bin/env python3
"""한국어 글에서 AI 문체 표지를 세어 보고서로 출력한다.

판정기가 아니다. 한국 독자는 표지 하나가 아니라 "밀도와 반복"으로 AI 글을 알아보므로,
무엇이 몇 번, 어디서 겹치는지를 보여 주는 것이 목적이다. 고칠지 말지는 읽고 판단한다.

사용법:
    python3 count_tells.py 글.md
    cat 글.txt | python3 count_tells.py -
    python3 count_tells.py 글.md --json      # 기계가 읽을 형식
    python3 count_tells.py 원문.md --compare 고친글.md   # 전후 비교
표준 라이브러리만 쓴다.
"""
from __future__ import annotations

import argparse
import json
import re
import statistics
import sys
from collections import Counter
from dataclasses import dataclass, field

# ---------------------------------------------------------------------------
# 표지 목록. (id, 이름, 정규식, 설명)
# 층위: A=화행, B=구조, C=문장, D=낱말·기호
# ---------------------------------------------------------------------------
PATTERNS: list[tuple[str, str, str, str]] = [
    # A. 화행: 문장을 다듬어서는 안 고쳐지고, 빼야 고쳐진다
    ("A1", "단서·보험 멘트", r"다만[,\s]|단정(하기|할 수는?|짓기)\s?(어렵|없|힘들)|확정할 수(는)? 없|일 수도 있고 아닐 수도|경우에 따라 다를 수|개인(의|마다) (선택|차이|상황)에 따라", "결론을 흐리는 '다만', 단정 회피, 양비론"),
    ("A2", "묻지 않은 부정·허수아비 대비", r"(단순히|단순한)[^.!?\n]{0,30}(아니라|넘어|그치지)|[가-힣]+(이|가) 아니라 [가-힣]+|라기보다(는)?|라는 뜻은 아닙니다|것은 아닙니다", "'A가 아니라 B', '단순히 ~를 넘어'"),
    ("A3", "아첨·과잉 칭찬", r"핵심을 (정확히 )?찔|정곡을 찌|날카로운 (통찰|질문|지적|관찰)|정말 좋은 질문|정확히 지적|훌륭한 (질문|통찰)", "'너 정말 핵심을 찔렀어'"),
    ("A4", "후속 제안·맺음 인사", r"원하시면|원한다면|필요하시다면|해\s?드릴까요|알려\s?드릴까요|도움이 되(셨|었)(길|기를)|댓글로 (남겨|공유|알려)", "'원하시면 ~해드릴까요?', '도움이 되셨길'"),
    ("A5", "예고·메타 발화", r"(에 대해|을|를) (알아|살펴)보(겠|도록 하겠)습니다|결론부터 말(하|씀드리)(면|자면)|정리하면 다음과 같|요약하면 다음과 같|설명(해\s?)?드리겠습니다|말씀드리겠습니다|살펴보았습니다|알아보았습니다|더 흥미로워(집|지)|흥미로운 (점|사실)은|비교하면 다음과 같|다음과 같습니다", "'~에 대해 알아보겠습니다', '결론부터 말하면'"),
    ("A6", "작위적 공손", r"하도록 하겠습니다|가져보(도록 하|겠)|소중한 (의견|시간|말씀)|감사드립니다!|진심으로 (감사|공감)|충분히 이해(합니다|해요)", "'~하도록 하겠습니다', '소중한 의견 감사드립니다!'"),
    # B. 구조
    ("B1", "거창한 마무리·상투 결론", r"시사하는 바가|의미가 (있었|깊었)습니다|성장(했|하였)습니다|기여하겠습니다|이바지하겠습니다|더 나은 (미래|내일)|함께 성장하는|순간이었다|역설이었다|의 증명이었다|균형이었다|발판을 마련", "문단·글 끝의 '시사하는 바가 큽니다', '~의 순간이었다'"),
    ("B2", "공허한 중요성 단언", r"(것|점)이 (매우 |무엇보다 |가장 )?중요합니다|(것|점)이 (매우 )?중요하다|필수적입니다|핵심(입니다|이다)\.", "'~하는 것이 중요합니다'"),
    # C. 문장
    ("C1", "문두 상투 접속어", r"(^|[.!?]\s+|\n)\s*(또한|이처럼|이를 통해|이러한|나아가|결론적으로|결과적으로|따라서|게다가|뿐만 아니라|흥미롭게도|궁극적으로|더불어|요약하자면|다시 말해|특히|아울러|한편)[,\s]", "문장 맨 앞의 '또한', '이처럼', '결론적으로'"),
    ("C2", "앞 문장 받는 지시어", r"(^|[\s(])(이는|이러한|이를|이로써|이에)\s", "'이는', '이러한' (독자가 지시 대상을 되짚어야 함)"),
    ("C3", "번역투 조사·구문", r"에 있어(서)?|[을를] 통(해|하여)|에 (대한|대해|관한|관하여)|의 경우|에 의(해|하여)|로 인(해|하여)|로부터|기 위(해|하여)|에도 불구하고|중(의)? 하나(입니다|이다|로)|의 그것", "'~에 있어서', '~를 통해', '~에 의해' (references/translationese.md 참고)"),
    ("C4", "가지다·갖다 (have 직역)", r"(시간|회의|간담회|기회|관심|자세|태도|역량|능력|경험)[을를] (가지|갖)|가지고 있(습니다|다|는)|갖고 있(습니다|다|는)", "'시간을 가지다', '~를 가지고 있다'"),
    ("C5", "이중 피동", r"되어지|보여지|여겨지|생각되어|쓰여지|잊혀지|불리워|읽혀지|만들어지게|사용되어", "'생각되어집니다', '보여집니다'"),
    ("C6", "명사화·거창한 한자어", r"(진행|수행|처리|실시|도모|제고|고도화|극대화|창출|구축|강화|확보)(하였|했|합니다|하여|하고|를|을)|에 대한 (검토|분석|논의|이해)|역량 (강화|고도화)|시너지|가치 창출|유의미한", "'검토를 진행하였습니다', '역량 고도화'"),
    ("C7", "가능성 서술 남발", r"할 수 있습니다|될 수 있습니다|일 수 있습니다|수 있을 것입니다", "'~할 수 있습니다' (단정할 자리에서도 가능성만 말함)"),
    ("C12", "무생물 주어 + 사람 행동 (후보)", r"(데이터|결과|숫자|지표|시장|코드|연구|수치|그래프)(가|이|는|은) (말해|말한|보여 ?준|증명|이야기|외치|속삭|반응했)", "'데이터가 말해 준다', '시장이 반응했다'. 행위자가 숨었는지 읽고 판단"),
    ("C10", "대명사·소유격 채우기", r"(^|\s)(그의|그녀의|당신의|당신은|그들의|우리의)\s", "'그의 손을', '당신의 일상에' (문맥으로 알 수 있으면 생략)"),
    # D. 낱말·기호
    ("D1", "엠대시", r"—|–", "영어식 줄표. 한국어엔 그 호흡 자리가 없음"),
    ("D2", "가운뎃점 나열", r"[가-힣A-Za-z]·[가-힣A-Za-z]", "'시장·기술' (일상 문서는 쉼표나 '와/과')"),
    ("D3", "유니코드 화살표", r"→|⇒|⟶", "'기획 → 개발' (손으로는 잘 안 치는 기호)"),
    ("D4", "볼드 강조", r"\*\*[^*\n]+\*\*", "**볼드** 남발"),
    ("D5", "장식 이모지", r"[\U0001F300-\U0001FAFF☀-➿⭐✅❌]", "✅📌💡 같은 장식"),
    ("D6", "작은따옴표·큰따옴표 강조", r"[‘'][^‘’'\n]{1,15}[’']|[“\"][^“”\"\n]{1,10}[”\"]", "짧은 낱말에 붙은 따옴표 (인용이 아닌 강조)"),
    ("D8", "분야에서 안 쓰는 동사·용어 (후보)", r"셌(습니다|다|고)|걷어(냈|내|내고)|흘려보(냈|내)|(구조|모듈|계층)(로|으로) 짓|끌고 (갔|가)|(상태|경로)(로|가) 닫혔|갈랐|뭉개|오너십을 (가지|가졌|갖)|정직성|장치(를|도|가|로)|본론|간극을|흐름을 펴|끌어내리|드나드|계측 축", "'burn-in으로 셌습니다', '걷어냈습니다', '장치를 넣었습니다', 모델 비교의 '정직성'. 후보일 뿐이니 그 분야 동료가 쓰는 말인지 읽고 판단"),
]

CONNECTOR_START = re.compile(PATTERNS[[p[0] for p in PATTERNS].index("C1")][2])
LATIN_WORD = re.compile(r"[A-Za-z][A-Za-z\-]{2,}")
SENT_SPLIT = re.compile(r"(?<=[.!?…])\s+|\n+")
MD_LINE = re.compile(r"^\s*(#{1,6}\s|[-*+]\s|\d+[.)]\s|>\s|---+\s*$)")


@dataclass
class Hit:
    pid: str
    line: int
    text: str


@dataclass
class Report:
    chars: int = 0
    sentences: int = 0
    hits: dict[str, list[Hit]] = field(default_factory=dict)
    ending_runs: list[tuple[str, int, int]] = field(default_factory=list)  # (어미, 길이, 시작 줄)
    ending_top: list[tuple[str, int]] = field(default_factory=list)
    sent_len_mean: float = 0.0
    sent_len_cv: float = 0.0
    comma_heavy: list[Hit] = field(default_factory=list)
    go_chains: list[Hit] = field(default_factory=list)
    latin_heavy: list[Hit] = field(default_factory=list)
    md_lines: int = 0
    total_lines: int = 0


def ending_key(sentence: str) -> str:
    """문장 끝 어미를 대략 뽑는다. 형태소 분석 없이 마지막 어절의 끝 3글자."""
    s = re.sub(r"[\s.!?…~\"'”’)\]]+$", "", sentence)
    if not s:
        return ""
    last = s.split()[-1]
    return last[-3:] if len(last) >= 3 else last


def ending_class(key: str) -> str:
    if key.endswith(("니다", "니까")):
        return "합쇼체(~습니다)"
    if key.endswith("요"):
        return "해요체(~요)"
    if key.endswith(("음", "임", "함", "됨", "봄")):
        return "음슴체"
    if key.endswith("다"):
        return "해라체(~다)"
    return "기타"


def sentence_at(line: str, pos: int) -> str:
    """줄 안에서 pos 위치를 포함하는 문장을 돌려준다."""
    start = 0
    for m in SENT_SPLIT.finditer(line):
        if m.start() >= pos:
            return line[start:m.start()].strip()
        start = m.end()
    return line[start:].strip()


def split_sentences(text: str) -> list[tuple[int, str]]:
    out: list[tuple[int, str]] = []
    for lineno, line in enumerate(text.splitlines(), start=1):
        if not line.strip() or MD_LINE.match(line) and len(line.strip()) < 4:
            continue
        for part in SENT_SPLIT.split(line):
            part = part.strip()
            if len(re.sub(r"\W", "", part)) >= 4:
                out.append((lineno, part))
    return out


def analyze(text: str) -> Report:
    rep = Report()
    rep.chars = len(re.sub(r"\s", "", text))
    lines = text.splitlines()
    rep.total_lines = sum(1 for l in lines if l.strip())
    rep.md_lines = sum(1 for l in lines if MD_LINE.match(l))

    for pid, _name, rx, _desc in PATTERNS:
        compiled = re.compile(rx, re.MULTILINE)
        found: list[Hit] = []
        for lineno, line in enumerate(lines, start=1):
            for m in compiled.finditer(line):
                # 일치 구간 앞쪽은 앞 문장의 마침표·공백을 포함할 수 있어 끝 위치로 문장을 찾는다
                found.append(Hit(pid, lineno, sentence_at(line, max(m.end() - 1, 0))))
        rep.hits[pid] = found

    sents = split_sentences(text)
    rep.sentences = len(sents)
    lengths = [len(re.sub(r"\s", "", s)) for _, s in sents]
    if lengths:
        rep.sent_len_mean = statistics.mean(lengths)
        if len(lengths) > 1 and rep.sent_len_mean:
            rep.sent_len_cv = statistics.pstdev(lengths) / rep.sent_len_mean

    # 같은 어미 계열이 몇 문장 연속되는가
    keys = [(ln, ending_key(s)) for ln, s in sents]
    classes = [(ln, ending_class(k)) for ln, k in keys]
    run_cls, run_len, run_start = None, 0, 0
    for ln, c in classes + [(0, None)]:
        if c == run_cls and c is not None:
            run_len += 1
        else:
            if run_cls and run_cls != "기타" and run_len >= 5:
                rep.ending_runs.append((run_cls, run_len, run_start))
            run_cls, run_len, run_start = c, 1, ln
    rep.ending_top = [(k, n) for k, n in Counter(k for _, k in keys if k).most_common(5) if n >= 3]

    for ln, s in sents:
        if s.count(",") >= 3:
            rep.comma_heavy.append(Hit("comma", ln, s))
        if len(re.findall(r"[가-힣]고,", s)) >= 2:
            rep.go_chains.append(Hit("go", ln, s))
        if len(LATIN_WORD.findall(s)) >= 3:
            rep.latin_heavy.append(Hit("latin", ln, s))
    return rep


def per_k(n: int, chars: int) -> float:
    return round(n * 1000 / chars, 1) if chars else 0.0


def to_dict(rep: Report) -> dict:
    return {
        "chars": rep.chars,
        "sentences": rep.sentences,
        "sentence_length_mean": round(rep.sent_len_mean, 1),
        "sentence_length_cv": round(rep.sent_len_cv, 2),
        "markdown_line_ratio": round(rep.md_lines / rep.total_lines, 2) if rep.total_lines else 0,
        "patterns": {
            pid: {"name": name, "count": len(rep.hits[pid]), "per_1000_chars": per_k(len(rep.hits[pid]), rep.chars),
                  "lines": sorted({h.line for h in rep.hits[pid]})}
            for pid, name, _rx, _d in PATTERNS
        },
        "ending_runs": [{"class": c, "length": n, "start_line": s} for c, n, s in rep.ending_runs],
        "ending_top": [{"ending": k, "count": n} for k, n in rep.ending_top],
        "comma_heavy_lines": [h.line for h in rep.comma_heavy],
        "go_chain_lines": [h.line for h in rep.go_chains],
        "latin_heavy_lines": [h.line for h in rep.latin_heavy],
    }


def shorten(s: str, n: int = 70) -> str:
    return s if len(s) <= n else s[: n - 1] + "…"


def render(rep: Report, examples: int = 3) -> str:
    out: list[str] = []
    out.append(f"# AI 문체 표지 집계\n")
    out.append(f"- 글자 수(공백 제외): {rep.chars}, 문장 수: {rep.sentences}")
    cv_note = " ← 문장 길이가 너무 고름" if rep.sentences >= 8 and rep.sent_len_cv < 0.35 else ""
    out.append(f"- 문장 길이 평균 {rep.sent_len_mean:.0f}자, 변동계수 {rep.sent_len_cv:.2f}{cv_note}")
    if rep.total_lines:
        ratio = rep.md_lines / rep.total_lines
        md_note = " ← 서식 비중 높음" if ratio >= 0.4 and rep.total_lines >= 6 else ""
        out.append(f"- 제목·불릿·번호 줄 비율 {ratio:.0%}{md_note}")
    out.append("")
    out.append("## 표지별 횟수 (1000자당)\n")
    out.append("| id | 표지 | 횟수 | 1000자당 | 줄 |")
    out.append("|---|---|---|---|---|")
    for pid, name, _rx, _desc in PATTERNS:
        hits = rep.hits[pid]
        if not hits:
            continue
        lines = sorted({h.line for h in hits})
        line_s = ", ".join(map(str, lines[:12])) + (" …" if len(lines) > 12 else "")
        out.append(f"| {pid} | {name} | {len(hits)} | {per_k(len(hits), rep.chars)} | {line_s} |")
    out.append("")

    if rep.ending_runs or rep.ending_top:
        out.append("## 어미 반복\n")
        for c, n, s in rep.ending_runs:
            out.append(f"- {s}번째 줄부터 {c} 문장이 {n}번 연속")
        if rep.ending_top:
            out.append("- 자주 나온 문장 끝: " + ", ".join(f"'{k}' {n}회" for k, n in rep.ending_top))
        out.append("")

    extras = [
        ("쉼표 3개 이상인 문장", rep.comma_heavy),
        ("'-고,'로 두 번 넘게 이은 문장", rep.go_chains),
        ("영단어 3개 이상인 문장", rep.latin_heavy),
    ]
    if any(h for _, h in extras):
        out.append("## 문장 단위 경고\n")
        for title, hits in extras:
            if hits:
                out.append(f"- {title}: {len(hits)}개 (줄 {', '.join(str(h.line) for h in hits[:10])})")
        out.append("")

    out.append("## 예시\n")
    for pid, name, _rx, desc in PATTERNS:
        hits = rep.hits[pid]
        if not hits:
            continue
        out.append(f"**{pid} {name}**: {desc}")
        seen = set()
        for h in hits:
            if h.line in seen:
                continue
            seen.add(h.line)
            out.append(f"  - {h.line}: {shorten(h.text)}")
            if len(seen) >= examples:
                break
    out.append("")
    out.append("> 횟수는 단서일 뿐이다. 같은 표지가 문단마다 반복되거나 여러 표지가 한 문단에 겹칠 때 고친다. 인용, 고유명사, 법률·학술 문체의 관례는 그대로 둔다.")
    return "\n".join(out)


def render_compare(a: Report, b: Report) -> str:
    out = ["# 전후 비교\n", "| id | 표지 | 전 | 후 |", "|---|---|---|---|"]
    for pid, name, _rx, _d in PATTERNS:
        na, nb = len(a.hits[pid]), len(b.hits[pid])
        if na or nb:
            out.append(f"| {pid} | {name} | {na} | {nb} |")
    out.append(f"| - | 글자 수 | {a.chars} | {b.chars} |")
    out.append(f"| - | 문장 길이 변동계수 | {a.sent_len_cv:.2f} | {b.sent_len_cv:.2f} |")
    out.append(f"| - | 같은 어미 5연속 이상 | {len(a.ending_runs)} | {len(b.ending_runs)} |")
    out.append(f"| - | 쉼표 3개 이상 문장 | {len(a.comma_heavy)} | {len(b.comma_heavy)} |")
    return "\n".join(out)


def read(path: str) -> str:
    if path == "-":
        return sys.stdin.read()
    with open(path, encoding="utf-8") as f:
        return f.read()


def main() -> None:
    ap = argparse.ArgumentParser(description="한국어 AI 문체 표지 집계")
    ap.add_argument("path", help="파일 경로, 표준입력은 -")
    ap.add_argument("--json", action="store_true", help="JSON으로 출력")
    ap.add_argument("--compare", metavar="AFTER", help="고친 글과 전후 비교")
    ap.add_argument("--examples", type=int, default=3, help="표지마다 보여 줄 예시 수")
    args = ap.parse_args()

    before = analyze(read(args.path))
    if args.compare:
        after = analyze(read(args.compare))
        if args.json:
            print(json.dumps({"before": to_dict(before), "after": to_dict(after)}, ensure_ascii=False, indent=2))
        else:
            print(render_compare(before, after))
        return
    if args.json:
        print(json.dumps(to_dict(before), ensure_ascii=False, indent=2))
    else:
        print(render(before, args.examples))


if __name__ == "__main__":
    main()
