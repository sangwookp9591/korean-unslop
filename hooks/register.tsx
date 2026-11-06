import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { LayerCounts, Panel, Run, RunMode, Worker } from '../types'

// ---------------------------------------------------------------------------
// 이름과 상수

const PANE = 'korean-unslop-progress'
const TOOL = 'mcp__korean-unslop__progress'
const STEPS_BY_MODE: Record<RunMode, string[]> = {
  unslop: ['대상 확인', '세기', '규모 판단', '층위별 조사', '모아서 고치기', '다시 세기', '최종 검증'],
  coach: ['결 확인', '흐름 지도', '검수', '제안', '자료 요청', '반영'],
}
const LABEL: Record<RunMode, string> = { unslop: 'korean-unslop', coach: 'Doc Coach' }
const stepsOf = (r: Run) => STEPS_BY_MODE[r.mode ?? 'unslop']

// 색: 모드마다 강조색 하나, 끝나면 초록. 층위마다 고정색 하나.
const ACCENT: Record<RunMode, string> = { unslop: '#8B7CF6', coach: '#2A9D8F' }
const DONE = '#4CAF84'
const FAIL = '#E0654A'
const LAYER_COLOR: Record<string, string> = {
  화행: '#E0654A',
  '화행+구조': '#E0654A',
  '구조·내용': '#D99A2B',
  문장: '#2A9D8F',
  '문장+낱말': '#2A9D8F',
  '낱말·분야': '#4A90D9',
  '흐름 지도': '#8B7CF6',
  검증: DONE,
  기타: '#8A8A8A',
}
const COUNT_LAYERS: { key: keyof LayerCounts; name: string; color: string }[] = [
  { key: 'A', name: '화행', color: '#E0654A' },
  { key: 'B', name: '구조', color: '#D99A2B' },
  { key: 'C', name: '문장', color: '#2A9D8F' },
  { key: 'D', name: '낱말', color: '#4A90D9' },
]
const GLYPH = { running: '●', done: '✓', failed: '✗' } as const

// 필드가 바뀌면 태그를 올린다: 예전 버전이 저장한 값을 initial로 읽는다.
const run = atom({ plugin: 'korean-unslop', key: 'run' } as const, null as Run | null, { shape: 'run-1' })
const panel = atom({ plugin: 'korean-unslop', key: 'panel' } as const, { isCompact: false, isDoneCollapsed: false } as Panel, {
  shape: 'panel-1',
})

type ProgressInput = {
  step: number
  mode?: RunMode
  title?: string
  audience?: string
  tier?: string
  chars?: number
  counts?: LayerCounts
  merged?: number
  note?: string
  issues?: number
  proposals?: number
  requests?: number
}

// ---------------------------------------------------------------------------
// 에이전트 이름과 보고 읽기

/** Agent 호출의 description에서 역할, 층위, 범위를 읽는다. "unslop 조사관 문장 1-120줄" */
function parseWorker(description: string): Pick<Worker, 'role' | 'layer' | 'scope'> | undefined {
  const d = description.trim()
  if (!/^(unslop|coach)\b/i.test(d)) return undefined
  const role = /검증/.test(d) ? 'verifier' : /흐름/.test(d) ? 'flow' : /조사/.test(d) ? 'investigator' : undefined
  if (!role) return undefined
  const has = (re: RegExp) => re.test(d)
  const layer =
    role === 'verifier'
      ? '검증'
      : role === 'flow'
        ? '흐름 지도'
        : has(/화행/) && has(/구조/)
          ? '화행+구조'
          : has(/문장/) && has(/낱말/)
            ? '문장+낱말'
            : has(/화행/)
              ? '화행'
              : has(/구조|내용/)
                ? '구조·내용'
                : has(/문장/)
                  ? '문장'
                  : has(/낱말|분야/)
                    ? '낱말·분야'
                    : '기타'
  const m = d.match(/(\d+\s*[-~]\s*\d+\s*(줄|쪽|장)?|슬라이드\s*\d+\s*[-~]\s*\d+|구간\s*\d+)/)
  return { role, layer, scope: m?.[1]?.replace(/\s+/g, '') ?? '전체' }
}

