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
