import type { Pt } from './types'
import type { Raster } from './grow'

/**
 * 栅格标号图 → 平面弧段拓扑。
 *
 * 在格点（cell 的角点）构成的格线上，凡是分隔了两个不同归属的格子的那一小段，
 * 就是一条「边界基元」。把它们串起来：
 *   度数 ≠ 2 的格点 = 交汇点（node）
 *   两个交汇点之间的链 = 一段弧（arc）
 * 一段弧两侧的区域在全程保持不变，所以它可以被两侧区域共享。
 */

export interface RawArc {
  id: string
  n0: number
  n1: number
  pts: Pt[]
  /** 区域下标，-1 表示海/图外 */
  left: number
  right: number
}

export interface RawLoop {
  arcs: { arc: string; rev: boolean }[]
}

export interface TraceResult {
  nodes: Map<number, Pt>
  arcs: RawArc[]
  /** 区域下标 → 若干条闭合环 */
  loops: Map<number, RawLoop[]>
  labelPos: Map<number, Pt>
}

/**
 * 消除「棋盘格点」：两个同归属格子只在对角相碰。
 * 这种点在拓扑上是歧义的（说不清两块是连着还是断开），
 * 会让区域的边界在同一格点上出现 4 条边而无法唯一串成环。
 * 处理办法是把其中一格退还给海——只做腐蚀，绝不会凭空造出新的邻接。
 */
export function depinch(raster: Raster) {
  const { W, H, owner } = raster
  for (let pass = 0; pass < 4; pass++) {
    let changed = false
    for (let y = 0; y + 1 < H; y++) {
      for (let x = 0; x + 1 < W; x++) {
        const a = owner[y * W + x]
        const b = owner[y * W + x + 1]
        const c = owner[(y + 1) * W + x]
        const d = owner[(y + 1) * W + x + 1]
        if (a === d && b === c && a !== b) {
          // 优先腐蚀掉「不是海」的那一对里的一格
          if (b >= 0) owner[y * W + x + 1] = -1
          else if (a >= 0) owner[y * W + x] = -1
          else continue
          changed = true
        }
      }
    }
    if (!changed) break
  }
}

