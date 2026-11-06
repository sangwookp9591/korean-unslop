export type WorkerRole = 'investigator' | 'verifier' | 'flow'
export type WorkerStatus = 'running' | 'done' | 'failed'

export type Worker = {
  /** Agent 호출의 tool_use_id */
  id: string
  agentId?: string
  role: WorkerRole
  /** 맡은 층위: 화행, 구조·내용, 문장, 낱말·분야, 화행+구조, 문장+낱말, 흐름 지도, 검증 */
  layer: string
  /** 보는 범위: 전체, 1-120줄, 슬라이드 1-8 ... */
  scope: string
  label: string
  status: WorkerStatus
  /** 조사관: 발견 목록 행 수. 검증관: 지적 행 수 */
  findings?: number
  /** 검증관 판정: 통과 | 수정 필요 */
  verdict?: string
}

export type LayerCounts = { A?: number; B?: number; C?: number; D?: number }

export type RunMode = 'unslop' | 'coach'

export type Run = {
  title: string
  /** 없으면 unslop */
  mode?: RunMode
  /** 1 대상 확인 … 7 최종 검증, 8 완료 */
  step: number
  tier?: string
  chars?: number
  audience?: string
  /** count_tells.py가 센 층위별 표지 수 */
  counts?: LayerCounts
  /** 5단계에서 반영하기로 한 발견 수 */
  merged?: number
  note?: string
  /** Doc Coach: 검수에서 찾은 문제, 제안 수, 추가 자료 요청 수 */
  issues?: number
  proposals?: number
  requests?: number
  workers: Worker[]
  isDone: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'korean-unslop': { run: Shaped<Run | null> }
  }
}
