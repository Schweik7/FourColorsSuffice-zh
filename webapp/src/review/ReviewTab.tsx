import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import figures, { savedReview } from 'virtual:book-manifest'
import { countProgress, parseProgress, type ProgressMap, type Status } from './progress'
import { readStore, usePersist } from '../core/persist'

type Filter = 'all' | 'todo' | 'fix' | 'nosvg'

const KEY = 'fct-review-v1'
/** 审阅进度之外的界面状态：停在哪一张、开着什么筛选、意见框里还没提交的字 */
const UI_KEY = 'fct-review-ui-v1'

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'todo', label: '仅未审' },
  { key: 'fix', label: '仅待改' },
  { key: 'nosvg', label: '仅无新图' },
]

/**
 * 首次进来时的初始进度。
 *
 * 本应用与旧的 review.html 不共享 localStorage（后者多半是 file:// 打开的，
 * 属于另一个 origin），所以本地为空时用项目里的 review_result.json 打底，
 * 把上一轮的成果接上。本地已有记录就不动它。
 */
function loadInitialState(): { progress: ProgressMap; seeded: boolean } {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) || '{}')
    if (stored && typeof stored === 'object' && Object.keys(stored).length) {
      return { progress: stored, seeded: false }
    }
  } catch {
    // 本地数据坏了就当没有，走下面的打底
  }

  const { progress } = parseProgress(savedReview)
  return { progress, seeded: Object.keys(progress).length > 0 }
}

interface ReviewUi {
  filter: Filter
  /** 停留的插图 id。存 id 而不是序号——筛选一变，同一个序号指的就不是同一张了 */
  currentId: string | null
  /** 意见框里还没按「待改」提交的草稿，属于 currentId 那一张 */
  draft: string
}

function loadUi(): ReviewUi {
  const raw = readStore<Partial<ReviewUi>>(UI_KEY)
  const filter = raw?.filter
  return {
    filter: FILTERS.some((f) => f.key === filter) ? (filter as Filter) : 'all',
    currentId: typeof raw?.currentId === 'string' ? raw.currentId : null,
    draft: typeof raw?.draft === 'string' ? raw.draft : '',
  }
}

const assetUrl = (dir: string, file: string) =>
  `${import.meta.env.BASE_URL}${dir}/${encodeURIComponent(file)}`

