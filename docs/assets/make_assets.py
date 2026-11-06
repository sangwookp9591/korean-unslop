"""README용 SVG 생성: 배너, 프롬프트 위 띠, 패널 (라이트/다크). 사용법: python3 docs/assets/make_assets.py docs/assets"""
import os
import sys

OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)

SANS = "'Pretendard','Apple SD Gothic Neo','Noto Sans KR','Malgun Gothic','Segoe UI',sans-serif"
MONO = "'D2Coding','JetBrains Mono','Menlo','Consolas','Apple SD Gothic Neo','Malgun Gothic','Noto Sans KR',monospace"
ACCENT = "#8B7CF6"
DONE = "#4CAF84"
LAYER = {"화행": "#E0654A", "구조": "#D99A2B", "문장": "#2A9D8F", "낱말": "#4A90D9"}

THEMES = {
    "light": dict(bg1="#FBFAFF", bg2="#F1EEFF", ink="#1F1D2B", mute="#6B6880", trk="#E4E1F2", card="#FFFFFF",
                  line="#E6E3F0", term="#FFFFFF", termbar="#F3F1F8", strike="#C2412D", good="#1E7F56"),
    "dark": dict(bg1="#15141C", bg2="#1E1A30", ink="#ECEAF6", mute="#9C99B0", trk="#2D2A3D", card="#1E1C28",
                 line="#2F2C3E", term="#14131A", termbar="#1E1C26", strike="#F07C66", good="#5FD39C"),
}