/** 흐름 지도 조각의 장 행 수: "| 3 | 제목 | ..." */
const countRows = (text: string): number => (text.match(/^\|\s*\d+\s*\|/gm) ?? []).length

/** 조사관 보고의 발견 목록 행 수: "| 3 | C3 | 11 | ..." */
const countFindings = (text: string): number => (text.match(/^\|\s*\d+\s*\|\s*[A-E]\d{1,2}\s*\|/gm) ?? []).length

/** 검증관 보고의 지적 행 수와 판정: "| 1 | 4 | ...", "판정: 통과" */
function readVerdict(text: string): { findings: number; verdict?: string } {
  const findings = (text.match(/^\|\s*\d+\s*\|\s*[1-7]\s*\|/gm) ?? []).length
  const m = text.match(/판정\s*[:：]?\s*\**\s*(통과|수정 필요)/)
  return { findings, verdict: m?.[1] }
}

function finish(w: Worker, text: string): Worker {
  if (w.role === 'flow') return { ...w, status: 'done', findings: countRows(text) }
  if (w.role === 'verifier') {
    const v = readVerdict(text)
    return { ...w, status: 'done', findings: v.findings, verdict: v.verdict }
  }
  return { ...w, status: 'done', findings: countFindings(text) }
}

// ---------------------------------------------------------------------------
// 진행률과 글

const sum = (c?: LayerCounts): number => (c ? (c.A ?? 0) + (c.B ?? 0) + (c.C ?? 0) + (c.D ?? 0) : 0)
const accentOf = (r: Run): string => (r.isDone ? DONE : ACCENT[r.mode ?? 'unslop'])
const comma = (n: number): string => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',')

/** 단계 진행률. 조사 단계는 끝난 에이전트 비율만큼 그 칸을 채운다. */
function ratio(r: Run): number {
  if (r.isDone) return 1
  const steps = stepsOf(r).length
  const live = r.workers.filter(w => w.role !== 'verifier')
  const part = live.length ? live.filter(w => w.status !== 'running').length / live.length : 0
  const within = (r.mode ?? 'unslop') === 'unslop' ? (r.step === 4 ? part : 0) : r.step === 2 ? part : 0
  return Math.min(1, (r.step - 1 + within) / steps)
}

const pct = (r: Run): string => `${Math.round(ratio(r) * 100)}%`

function stepLabel(r: Run): string {
  const steps = stepsOf(r)
  return r.isDone || r.step > steps.length ? '완료' : `${r.step}/${steps.length} ${steps[r.step - 1]}`
}

const bar = (fill: number, width: number): string => {
  const n = Math.round(Math.max(0, Math.min(1, fill)) * width)
  return '█'.repeat(n) + '░'.repeat(Math.max(0, width - n))
}

const found = (r: Run): number =>
  r.workers.filter(w => w.role === 'investigator').reduce((n, w) => n + (w.findings ?? 0), 0)

function statusLine(r: Run): string {
  const parts = [`${LABEL[r.mode ?? 'unslop']} · ${stepLabel(r)} · ${pct(r)}`]
  const inv = r.workers.filter(w => w.role === 'investigator')
  if (inv.length) parts.push(`조사관 ${inv.filter(w => w.status !== 'running').length}/${inv.length} · 발견 ${found(r)}건`)
  else if (r.counts) parts.push(`검출 ${sum(r.counts)}건`)
  if (r.issues !== undefined) parts.push(`문제 ${r.issues}`)
  return parts.join(' · ')
}

// ---------------------------------------------------------------------------
// 데스크톱 SVG: 단계마다 한 칸인 둥근 막대. 지금 칸은 숨 쉬듯 깜빡인다.

const FONT = "-apple-system,BlinkMacSystemFont,'Pretendard','Apple SD Gothic Neo','Segoe UI',sans-serif"
const xml = (s: string): string =>
  s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)
// 한글·한자·전각은 1em, 그 밖은 대략 0.58em
const textW = (s: string, size: number): number =>
  [...s].reduce((w, ch) => w + (/[ᄀ-ᇿ　-鿿가-힣＀-￯]/.test(ch) ? 1 : 0.58) * size, 0)
