import { useCallback, useEffect, useMemo, useState } from 'react'
import figures from 'virtual:book-manifest'

type Status = 'todo' | 'ok' | 'fix'
type Filter = 'all' | 'todo' | 'fix' | 'nosvg'

interface Record_ {
  status: Status
  comment: string
  at: string
}

const KEY = 'fct-review-v1'

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'todo', label: '仅未审' },
  { key: 'fix', label: '仅待改' },
  { key: 'nosvg', label: '仅无新图' },
]

function loadState(): Record<string, Record_> {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}')
  } catch {
    return {}
  }
}

const assetUrl = (dir: string, file: string) =>
  `${import.meta.env.BASE_URL}${dir}/${encodeURIComponent(file)}`

export default function ReviewTab() {
  const [state, setState] = useState<Record<string, Record_>>(loadState)
  const [filter, setFilter] = useState<Filter>('all')
  const [idx, setIdx] = useState(0)
  const [comment, setComment] = useState('')

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

  // 切换条目时把文本框同步到该条已存的意见
  useEffect(() => {
    setComment(current ? (state[current.id]?.comment ?? '') : '')
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
        <button className="chip" onClick={exportJson}>
          导出 JSON
        </button>
        <button
          className="chip"
          onClick={() => {
            if (confirm('清空所有校对进度？不可恢复。')) {
              setState({})
              setIdx(0)
            }
          }}
        >
          清空进度
        </button>
      </div>

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
