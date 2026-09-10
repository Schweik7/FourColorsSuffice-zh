import { useCallback, useEffect, useRef } from 'react'
import { DIRS, cellAt, cellsInDisc } from '../core/mesh'
import { SEA, labelOfNeighbor, type Painting } from '../core/paint'
import { readableTextOn, resolveColor, type Palette } from '../core/palette'

export type Tool = 'brush' | 'erase' | 'fill' | 'pick'

interface Props {
  painting: Painting
  palette: Palette
  /** 画笔半径，格数 */
  brush: number
  showGrid: boolean
  /** 每块的标签放哪儿；为空则不画标签 */
  labelAt: { text: string; x: number; y: number; fill: string }[]
  /** 一笔涂到哪些格子上；由外层决定怎么改 labels */
  onStroke: (cells: number[]) => void
  onStrokeStart: () => void
  onStrokeEnd: () => void
  onPick: (cell: number) => void
  tool: Tool
  /** 触发重画的版本号：labels 是就地改的，靠它通知 canvas */
  revision: number
}

/**
 * 涂色画布。
 *
 * 用 canvas 而不是 SVG：一屏三五千个格子，每笔都要重画，
 * SVG 那么多节点浏览器扛不住，canvas 按颜色分批一次 fill 就完事了。
 * 命中测试也简单——六边形是它中心在三角格上的 Voronoi 胞腔，
 * 「离哪个中心最近」就是准确答案。
 */
