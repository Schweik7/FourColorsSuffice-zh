import { useEffect, useMemo, useState } from 'react'
import type { GraphSpec, RegionId } from '../core/types'
import {
  adjacencySet,
  edgeKey,
  fourColor,
  nextRegionName,
  neighborsOf,
  normalizeGraph,
  planarityWarning,
  removeRegion,
  renameRegion,
  setEdge,
} from '../core/graph'
import { graphToText, parseGraphText } from '../core/parse'
import type { Palette } from '../core/palette'
import ColorPicker from './ColorPicker'

interface Props {
  graph: GraphSpec
  palette: Palette
  onChange: (graph: GraphSpec) => void
}

type Mode = 'visual' | 'text'

const SAMPLES: { label: string; text: string }[] = [
  { label: '四国互邻（需四色）', text: 'A: B C D\nB: C D\nC: D' },
  { label: '外圈五国', text: 'E: A B C D\nA B\nB C\nC D\nD A' },
  {
    label: '书中十区域示例',
    text: 'A: B C D\nB: C E F\nC: D F G\nD: G H\nE: F I\nF: G I J\nG: H J\nH: J\nI: J',
  },
]

export default function GraphInput({ graph, palette, onChange }: Props) {
  const [mode, setMode] = useState<Mode>('visual')
  const [text, setText] = useState(() => graphToText(graph))
  const [parseWarnings, setParseWarnings] = useState<string[]>([])

  // 从文本模式切回来之前，先把当前图同步进文本框
  useEffect(() => {
    if (mode === 'text') setText(graphToText(graph))
    // 只在进入文本模式的那一刻同步，之后由用户自由编辑
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  const adj = useMemo(() => adjacencySet(graph), [graph])
  const warning = planarityWarning(graph)

  const applyText = (next: string) => {
    setText(next)
    const { graph: parsed, warnings } = parseGraphText(next)
    setParseWarnings(warnings)
    // 沿用旧图里已经选好的颜色，别让用户白选
    const colors: Record<RegionId, string> = {}
    for (const id of parsed.regions) colors[id] = graph.colors[id] ?? 'gray'
    onChange(normalizeGraph({ ...parsed, colors }))
  }

  const addRegion = () => {
    const name = nextRegionName(graph.regions)
    onChange(
      normalizeGraph({
        ...graph,
        regions: [...graph.regions, name],
        colors: { ...graph.colors, [name]: 'gray' },
      }),
    )
  }

  const autoColor = () => {
    const assigned = fourColor(graph)
    onChange({ ...graph, colors: { ...graph.colors, ...assigned } })
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <h3>第一步 · 区域与邻居</h3>
        <div className="seg">
          <button className={mode === 'visual' ? 'on' : ''} onClick={() => setMode('visual')}>
            可视化
          </button>
          <button className={mode === 'text' ? 'on' : ''} onClick={() => setMode('text')}>
            文本（NetworkX 风格）
          </button>
        </div>
      </div>

      {mode === 'text' ? (
        <div className="text-mode">
          <textarea
            className="graph-text"
            value={text}
            spellCheck={false}
            onChange={(e) => applyText(e.target.value)}
            placeholder={'A: B C D\nB: C\n\n也接受 A B / A-B 的边表，\n以及 G.add_edge("A", "B") 这类 Python 代码'}
          />
          <div className="samples">
            <span className="muted">示例：</span>
            {SAMPLES.map((s) => (
              <button key={s.label} className="chip" onClick={() => applyText(s.text)}>
                {s.label}
              </button>
            ))}
          </div>
          {parseWarnings.map((w, i) => (
            <p key={i} className="warn">
              {w}
            </p>
          ))}
        </div>
      ) : (
        <div className="regions">
          {graph.regions.map((id) => (
            <div className="region-row" key={id}>
              <input
                className="region-name"
                value={id}
                onChange={(e) => {
                  const next = e.target.value.trim()
                  if (!next || graph.regions.includes(next)) return
                  onChange(renameRegion(graph, id, next))
                }}
              />

              <ColorPicker
                value={graph.colors[id] ?? 'gray'}
                palette={palette}
                onChange={(color) => onChange({ ...graph, colors: { ...graph.colors, [id]: color } })}
              />

              <div className="neighbors">
                <span className="muted">邻居</span>
                {graph.regions
                  .filter((other) => other !== id)
                  .map((other) => {
                    const on = adj.has(edgeKey(id, other))
                    return (
                      <button
                        key={other}
                        className={on ? 'nb on' : 'nb'}
                        onClick={() => onChange(setEdge(graph, id, other, !on))}
                        title={on ? `断开 ${id}–${other}` : `连接 ${id}–${other}`}
                      >
                        {other}
                      </button>
                    )
                  })}
                {graph.regions.length === 1 && <span className="muted">（再加一个区域才能连边）</span>}
              </div>

              <button
                className="icon-btn"
                title={`删除区域 ${id}`}
                onClick={() => onChange(removeRegion(graph, id))}
              >
                ×
              </button>
            </div>
          ))}

          {!graph.regions.length && (
            <p className="muted">还没有区域。点下面的「添加区域」，或切到文本模式一次性粘贴。</p>
          )}
        </div>
      )}

      <div className="panel-actions">
        {mode === 'visual' && (
          <>
            <button className="btn" onClick={addRegion}>
              + 添加区域
            </button>
            <button className="btn" onClick={autoColor} disabled={!graph.regions.length}>
              自动四色
            </button>
          </>
        )}
        <span className="spacer" />
        <span className="muted">
          {graph.regions.length} 个区域 · {graph.edges.length} 条邻接
          {graph.regions.length ? ` · 最大度 ${Math.max(...graph.regions.map((r) => neighborsOf(graph, r).length))}` : ''}
        </span>
      </div>

      {warning && <p className="warn strong">{warning}</p>}
    </div>
  )
}
