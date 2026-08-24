import type { GraphSpec, Pt, RegionId } from './types'
import type { Rng } from './rng'

export interface Layout {
  pos: Record<RegionId, Pt>
  crossings: number
}

function orient(a: Pt, b: Pt, c: Pt): number {
  const v = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
  return Math.abs(v) < 1e-9 ? 0 : Math.sign(v)
}

/** 真交叉：两段在内部相交，共享端点不算 */
function segmentsCross(p1: Pt, p2: Pt, p3: Pt, p4: Pt): boolean {
  if (p1 === p3 || p1 === p4 || p2 === p3 || p2 === p4) return false
  const d1 = orient(p3, p4, p1)
  const d2 = orient(p3, p4, p2)
  const d3 = orient(p1, p2, p3)
  const d4 = orient(p1, p2, p4)
  return d1 !== d2 && d3 !== d4 && d1 !== 0 && d2 !== 0 && d3 !== 0 && d4 !== 0
}

function countCrossings(graph: GraphSpec, pos: Record<RegionId, Pt>): number {
  const { edges } = graph
  let n = 0
  for (let i = 0; i < edges.length; i++) {
    for (let j = i + 1; j < edges.length; j++) {
      const [a, b] = edges[i]
      const [c, d] = edges[j]
      if (a === c || a === d || b === c || b === d) continue
      if (segmentsCross(pos[a], pos[b], pos[c], pos[d])) n++
    }
  }
  return n
}

/** 点到线段的最近点 */
function closestOnSegment(p: Pt, a: Pt, b: Pt): { q: Pt; t: number } {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  if (len2 < 1e-9) return { q: a, t: 0 }
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  return { q: { x: a.x + t * dx, y: a.y + t * dy }, t }
}

interface SimOptions {
  iterations: number
  width: number
  height: number
}

function simulate(graph: GraphSpec, rng: Rng, opts: SimOptions): Record<RegionId, Pt> {
  const ids = graph.regions
  const n = ids.length
  const { width: W, height: H } = opts
  const pos: Record<RegionId, Pt> = {}

  // 初始位置：圆周 + 抖动。纯随机初值容易把图折叠在一起
  const radius = Math.min(W, H) * 0.35
  ids.forEach((id, i) => {
    const theta = (2 * Math.PI * i) / n + rng.range(-0.35, 0.35)
    const r = radius * rng.range(0.55, 1)
    pos[id] = { x: W / 2 + r * Math.cos(theta), y: H / 2 + r * Math.sin(theta) }
  })
  if (n === 1) pos[ids[0]] = { x: W / 2, y: H / 2 }

  // 理想边长
  const k = Math.sqrt((W * H) / Math.max(n, 1)) * 0.62
  let temp = Math.min(W, H) * 0.12

  for (let step = 0; step < opts.iterations; step++) {
    const disp: Record<RegionId, Pt> = {}
    for (const id of ids) disp[id] = { x: 0, y: 0 }

    // 顶点之间互斥
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = ids[i]
        const b = ids[j]
        let dx = pos[a].x - pos[b].x
        let dy = pos[a].y - pos[b].y
        let dist = Math.hypot(dx, dy)
        if (dist < 1e-6) {
          dx = rng.range(-1, 1)
          dy = rng.range(-1, 1)
          dist = 1e-6
        }
        const f = (k * k) / dist
        disp[a].x += (dx / dist) * f
        disp[a].y += (dy / dist) * f
        disp[b].x -= (dx / dist) * f
        disp[b].y -= (dy / dist) * f
      }
    }

    // 边上的弹簧吸引
    for (const [a, b] of graph.edges) {
      const dx = pos[a].x - pos[b].x
      const dy = pos[a].y - pos[b].y
      const dist = Math.max(Math.hypot(dx, dy), 1e-6)
      const f = (dist * dist) / k
      disp[a].x -= (dx / dist) * f
      disp[a].y -= (dy / dist) * f
      disp[b].x += (dx / dist) * f
      disp[b].y += (dy / dist) * f
    }

    // 顶点与不相邻的边互斥：避免某个区域的种子圆压在别人的边带上，
    // 那会在栅格生长阶段造出图里没有的邻接
    const minGap = k * 0.75
    for (const v of ids) {
      for (const [a, b] of graph.edges) {
        if (v === a || v === b) continue
        const { q, t } = closestOnSegment(pos[v], pos[a], pos[b])
        let dx = pos[v].x - q.x
        let dy = pos[v].y - q.y
        let dist = Math.hypot(dx, dy)
        if (dist > minGap) continue
        if (dist < 1e-6) {
          dx = -(pos[b].y - pos[a].y)
          dy = pos[b].x - pos[a].x
          dist = Math.max(Math.hypot(dx, dy), 1e-6)
        }
        const f = ((minGap - dist) / minGap) * k * 2.6
        disp[v].x += (dx / dist) * f
        disp[v].y += (dy / dist) * f
        // 边的两端各承担一半反作用力
        for (const e of [a, b] as const) {
          const w = e === a ? 1 - t : t
          disp[e].x -= (dx / dist) * f * w * 0.5
          disp[e].y -= (dy / dist) * f * w * 0.5
        }
      }
    }

    // 限幅 + 退火 + 收进画布
    for (const id of ids) {
      const d = Math.hypot(disp[id].x, disp[id].y)
      if (d > 1e-9) {
        const scale = Math.min(d, temp) / d
        pos[id].x += disp[id].x * scale
        pos[id].y += disp[id].y * scale
      }
      pos[id].x = Math.max(W * 0.06, Math.min(W * 0.94, pos[id].x))
      pos[id].y = Math.max(H * 0.06, Math.min(H * 0.94, pos[id].y))
    }
    temp *= 0.982
  }

  return pos
}

