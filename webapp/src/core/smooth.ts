import type { Pt } from './types'
import type { Rng } from './rng'

function dist(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/** 点到线段的垂距 */
function perpDistance(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy)
  if (len < 1e-9) return dist(p, a)
  return Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / len
}

/** Douglas–Peucker 折线简化。两端点必定保留，所以共享边界不会被拆散 */
export function rdp(pts: Pt[], epsilon: number): Pt[] {
  if (pts.length <= 2) return [...pts]
  let maxDist = 0
  let index = 0
  for (let i = 1; i < pts.length - 1; i++) {
    const d = perpDistance(pts[i], pts[0], pts[pts.length - 1])
    if (d > maxDist) {
      maxDist = d
      index = i
    }
  }
  if (maxDist <= epsilon) return [pts[0], pts[pts.length - 1]]
  const left = rdp(pts.slice(0, index + 1), epsilon)
  const right = rdp(pts.slice(index), epsilon)
  return [...left.slice(0, -1), ...right]
}

/** 按弧长等距重采样，得到便于加抖动、也便于手工拖拽的控制点 */
export function resample(pts: Pt[], spacing: number): Pt[] {
  if (pts.length < 2) return [...pts]
  const total = pts.reduce((sum, p, i) => (i ? sum + dist(pts[i - 1], p) : 0), 0)
  if (total < 1e-6) return [pts[0], pts[pts.length - 1]]

  const count = Math.max(1, Math.round(total / spacing))
  const step = total / count
  const out: Pt[] = [pts[0]]
  let segIdx = 1
  let segStart = 0

  for (let k = 1; k < count; k++) {
    const target = k * step
    while (segIdx < pts.length - 1 && segStart + dist(pts[segIdx - 1], pts[segIdx]) < target) {
      segStart += dist(pts[segIdx - 1], pts[segIdx])
      segIdx++
    }
    const a = pts[segIdx - 1]
    const b = pts[segIdx]
    const segLen = Math.max(dist(a, b), 1e-9)
    const t = Math.min(1, Math.max(0, (target - segStart) / segLen))
    out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
  }
  out.push(pts[pts.length - 1])
  return out
}

/**
 * 沿法向加低频抖动，营造手绘感。
 * 幅度在两端衰减到 0——交汇点是多条弧共用的，不能各自跑偏。
 */
export function jitter(pts: Pt[], amplitude: number, rng: Rng): Pt[] {
  if (pts.length < 3 || amplitude <= 0) return [...pts]

  // 两条不同频率的正弦叠加，比逐点随机更像手画出来的
  const phase1 = rng.range(0, Math.PI * 2)
  const phase2 = rng.range(0, Math.PI * 2)
  const freq1 = rng.range(1.2, 2.6)
  const freq2 = rng.range(3.1, 5.4)
  const mix = rng.range(0.25, 0.5)

  return pts.map((p, i) => {
    if (i === 0 || i === pts.length - 1) return { ...p }
    const t = i / (pts.length - 1)
    // 端点处衰减
    const taper = Math.sin(Math.PI * t) ** 0.75
    const offset =
      amplitude * taper * (Math.sin(freq1 * Math.PI * t + phase1) + mix * Math.sin(freq2 * Math.PI * t + phase2))

    const prev = pts[i - 1]
    const next = pts[i + 1]
    const dx = next.x - prev.x
    const dy = next.y - prev.y
    const len = Math.max(Math.hypot(dx, dy), 1e-9)
    return { x: p.x + (-dy / len) * offset, y: p.y + (dx / len) * offset }
  })
}

/**
 * Chaikin 磨角：每条线段取 1/4 和 3/4 两点，替换掉原来的折点。
 *
 * 用它把六边形网格描出来的那条 60 度锯齿变成柔和的曲线。
 * 之所以不用样条直接插值：Chaikin 的结果**始终落在原折线的凸包内**，
 * 不会像样条那样在急转弯处甩出去，两块共享的边界也就不会互相穿插。
 *
 * 端点保持不动——那是三块碰头的交汇点，几条弧必须在同一个点上接住。
 * 交汇处因此保留一个折角，这正是真实地图上三国交界的样子。
 */