def esc(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def tw(s: str, size: float) -> float:
    return sum((0.92 if "가" <= ch <= "힣" or "　" <= ch <= "鿿" else 0.58) * size for ch in s)


def segbar(x, y, w, h, steps, cur, inner, color, trk, label, pill_font=12):
    gap = 4
    seg = (w - gap * (steps - 1)) / steps
    out = []
    for i in range(steps):
        sx = x + i * (seg + gap)
        out.append(f'<rect x="{sx:.1f}" y="{y}" width="{seg:.1f}" height="{h}" rx="{h/2}" fill="{trk}"/>')
        if i + 1 < cur:
            out.append(f'<rect x="{sx:.1f}" y="{y}" width="{seg:.1f}" height="{h}" rx="{h/2}" fill="{color}"/>')
        elif i + 1 == cur:
            out.append(f'<rect class="now" x="{sx:.1f}" y="{y}" width="{seg:.1f}" height="{h}" rx="{h/2}" fill="{color}"/>')
            if inner:
                out.append(f'<rect x="{sx:.1f}" y="{y}" width="{max(h, seg*inner):.1f}" height="{h}" rx="{h/2}" fill="{color}"/>')
    pw = 20 + tw(label, pill_font)
    head = x + (cur - 0.5) * (seg + gap)
    px = max(x, min(x + w - pw, head - pw / 2))
    out.append(f'<rect x="{px:.1f}" y="{y}" width="{pw:.1f}" height="{h}" rx="{h/2}" fill="{color}"/>')
    out.append(f'<text x="{px+pw/2:.1f}" y="{y+h/2+pill_font*0.36:.1f}" text-anchor="middle" font-family="{SANS}" '
               f'font-size="{pill_font}" font-weight="700" fill="#fff">{esc(label)}</text>')
    return "".join(out)


ANIM = """<style>.now{animation:br 1.8s ease-in-out infinite}@keyframes br{0%,100%{opacity:.28}50%{opacity:.65}}
@media (prefers-reduced-motion: reduce){.now{animation:none;opacity:.45}}</style>"""


def banner(t):
    W, H = 1200, 400
    rows = [
        ("다만, 모든 조직에 적합하다고 단정하기는 어렵습니다.", "(삭제)", "A1 결론 흐리는 단서"),
        ("원격 근무는 단순히 장소를 바꾸는 것을 넘어", "원격 근무를 하면 일하는 방식이 바뀝니다", "A2 묻지 않은 대비"),
        ("이를 통해 출퇴근 시간을 절약할 수 있습니다.", "출퇴근 시간이 줄어듭니다.", "C3 번역투"),
        ("이에 대한 검토를 진행하였습니다.", "이 내용을 검토했습니다.", "C6 명사화"),
    ]
    s = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">', ANIM,
         f'<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="{t["bg1"]}"/>'
         f'<stop offset="1" stop-color="{t["bg2"]}"/></linearGradient></defs>',
         f'<rect width="{W}" height="{H}" rx="20" fill="url(#g)"/>',
         f'<circle cx="64" cy="78" r="9" fill="{ACCENT}"/>',
         f'<text x="88" y="92" font-family="{MONO}" font-size="40" font-weight="700" fill="{t["ink"]}">korean-unslop</text>',
         f'<text x="64" y="134" font-family="{SANS}" font-size="20" fill="{t["mute"]}">한국어 글에서 AI 문체의 불쾌한 골짜기를 걷어냅니다</text>',
         segbar(64, 162, 470, 22, 7, 4, 0.5, ACCENT, t["trk"], "4/7 층위별 조사"),
         f'<text x="548" y="179" font-family="{SANS}" font-size="15" fill="{t["mute"]}">50%</text>']
    # 오른쪽 위: 층위 칩
    cx = 64
    for name, col in LAYER.items():
        w = 22 + tw(name, 14)
        s.append(f'<rect x="{cx}" y="206" width="{w:.0f}" height="26" rx="13" fill="{col}" opacity="0.14"/>')
        s.append(f'<text x="{cx + w/2:.0f}" y="224" text-anchor="middle" font-family="{SANS}" font-size="14" font-weight="600" fill="{col}">{name}</text>')
        cx += w + 8
    # 전후 카드
    x0, y0, cw = 640, 40, 512
    s.append(f'<rect x="{x0}" y="{y0}" width="{cw}" height="320" rx="16" fill="{t["card"]}" stroke="{t["line"]}"/>')
    s.append(f'<text x="{x0+24}" y="{y0+36}" font-family="{SANS}" font-size="14" font-weight="700" fill="{t["mute"]}">전  →  후</text>')
    for i, (before, after, tag) in enumerate(rows):
        y = y0 + 72 + i * 66
        bt = before if tw(before, 15) < cw - 60 else before[:26] + "…"
        s.append(f'<text x="{x0+24}" y="{y}" font-family="{SANS}" font-size="15" fill="{t["strike"]}">{esc(bt)}</text>')
        s.append(f'<line x1="{x0+24}" y1="{y-5}" x2="{x0+24+tw(bt,15):.0f}" y2="{y-5}" stroke="{t["strike"]}" stroke-width="1.4" opacity="0.8"/>')
        s.append(f'<text x="{x0+24}" y="{y+24}" font-family="{SANS}" font-size="15" font-weight="600" fill="{t["good"]}">→ {esc(after)}</text>')
        s.append(f'<text x="{x0+cw-24}" y="{y+24}" text-anchor="end" font-family="{MONO}" font-size="11" fill="{t["mute"]}">{esc(tag)}</text>')
    # 아래 왼쪽: 세 가지 구성
    items = [("korean-unslop", "문장을 세고 고친다"), ("doc-coach", "흐름과 구성을 검수한다"), ("진행 표시 mod", "단계와 발견 건수를 보여 준다")]
    for i, (a, b) in enumerate(items):
        y = 272 + i * 36
        s.append(f'<rect x="64" y="{y-16}" width="6" height="22" rx="3" fill="{[ACCENT, "#2A9D8F", DONE][i]}"/>')
        s.append(f'<text x="82" y="{y}" font-family="{MONO}" font-size="16" font-weight="700" fill="{t["ink"]}">{a}</text>')
        s.append(f'<text x="{82 + tw(a,16)*1.02 + 14:.0f}" y="{y}" font-family="{SANS}" font-size="15" fill="{t["mute"]}">{b}</text>')
    s.append("</svg>")
    return "\n".join(s)


def band(t):
    W, H = 1000, 64
    title = "원격 근무 보고"
    s = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">', ANIM,
         f'<rect width="{W}" height="{H}" rx="14" fill="{t["card"]}" stroke="{t["line"]}"/>',
         f'<circle cx="26" cy="{H/2}" r="5" fill="{ACCENT}"/>',
         f'<text x="40" y="{H/2+5}" font-family="{SANS}" font-size="15" font-weight="700" fill="{t["ink"]}">{title}</text>']
    bx = 40 + tw(title, 15) + 22
    s.append(segbar(bx, H / 2 - 10, 560, 20, 7, 4, 0.5, ACCENT, t["trk"], "4/7 층위별 조사"))
    x = bx + 576
    for txt, col, bold in (("50%", t["mute"], False), ("발견 9", ACCENT, True), ("×2", t["ink"], True), ("✕", t["mute"], False)):
        s.append(f'<text x="{x:.0f}" y="{H/2+5}" font-family="{SANS}" font-size="14" {"font-weight=\"700\"" if bold else ""} fill="{col}">{txt}</text>')
        x += tw(txt, 14) + 22
    s.append("</svg>")
    return "\n".join(s)