/** 把布局等比缩放平移到画布内，留出边距 */
function fitToCanvas(pos: Record<RegionId, Pt>, W: number, H: number, margin: number) {
  const pts = Object.values(pos)
  if (!pts.length) return
  const xs = pts.map((p) => p.x)
  const ys = pts.map((p) => p.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const spanX = Math.max(maxX - minX, 1e-6)
  const spanY = Math.max(maxY - minY, 1e-6)
  const scale = Math.min((W - 2 * margin) / spanX, (H - 2 * margin) / spanY)
  // 单点或共线时不要放大到离谱
  const s = Math.min(scale, 1e3)
  const offX = (W - spanX * s) / 2 - minX * s
  const offY = (H - spanY * s) / 2 - minY * s
  for (const p of pts) {
    p.x = p.x * s + offX
    p.y = p.y * s + offY
  }
}

/**
 * 求一个尽量无交叉的直线画法。
 * 多次随机重启取交叉最少的一版，再用「交换顶点位置」做局部改良。
 */
export function layoutGraph(
  graph: GraphSpec,
  rng: Rng,
  width: number,
  height: number,
  restarts = 6,
): Layout {
  if (!graph.regions.length) return { pos: {}, crossings: 0 }

  let best: Record<RegionId, Pt> | null = null
  let bestCross = Infinity

  for (let attempt = 0; attempt < restarts; attempt++) {
    const pos = simulate(graph, rng, { iterations: 420, width, height })
    const cross = countCrossings(graph, pos)
    if (cross < bestCross) {
      bestCross = cross
      best = pos
    }
    if (bestCross === 0) break
  }

  const pos = best!
  bestCross = repairCrossings(graph, pos, rng, bestCross)

  fitToCanvas(pos, width, height, Math.min(width, height) * 0.12)
  return { pos, crossings: countCrossings(graph, pos) }
}

/**
 * 消交叉的局部改良。两招轮着来：
 *   1. 互换两个顶点的位置
 *   2. 把某个顶点挪到它所有邻居的重心（Tutte 嵌入的做法——
 *      K4 这类图力导向总把四个点摊成一圈从而交叉，
 *      把其中一个收进三角形内部就解决了）
 * 只有交叉数不增加才接受。
 */
function repairCrossings(
  graph: GraphSpec,
  pos: Record<RegionId, Pt>,
  rng: Rng,
  startCross: number,
): number {
  if (startCross === 0) return 0
  const ids = graph.regions
  let cross = startCross

  for (let round = 0; round < 400 && cross > 0; round++) {
    const v = rng.pick(ids)

    if (round % 2 === 0) {
      const u = rng.pick(ids)
      if (u === v) continue
      const tmp = pos[v]
      pos[v] = pos[u]
      pos[u] = tmp
      const next = countCrossings(graph, pos)
      if (next <= cross) cross = next
      else {
        pos[u] = pos[v]
        pos[v] = tmp
      }
      continue
    }

    const nbs = graph.edges
      .filter(([a, b]) => a === v || b === v)
      .map(([a, b]) => (a === v ? b : a))
    if (nbs.length < 2) continue
    const saved = pos[v]
    // 收缩到重心，再往外拉一点点，免得和邻居重叠
    const cx = nbs.reduce((s, id) => s + pos[id].x, 0) / nbs.length
    const cy = nbs.reduce((s, id) => s + pos[id].y, 0) / nbs.length
    const t = rng.range(0.75, 1)
    pos[v] = { x: saved.x + (cx - saved.x) * t, y: saved.y + (cy - saved.y) * t }
    const next = countCrossings(graph, pos)
    if (next <= cross) cross = next
    else pos[v] = saved
  }

  return cross
}
