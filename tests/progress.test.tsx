import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'korean-unslop',
  component: 'Pane',
  requestId: 'korean-unslop-progress',
  props: {
    title: 'korean-unslop',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

const TOOL = 'mcp__korean-unslop__progress'

const REPORT = `## 발견 (문장, 1-120줄)

| # | id | 줄 | 원문 구절 | 독자가 떠안는 일 | 수정안 | 확신 |
|---|---|---|---|---|---|---|
| 1 | C3 | 5 | 이를 통해 | 관계 복원 | (삭제) | 높음 |
| 2 | C1 | 11 | 따라서 | 관계 복원 | 그래서 | 중간 |
| 3 | C12 | 13 | 데이터가 말해 준다 | 대상 알아내기 | 수치로 보면 | 높음 |
`

const VERDICT = `판정: 수정 필요

| # | 항목 번호 | 위치 | 문제 | 원문 근거 | 제안 |
|---|---|---|---|---|---|
| 1 | 2 | 3줄 | 확신이 세짐 | 원문 "보입니다" | 되돌림 |
`

function engine(on: Parameters<Parameters<typeof test>[1]>[1]) {
  on('tool.register', (_, e) => ({ value: { tool: `mcp__korean-unslop__${e.name}` } }))
  on('command.register', () => ({ value: { command: 'unslop-progress' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
}

test('단계, 검출 건수, 조사관 담당과 발견 건수를 패널에 보여 준다', async ($, on) => {
  engine(on)
  // 동기 실행된 조사관: Agent 결과에 보고가 바로 담겨 온다
  on('tool.call', (_, e) =>
    e.tool === 'Agent'
      ? { result: { agentId: 'a1', content: [{ type: 'text', text: REPORT }] }, text: REPORT }
      : { result: {} },
  )

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: TOOL, step: 1, title: '원격 근무 보고', audience: '팀장 보고' })
  await $.tool.call({ tool: TOOL, step: 2, counts: { A: 4, B: 2, C: 12, D: 3 }, chars: 3100, tier: '중' })
  await $.tool.call({ tool: TOOL, step: 4, note: '조사관 2명 보냄' })
  await $.tool.call({ tool: 'Agent', description: 'unslop 조사관 문장 1-120줄', prompt: '...' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /스크립트 검출/ }))?.text).toBe('스크립트 검출 21건')
    expect((await ui.find({ type: 'Text', text: /조사관 1\/1/ }))?.text).toBe('조사관 1/1 · 발견 3건')
    expect((await ui.find({ type: 'Text', text: /1-120줄/ }))?.text).toBe('✓ 문장 · 1-120줄 · 발견 3건')
    expect((await ui.find({ type: 'Text', text: /층위별 조사/ }))?.text).toContain('▶ 4. 층위별 조사')
    await ui.unmount()
  }
})

test('백그라운드 조사관과 검증관은 turn.complete에서 끝난다', async ($, on) => {
  engine(on)
  on('tool.call', (_, e) =>
    e.tool === 'Agent'
      ? {
          result: { agentId: e.description.includes('검증') ? 'v1' : 'b1', content: [] },
          text: 'Async agent launched successfully.',
        }
      : { result: {} },
  )
  on('turn.complete', (_, e) => ({ text: e.answer }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: TOOL, step: 1, title: '자소서' })
  await $.tool.call({ tool: TOOL, step: 4 })
  await $.tool.call({ tool: 'Agent', description: 'unslop 조사관 화행 전체', prompt: '...' })
  await $.tool.call({ tool: 'Agent', description: '관계없는 작업', prompt: '...' })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /화행 · 전체/ }))?.text).toBe('▶ 화행 · 전체 · 조사 중')

  await $.turn.complete({ agentId: 'b1', answer: REPORT, reason: 'answer', isAborted: false, durationMs: 1, turnId: 't1' })
  expect((await ui.find({ type: 'Text', text: /화행 · 전체/ }))?.text).toBe('✓ 화행 · 전체 · 발견 3건')

  await $.tool.call({ tool: TOOL, step: 7 })
  await $.tool.call({ tool: 'Agent', description: 'unslop 검증관', prompt: '...' })
  await $.turn.complete({ agentId: 'v1', answer: VERDICT, reason: 'answer', isAborted: false, durationMs: 1, turnId: 't2' })
  expect((await ui.find({ type: 'Text', text: /지적/ }))?.text).toBe('✓ 수정 필요 · 지적 1건')
  expect(await ui.find({ type: 'Text', text: /관계없는/ })).toBeUndefined()
  await ui.unmount()
})

test('진행 중인 작업이 없으면 안내만 보인다', async ($, on) => {
  engine(on)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text' }))?.text).toBe('진행 중인 고쳐 쓰기가 없습니다.')
  await ui.unmount()
})

const MAP = `| 장 | 제목 | 메시지 | 역할 | 근거 |
|---|---|---|---|---|
| 1 | 2Q 결과 | 이탈률 12%→8% | 결론 | 대시보드 |
| 2 | 시장 현황 | (없음) | 배경 | 리포트 |
| 3 | 원인 | 가입 단계가 길다 | 원인 | VOC |
`

test('Doc Coach 모드는 자기 단계와 흐름 지도 조각, 문제·제안·요청 수를 보여 준다', async ($, on) => {
  engine(on)
  on('tool.call', (_, e) =>
    e.tool === 'Agent'
      ? { result: { agentId: 'f1', content: [{ type: 'text', text: MAP }] }, text: MAP }
      : { result: {} },
  )

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: TOOL, mode: 'coach', step: 1, title: '2Q 보고 덱', audience: '배포용 보고서 · 임원' })
  await $.tool.call({ tool: TOOL, mode: 'coach', step: 2 })
  await $.tool.call({ tool: 'Agent', description: 'coach 흐름 1-15장', prompt: '...' })
  await $.tool.call({ tool: TOOL, mode: 'coach', step: 4, issues: 5, proposals: 2, requests: 1 })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /4\. 제안/ }))?.text).toContain('▶ 4. 제안')
  expect((await ui.find({ type: 'Text', text: /1-15장/ }))?.text).toBe('✓ 1-15장 · 지도 3장')
  expect((await ui.find({ type: 'Text', text: /문제 5건/ }))?.text).toBe('문제 5건 · 제안 2개 · 자료 요청 1건')
  expect(await ui.find({ type: 'Text', text: /층위별 조사/ })).toBeUndefined()
  await ui.unmount()
})
