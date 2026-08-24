import { useCallback, useMemo, useRef, useState } from 'react'
import type { MapModel, Pt } from '../core/types'
import { arcById, nodePos, renderModel, toSvgString } from '../core/render'
import { embedMetadata } from '../core/serialize'
import { fourColor } from '../core/graph'
import { PALETTES, type Palette } from '../core/palette'
import ColorPicker from './ColorPicker'
import MapView from './MapView'

interface Props {
  model: MapModel
  palette: Palette
  paletteKey: string
  onPaletteChange: (key: string) => void
  onChange: (model: MapModel) => void
  onBack: () => void
}

type Handle =
  | { kind: 'node'; id: string }
  | { kind: 'mid'; arc: string; index: number }
  | { kind: 'label'; region: string }

/**
 * 抓住指针，这样拖到画布外面也不会断。
 * 有些情况下（合成事件、指针已经抬起）会抛 NotFoundError——
 * 那只是少了「拖出界仍跟手」这一点便利，不该让整个拖拽失效。
 */
function capturePointer(e: React.PointerEvent<SVGElement>) {
  try {
    e.currentTarget.setPointerCapture(e.pointerId)
  } catch {
    // 忽略：拖拽本身仍然工作
  }
}

const SEA_PRESETS: { label: string; value: string | null }[] = [
  { label: '透明', value: null },
  { label: '白', value: '#ffffff' },
  { label: '浅蓝', value: '#eaf1f7' },
  { label: '纸色', value: '#faf7f0' },
]