def pane(t):
    W = 560
    lines = []  # (spans, size, gap)  spans: (text, color, bold)
    M, I, G, D = t["mute"], t["ink"], DONE, ACCENT
    L = LAYER

    def bar(n, w, col):
        return [("█" * n, col, False), ("░" * (w - n), t["trk"], False)]

    lines += [
        ([("● ", D, True), ("원격 근무 보고", I, True)], 18, 0),
        ([("팀장 보고 · 중 규모 · 3,100자", M, False)], 14, 0),
        (bar(10, 20, D) + [("  50%", M, False)], 14, 6),
        ([("단계", M, False)], 13, 14),
        ([("✓ ", G, True), ("대상 확인", M, False)], 15, 0),
        ([("✓ ", G, True), ("세기", M, False)], 15, 0),
        ([("✓ ", G, True), ("규모 판단", M, False)], 15, 0),
        ([("● ", D, True), ("층위별 조사", I, True), ("  — 조사관 2명 보냄", M, False)], 15, 0),
        ([("○ ", M, False), ("모아서 고치기", M, False)], 15, 0),
        ([("○ ", M, False), ("다시 세기", M, False)], 15, 0),
        ([("○ ", M, False), ("최종 검증", M, False)], 15, 0),
        ([("스크립트 검출 ", I, True), ("21", D, True), ("건", M, False)], 15, 14),
    ]
    for name, v in (("화행", 4), ("구조", 2), ("문장", 12), ("낱말", 3)):
        n = round(v / 12 * 16)
        lines.append(([(f"  {name} ", M, False)] + bar(n, 16, L[name]) + [(f" {v}", I, False)], 14, 0))
    lines += [
        ([("조사관 ", I, True), ("1/2", M, False), (" · 발견 ", M, False), ("9", D, True), ("건", M, False)], 15, 14),
        ([("실행 중 · 1", M, False)], 13, 0),
        ([("▣ ", L["문장"], True), ("문장+낱말 · 전체 ", I, True), ("●", L["문장"], True)], 15, 2),
        ([("   조사 중", I, False)], 14, 0),
        ([("▾ 완료 · 1", M, False)], 13, 10),
        ([("▣ ", L["화행"], True), ("화행+구조 · 전체 ", I, True), ("✓", G, True)], 15, 2),
        ([("   발견 9건", M, False)], 14, 0),
    ]
    y = 64
    body = []
    for spans, size, gap in lines:
        y += gap + size + 9
        tsp = "".join(
            f'<tspan fill="{c}"{" font-weight=&quot;700&quot;".replace("&quot;", chr(34)) if b else ""}>{esc(x)}</tspan>'
            for x, c, b in spans)
        body.append(f'<text x="28" y="{y}" font-family="{MONO}" font-size="{size}" xml:space="preserve">{tsp}</text>')
    H = y + 30
    s = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">',
         f'<rect width="{W}" height="{H}" rx="14" fill="{t["term"]}" stroke="{t["line"]}"/>',
         f'<path d="M0 14 a14 14 0 0 1 14 -14 h{W-28} a14 14 0 0 1 14 14 v22 h-{W} z" fill="{t["termbar"]}"/>',
         '<circle cx="24" cy="18" r="6" fill="#FF5F57"/><circle cx="44" cy="18" r="6" fill="#FEBC2E"/><circle cx="64" cy="18" r="6" fill="#28C840"/>',
         f'<text x="{W/2}" y="23" text-anchor="middle" font-family="{SANS}" font-size="13" fill="{t["mute"]}">korean-unslop</text>']
    s += body + ["</svg>"]
    return "\n".join(s)


for name, t in THEMES.items():
    for kind, fn in (("banner", banner), ("band", band), ("pane", pane)):
        with open(os.path.join(OUT, f"{kind}-{name}.svg"), "w", encoding="utf-8") as f:
            f.write(fn(t))
print(sorted(os.listdir(OUT)))