export function traceRaster(raster: Raster): TraceResult {
  const { W, H, cell, owner } = raster
  const LW = W + 1
  const LH = H + 1
  const NP = LW * LH

  /** 格子归属；越界或被封锁都算海（-1） */
  const cellAt = (cx: number, cy: number): number => {
    if (cx < 0 || cy < 0 || cx >= W || cy >= H) return -1
    const o = owner[cy * W + cx]
    return o < 0 ? -1 : o
  }

  // 边编号：0..NP-1 为水平边（格点 p → p+1），NP.. 为竖直边（格点 p → p+LW）
  const isH = (e: number) => e < NP
  const canon = (e: number) => (isH(e) ? e : e - NP)
  const ends = (e: number): [number, number] => {
    const p = canon(e)
    return isH(e) ? [p, p + 1] : [p, p + LW]
  }

  const inc: number[][] = Array.from({ length: NP }, () => [])
  const addEdge = (e: number) => {
    const [p, q] = ends(e)
    inc[p].push(e)
    inc[q].push(e)
  }

  for (let y = 0; y < LH; y++) {
    for (let x = 0; x < LW; x++) {
      const p = y * LW + x
      // 水平边：分隔上方 (x, y-1) 与下方 (x, y)
      if (x < W && cellAt(x, y - 1) !== cellAt(x, y)) addEdge(p)
      // 竖直边：分隔左侧 (x-1, y) 与右侧 (x, y)
      if (y < H && cellAt(x - 1, y) !== cellAt(x, y)) addEdge(NP + p)
    }
  }

  /** 沿边 e 从格点 `from` 走向另一端时，左右两侧分别是谁 */
  const sidesWalking = (e: number, from: number): { left: number; right: number } => {
    const p = canon(e)
    const x = p % LW
    const y = (p - x) / LW
    if (isH(e)) {
      const above = cellAt(x, y - 1)
      const below = cellAt(x, y)
      return from === p ? { left: above, right: below } : { left: below, right: above }
    }
    const west = cellAt(x - 1, y)
    const east = cellAt(x, y)
    return from === p ? { left: east, right: west } : { left: west, right: east }
  }

  const toPt = (p: number): Pt => {
    const x = p % LW
    return { x: x * cell, y: ((p - x) / LW) * cell }
  }

  // ── 串弧段 ──
  const visited = new Set<number>()
  const arcs: RawArc[] = []
  const nodes = new Map<number, Pt>()
  /** 边 → 它属于哪条弧、以及该弧经过这条边时是从哪个格点出发的 */
  const edgeArc = new Map<number, { arc: string; from: number }>()

  const isJunction = (p: number) => inc[p].length !== 2 && inc[p].length > 0

  const walk = (start: number, firstEdge: number, stopAtStart: boolean): RawArc => {
    const id = `a${arcs.length}`
    const pts: number[] = [start]
    let cur = start
    let e = firstEdge
    const { left, right } = sidesWalking(e, start)

    for (;;) {
      visited.add(e)
      edgeArc.set(e, { arc: id, from: cur })
      const [p, q] = ends(e)
      const next = p === cur ? q : p
      pts.push(next)
      cur = next
      if (stopAtStart && cur === start) break
      if (isJunction(cur)) break
      const cont = inc[cur].find((other) => other !== e)
      if (cont === undefined || visited.has(cont)) break
      e = cont
    }

    const arc: RawArc = {
      id,
      n0: pts[0],
      n1: pts[pts.length - 1],
      pts: pts.map(toPt),
      left,
      right,
    }
    arcs.push(arc)
    nodes.set(arc.n0, toPt(arc.n0))
    nodes.set(arc.n1, toPt(arc.n1))
    return arc
  }

  for (let p = 0; p < NP; p++) {
    if (!isJunction(p)) continue
    for (const e of inc[p]) {
      if (visited.has(e)) continue
      walk(p, e, false)
    }
  }

  // 剩下的是没有交汇点的纯闭环（比如完全被包住的孤岛），随便取一点当节点
  for (let e = 0; e < 2 * NP; e++) {
    if (!inc[canon(e)].includes(e) || visited.has(e)) continue
    walk(ends(e)[0], e, true)
  }

  // ── 每个区域的边界环 ──
  const regionCount = raster.ids.length
  const loops = new Map<number, RawLoop[]>()

  for (let r = 0; r < regionCount; r++) {
    // 只保留与 r 相关的边，重建局部关联表
    const localInc = new Map<number, number[]>()
    const own = new Set<number>()
    for (let e = 0; e < 2 * NP; e++) {
      const p = canon(e)
      if (!inc[p].includes(e)) continue
      const { left, right } = sidesWalking(e, ends(e)[0])
      if (left !== r && right !== r) continue
      own.add(e)
      for (const end of ends(e)) {
        const list = localInc.get(end) ?? []
        list.push(e)
        localInc.set(end, list)
      }
    }
    if (!own.size) continue

    const used = new Set<number>()
    const result: RawLoop[] = []

    for (const seedEdge of own) {
      if (used.has(seedEdge)) continue

      // 走一圈，收集有序的边序列
      const seq: { edge: number; from: number }[] = []
      let e = seedEdge
      let cur = ends(seedEdge)[0]
      const startPt = cur
      for (;;) {
        used.add(e)
        seq.push({ edge: e, from: cur })
        const [p, q] = ends(e)
        cur = p === cur ? q : p
        if (cur === startPt) break
        const nextEdge = (localInc.get(cur) ?? []).find((o) => o !== e && !used.has(o))
        if (nextEdge === undefined) break
        e = nextEdge
      }

      // 压缩成弧段序列
      const items: { arc: string; rev: boolean }[] = []
      for (const { edge, from } of seq) {
        const info = edgeArc.get(edge)
        if (!info) continue
        const rev = info.from !== from
        const last = items[items.length - 1]
        if (last && last.arc === info.arc) continue
        items.push({ arc: info.arc, rev })
      }
      // 首尾可能是同一条弧被绕回来了
      if (items.length > 1 && items[0].arc === items[items.length - 1].arc) items.pop()
      if (items.length) result.push({ arcs: items })
    }

    if (result.length) loops.set(r, result)
  }

  return { nodes, arcs, loops, labelPos: computeLabelPositions(raster) }
}

/**
 * 标签锚点：区域内「离边界最远」的那一格。
 * 用一次多源 BFS 算出所有格子到异归属格子的距离，再各区域取最大值。
 */
function computeLabelPositions(raster: Raster): Map<number, Pt> {
  const { W, H, cell, owner } = raster
  const dist = new Int32Array(W * H).fill(-1)
  const queue = new Int32Array(W * H)
  let head = 0
  let tail = 0

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x
      const o = owner[i]
      if (o < 0) continue
      let onEdge = false
      for (let dy = -1; dy <= 1 && !onEdge; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= W || ny >= H || owner[ny * W + nx] !== o) {
            onEdge = true
            break
          }
        }
      }
      if (onEdge) {
        dist[i] = 0
        queue[tail++] = i
      }
    }
  }

  while (head < tail) {
    const i = queue[head++]
    const x = i % W
    const y = (i - x) / W
    const o = owner[i]
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx
      const ny = y + dy
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
      const j = ny * W + nx
      if (owner[j] !== o || dist[j] >= 0) continue
      dist[j] = dist[i] + 1
      queue[tail++] = j
    }
  }

  const best = new Map<number, { d: number; i: number }>()
  for (let i = 0; i < owner.length; i++) {
    const o = owner[i]
    if (o < 0) continue
    const cur = best.get(o)
    if (!cur || dist[i] > cur.d) best.set(o, { d: dist[i], i })
  }

  const out = new Map<number, Pt>()
  for (const [o, { i }] of best) {
    const x = i % W
    out.set(o, { x: (x + 0.5) * cell, y: ((i - x) / W + 0.5) * cell })
  }
  return out
}