export default function ReviewTab() {
  const initial = useRef(loadInitialState())
  const savedUi = useRef(loadUi())
  const [state, setState] = useState<ProgressMap>(initial.current.progress)
  const [filter, setFilter] = useState<Filter>(savedUi.current.filter)
  const [idx, setIdx] = useState(0)
  const [comment, setComment] = useState('')
  const [notice, setNotice] = useState<string | null>(() => {
    if (!initial.current.seeded) return null
    const { ok, fix } = countProgress(initial.current.progress)
    return `本地还没有进度，已从项目里的 review_result.json 接上上一轮的成果：通过 ${ok} 张、待改 ${fix} 张。`
  })
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    localStorage.setItem(KEY, JSON.stringify(state))
  }, [state])

  const statusOf = useCallback((id: string): Status => state[id]?.status ?? 'todo', [state])

  const visible = useMemo(() => {
    if (filter === 'todo') return figures.filter((f) => statusOf(f.id) === 'todo')
    if (filter === 'fix') return figures.filter((f) => statusOf(f.id) === 'fix')
    if (filter === 'nosvg') return figures.filter((f) => !f.svg)
    return figures
  }, [filter, statusOf])

  const clamped = Math.max(0, Math.min(idx, visible.length - 1))
  const current = visible[clamped]

  // 恢复上次停留的位置。列表由筛选和进度共同决定，所以等 visible 算出来再按 id 找
  const restored = useRef(false)
  useEffect(() => {
    if (restored.current) return
    restored.current = true
    const want = savedUi.current.currentId
    if (!want) return
    const i = visible.findIndex((f) => f.id === want)
    if (i >= 0) setIdx(i)
  }, [visible])

  // 切换条目时把文本框同步到该条已存的意见；上次没提交完的草稿优先
  useEffect(() => {
    if (!current) {
      setComment('')
      return
    }
    const draft = savedUi.current.currentId === current.id ? savedUi.current.draft : ''
    setComment(draft || (state[current.id]?.comment ?? ''))
    // 只在当前条目变化时同步，编辑过程中不要被覆盖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id])

  const stats = useMemo(() => {
    let ok = 0
    let fix = 0
    for (const f of figures) {
      const s = statusOf(f.id)
      if (s === 'ok') ok++
      else if (s === 'fix') fix++
    }
    return { ok, fix, todo: figures.length - ok - fix, total: figures.length }
  }, [statusOf])

  const mark = useCallback(
    (status: Status) => {
      if (!current) return
      const text = comment.trim()
      if (status === 'fix' && !text) {
        alert('请先填写修改意见')
        return
      }
      setState((prev) => ({
        ...prev,
        [current.id]: { status, comment: text, at: new Date().toISOString().slice(0, 19) },
      }))
      // 「仅未审 / 仅待改」筛选下本条会移出列表，停在原位就等于自动前进
      if (filter === 'all') setIdx((i) => Math.min(i + 1, figures.length - 1))
    },
    [current, comment, filter],
  )

  usePersist(UI_KEY, { filter, currentId: current?.id ?? null, draft: comment })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT') return
      if (e.key === 'ArrowLeft') setIdx((i) => Math.max(0, i - 1))
      else if (e.key === 'ArrowRight') setIdx((i) => i + 1)
      else if (e.key === 'a' || e.key === 'A') mark('ok')
      else if (e.key === 's' || e.key === 'S') {
        e.preventDefault()
        document.querySelector<HTMLTextAreaElement>('#review-comment')?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mark])

  const exportJson = () => {
    const needsFix: unknown[] = []
    const approved: string[] = []
    const pending: string[] = []

    for (const f of figures) {
      const rec = state[f.id]
      const base = {
        id: f.id,
        desc: f.desc,
        original: f.orig ? `images/${f.orig}` : null,
        svg: f.svg ? `images/${f.svg}` : null,
      }
      if (!rec || rec.status === 'todo') pending.push(f.id)
      else if (rec.status === 'ok') approved.push(f.id)
      else needsFix.push({ ...base, comment: rec.comment, reviewed_at: rec.at })
    }

    const out = {
      project: '《四色足矣：四色猜想是如何解决的》插图重绘校对结果',
      exported_at: new Date().toISOString().slice(0, 19),
      summary: {
        total: figures.length,
        approved: approved.length,
        needs_fix: needsFix.length,
        pending: pending.length,
      },
      instructions_for_ai:
        '请逐条处理 needs_fix。每条给出 svg（待修改文件）、original（原始扫描件，供对照）和 comment（人工修改意见）。' +
        '修改后覆盖同名 .svg，不要动 original，也不要修改 _redraw_tools/ 下的共享文件。',
      needs_fix: needsFix,
      approved,
      pending,
    }

    const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'review_result.json'
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const importJson = async (file: File) => {
    let raw: unknown
    try {
      raw = JSON.parse(await file.text())
    } catch {
      setNotice('这个文件不是合法的 JSON。')
      return
    }

    const { progress, shape, error } = parseProgress(raw)
    if (error) {
      setNotice(error)
      return
    }

    const { ok, fix } = countProgress(progress)
    const known = new Set(figures.map((f) => f.id))
    const unknown = Object.keys(progress).filter((id) => !known.has(id))

    // 合并而不是覆盖：本地已审、文件里没提到的条目应当保留
    setState((prev) => ({ ...prev, ...progress }))
    setNotice(
      `已导入${shape === 'export' ? '导出文件' : '原始记录'}：通过 ${ok} 张、待改 ${fix} 张。` +
        (unknown.length ? ` 其中 ${unknown.length} 条对不上当前的插图（${unknown.slice(0, 3).join('、')}${unknown.length > 3 ? '…' : ''}），已一并保留。` : ''),
    )
  }

  if (!figures.length) {
    return (
      <div className="empty-note">
        没有扫描到插图。请确认 <code>webapp/</code> 的上一级目录里有 <code>images/</code>。
      </div>
    )
  }

  const progress = (100 * (stats.ok + stats.fix)) / stats.total

  return (
    <div className="review">
      <div className="review-bar">
        <span className="stat">
          共 {stats.total} · 通过 <b className="ok">{stats.ok}</b> · 待改{' '}
          <b className="fix">{stats.fix}</b> · 未审 <b className="todo">{stats.todo}</b>
        </span>
        {FILTERS.map((f) => (
          <button
            key={f.key}
            className={filter === f.key ? 'chip on' : 'chip'}
            onClick={() => {
              setFilter(f.key)
              setIdx(0)
            }}
          >
            {f.label}
          </button>
        ))}
        <span className="spacer" />
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void importJson(file)
            e.target.value = ''
          }}
        />
        <button
          className="chip"
          onClick={() => fileRef.current?.click()}
          title="导入 review_result.json，或旧版 localStorage 里的原始记录"
        >
          导入进度
        </button>
        <button className="chip" onClick={exportJson}>
          导出 JSON
        </button>
        <button
          className="chip"
          onClick={() => {
            if (confirm('清空所有校对进度？不可恢复。')) {
              setState({})
              setIdx(0)
              setNotice(null)
            }
          }}
        >
          清空进度
        </button>
      </div>

      {notice && (
        <div className="review-notice">
          {notice}
          <button className="icon-btn" onClick={() => setNotice(null)} title="知道了">
            ×
          </button>
        </div>
      )}

      <div className="progress">
        <div style={{ width: `${progress}%` }} />
      </div>

      <div className="review-body">
        <aside className="review-list">
          {visible.map((f, i) => (
            <div
              key={f.id}
              className={[
                'row',
                statusOf(f.id),
                i === clamped ? 'cur' : '',
                f.svg ? '' : 'nosvg',
              ].join(' ')}
              onClick={() => setIdx(i)}
            >
              {f.id} {f.desc}
            </div>
          ))}
          {!visible.length && <div className="row muted">（该筛选下没有图）</div>}
        </aside>

        <section className="review-work">
          <div className="review-pair">
            <div className="pane">
              <h2>原图</h2>
              <div className="pane-box">
                {current?.orig ? (
                  <img
                    src={assetUrl('images', current.orig)}
                    alt={`${current.id} 原图`}
                    onClick={(e) => window.open((e.target as HTMLImageElement).src)}
                  />
                ) : (
                  <span className="none">无原图</span>
                )}
              </div>
            </div>
            <div className="pane">
              <h2>新图（SVG）</h2>
              <div className="pane-box">
                {current?.svg ? (
                  <img
                    src={assetUrl('images', current.svg)}
                    alt={`${current.id} 重绘图`}
                    onClick={(e) => window.open((e.target as HTMLImageElement).src)}
                  />
                ) : (
                  <span className="none">尚未重绘</span>
                )}
              </div>
            </div>
          </div>

          {current && (
            <div className="review-ctl">
              <div className="review-title">
                <b>{current.id}</b> {current.desc}
                <span className={`badge ${statusOf(current.id)}`}>
                  {statusOf(current.id) === 'ok'
                    ? '● 已通过'
                    : statusOf(current.id) === 'fix'
                      ? '● 待修改'
                      : '○ 未审'}
                </span>
                <span className="muted">
                  ({clamped + 1}/{visible.length})
                </span>
              </div>
              <div className="review-row">
                <textarea
                  id="review-comment"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="修改意见（选「按意见调整」时填写，会写进导出的 JSON 供 AI 照着改）"
                />
                <div className="review-btns">
                  <button className="btn pass" onClick={() => mark('ok')}>
                    ✓ 通过 (A)
                  </button>
                  <button className="btn fixbtn" onClick={() => mark('fix')}>
                    ✎ 按意见调整 (S)
                  </button>
                  <div className="review-nav">
                    <button className="btn" onClick={() => setIdx((i) => Math.max(0, i - 1))}>
                      ← 上一张
                    </button>
                    <button className="btn" onClick={() => setIdx((i) => i + 1)}>
                      下一张 →
                    </button>
                  </div>
                </div>
              </div>
              <p className="hint">快捷键：← → 翻页 · A 通过 · S 跳到意见框 · 点图可放大（新标签页打开）</p>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