export function chaikinOpen(pts: Pt[], rounds: number): Pt[] {
  let cur = pts
  for (let r = 0; r < rounds && cur.length >= 3; r++) {
    const next: Pt[] = [cur[0]]
    for (let i = 0; i + 1 < cur.length; i++) {
      const a = cur[i]
      const b = cur[i + 1]
      next.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 })
      next.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 })
    }
    next.push(cur[cur.length - 1])
    cur = next
  }
  return cur
}

/** 闭合版 Chaikin。传入的点列不要重复首尾，返回的同样不重复 */
export function chaikinClosed(pts: Pt[], rounds: number): Pt[] {
  let cur = pts
  for (let r = 0; r < rounds && cur.length >= 3; r++) {
    const next: Pt[] = []
    for (let i = 0; i < cur.length; i++) {
      const a = cur[i]
      const b = cur[(i + 1) % cur.length]
      next.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 })
      next.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 })
    }
    cur = next
  }
  return cur
}

/** 一步拉普拉斯平滑：每点朝左右邻居的中点挪 factor 那么多 */
function laplacianStep(pts: Pt[], factor: number, closed: boolean): Pt[] {
  const n = pts.length
  const out = pts.map((p) => ({ ...p }))
  const from = closed ? 0 : 1
  const to = closed ? n : n - 1
  for (let i = from; i < to; i++) {
    const a = pts[(i - 1 + n) % n]
    const b = pts[(i + 1) % n]
    out[i] = {
      x: pts[i].x + factor * ((a.x + b.x) / 2 - pts[i].x),
      y: pts[i].y + factor * ((a.y + b.y) / 2 - pts[i].y),
    }
  }
  return out
}

/**
 * Taubin 平滑：一正一负两步交替。
 *
 * Chaikin 只压得住最高频那一档，压不掉低频的阶梯——外框圆角被网格量化出来的
 * 那种「走几格下一阶」的锯齿正是低频的，所以磨再多轮角也还在。
 * 反复做拉普拉斯平滑能压到更低的频段，但它同时会让曲线整体缩水，
 * 平滑得越狠区域缩得越小。Taubin 在每个正步后跟一个**略大的负步**，
 * 低频几乎原样弹回、高频留在被压下去的状态，于是形状不缩水。
 *
 * 端点不动：那是三块碰头的交汇点，几条弧必须在同一个点上接住。
 * 弧是全局只算一次的，所以两侧区域拿到的仍然是同一条曲线。
 */
export function taubin(pts: Pt[], passes: number, closed: boolean): Pt[] {
  const LAMBDA = 0.5
  const MU = -0.53
  let cur = pts
  for (let i = 0; i < passes && cur.length > 3; i++) {
    cur = laplacianStep(cur, LAMBDA, closed)
    cur = laplacianStep(cur, MU, closed)
  }
  return cur
}

/** 折线 → SVG path 片段（不含起始 M） */
export function polylineTo(pts: Pt[]): string {
  return pts.slice(1).map((p) => `L${round(p.x)} ${round(p.y)}`).join('')
}

/**
 * Catmull–Rom 转三次贝塞尔，得到光滑曲线。
 * `closed` 为真时首尾相接处也保持光滑。
 */
export function smoothTo(pts: Pt[], closed: boolean, tension = 1): string {
  const n = pts.length
  if (n < 3) return polylineTo(pts)

  const at = (i: number): Pt => {
    if (closed) return pts[((i % n) + n) % n]
    return pts[Math.max(0, Math.min(n - 1, i))]
  }

  const last = closed ? n : n - 1
  let d = ''
  for (let i = 0; i < last; i++) {
    const p0 = at(i - 1)
    const p1 = at(i)
    const p2 = at(i + 1)
    const p3 = at(i + 2)
    const c1 = { x: p1.x + ((p2.x - p0.x) / 6) * tension, y: p1.y + ((p2.y - p0.y) / 6) * tension }
    const c2 = { x: p2.x - ((p3.x - p1.x) / 6) * tension, y: p2.y - ((p3.y - p1.y) / 6) * tension }
    d += `C${round(c1.x)} ${round(c1.y)},${round(c2.x)} ${round(c2.y)},${round(p2.x)} ${round(p2.y)}`
  }
  return d
}

export function round(v: number): number {
  return Math.round(v * 100) / 100
}