function fit(s: string, size: number, maxW: number): string {
  if (textW(s, size) <= maxW) return s
  let out = ''
  for (const ch of s) {
    if (textW(out + ch + '…', size) > maxW) break
    out += ch
  }
  return out + '…'
}

const BAND_H = 24

function bandSvg(r: Run, W: number): string {
  const color = accentOf(r)
  const steps = stepsOf(r)
  const title = fit(r.title, 13, W * 0.32)
  const label = stepLabel(r)
  const percent = pct(r)
  const barX = Math.round(18 + textW(title, 13) + 14)
  const pillW = Math.round(16 + textW(label, 11))
  const barW = Math.max(80, W - barX - 48)
  const gap = 3
  const segW = (barW - gap * (steps.length - 1)) / steps.length
  const y = 5
  const h = BAND_H - 10
  const segs = steps
    .map((_, i) => {
      const n = i + 1
      const x = i * (segW + gap)
      const done = r.isDone || n < r.step
      const now = !r.isDone && n === r.step
      // 조사 단계 같은 칸은 진행률만큼 안을 채운다
      const inner = now ? Math.max(0, ratio(r) * steps.length - i) : 0
      return [
        `<rect class="trk" x="${x.toFixed(1)}" y="${y}" width="${segW.toFixed(1)}" height="${h}" rx="${h / 2}"/>`,
        done ? `<rect x="${x.toFixed(1)}" y="${y}" width="${segW.toFixed(1)}" height="${h}" rx="${h / 2}" fill="${color}"/>` : '',
        now
          ? `<rect class="now" x="${x.toFixed(1)}" y="${y}" width="${segW.toFixed(1)}" height="${h}" rx="${h / 2}" fill="${color}"/>` +
            (inner > 0
              ? `<rect x="${x.toFixed(1)}" y="${y}" width="${Math.max(h, segW * Math.min(1, inner)).toFixed(1)}" height="${h}" rx="${h / 2}" fill="${color}"/>`
              : '')
          : '',
      ].join('')
    })
    .join('')
  const head = r.isDone ? barW : Math.min(barW, (r.step - 0.5) * (segW + gap))
  const pillX = Math.max(0, Math.min(barW - pillW, head - pillW / 2))
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${BAND_H}" viewBox="0 0 ${W} ${BAND_H}">
<style>
.tx{fill:#1f1f1f}.mu{fill:#8a8a8a}.trk{fill:#e6e6ea}
@media (prefers-color-scheme: dark){.tx{fill:#ececec}.mu{fill:#9a9a9a}.trk{fill:#2e2e33}}
.now{animation:br 1.8s ease-in-out infinite}@keyframes br{0%,100%{opacity:.25}50%{opacity:.6}}
@media (prefers-reduced-motion: reduce){.now{animation:none;opacity:.4}}
</style>
<circle cx="6" cy="${BAND_H / 2}" r="4" fill="${color}"/>
<text class="tx" x="18" y="${BAND_H / 2 + 4.5}" font-family="${FONT}" font-size="13" font-weight="600">${xml(title)}</text>
<g transform="translate(${barX},0)">${segs}
<rect x="${pillX.toFixed(1)}" y="${y}" width="${pillW}" height="${h}" rx="${h / 2}" fill="${color}"/>
<text x="${(pillX + pillW / 2).toFixed(1)}" y="${y + h / 2 + 3.8}" text-anchor="middle" font-family="${FONT}" font-size="11" font-weight="600" fill="#ffffff">${xml(label)}</text>
</g>
<text class="mu" x="${W - 4}" y="${BAND_H / 2 + 4.5}" text-anchor="end" font-family="${FONT}" font-size="12.5" font-variant-numeric="tabular-nums">${percent}</text>
</svg>`
}

// ---------------------------------------------------------------------------

async function openPane($: EngineInterface, r: Run | null): Promise<void> {
  await $.ui.open({ id: PANE, title: r ? LABEL[r.mode ?? 'unslop'] : 'korean-unslop' })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.tool.register({
      name: 'progress',
      description:
        'korean-unslop 고쳐 쓰기의 진행 상황을 패널과 상태줄에 표시한다. korean-unslop 스킬로 글을 고칠 때 각 단계를 시작할 때마다 부른다. ' +
        'doc-coach 스킬로 흐름을 검수할 때는 mode "coach"로 부른다. step 1에서 title로 새 작업을 시작한다. ' +
        '조사관과 검증관은 Agent description을 "unslop 조사관 <층위> <범위>", "unslop 검증관", 흐름 지도 조각은 "coach 흐름 <범위>"로 지으면 자동으로 추적된다.',
      inputSchema: {
        type: 'object',
        properties: {
          mode: { type: 'string', enum: ['unslop', 'coach'], description: '없으면 unslop' },
          step: {
            type: 'integer',
            minimum: 1,
            maximum: 8,
            description:
              'unslop: 1 대상 확인, 2 세기, 3 규모 판단, 4 층위별 조사, 5 모아서 고치기, 6 다시 세기, 7 최종 검증, 8 완료. ' +
              'coach: 1 결 확인, 2 흐름 지도, 3 검수, 4 제안, 5 자료 요청, 6 반영, 7 완료',
          },
          issues: { type: 'integer', description: 'coach: 검수에서 찾은 문제 수' },
          proposals: { type: 'integer', description: 'coach: 제안한 구성안 수' },
          requests: { type: 'integer', description: 'coach: 추가 자료 요청 수' },
          title: { type: 'string', description: '고치는 글의 짧은 이름. step 1에서 준다.' },
          audience: { type: 'string', description: '읽을 사람과 장르. 예: 팀장 보고' },
          tier: { type: 'string', enum: ['소', '중', '대', '특대'] },
          chars: { type: 'integer', description: '공백 제외 글자 수' },
          counts: {
            type: 'object',
            description: 'count_tells.py가 센 층위별 표지 수 합계',
            properties: { A: { type: 'integer' }, B: { type: 'integer' }, C: { type: 'integer' }, D: { type: 'integer' } },
          },
          merged: { type: 'integer', description: '5단계에서 반영하기로 한 발견 수' },
          note: { type: 'string', description: '지금 하는 일 한 줄' },
        },
        required: ['step'],
      },
      isDeferred: false,
    })
    await $.command.register({ name: 'unslop-progress', description: 'korean-unslop 진행 패널 열기' })
    return next(e)
  })

  on('command.run', { command: 'unslop-progress' }, async $ => {
    await openPane($, await read($, run))
    return { text: '진행 패널을 열었습니다.' }
  })

  on('tool.call', { tool: TOOL }, async ($, e) => {
    // 도구 인자는 tool.call 입력에 펼쳐져 들어온다
    const p = e as unknown as ProgressInput
    const mode: RunMode = p.mode ?? 'unslop'
    const last = STEPS_BY_MODE[mode].length + 1
    const step = Math.min(last, Math.max(1, Math.round(p.step)))
    const isNew = step === 1 || p.title !== undefined
    let opened = false
    const cur = await update($, run, prev => {
      const base: Run =
        !prev || prev.isDone || (isNew && step === 1) || (prev.mode ?? 'unslop') !== mode
          ? { title: p.title ?? prev?.title ?? '글', mode, step, workers: [], isDone: false }
          : prev
      opened = base !== prev
      return {
        ...base,
        step,
        title: p.title ?? base.title,
        audience: p.audience ?? base.audience,
        tier: p.tier ?? base.tier,
        chars: p.chars ?? base.chars,
        counts: p.counts ?? base.counts,
        merged: p.merged ?? base.merged,
        note: p.note ?? base.note,
        issues: p.issues ?? base.issues,
        proposals: p.proposals ?? base.proposals,
        requests: p.requests ?? base.requests,
        isDone: step === last,
      }
    })
    if (opened) void openPane($, cur)
    if (cur) {
      if (cur.isDone) {
        $.ui.status(undefined)
        $.ui.toast(`${LABEL[mode]} 완료: ${cur.title}`)
      } else {
        $.ui.status(statusLine(cur))
      }
    }
    return { result: `기록함: ${LABEL[mode]} ${step} ${STEPS_BY_MODE[mode][step - 1] ?? '완료'}` }
  })

  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    const current = await read($, run)
    const parsed = current && !current.isDone ? parseWorker(e.description) : undefined
    if (!parsed) return next(e)

    const worker: Worker = { id: e.tool_use_id ?? e.description, label: e.description, status: 'running', ...parsed }
    const r1 = await update($, run, prev => (prev ? { ...prev, workers: [...prev.workers, worker] } : prev))
    if (r1) $.ui.status(statusLine(r1))

    const ran = await next(e)
    const rec = (ran as { result?: { agentId?: string; content?: { text: string }[] } }).result
    const text = ran.text ?? rec?.content?.map(c => c.text).join('\n') ?? ''
    const isAsync = /launched|background|백그라운드/i.test(text)
    const failed = ran.deny !== undefined || ran.isError === true

    const r2 = await update($, run, prev =>
      prev
        ? {
            ...prev,
            workers: prev.workers.map((w): Worker => {
              if (w.id !== worker.id) return w
              if (failed) return { ...w, status: 'failed' }
              if (isAsync) return { ...w, agentId: rec?.agentId }
              return finish(w, text)
            }),
          }
        : prev,
    )
    if (r2) $.ui.status(statusLine(r2))
    return ran
  })

  on('turn.complete', async ($, e, next) => {
    const id = e.agentId
    if (id) {
      const r = await update($, run, prev =>
        prev && prev.workers.some(w => w.agentId === id && w.status === 'running')
          ? {
              ...prev,
              workers: prev.workers.map((w): Worker =>
                w.agentId === id ? (e.isAborted ? { ...w, status: 'failed' } : finish(w, e.answer)) : w,
              ),
            }
          : prev,
      )
      if (r && !r.isDone) $.ui.status(statusLine(r))
    }
    return next(e)
  })

  // ── 프롬프트 위 띠 ──────────────────────────────────────────────────────
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const r = await read($, run)
    if (!r || r.isBandHidden || e.props.hasSurvey) return next(e)
    // 다른 mod의 띠는 이 줄 아래에 둔다. 엔진 자리표시는 감싸지 않는다.
    const drawn = await Promise.resolve(next(e)).catch(() => null)
    const below = drawn && typeof drawn === 'object' && (drawn as { type?: string }).type !== 'engine' ? drawn : null

    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const color = accentOf(r)
    const crew = r.workers.length
    const n = found(r)
    const crewButton = <Button key="unslop-crew" label={crew ? `×${crew}` : '패널'} plain onPress={() => void openPane($, r)} />
    const dismiss = (
      <Button key="unslop-dismiss" label="✕" plain role="dismiss" onPress={() => update($, run, prev => (prev ? { ...prev, isBandHidden: true } : prev))} />
    )

    if (e.surface !== 'terminal' && 'Svg' in ui) {
      const { Svg } = ui
      const width = Math.max(220, Math.min(1400, (e.props.bodyColumns || 100) * 8 - 96))
      return (
        <Box flexDirection="column">
          <Box flexDirection="row" alignItems="center" gap={1}>
            <Svg source={bandSvg(r, width)} alt={`${r.title}: ${stepLabel(r)}, ${pct(r)}`} width={width} height={BAND_H} />
            {crewButton}
            {dismiss}
          </Box>
          {below}
        </Box>
      )
    }

    const cols = e.props.bodyColumns || 80
    const titleW = Math.max(8, Math.min(26, r.title.length * 2 + 2, Math.floor(cols / 4)))
    const width = Math.max(6, Math.min(24, cols - titleW - 44))
    return (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1}>
          <Box width={titleW} flexShrink={0}>
            <Text color={color}>● </Text>
            <Text bold wrap="truncate-end">
              {r.title}
            </Text>
          </Box>
          <Text color={color}>{bar(ratio(r), width)}</Text>
          <Text bold>{stepLabel(r)}</Text>
          <Text dimColor>{pct(r)}</Text>
          {n > 0 && <Text color={color}>발견 {n}</Text>}
          {crewButton}
          {dismiss}
        </Box>
        {below}
      </Box>
    )
  })

  // ── 패널 ─────────────────────────────────────────────────────────────────
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const r = await read($, run)
    const p = await read($, panel)
    if (!r) {
      return (
        <Box flexDirection="column">
          <Text dimColor>진행 중인 고쳐 쓰기가 없습니다.</Text>
          <Text dimColor>korean-unslop이나 doc-coach 스킬을 쓰면 여기에 단계가 표시됩니다.</Text>
        </Box>
      )
    }

    const color = accentOf(r)
    const steps = stepsOf(r)
    const cols = Math.max(28, e.props.bodyColumns || 40)
    const barW = Math.max(10, Math.min(28, cols - 10))
    const meta = [r.audience, r.tier && `${r.tier} 규모`, r.chars !== undefined && `${comma(r.chars)}자`]
      .filter(Boolean)
      .join(' · ')
    const flow = r.workers.filter(w => w.role === 'flow')
    const inv = r.workers.filter(w => w.role === 'investigator')
    const ver = r.workers.filter(w => w.role === 'verifier')
    const crew = [...flow, ...inv]
    const running = crew.filter(w => w.status === 'running')
    const finished = crew.filter(w => w.status !== 'running')

    const compactButton = (
      <Button key="compact" label={p.isCompact ? '펼치기' : '간단히'} plain onPress={() => update($, panel, prev => ({ ...prev, isCompact: !prev.isCompact }))} />
    )
    const doneButton = (
      <Button
        key="done"
        label={`${p.isDoneCollapsed ? '▸' : '▾'} 완료 · ${finished.length}`}
        plain
        onPress={() => update($, panel, prev => ({ ...prev, isDoneCollapsed: !prev.isDoneCollapsed }))}
      />
    )

    const header = (
      <Box flexDirection="column">
        {e.surface !== 'terminal' && 'Svg' in ui ? (
          <ui.Svg
            source={bandSvg(r, Math.max(240, Math.min(900, cols * 8 - 8)))}
            alt={`${r.title}: ${stepLabel(r)}, ${pct(r)}`}
            width={Math.max(240, Math.min(900, cols * 8 - 8))}
            height={BAND_H}
          />
        ) : (
          <Box flexDirection="row" justifyContent="space-between">
            <Text bold wrap="truncate-end">
              <Text color={color}>● </Text>
              {r.title}
            </Text>
            {compactButton}
          </Box>
        )}
        {meta && (
          <Text dimColor wrap="truncate-end">
            {meta}
          </Text>
        )}
        {e.surface === 'terminal' && (
          <Text>
            <Text color={color}>{bar(ratio(r), barW)}</Text>
            <Text dimColor> {pct(r)}</Text>
          </Text>
        )}
        {e.surface !== 'terminal' && 'Svg' in ui && compactButton}
      </Box>
    )

    // 에이전트 한 명: 색 사각형 + 이름 + 상태 기호, 아래 줄에 결과
    const workerRow = (w: Worker) => {
      const lc = LAYER_COLOR[w.layer] ?? LAYER_COLOR['기타']!
      const sc = w.status === 'failed' ? FAIL : w.status === 'done' ? DONE : lc
      const result =
        w.status === 'running'
          ? w.role === 'flow'
            ? '지도 그리는 중'
            : '조사 중'
          : w.status === 'failed'
            ? '실패'
            : w.role === 'flow'
              ? `지도 ${w.findings ?? 0}장`
              : w.role === 'verifier'
                ? `${w.verdict ?? '완료'} · 지적 ${w.findings ?? 0}건`
                : `발견 ${w.findings ?? 0}건`
      return (
        <Box key={w.id} flexDirection="column" marginBottom={1}>
          <Box flexDirection="row" gap={1}>
            <Text color={lc}>▣</Text>
            <Text bold wrap="truncate-end">
              {w.role === 'flow' ? w.scope : `${w.layer} · ${w.scope}`}
            </Text>
            <Text color={sc}>{GLYPH[w.status]}</Text>
          </Box>
          <Text dimColor={w.status !== 'running'} wrap="truncate-end">
            {'  '}
            {result}
          </Text>
        </Box>
      )
    }

    if (p.isCompact) {
      return (
        <Box flexDirection="column">
          {header}
          <Text dimColor>{stepLabel(r)}</Text>
          <Text wrap="truncate-end">
            {[...crew, ...ver].map(w => (
              <Text key={w.id} color={w.status === 'done' ? DONE : w.status === 'failed' ? FAIL : LAYER_COLOR[w.layer] ?? color}>
                {GLYPH[w.status]}{' '}
              </Text>
            ))}
          </Text>
        </Box>
      )
    }

    const maxCount = Math.max(1, ...COUNT_LAYERS.map(l => r.counts?.[l.key] ?? 0))
    const coach = [
      r.issues !== undefined && { label: '문제', n: r.issues, color: FAIL },
      r.proposals !== undefined && { label: '제안', n: r.proposals, color: ACCENT.coach },
      r.requests !== undefined && { label: '자료 요청', n: r.requests, color: '#D99A2B' },
    ].filter((x): x is { label: string; n: number; color: string } => Boolean(x))

    return (
      <Box flexDirection="column">
        {header}

        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>단계</Text>
          {steps.map((name, i) => {
            const n = i + 1
            const done = r.isDone || n < r.step
            const now = !r.isDone && n === r.step
            return (
              <Text key={`s${n}`} wrap="truncate-end">
                <Text color={done ? DONE : now ? color : undefined} dimColor={!done && !now}>
                  {done ? '✓' : now ? '●' : '○'}
                </Text>
                <Text bold={now} dimColor={done || (!done && !now)}>
                  {' '}
                  {name}
                </Text>
                {now && r.note ? <Text dimColor> — {r.note}</Text> : null}
              </Text>
            )
          })}
        </Box>

        {r.counts && (
          <Box flexDirection="column" marginTop={1}>
            <Text>
              <Text bold>스크립트 검출 </Text>
              <Text color={color} bold>
                {sum(r.counts)}
              </Text>
              <Text dimColor>건</Text>
            </Text>
            {COUNT_LAYERS.map(l => {
              const v = r.counts?.[l.key] ?? 0
              return (
                <Text key={l.key}>
                  <Text dimColor>{`  ${l.name} `}</Text>
                  <Text color={l.color}>{bar(v / maxCount, Math.max(6, Math.min(16, cols - 16)))}</Text>
                  <Text tabular> {v}</Text>
                </Text>
              )
            })}
          </Box>
        )}

        {coach.length > 0 && (
          <Box flexDirection="row" gap={2} marginTop={1}>
            {coach.map(c => (
              <Text key={c.label}>
                <Text color={c.color} bold>
                  {c.n}
                </Text>
                <Text dimColor> {c.label}</Text>
              </Text>
            ))}
          </Box>
        )}

        {crew.length > 0 && (
          <Box flexDirection="column" marginTop={1}>
            <Text>
              <Text bold>{flow.length && !inv.length ? '흐름 지도 조각' : '조사관'} </Text>
              <Text dimColor>
                {finished.length}/{crew.length}
              </Text>
              {inv.length > 0 && (
                <Text>
                  <Text dimColor> · 발견 </Text>
                  <Text color={color} bold>
                    {found(r)}
                  </Text>
                  <Text dimColor>건{r.merged !== undefined ? ` · 반영 ${r.merged}건` : ''}</Text>
                </Text>
              )}
            </Text>
            {running.length > 0 && <Text dimColor>실행 중 · {running.length}</Text>}
            {running.map(workerRow)}
            {finished.length > 0 && doneButton}
            {!p.isDoneCollapsed && finished.map(workerRow)}
          </Box>
        )}

        {ver.length > 0 && (
          <Box flexDirection="column" marginTop={1}>
            <Text bold>검증관</Text>
            {ver.map(workerRow)}
          </Box>
        )}
      </Box>
    )
  })
}