export default function PaintCanvas({
  painting,
  palette,
  brush,
  showGrid,
  labelAt,
  onStroke,
  onStrokeStart,
  onStrokeEnd,
  onPick,
  tool,
  revision,
}: Props) {
  const ref = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const last = useRef<{ x: number; y: number } | null>(null)
  const { mesh } = painting

  // ── 重画 ──
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const w = mesh.width
    const h = mesh.height
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr
      canvas.height = h * dpr
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)

    // 海：画成淡淡的方格底，一眼能看出哪儿还没涂
    ctx.fillStyle = '#f7f7f5'
    ctx.fillRect(0, 0, w, h)

    const tracePolygon = (i: number) => {
      const base = i * DIRS
      const v0 = mesh.corner[base]
      ctx.moveTo(mesh.vx[v0], mesh.vy[v0])
      for (let d = 1; d < DIRS; d++) {
        const v = mesh.corner[base + d]
        ctx.lineTo(mesh.vx[v], mesh.vy[v])
      }
      ctx.closePath()
    }

    // 按块分批填色：一块只调用一次 fill，几千个格子也不卡
    const buckets = new Map<number, number[]>()
    for (let i = 0; i < mesh.count; i++) {
      const k = painting.labels[i]
      if (k < 0 || !mesh.paintable[i]) continue
      const list = buckets.get(k)
      if (list) list.push(i)
      else buckets.set(k, [i])
    }
    for (const [k, cells] of buckets) {
      ctx.fillStyle = resolveColor(painting.colors[k], palette)
      ctx.beginPath()
      for (const i of cells) tracePolygon(i)
      ctx.fill()
    }

    if (showGrid) {
      ctx.strokeStyle = 'rgba(0,0,0,0.08)'
      ctx.lineWidth = 0.5
      ctx.beginPath()
      for (let i = 0; i < mesh.count; i++) {
        if (mesh.paintable[i]) tracePolygon(i)
      }
      ctx.stroke()
    }

    // 区域边界：只描异色格边，得到的就是最终地图的轮廓
    ctx.strokeStyle = '#2f2f2f'
    ctx.lineWidth = 1.6
    ctx.lineCap = 'round'
    ctx.beginPath()
    for (let i = 0; i < mesh.count; i++) {
      const k = painting.labels[i]
      for (let d = 0; d < DIRS; d++) {
        const j = mesh.nbr[i * DIRS + d]
        // 每条边只从格号小的那侧描一次
        if (j >= 0 && j < i) continue
        if (labelOfNeighbor(painting, i, d) === k) continue
        if (k < 0 && (j < 0 || painting.labels[j] < 0)) continue
        const a = mesh.corner[i * DIRS + d]
        const b = mesh.corner[i * DIRS + ((d + 1) % DIRS)]
        ctx.moveTo(mesh.vx[a], mesh.vy[a])
        ctx.lineTo(mesh.vx[b], mesh.vy[b])
      }
    }
    ctx.stroke()

    if (labelAt.length) {
      ctx.font = "italic 22px Georgia, 'Times New Roman', serif"
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      for (const l of labelAt) {
        ctx.fillStyle = l.fill
        ctx.fillText(l.text, l.x, l.y)
      }
    }
  }, [painting, palette, showGrid, labelAt, revision, mesh])

  // ── 指针 ──
  const toModel = useCallback((clientX: number, clientY: number) => {
    const canvas = ref.current
    if (!canvas) return null
    const box = canvas.getBoundingClientRect()
    if (!box.width || !box.height) return null
    return {
      x: ((clientX - box.left) / box.width) * mesh.width,
      y: ((clientY - box.top) / box.height) * mesh.height,
    }
  }, [mesh])

  const applyAt = useCallback(
    (x: number, y: number) => {
      if (tool === 'pick' || tool === 'fill') {
        const cell = cellAt(mesh, x, y)
        if (cell >= 0) onPick(cell)
        return
      }
      onStroke(cellsInDisc(mesh, x, y, Math.max(1, brush) * mesh.size))
    },
    [tool, mesh, brush, onStroke, onPick],
  )

  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = toModel(e.clientX, e.clientY)
    if (!p) return
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // 拖到画布外不跟手而已，不该让整笔失效
    }
    if (tool === 'pick' || tool === 'fill') {
      applyAt(p.x, p.y)
      return
    }
    drawing.current = true
    last.current = p
    onStrokeStart()
    applyAt(p.x, p.y)
  }

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return
    const p = toModel(e.clientX, e.clientY)
    if (!p) return
    const from = last.current ?? p
    // 沿着这一段补点：手快了不补的话会漏出一串空格
    const dist = Math.hypot(p.x - from.x, p.y - from.y)
    const steps = Math.max(1, Math.ceil(dist / (mesh.size * 0.8)))
    for (let s = 1; s <= steps; s++) {
      applyAt(from.x + ((p.x - from.x) * s) / steps, from.y + ((p.y - from.y) * s) / steps)
    }
    last.current = p
  }

  const up = () => {
    if (!drawing.current) return
    drawing.current = false
    last.current = null
    onStrokeEnd()
  }

  return (
    <canvas
      ref={ref}
      className="paint-canvas"
      /*
       * 两条 max-* 都要顶到模型尺寸，不能只写 100%。
       * canvas 的固有尺寸取自它的 width/height 属性，而那是按设备像素比放大过的
       * （高分屏上是 1800×1280），只写 100% 的话它在高分屏上就撑得比 900 宽，
       * 同一份画布在不同屏幕上大小不一样。顶到模型尺寸之后，
       * 宽高仍是 auto，浏览器按固有比例缩，最大就是 1:1。
       */
      style={{
        maxWidth: `min(100%, ${mesh.width}px)`,
        maxHeight: `min(100%, ${mesh.height}px)`,
      }}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
    />
  )
}

/** 标签绘制信息：给每块找一个显眼的位置，并按底色挑黑字还是白字 */
export function labelsFor(
  painting: Painting,
  palette: Palette,
  poles: Int32Array,
): { text: string; x: number; y: number; fill: string }[] {
  const out: { text: string; x: number; y: number; fill: string }[] = []
  painting.names.forEach((name, k) => {
    const cell = poles[k]
    if (cell === undefined || cell < 0) return
    const fill = resolveColor(painting.colors[k], palette)
    out.push({
      text: name,
      x: painting.mesh.cx[cell],
      y: painting.mesh.cy[cell],
      fill: readableTextOn(fill),
    })
  })
  return out
}

export { SEA }
