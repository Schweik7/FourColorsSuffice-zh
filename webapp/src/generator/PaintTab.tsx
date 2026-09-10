import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MapModel, RegionId } from '../core/types'
import { buildMesh, cellAt, type HexMesh } from '../core/mesh'
import {
  SEA,
  addRegion,
  areasOf,
  clonePainting,
  contactsOf,
  emptyPainting,
  floodFill,
  fromSnapshot,
  graphFromPainting,
  inspect,
  isSnapshot,
  mergeStrayComponents,
  paintCells,
  removeRegionAt,
  resampleOnto,
  toSnapshot,
  unpair,
  type Painting,
} from '../core/paint'
import { DEFAULT_RELAX, createRelax, relaxRound, type RelaxOptions, type RelaxState } from '../core/relax'
import { poleCells, traceToModel } from '../core/trace'
import { DEFAULT_SEED, seedFromGraph } from '../core/seed'
import { fourColor, nextRegionName } from '../core/graph'
import { parseGraphText } from '../core/parse'
import { SLOTS, PALETTES, paletteByKey, resolveColor } from '../core/palette'
import { readStore, storageAvailable, usePersist } from '../core/persist'
import PaintCanvas, { labelsFor, type Tool } from './PaintCanvas'
import ColorPicker from './ColorPicker'
import MapEditor from './MapEditor'

const WIDTH = 900
const HEIGHT = 640

/** 格子越小越细腻，但每笔要动的格子也越多 */
const DENSITIES = [
  { key: 'coarse', label: '粗', size: 14 },
  { key: 'medium', label: '中', size: 9 },
  { key: 'fine', label: '细', size: 6 },
] as const
type DensityKey = (typeof DENSITIES)[number]['key']

const TOOLS: { key: Tool; label: string; hint: string }[] = [
  { key: 'brush', label: '画笔', hint: '按住拖动，涂成当前选中的区域' },
  { key: 'erase', label: '橡皮', hint: '擦回背景（海）' },
  { key: 'fill', label: '油漆桶', hint: '把点到的那一整片改成当前区域' },
  { key: 'pick', label: '吸管', hint: '点哪块就把哪块设为当前区域' },
]

const PAINT_KEY = 'fct-paint-v1'
const PAINT_OPTS_KEY = 'fct-paint-opts-v1'

const UNDO_LIMIT = 40

interface Opts {
  density: DensityKey
  tool: Tool
  brush: number
  showGrid: boolean
  paletteKey: string
  relax: RelaxOptions
  smooth: number
  graphText: string
}

const DEFAULT_OPTS: Opts = {
  density: 'medium',
  tool: 'brush',
  brush: 2,
  showGrid: true,
  paletteKey: 'standard',
  relax: DEFAULT_RELAX,
  smooth: 3,
  graphText: 'A: B C D\nB: C D\nC: D',
}

function meshFor(density: DensityKey): HexMesh {
  const found = DENSITIES.find((d) => d.key === density) ?? DENSITIES[1]
  return buildMesh(WIDTH, HEIGHT, found.size)
}

/** 本地存下来的东西一律当作不可信输入 */
function loadOpts(): Opts {
  const raw = readStore<Partial<Opts>>(PAINT_OPTS_KEY)
  if (!raw || typeof raw !== 'object') return DEFAULT_OPTS
  const density = DENSITIES.some((d) => d.key === raw.density) ? raw.density! : DEFAULT_OPTS.density
  return {
    density,
    tool: TOOLS.some((t) => t.key === raw.tool) ? raw.tool! : 'brush',
    brush: typeof raw.brush === 'number' ? Math.min(12, Math.max(1, raw.brush)) : 2,
    showGrid: typeof raw.showGrid === 'boolean' ? raw.showGrid : true,
    paletteKey: typeof raw.paletteKey === 'string' ? raw.paletteKey : 'standard',
    relax: { ...DEFAULT_RELAX, ...(raw.relax && typeof raw.relax === 'object' ? raw.relax : {}) },
    smooth: typeof raw.smooth === 'number' ? Math.min(5, Math.max(0, raw.smooth)) : 3,
    graphText: typeof raw.graphText === 'string' ? raw.graphText : DEFAULT_OPTS.graphText,
  }
}

function loadPainting(mesh: HexMesh): Painting {
  const raw = readStore<unknown>(PAINT_KEY)
  if (!isSnapshot(raw)) return emptyPainting(mesh)
  return fromSnapshot(raw, mesh) ?? emptyPainting(mesh)
}

