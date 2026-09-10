/**
 * 整形：在**不动拓扑**的前提下把形状变好看。
 *
 * 这是涂色式表示相对解析构造的关键好处。做法是在网格上跑局部搜索：
 * 每次只把一个边界格子换个归属，换之前检查三条硬约束——
 *
 *   1. 邻接关系一格不差地保持原样（既不许多出来，也不许丢掉）；
 *   2. 失去这一格的那块不能被切断，也不能低于最小面积；
 *   3. 必须保留的公共边界不能短到最小接触长度以下。
 *
 * 三条都是**局部**的：邻接靠一张接触计数表增量维护，连通性靠六邻居的
 * 段数判据（见 paint.ts），所以单步是 O(1)，可以放心跑成千上万步。
 *
 * 因为每一步都验过，这个循环**不可能**把地图改错。于是"好看"就能放心地
 * 当成能量去优化，而不必再当成约束去构造——解析构造里缺的正是这个自由度：
 * 那边的权重只能沿固定线段挪分割点，动不了长宽比，也拉不直尖角。
 *
 * 能量由两项组成：
 *
 *   - **紧凑度** `周长² / 面积`，归一到"圆块 ≈ 1"。尖角要用很多周长换很少面积，
 *     所以这一项专治尖刺和细条。
 *   - **面积均衡** `(面积/目标 - 1)²`，专治"有一块小得看不见"。
 */

import { makeRng, type Rng } from './rng'
import { DIRS } from './mesh'
import {
  areasOf,
  contactsOf,
  labelOfNeighbor,
  pairKey,
  perimetersOf,
  removalKeepsConnected,
  type Painting,
} from './paint'

/**
 * 圆块的 `周长²/面积` 极限值。
 * n 环的六边形块有 3n²+3n+1 格、6(2n+1) 条外边，比值 n→∞ 时趋于 48。
 * 拿它归一之后，紧凑度读数 1 就是"和圆块一样好"，2 就是"周长长了四成"。
 */
const IDEAL_ISO = 48

export interface RelaxOptions {
  /** 紧凑度权重：越大越圆、越不容易出尖角 */
  compact: number
  /** 面积均衡权重：越大各块越接近一样大 */
  areaEven: number
  /** 每块最少格数，低于它就不许再被削 */
  minArea: number
  /** 必须保留的邻接，公共边界至少要有这么多格边 */
  minContact: number
  seed: number
}

export const DEFAULT_RELAX: RelaxOptions = {
  compact: 1,
  areaEven: 0.6,
  minArea: 6,
  minContact: 2,
  seed: 20240910,
}

export interface RelaxState {
  painting: Painting
  opts: RelaxOptions
  areas: Int32Array
  perims: Int32Array
  contacts: Map<number, number>
  /** 开工时的邻接关系。整形的全部意义就是保住它 */
  required: Set<number>
  targetArea: number
  rng: Rng
  round: number
  /** 上一轮真正挪动了几格。0 表示已经收敛 */
  moved: number
}

export function createRelax(painting: Painting, opts: RelaxOptions = DEFAULT_RELAX): RelaxState {
  const areas = areasOf(painting)
  const perims = perimetersOf(painting)
  const contacts = contactsOf(painting)
  const live = [...areas].filter((a) => a > 0)
  return {
    painting,
    opts,
    areas,
    perims,
    contacts,
    required: new Set(contacts.keys()),
    targetArea: live.length ? live.reduce((a, b) => a + b, 0) / live.length : 0,
    rng: makeRng(opts.seed),
    round: 0,
    moved: 0,
  }
}

/** 单块的形状代价。空块记 0，免得刚建好还没涂的块把总能量顶到无穷 */
function cost(area: number, perim: number, target: number, opts: RelaxOptions): number {
  if (area <= 0) return 0
  const compact = (perim * perim) / (area * IDEAL_ISO)
  const even = target > 0 ? (area / target - 1) ** 2 : 0
  return opts.compact * compact + opts.areaEven * even
}

/** 当前总能量，供界面显示收敛情况 */
export function energyOf(st: RelaxState): number {
  let sum = 0
  for (let k = 0; k < st.areas.length; k++) {
    sum += cost(st.areas[k], st.perims[k], st.targetArea, st.opts)
  }
  return sum
}

/** 六个方向上邻居的块号，出界记作海 */
function neighborLabels(p: Painting, cell: number, out: Int32Array): void {
  for (let d = 0; d < DIRS; d++) out[d] = labelOfNeighbor(p, cell, d)
}

interface Move {
  /** 能量变化，负数才值得做 */
  delta: number
  /** 接触计数的增量，键是 pairKey */
  contacts: Map<number, number>
}

/**
 * 试算把 cell 从现在这块换给 to，返回可行的动作；不可行返回 null。
 * 三条硬约束都在这里挡住，所以调用方拿到非 null 就可以无条件应用。
 */