export default function MapEditor({
  model,
  palette,
  paletteKey,
  onPaletteChange,
  onChange,
  onBack,
}: Props) {
  const [editing, setEditing] = useState(false)
  const [drag, setDrag] = useState<Handle | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  const rendered = useMemo(() => renderModel(model, palette), [model, palette])
  const nodes = useMemo(() => nodePos(model), [model])
  const arcs = useMemo(() => arcById(model), [model])

  const toModel = useCallback((clientX: number, clientY: number): Pt => {
    const svg = svgRef.current!
    const rect = svg.getBoundingClientRect()
    return {
      x: ((clientX - rect.left) / rect.width) * model.width,
      y: ((clientY - rect.top) / rect.height) * model.height,
    }
  }, [model.width, model.height])

  /** 把某个手柄挪到 p。节点被多条弧共用，所以挪节点会同时带动它们 */
  const moveHandle = useCallback(
    (handle: Handle, p: Pt) => {
      if (handle.kind === 'node') {
        onChange({
          ...model,
          nodes: model.nodes.map((n) => (n.id === handle.id ? { ...n, p } : n)),
        })
        return
      }
      if (handle.kind === 'mid') {
        onChange({
          ...model,
          arcs: model.arcs.map((a) =>
            a.id === handle.arc
              ? { ...a, mid: a.mid.map((m, i) => (i === handle.index ? p : m)) }
              : a,
          ),
        })
        return
      }
      onChange({
        ...model,
        regions: model.regions.map((r) => (r.id === handle.region ? { ...r, labelPos: p } : r)),
      })
    },
    [model, onChange],
  )

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!drag) return
    moveHandle(drag, toModel(e.clientX, e.clientY))
  }

  /** 在弧上双击 → 在最近的两个控制点之间插入一个新点 */
  const insertPoint = (arcId: string, at: Pt) => {
    const arc = arcs.get(arcId)
    if (!arc) return
    const pts = [nodes.get(arc.n0)!, ...arc.mid, nodes.get(arc.n1)!]
    let bestIdx = 0
    let bestDist = Infinity
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i]
      const b = pts[i + 1]
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      const d = Math.hypot(mid.x - at.x, mid.y - at.y)
      if (d < bestDist) {
        bestDist = d
        bestIdx = i
      }
    }
    onChange({
      ...model,
      arcs: model.arcs.map((a) =>
        a.id === arcId ? { ...a, mid: [...a.mid.slice(0, bestIdx), at, ...a.mid.slice(bestIdx)] } : a,
      ),
    })
  }

  const removePoint = (arcId: string, index: number) => {
    onChange({
      ...model,
      arcs: model.arcs.map((a) =>
        a.id === arcId ? { ...a, mid: a.mid.filter((_, i) => i !== index) } : a,
      ),
    })
  }

  const exportSvg = () => {
    const svg = toSvgString(model, palette, embedMetadata(model))
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `fourcolor-map-${model.seed.toString(16)}.svg`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const setAllLabels = (show: boolean) =>
    onChange({ ...model, regions: model.regions.map((r) => ({ ...r, showLabel: show })) })

  return (
    <div className="editor">
      <div className="editor-canvas">
        <div className="editor-toolbar">
          <button className="btn" onClick={onBack}>
            ← 换一张
          </button>
          <button
            className={editing ? 'btn primary' : 'btn'}
            onClick={() => setEditing((v) => !v)}
          >
            {editing ? '✓ 完成边界编辑' : '✎ 编辑边界'}
          </button>
          <span className="spacer" />
          <label className="inline">
            <input
              type="checkbox"
              checked={model.showDual}
              onChange={(e) => onChange({ ...model, showDual: e.target.checked })}
            />
            叠加对偶图
          </label>
          <button className="btn primary" onClick={exportSvg}>
            ↓ 导出 SVG
          </button>
        </div>

        <div className={editing ? 'stage editing' : 'stage'}>
          <MapView
            rendered={rendered}
            labelSize={model.labelSize}
            className="map-svg"
            svgRef={svgRef}
            onPointerMove={onPointerMove}
            onPointerUp={() => setDrag(null)}
          >
            {editing && (
              <g className="handles">
                {/* 弧线本体：双击可插点 */}
                {rendered.arcs.map((a) =>
                  a.d ? (
                    <path
                      key={`hit-${a.id}`}
                      d={a.d}
                      className="arc-hit"
                      onDoubleClick={(e) => insertPoint(a.id, toModel(e.clientX, e.clientY))}
                    />
                  ) : null,
                )}

                {model.arcs.flatMap((arc) =>
                  arc.mid.map((p, i) => (
                    <circle
                      key={`${arc.id}-${i}`}
                      className="handle mid"
                      cx={p.x}
                      cy={p.y}
                      r={5}
                      onPointerDown={(e) => {
                        capturePointer(e)
                        setDrag({ kind: 'mid', arc: arc.id, index: i })
                      }}
                      onDoubleClick={() => removePoint(arc.id, i)}
                    />
                  )),
                )}

                {model.nodes.map((n) => (
                  <rect
                    key={n.id}
                    className="handle node"
                    x={n.p.x - 5.5}
                    y={n.p.y - 5.5}
                    width={11}
                    height={11}
                    onPointerDown={(e) => {
                      capturePointer(e)
                      setDrag({ kind: 'node', id: n.id })
                    }}
                  />
                ))}

                {model.regions
                  .filter((r) => r.showLabel)
                  .map((r) => (
                    <circle
                      key={`label-${r.id}`}
                      className="handle label"
                      cx={r.labelPos.x}
                      cy={r.labelPos.y}
                      r={model.labelSize * 0.7}
                      onPointerDown={(e) => {
                        capturePointer(e)
                        setDrag({ kind: 'label', region: r.id })
                      }}
                    />
                  ))}
              </g>
            )}
          </MapView>
        </div>

        {editing && (
          <p className="hint">
            方块 = 边界交汇点（拖它，交于此处的所有边界一起动）· 圆点 = 边界控制点 ·
            大圆 = 标签位置。双击边界插入控制点，双击控制点删除它。邻接关系不会因为拖动而改变。
          </p>
        )}
      </div>

      <aside className="editor-side">
        <section>
          <h4>配色方案</h4>
          <div className="seg wide">
            {PALETTES.map((p) => (
              <button
                key={p.key}
                className={paletteKey === p.key ? 'on' : ''}
                onClick={() => onPaletteChange(p.key)}
                title={p.hint}
              >
                {p.label}
              </button>
            ))}
          </div>
          <button
            className="btn"
            onClick={() => {
              const assigned = fourColor(model.graph)
              onChange({ ...model, graph: { ...model.graph, colors: { ...model.graph.colors, ...assigned } } })
            }}
          >
            重新自动四色
          </button>
        </section>

        <section>
          <h4>各区域</h4>
          <div className="region-list">
            {model.regions.map((r) => (
              <div className="region-item" key={r.id}>
                <label className="inline">
                  <input
                    type="checkbox"
                    checked={r.showLabel}
                    onChange={(e) =>
                      onChange({
                        ...model,
                        regions: model.regions.map((x) =>
                          x.id === r.id ? { ...x, showLabel: e.target.checked } : x,
                        ),
                      })
                    }
                  />
                  <b>{r.id}</b>
                </label>
                <ColorPicker
                  value={model.graph.colors[r.id] ?? 'gray'}
                  palette={palette}
                  onChange={(color) =>
                    onChange({
                      ...model,
                      graph: { ...model.graph, colors: { ...model.graph.colors, [r.id]: color } },
                    })
                  }
                />
              </div>
            ))}
          </div>
          <div className="panel-actions">
            <button className="btn" onClick={() => setAllLabels(true)}>
              全部显示标签
            </button>
            <button className="btn" onClick={() => setAllLabels(false)}>
              全部隐藏
            </button>
          </div>
        </section>

        <section>
          <h4>版面</h4>
          <label className="field">
            边界线粗细
            <input
              type="range"
              min={0}
              max={6}
              step={0.5}
              value={model.strokeWidth}
              onChange={(e) => onChange({ ...model, strokeWidth: Number(e.target.value) })}
            />
            <span>{model.strokeWidth}</span>
          </label>
          <label className="field">
            标签字号
            <input
              type="range"
              min={10}
              max={48}
              step={1}
              value={model.labelSize}
              onChange={(e) => onChange({ ...model, labelSize: Number(e.target.value) })}
            />
            <span>{model.labelSize}</span>
          </label>
          <label className="field">
            边界线颜色
            <input
              type="color"
              value={model.strokeColor}
              onChange={(e) => onChange({ ...model, strokeColor: e.target.value })}
            />
          </label>
          <div className="field">
            背景
            <div className="seg">
              {SEA_PRESETS.map((s) => (
                <button
                  key={s.label}
                  className={model.seaColor === s.value ? 'on' : ''}
                  onClick={() => onChange({ ...model, seaColor: s.value })}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        </section>
      </aside>
    </div>
  )
}
