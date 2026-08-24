export type Status = 'todo' | 'ok' | 'fix'

export interface ReviewRecord {
  status: Status
  comment: string
  at: string
}

/** 图号 → 审阅结果 */
export type ProgressMap = Record<string, ReviewRecord>

export interface ParseProgressResult {
  progress: ProgressMap
  /** 认出来的格式，用于给用户回话 */
  shape: 'export' | 'raw' | null
  error: string | null
}

interface ExportedFix {
  id?: unknown
  comment?: unknown
  reviewed_at?: unknown
}

function isRecordLike(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

/**
 * 认两种格式：
 *
 * 1. 校对台导出的 `review_result.json`
 *    `{ approved: ["fig-001", …], needs_fix: [{ id, comment, reviewed_at }, …] }`
 *
 * 2. 浏览器 localStorage 里的原始结构
 *    `{ "fig-001": { status, comment, at }, … }`
 *
 * 之所以要认第二种：localStorage 是按 origin 隔离的，
 * 用 file:// 打开过的旧 review.html 与本应用不共享数据，
 * 得让用户能把那边的原始记录直接倒过来。
 */
export function parseProgress(raw: unknown): ParseProgressResult {
  if (!isRecordLike(raw)) {
    return { progress: {}, shape: null, error: '这不是一个 JSON 对象。' }
  }

  // ── 导出格式 ──
  if (Array.isArray(raw.approved) || Array.isArray(raw.needs_fix)) {
    const progress: ProgressMap = {}

    for (const id of Array.isArray(raw.approved) ? raw.approved : []) {
      if (typeof id === 'string') progress[id] = { status: 'ok', comment: '', at: '' }
    }

    for (const item of Array.isArray(raw.needs_fix) ? raw.needs_fix : []) {
      if (!isRecordLike(item)) continue
      const fix = item as ExportedFix
      if (typeof fix.id !== 'string') continue
      progress[fix.id] = {
        status: 'fix',
        comment: typeof fix.comment === 'string' ? fix.comment : '',
        at: typeof fix.reviewed_at === 'string' ? fix.reviewed_at : '',
      }
    }

    if (!Object.keys(progress).length) {
      return { progress: {}, shape: null, error: '文件里没有已审阅的记录。' }
    }
    return { progress, shape: 'export', error: null }
  }

  // ── localStorage 原始格式 ──
  const progress: ProgressMap = {}
  let looksRaw = false
  for (const [id, value] of Object.entries(raw)) {
    if (!isRecordLike(value)) continue
    const status = value.status
    if (status !== 'ok' && status !== 'fix' && status !== 'todo') continue
    looksRaw = true
    if (status === 'todo') continue
    progress[id] = {
      status,
      comment: typeof value.comment === 'string' ? value.comment : '',
      at: typeof value.at === 'string' ? value.at : '',
    }
  }

  if (!looksRaw) {
    return {
      progress: {},
      shape: null,
      error: '认不出这个格式。请选择校对台导出的 review_result.json，或旧版 localStorage 里的原始记录。',
    }
  }
  return { progress, shape: 'raw', error: null }
}

export function countProgress(progress: ProgressMap) {
  let ok = 0
  let fix = 0
  for (const rec of Object.values(progress)) {
    if (rec.status === 'ok') ok++
    else if (rec.status === 'fix') fix++
  }
  return { ok, fix }
}