function evaluate(st: RelaxState, cell: number, to: number, nb: Int32Array): Move | null {
  const p = st.painting
  const from = p.labels[cell]
  if (from === to) return null
  if (!p.mesh.paintable[cell]) return null

  // ── 约束 2：失去这一格的那块不能断，也不能被削过头 ──
  if (!removalKeepsConnected(p, cell)) return null
  if (from >= 0 && st.areas[from] - 1 < Math.max(1, st.opts.minArea)) return null

  neighborLabels(p, cell, nb)
  let sameFrom = 0
  let sameTo = 0
  for (let d = 0; d < DIRS; d++) {
    if (nb[d] === from) sameFrom++
    else if (nb[d] === to) sameTo++
  }
  // 接手的那块必须已经贴着这一格，否则它会多出一个飞地
  if (sameTo === 0) return null

  // ── 约束 1 与 3：邻接关系与公共边界长度 ──
  const delta = new Map<number, number>()
  const bump = (a: number, b: number, by: number) => {
    const key = pairKey(a, b)
    delta.set(key, (delta.get(key) ?? 0) + by)
  }
  for (let d = 0; d < DIRS; d++) {
    const x = nb[d]
    if (x < 0) continue
    if (from >= 0 && x !== from) bump(from, x, -1)
    if (to >= 0 && x !== to) bump(to, x, 1)
  }
  for (const [key, by] of delta) {
    if (by === 0) continue
    const before = st.contacts.get(key) ?? 0
    const after = before + by
    const need = st.required.has(key)
    if (after > 0 && !need) return null // 冒出了图里没有的邻接
    if (after === 0 && need) return null // 弄丢了必须保留的邻接
    if (need && after < st.opts.minContact && after < before) return null // 把本就短的边界越削越短
  }

  // ── 能量 ──
  let dE = 0
  if (from >= 0) {
    const a0 = st.areas[from]
    const p0 = st.perims[from]
    dE += cost(a0 - 1, p0 + sameFrom - (DIRS - sameFrom), st.targetArea, st.opts)
    dE -= cost(a0, p0, st.targetArea, st.opts)
  }
  if (to >= 0) {
    const a0 = st.areas[to]
    const p0 = st.perims[to]
    dE += cost(a0 + 1, p0 + (DIRS - sameTo) - sameTo, st.targetArea, st.opts)
    dE -= cost(a0, p0, st.targetArea, st.opts)
  }

  return { delta: dE, contacts: delta }
}

function apply(st: RelaxState, cell: number, to: number, move: Move, nb: Int32Array): void {
  const p = st.painting
  const from = p.labels[cell]
  neighborLabels(p, cell, nb)
  let sameFrom = 0
  let sameTo = 0
  for (let d = 0; d < DIRS; d++) {
    if (nb[d] === from) sameFrom++
    else if (nb[d] === to) sameTo++
  }

  if (from >= 0) {
    st.areas[from]--
    st.perims[from] += sameFrom - (DIRS - sameFrom)
  }
  if (to >= 0) {
    st.areas[to]++
    st.perims[to] += DIRS - sameTo - sameTo
  }
  for (const [key, by] of move.contacts) {
    const after = (st.contacts.get(key) ?? 0) + by
    if (after > 0) st.contacts.set(key, after)
    else st.contacts.delete(key)
  }
  p.labels[cell] = to
}

/** 当前所有可涂、且贴着异色的格子 */
function boundaryCells(p: Painting): number[] {
  const out: number[] = []
  for (let i = 0; i < p.mesh.count; i++) {
    if (!p.mesh.paintable[i]) continue
    const k = p.labels[i]
    for (let d = 0; d < DIRS; d++) {
      if (labelOfNeighbor(p, i, d) !== k) {
        out.push(i)
        break
      }
    }
  }
  return out
}

/**
 * 跑一轮：把所有边界格子按随机顺序过一遍，每格取能量降得最多的那个归属。
 * 返回这一轮挪动了几格；返回 0 表示收敛，再跑也没用。
 */
export function relaxRound(st: RelaxState): number {
  const cells = boundaryCells(st.painting)
  // Fisher–Yates。固定顺序会让边界一侧总是先动，磨出方向性的毛刺
  for (let i = cells.length - 1; i > 0; i--) {
    const j = st.rng.int(i + 1)
    ;[cells[i], cells[j]] = [cells[j], cells[i]]
  }

  const nb = new Int32Array(DIRS)
  const scratch = new Int32Array(DIRS)
  const seen = new Set<number>()
  let moved = 0

  for (const cell of cells) {
    const from = st.painting.labels[cell]
    neighborLabels(st.painting, cell, scratch)
    seen.clear()

    let best: Move | null = null
    let bestTo = from
    for (let d = 0; d < DIRS; d++) {
      const to = scratch[d]
      if (to === from || seen.has(to)) continue
      seen.add(to)
      const move = evaluate(st, cell, to, nb)
      if (move && move.delta < -1e-9 && (!best || move.delta < best.delta)) {
        best = move
        bestTo = to
      }
    }
    if (best) {
      apply(st, cell, bestTo, best, nb)
      moved++
    }
  }

  st.round++
  st.moved = moved
  return moved
}

/** 连跑若干轮，收敛就提前停。返回实际跑了几轮 */
export function relaxRounds(st: RelaxState, rounds: number): number {
  for (let r = 0; r < rounds; r++) {
    if (relaxRound(st) === 0) return r + 1
  }
  return rounds
}

/** 每块的紧凑度读数：1 ≈ 圆块，越大越尖越细 */
export function compactnessOf(st: RelaxState): number[] {
  return [...st.areas].map((a, k) => (a > 0 ? (st.perims[k] * st.perims[k]) / (a * IDEAL_ISO) : 0))
}
