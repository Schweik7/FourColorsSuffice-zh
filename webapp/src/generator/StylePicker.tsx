import { useRef, useState } from 'react'
import type { Pt, StyleKind } from '../core/types'
import { rdp } from '../core/smooth'

interface Props {
  style: StyleKind
  onStyleChange: (style: StyleKind) => void
  framePolygon: Pt[]
  onFrameChange: (poly: Pt[]) => void
  width: number
  height: number
}

const STYLES: { key: StyleKind; label: string; desc: string }[] = [
  { key: 'bands', label: '嵌套色带', desc: '圆角矩形外框，环形分层、径向切分' },
  { key: 'map', label: '地图手绘', desc: '同样的结构，边界带明显的手绘抖动' },
  { key: 'geometric', label: '规整几何', desc: '直角外框、纯直线边界，棱角分明' },
  { key: 'frame', label: '自绘外框', desc: '你画出整体轮廓，地图铺满这个框' },
]

/** 每隔这么远才记一个点，免得手绘出成千上万个采样点 */
const SAMPLE_GAP = 6

export default function StylePicker({
  style,
  onStyleChange,
  framePolygon,
  onFrameChange,
  width,
  height,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [drawing, setDrawing] = useState(false)
  const draftRef = useRef<Pt[]>([])

  const toModel = (e: React.PointerEvent): Pt => {
    const svg = svgRef.current!
    const rect = svg.getBoundingClientRect()
    return {
      x: ((e.clientX - rect.left) / rect.width) * width,
      y: ((e.clientY - rect.top) / rect.height) * height,
    }
  }

  const start = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    draftRef.current = [toModel(e)]
    setDrawing(true)
    onFrameChange([])
  }

  const move = (e: React.PointerEvent) => {
    if (!drawing) return
    const p = toModel(e)
    const last = draftRef.current[draftRef.current.length - 1]
    if (Math.hypot(p.x - last.x, p.y - last.y) < SAMPLE_GAP) return
    draftRef.current.push(p)
    onFrameChange([...draftRef.current])
  }

  const end = () => {
    if (!drawing) return
    setDrawing(false)
    // 收笔时简化一下，控制点太密拖起来会很难受
    const simplified = rdp(draftRef.current, 3)
    onFrameChange(simplified.length >= 3 ? simplified : [])
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <h3>第二步 · 整体风格</h3>
      </div>

      <div className="style-cards">
        {STYLES.map((s) => (
          <button
            key={s.key}
            className={style === s.key ? 'style-card on' : 'style-card'}
            onClick={() => onStyleChange(s.key)}
          >
            <StyleThumb kind={s.key} />
            <strong>{s.label}</strong>
            <span>{s.desc}</span>
          </button>
        ))}
      </div>

      {style === 'frame' && (
        <div className="frame-draw">
          <p className="muted">按住鼠标画一圈，作为整张地图的外轮廓（松手自动闭合）。</p>
          <svg
            ref={svgRef}
            className="frame-canvas"
            viewBox={`0 0 ${width} ${height}`}
            onPointerDown={start}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
          >
            <rect width={width} height={height} fill="#fbfbf9" />
            {framePolygon.length >= 2 && (
              <polygon
                points={framePolygon.map((p) => `${p.x},${p.y}`).join(' ')}
                fill="#4f7cac22"
                stroke="#4f7cac"
                strokeWidth={3}
                strokeLinejoin="round"
              />
            )}
          </svg>
          <div className="panel-actions">
            <button className="btn" onClick={() => onFrameChange([])} disabled={!framePolygon.length}>
              清除外框
            </button>
            <span className="muted">
              {framePolygon.length >= 3 ? `${framePolygon.length} 个控制点` : '尚未绘制，将退回矩形画布'}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

/** 各风格的示意缩略图 */
function StyleThumb({ kind }: { kind: StyleKind }) {
  const line = { stroke: '#2f2f2f', strokeWidth: 2 } as const
  if (kind === 'bands') {
    return (
      <svg viewBox="0 0 100 64" className="thumb">
        <path {...line} d="M2 14a12 12 0 0 1 12-12h72a12 12 0 0 1 12 12v36a12 12 0 0 1-12 12H14a12 12 0 0 1-12-12Z" fill="#c0504d" />
        <path {...line} d="M14 20a8 8 0 0 1 8-8h56a8 8 0 0 1 8 8v24a8 8 0 0 1-8 8H22a8 8 0 0 1-8-8Z" fill="#e0b23c" />
        <path {...line} d="M50 12h28a8 8 0 0 1 8 8v24a8 8 0 0 1-8 8H50Z" fill="#5a9257" />
        <path {...line} d="M30 22h40v20H30Z" fill="#4f7cac" />
      </svg>
    )
  }
  if (kind === 'geometric') {
    return (
      <svg viewBox="0 0 100 64" className="thumb">
        <path {...line} d="M2 2h44v34H2Z" fill="#c0504d" />
        <path {...line} d="M46 2h52v22H46Z" fill="#5a9257" />
        <path {...line} d="M46 24h52v38H46Z" fill="#e0b23c" />
        <path {...line} d="M2 36h44v26H2Z" fill="#4f7cac" />
      </svg>
    )
  }
  if (kind === 'map') {
    return (
      <svg viewBox="0 0 100 64" className="thumb">
        <path {...line} d="M8 22C10 8 30 2 46 6c4 12-2 20-6 26-10 4-30 2-32-10Z" fill="#c0504d" />
        <path {...line} d="M46 6c14-4 34 0 40 12-2 10-14 12-22 10-10-2-14-14-18-22Z" fill="#5a9257" />
        <path {...line} d="M64 28c8 2 20 0 22-10 6 14 4 30-8 38-12 2-16-16-14-28Z" fill="#e0b23c" />
        <path {...line} d="M14 32c8 12 26 12 36 6 4 10 0 24-12 24-16 0-28-14-24-30Z" fill="#4f7cac" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 100 64" className="thumb">
      <path
        d="M12 30C8 12 28 4 50 6c24 2 40 12 38 28-2 18-24 28-44 26C24 58 15 46 12 30Z"
        fill="#f4e3b9"
        stroke="#4f7cac"
        strokeWidth={3}
        strokeDasharray="6 4"
      />
      <path {...line} d="M30 14c14-4 28 0 32 10-6 10-22 12-32 6-4-6-4-12 0-16Z" fill="#c4d8c3" />
      <path {...line} d="M22 34c12 8 30 8 42 0 2 12-10 22-24 20-12-2-20-10-18-20Z" fill="#c0d0e1" />
    </svg>
  )
}