/** 下一个还没被用掉的调色板槽位，用完就轮回 */
function nextSlot(used: readonly string[]): string {
  const taken = new Set(used)
  return SLOTS.find((s) => s !== 'gray' && !taken.has(s)) ?? SLOTS[used.length % SLOTS.length]
}

export default function PaintTab() {
  const [opts, setOpts] = useState<Opts>(loadOpts)
  const [painting, setPainting] = useState<Painting>(() => loadPainting(meshFor(loadOpts().density)))
  // labels 是就地改的，所以要靠一个版本号把重算和重画顶起来
  const [rev, setRev] = useState(0)
  const [active, setActive] = useState(0)
  const [model, setModel] = useState<MapModel | null>(null)
  const [seedNote, setSeedNote] = useState<string | null>(null)
  const [seedDiff, setSeedDiff] = useState<{ missing: [RegionId, RegionId][]; extra: [RegionId, RegionId][] } | null>(null)
  const [relaxing, setRelaxing] = useState(false)
  const [renaming, setRenaming] = useState<number | null>(null)

  const undoRef = useRef<Int32Array[]>([])
  const redoRef = useRef<Int32Array[]>([])
  const relaxRef = useRef<RelaxState | null>(null)

  const palette = useMemo(() => paletteByKey(opts.paletteKey), [opts.paletteKey])
  const bump = useCallback(() => setRev((r) => r + 1), [])

  usePersist(PAINT_OPTS_KEY, opts)
  usePersist(PAINT_KEY, useMemo(() => toSnapshot(painting), [painting, rev]), 700)

  // ── 撤销 ──
  const pushUndo = useCallback(() => {
    undoRef.current.push(Int32Array.from(painting.labels))
    if (undoRef.current.length > UNDO_LIMIT) undoRef.current.shift()
    redoRef.current = []
  }, [painting])

  const undo = useCallback(() => {
    const prev = undoRef.current.pop()
    if (!prev) return
    redoRef.current.push(Int32Array.from(painting.labels))
    painting.labels.set(prev)
    bump()
  }, [painting, bump])

  const redo = useCallback(() => {
    const next = redoRef.current.pop()
    if (!next) return
    undoRef.current.push(Int32Array.from(painting.labels))
    painting.labels.set(next)
    bump()
  }, [painting, bump])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      const target = e.target as HTMLElement | null
      if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return
      if (e.key === 'z' && !e.shiftKey) {
        e.preventDefault()
        undo()
      } else if (e.key === 'y' || (e.key === 'z' && e.shiftKey)) {
        e.preventDefault()
        redo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo])

  // ── 派生信息 ──
  const areas = useMemo(() => areasOf(painting), [painting, rev])
  const poles = useMemo(() => poleCells(painting), [painting, rev])
  const labels = useMemo(() => labelsFor(painting, palette, poles), [painting, palette, poles, rev])
  const issues = useMemo(
    () => inspect(painting, opts.relax.minArea, opts.relax.minContact),
    [painting, rev, opts.relax.minArea, opts.relax.minContact],
  )
  const contacts = useMemo(() => {
    const out: { a: string; b: string; n: number }[] = []
    for (const [key, n] of contactsOf(painting)) {
      const [x, y] = unpair(key)
      if (painting.names[x] === undefined || painting.names[y] === undefined) continue
      out.push({ a: painting.names[x], b: painting.names[y], n })
    }
    return out.sort((p, q) => (p.a === q.a ? p.b.localeCompare(q.b) : p.a.localeCompare(q.a)))
  }, [painting, rev])

  // ── 整形 ──
  useEffect(() => {
    if (!relaxing) return
    let stopped = false
    let handle = 0
    let rounds = 0
    const tick = () => {
      if (stopped) return
      const st = relaxRef.current
      if (!st) {
        setRelaxing(false)
        return
      }
      let moved = 0
      // 一帧跑三轮：既看得见形状在动，又不至于把主线程占死
      for (let r = 0; r < 3; r++) moved += relaxRound(st)
      rounds += 3
      bump()
      if (moved === 0 || rounds > 300) {
        setRelaxing(false)
        return
      }
      handle = requestAnimationFrame(tick)
    }
    handle = requestAnimationFrame(tick)
    return () => {
      stopped = true
      cancelAnimationFrame(handle)
    }
  }, [relaxing, bump])

  const startRelax = () => {
    if (relaxing) {
      setRelaxing(false)
      return
    }
    if (!painting.names.length) return
    pushUndo()
    relaxRef.current = createRelax(painting, opts.relax)
    setRelaxing(true)
  }

  // ── 笔刷 ──
  const stroke = useCallback(
    (cells: number[]) => {
      if (opts.tool === 'erase') {
        if (paintCells(painting, cells, SEA)) bump()
        return
      }
      if (active < 0 || active >= painting.names.length) return
      if (paintCells(painting, cells, active)) bump()
    },
    [painting, opts.tool, active, bump],
  )

  const pick = useCallback(
    (cell: number) => {
      if (opts.tool === 'pick') {
        const k = painting.labels[cell]
        if (k >= 0) setActive(k)
        return
      }
      // 油漆桶
      if (active < 0 || active >= painting.names.length) return
      pushUndo()
      if (floodFill(painting, cell, active)) bump()
    },
    [painting, opts.tool, active, pushUndo, bump],
  )

  // ── 区域增删改 ──
  const newRegion = () => {
    const name = nextRegionName(painting.names)
    const next = clonePainting(painting)
    const k = addRegion(next, name, nextSlot(next.colors))
    setPainting(next)
    setActive(k)
  }

  const dropRegion = (k: number) => {
    pushUndo()
    const next = clonePainting(painting)
    removeRegionAt(next, k)
    setPainting(next)
    setActive((cur) => (cur > k ? cur - 1 : Math.min(cur, next.names.length - 1)))
  }

  const rename = (k: number, raw: string) => {
    const name = raw.trim().replace(/\s+/g, '')
    setRenaming(null)
    if (!name || name === painting.names[k] || painting.names.includes(name)) return
    const next = clonePainting(painting)
    next.names[k] = name
    setPainting(next)
  }

  const setColor = (k: number, value: string) => {
    const next = clonePainting(painting)
    next.colors[k] = value
    setPainting(next)
  }

  const autoColor = () => {
    const assign = fourColor(graphFromPainting(painting))
    const next = clonePainting(painting)
    next.names.forEach((n, k) => {
      next.colors[k] = assign[n] ?? next.colors[k]
    })
    setPainting(next)
  }

  const clearAll = () => {
    pushUndo()
    painting.labels.fill(SEA)
    bump()
  }

  const mergeStrays = () => {
    pushUndo()
    if (mergeStrayComponents(painting)) bump()
  }

  // ── 换网格密度：把已经涂好的搬过去 ──
  const changeDensity = (density: DensityKey) => {
    if (density === opts.density) return
    const mesh = meshFor(density)
    const old = painting
    setPainting(resampleOnto(old, mesh, (x, y) => cellAt(old.mesh, x, y)))
    setOpts((o) => ({ ...o, density }))
    undoRef.current = []
    redoRef.current = []
  }

  // ── 由邻接关系铺草稿 ──
  const seed = () => {
    const { graph, warnings } = parseGraphText(opts.graphText)
    if (!graph.regions.length) {
      setSeedNote(warnings[0] ?? '还没有写出任何区域')
      setSeedDiff(null)
      return
    }
    const colored = { ...graph, colors: fourColor(graph) }
    const result = seedFromGraph(painting.mesh, colored, { ...DEFAULT_SEED, minArea: opts.relax.minArea })
    setPainting(result.painting)
    setActive(0)
    setSeedNote(result.note)
    setSeedDiff({ missing: result.missing, extra: result.extra })
    undoRef.current = []
    redoRef.current = []
  }

  const finish = () => {
    const { model: built, warnings } = traceToModel(painting, {
      smooth: opts.smooth,
      spacing: 1.1,
      style: 'map',
      seed: 1,
    })
    if (warnings.length) {
      setSeedNote(warnings[0])
      return
    }
    setModel(built)
  }

  if (model) {
    return (
      <MapEditor
        model={model}
        palette={palette}
        paletteKey={opts.paletteKey}
        onPaletteChange={(paletteKey) => setOpts((o) => ({ ...o, paletteKey }))}
        onChange={setModel}
        onBack={() => setModel(null)}
      />
    )
  }

  const painted = [...areas].reduce((a, b) => a + b, 0)
  const total = [...painting.mesh.paintable].reduce((a, b) => a + b, 0)

  return (
    <div className="paint">
      <div className="paint-left">
        <div className="panel">
          <div className="panel-head">
            <h3>区域</h3>
            <button className="btn" onClick={newRegion}>
              新建
            </button>
          </div>
          {!painting.names.length && (
            <p className="empty-note">先「新建」一块，再到右边画布上涂。邻接关系会自己从涂色里量出来。</p>
          )}
          <div className="paint-regions">
            {painting.names.map((name, k) => (
              <div key={k} className={k === active ? 'paint-region on' : 'paint-region'}>
                <button className="paint-swatch" onClick={() => setActive(k)} title="选为当前画笔">
                  <span style={{ background: resolveColor(painting.colors[k], palette) }} />
                </button>
                {renaming === k ? (
                  <input
                    className="paint-name"
                    autoFocus
                    defaultValue={name}
                    onBlur={(e) => rename(k, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') rename(k, (e.target as HTMLInputElement).value)
                      if (e.key === 'Escape') setRenaming(null)
                    }}
                  />
                ) : (
                  <button className="paint-name" onDoubleClick={() => setRenaming(k)} onClick={() => setActive(k)}>
                    {name}
                  </button>
                )}
                <span className="muted paint-area">{areas[k]} 格</span>
                <button className="icon-btn" title="删除这一块" onClick={() => dropRegion(k)}>
                  ×
                </button>
              </div>
            ))}
          </div>
          {painting.names[active] !== undefined && (
            <ColorPicker
              value={painting.colors[active] ?? 'gray'}
              palette={palette}
              onChange={(v) => setColor(active, v)}
            />
          )}
          <div className="panel-actions">
            <button className="btn" onClick={autoColor} disabled={!painting.names.length}>
              四色自动上色
            </button>
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <h3>工具</h3>
          </div>
          <div className="seg wide">
            {TOOLS.map((t) => (
              <button
                key={t.key}
                className={opts.tool === t.key ? 'on' : ''}
                title={t.hint}
                onClick={() => setOpts((o) => ({ ...o, tool: t.key }))}
              >
                {t.label}
              </button>
            ))}
          </div>
          <label className="field">
            <span>笔刷 {opts.brush} 格</span>
            <input
              type="range"
              min={1}
              max={12}
              value={opts.brush}
              onChange={(e) => setOpts((o) => ({ ...o, brush: Number(e.target.value) }))}
            />
          </label>
          <div className="inline">
            <span className="muted">网格</span>
            <div className="seg">
              {DENSITIES.map((d) => (
                <button
                  key={d.key}
                  className={opts.density === d.key ? 'on' : ''}
                  onClick={() => changeDensity(d.key)}
                >
                  {d.label}
                </button>
              ))}
            </div>
            <label className="inline">
              <input
                type="checkbox"
                checked={opts.showGrid}
                onChange={(e) => setOpts((o) => ({ ...o, showGrid: e.target.checked }))}
              />
              <span className="muted">格线</span>
            </label>
          </div>
          <div className="panel-actions">
            <button className="btn" onClick={undo}>
              撤销
            </button>
            <button className="btn" onClick={redo}>
              重做
            </button>
            <span className="spacer" />
            <button className="btn" onClick={clearAll}>
              清空
            </button>
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <h3>整形</h3>
            <button className={relaxing ? 'btn pass' : 'btn primary'} onClick={startRelax}>
              {relaxing ? '停下' : '开始整形'}
            </button>
          </div>
          <p className="muted">
            在不改动邻接关系的前提下把形状磨圆、把面积拉匀。每挪一格都先验过，
            所以怎么跑都不会把你涂出来的拓扑弄坏。
          </p>
          <label className="field">
            <span>紧凑度 {opts.relax.compact.toFixed(1)}</span>
            <input
              type="range"
              min={0}
              max={2}
              step={0.1}
              value={opts.relax.compact}
              onChange={(e) =>
                setOpts((o) => ({ ...o, relax: { ...o.relax, compact: Number(e.target.value) } }))
              }
            />
          </label>
          <label className="field">
            <span>面积均衡 {opts.relax.areaEven.toFixed(1)}</span>
            <input
              type="range"
              min={0}
              max={2}
              step={0.1}
              value={opts.relax.areaEven}
              onChange={(e) =>
                setOpts((o) => ({ ...o, relax: { ...o.relax, areaEven: Number(e.target.value) } }))
              }
            />
          </label>
          <label className="field">
            <span>每块最少 {opts.relax.minArea} 格</span>
            <input
              type="range"
              min={1}
              max={60}
              value={opts.relax.minArea}
              onChange={(e) =>
                setOpts((o) => ({ ...o, relax: { ...o.relax, minArea: Number(e.target.value) } }))
              }
            />
          </label>
          <label className="field">
            <span>最短公共边界 {opts.relax.minContact} 格边</span>
            <input
              type="range"
              min={1}
              max={12}
              value={opts.relax.minContact}
              onChange={(e) =>
                setOpts((o) => ({ ...o, relax: { ...o.relax, minContact: Number(e.target.value) } }))
              }
            />
          </label>
        </div>

        <div className="panel">
          <div className="panel-head">
            <h3>检查</h3>
          </div>
          {!issues.length ? (
            <p className="muted">没发现问题。已涂 {painted} / {total} 格。</p>
          ) : (
            <ul className="paint-issues">
              {issues.map((x, i) => (
                <li key={i} className={x.kind === 'split' || x.kind === 'empty' ? 'bad' : ''}>
                  {x.text}
                </li>
              ))}
            </ul>
          )}
          {issues.some((x) => x.kind === 'split') && (
            <div className="panel-actions">
              <button className="btn" onClick={mergeStrays}>
                并掉飞地
              </button>
              <span className="muted">每块只留最大的那片，零星几格并给旁边的邻居</span>
            </div>
          )}
          {contacts.length > 0 && (
            <details className="paint-adj">
              <summary>量出来的邻接关系（{contacts.length} 条）</summary>
              <div className="paint-adj-list">
                {contacts.map((c, i) => (
                  <span key={i} className="chip" title={`公共边界 ${c.n} 格边`}>
                    {c.a}–{c.b}
                  </span>
                ))}
              </div>
            </details>
          )}
        </div>

        <div className="panel">
          <div className="panel-head">
            <h3>由邻接关系铺草稿</h3>
            <button className="btn" onClick={seed}>
              铺草稿
            </button>
          </div>
          <p className="muted">
            会覆盖当前画布。铺出来的只是起点，接着用画笔改就行——
            机器切出来的边界总有几处不合意，那正是手工该上场的地方。
          </p>
          <textarea
            className="graph-text"
            rows={4}
            value={opts.graphText}
            onChange={(e) => setOpts((o) => ({ ...o, graphText: e.target.value }))}
          />
          {seedNote && <p className="warn strong">{seedNote}</p>}
          {seedDiff && (seedDiff.missing.length > 0 || seedDiff.extra.length > 0) && (
            <div className="paint-diff">
              {seedDiff.missing.length > 0 && (
                <p className="warn">
                  这几条邻接没铺出来，要手工补上：
                  {seedDiff.missing.map(([a, b]) => ` ${a}–${b}`).join('，')}
                </p>
              )}
              {seedDiff.extra.length > 0 && (
                <p className="warn">
                  这几条是多出来的，要手工分开：
                  {seedDiff.extra.map(([a, b]) => ` ${a}–${b}`).join('，')}
                </p>
              )}
            </div>
          )}
          {seedDiff && !seedDiff.missing.length && !seedDiff.extra.length && (
            <p className="muted">草稿的邻接关系与目标完全一致。</p>
          )}
        </div>
      </div>

      <div className="paint-right">
        <div className="paint-bar">
          <div className="seg">
            {PALETTES.map((p) => (
              <button
                key={p.key}
                className={opts.paletteKey === p.key ? 'on' : ''}
                title={p.hint}
                onClick={() => setOpts((o) => ({ ...o, paletteKey: p.key }))}
              >
                {p.label}
              </button>
            ))}
          </div>
          <label className="field inline">
            <span>磨角 {opts.smooth}</span>
            <input
              type="range"
              min={0}
              max={5}
              value={opts.smooth}
              onChange={(e) => setOpts((o) => ({ ...o, smooth: Number(e.target.value) }))}
            />
          </label>
          <span className="spacer" />
          <button className="btn primary" onClick={finish} disabled={!painting.names.length}>
            描边界并导出…
          </button>
        </div>
        <div className="paint-stage">
          <PaintCanvas
            painting={painting}
            palette={palette}
            brush={opts.brush}
            showGrid={opts.showGrid}
            labelAt={labels}
            tool={opts.tool}
            revision={rev}
            onStroke={stroke}
            onStrokeStart={pushUndo}
            onStrokeEnd={bump}
            onPick={pick}
          />
        </div>
        {!storageAvailable && (
          <p className="warn">浏览器不让本页用本地存储，刷新后画布不会保留，请及时导出。</p>
        )}
      </div>
    </div>
  )
}


