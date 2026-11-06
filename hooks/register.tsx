import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { LayerCounts, Run, RunMode, Worker } from '../types'

const PANE = 'korean-unslop-progress'
const TOOL = 'mcp__korean-unslop__progress'
const STEPS_BY_MODE: Record<RunMode, string[]> = {
  unslop: ['대상 확인', '세기', '규모 판단', '층위별 조사', '모아서 고치기', '다시 세기', '최종 검증'],
  coach: ['결 확인', '흐름 지도', '검수', '제안', '자료 요청', '반영'],
}
const LABEL: Record<RunMode, string> = { unslop: 'unslop', coach: 'Doc Coach' }
const stepsOf = (r: Run) => STEPS_BY_MODE[r.mode ?? 'unslop']
const LAYER_NAMES: Record<keyof LayerCounts, string> = { A: '화행', B: '구조', C: '문장', D: '낱말' }

// 필드가 바뀌면 태그를 올린다: 예전 버전이 저장한 값을 initial로 읽는다.
const run = atom({ plugin: 'korean-unslop', key: 'run' } as const, null as Run | null, {
  shape: 'run-1',
})

type ProgressInput = {
  step: number
  mode?: RunMode
  issues?: number
  proposals?: number
  requests?: number
  title?: string
  audience?: string
  tier?: string
  chars?: number
  counts?: LayerCounts
  merged?: number
  note?: string
}

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
function countRows(text: string): number {
  return (text.match(/^\|\s*\d+\s*\|/gm) ?? []).length
}

/** 조사관 보고의 발견 목록 행 수: "| 3 | C3 | 11 | ..." */
function countFindings(text: string): number {
  return (text.match(/^\|\s*\d+\s*\|\s*[A-E]\d{1,2}\s*\|/gm) ?? []).length
}

/** 검증관 보고의 지적 행 수와 판정: "| 1 | 4 | ..." , "판정: 통과" */
function readVerdict(text: string): { findings: number; verdict?: string } {
  const findings = (text.match(/^\|\s*\d+\s*\|\s*[1-7]\s*\|/gm) ?? []).length
  const m = text.match(/판정\s*[:：]?\s*\**\s*(통과|수정 필요)/)
  return { findings, verdict: m?.[1] }
}

function sum(c?: LayerCounts): number {
  return c ? (c.A ?? 0) + (c.B ?? 0) + (c.C ?? 0) + (c.D ?? 0) : 0
}

function statusLine(r: Run): string {
  const steps = stepsOf(r)
  const name = r.step > steps.length ? '완료' : `${r.step}/${steps.length} ${steps[r.step - 1]}`
  const inv = r.workers.filter(w => w.role === 'investigator')
  const parts = [`${LABEL[r.mode ?? 'unslop']} · ${name}`]
  if (r.issues !== undefined) parts.push(`문제 ${r.issues}건`)
  if (r.proposals !== undefined) parts.push(`제안 ${r.proposals}개`)
  if (r.requests !== undefined) parts.push(`자료 요청 ${r.requests}건`)
  if (r.tier) parts.push(`${r.tier} 규모`)
  if (inv.length) {
    const done = inv.filter(w => w.status !== 'running').length
    const found = inv.reduce((n, w) => n + (w.findings ?? 0), 0)
    parts.push(`조사관 ${done}/${inv.length} · 발견 ${found}건`)
  } else if (r.counts) {
    parts.push(`검출 ${sum(r.counts)}건`)
  }
  return parts.join(' · ')
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
            properties: {
              A: { type: 'integer' },
              B: { type: 'integer' },
              C: { type: 'integer' },
              D: { type: 'integer' },
            },
          },
          merged: { type: 'integer', description: '5단계에서 반영하기로 한 발견 수' },
          note: { type: 'string', description: '지금 하는 일 한 줄' },
        },
        required: ['step'],
      },
      isDeferred: false,
    })
    await $.command.register({
      name: 'unslop-progress',
      description: 'korean-unslop 진행 패널 열기',
    })
    return next(e)
  })

  on('command.run', { command: 'unslop-progress' }, async $ => {
    await $.ui.open({ id: PANE, title: 'korean-unslop' })
    return { text: 'korean-unslop 진행 패널을 열었습니다.' }
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
    if (opened) void $.ui.open({ id: PANE, title: LABEL[mode] })
    if (cur) {
      if (cur.isDone) {
        $.ui.status(undefined)
        void $.ui.toast(`${LABEL[mode]} 완료: ${cur.title}`)
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

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const r = await read($, run)
    if (!r) {
      return (
        <Box flexDirection="column">
          <Text dimColor>진행 중인 고쳐 쓰기가 없습니다.</Text>
          <Text dimColor>korean-unslop 스킬로 글을 고치면 여기에 단계가 표시됩니다.</Text>
        </Box>
      )
    }
    const steps = stepsOf(r)
    const flow = r.workers.filter(w => w.role === 'flow')
    const inv = r.workers.filter(w => w.role === 'investigator')
    const ver = r.workers.filter(w => w.role === 'verifier')
    const found = inv.reduce((n, w) => n + (w.findings ?? 0), 0)
    const coach = [
      r.issues !== undefined && `문제 ${r.issues}건`,
      r.proposals !== undefined && `제안 ${r.proposals}개`,
      r.requests !== undefined && `자료 요청 ${r.requests}건`,
    ].filter(Boolean).join(' · ')
    const meta = [r.audience, r.tier && `${r.tier} 규모`, r.chars !== undefined && `${r.chars}자`].filter(Boolean).join(' · ')
    const mark = (w: Worker) => (w.status === 'running' ? '▶' : w.status === 'failed' ? '✗' : '✓')
    const state = (w: Worker) =>
      w.status === 'running'
        ? '조사 중'
        : w.status === 'failed'
          ? '실패'
          : w.role === 'verifier'
            ? `${w.verdict ?? '완료'} · 지적 ${w.findings ?? 0}건`
            : w.role === 'flow'
              ? `지도 ${w.findings ?? 0}장`
              : `발견 ${w.findings ?? 0}건`

    return (
      <Box flexDirection="column">
        <Text bold>{r.title}</Text>
        {meta && <Text dimColor>{meta}</Text>}
        <Text> </Text>
        {steps.map((name, i) => {
          const n = i + 1
          const done = r.isDone || n < r.step
          const now = !r.isDone && n === r.step
          return (
            <Text bold={now} dimColor={!done && !now}>
              {done ? '✓' : now ? '▶' : '·'} {n}. {name}
              {now && r.note ? `  — ${r.note}` : ''}
            </Text>
          )
        })}
        {r.counts && (
          <Box flexDirection="column">
            <Text> </Text>
            <Text bold>스크립트 검출 {sum(r.counts)}건</Text>
            <Text dimColor>
              {(Object.keys(LAYER_NAMES) as (keyof LayerCounts)[])
                .map(k => `${LAYER_NAMES[k]} ${r.counts?.[k] ?? 0}`)
                .join(' · ')}
            </Text>
          </Box>
        )}
        {coach && (
          <Box flexDirection="column">
            <Text> </Text>
            <Text bold>{coach}</Text>
          </Box>
        )}
        {flow.length > 0 && (
          <Box flexDirection="column">
            <Text> </Text>
            <Text bold>흐름 지도 조각 {flow.filter(w => w.status !== 'running').length}/{flow.length}</Text>
            {flow.map(w => (
              <Text dimColor={w.status === 'done'}>
                {mark(w)} {w.scope} · {state(w)}
              </Text>
            ))}
          </Box>
        )}
        {inv.length > 0 && (
          <Box flexDirection="column">
            <Text> </Text>
            <Text bold>
              조사관 {inv.filter(w => w.status !== 'running').length}/{inv.length} · 발견 {found}건
              {r.merged !== undefined ? ` · 반영 ${r.merged}건` : ''}
            </Text>
            {inv.map(w => (
              <Text dimColor={w.status === 'done'}>
                {mark(w)} {w.layer} · {w.scope} · {state(w)}
              </Text>
            ))}
          </Box>
        )}
        {ver.length > 0 && (
          <Box flexDirection="column">
            <Text> </Text>
            <Text bold>검증관</Text>
            {ver.map(w => (
              <Text>
                {mark(w)} {state(w)}
              </Text>
            ))}
          </Box>
        )}
      </Box>
    )
  })
}

function finish(w: Worker, text: string): Worker {
  if (w.role === 'flow') return { ...w, status: 'done', findings: countRows(text) }
  if (w.role === 'verifier') {
    const v = readVerdict(text)
    return { ...w, status: 'done', findings: v.findings, verdict: v.verdict }
  }
  return { ...w, status: 'done', findings: countFindings(text) }
}
