import type { GraphSpec, Pt, RegionId } from './types'
import { neighborsOf } from './graph'
import { buildEmbedding, countCrossings, dartKey, minVertexGap } from './planar'
import { makePerimeter } from './construct'

/**
 * Tutte 重心嵌入。
 *
 * 把外面的顶点钉在一个凸多边形上，然后反复把每个内部顶点挪到它邻居的重心。
 * Tutte 定理（1963）说：对 3-连通平面图，这个不动点唯一存在，画出来
 * 保证无交叉，而且每个面都是凸的。
 *
 * 为什么非用它不可：重心细分构造出的区域，面积正比于它周围那些面的面积。
 * 布局里只要有又扁又窄的面，成图里就会出现被挤成一条线的区域。
 * Tutte 嵌入把面摊得均匀，区域大小也就跟着均匀了。
 *
 * 非 3-连通的图（有割点、桥）会退化——挂在割点外侧的那一坨会缩成一个点。
 * 所以跑完要检查顶点间距和交叉数，退化了就不用这一版。
 */

export interface TutteResult {
  pos: Record<RegionId, Pt>
  crossings: number
  /** 最小顶点间距相对画布短边的比例，太小说明塌了 */
  spread: number
  /** 被钉在框上的顶点（外面上的那些），按沿框的环形次序排列 */
  pinnedOrder: RegionId[]
  /** 它们各自在框上的周长参数 */
  pinnedParam: Map<RegionId, number>
  /** 用到的那圈框 */
  frame: Pt[]
}

export function tutteEmbed(
  graph: GraphSpec,
  seedPos: Record<RegionId, Pt>,
  frame: Pt[],
  iterations = 600,
): TutteResult | null {
  if (graph.regions.length < 3 || !graph.edges.length) return null

  const emb = buildEmbedding(graph, seedPos)
  if (emb.outerIndex < 0) return null
  const outer = emb.faces[emb.outerIndex]

  // 外面环游上的顶点，按次序；割点会出现多次，取各次位置的平均
  const slots = new Map<RegionId, number[]>()
  outer.darts.forEach((d, i) => {
    const list = slots.get(d.from) ?? []
    list.push(i)
    slots.set(d.from, list)
  })
  if (slots.size < 3) return null

  const perim = makePerimeter(frame)
  const pinned = new Map<RegionId, Pt>()
  const param = new Map<RegionId, number>()
  const m = outer.darts.length
  for (const [v, indices] of slots) {
    // 环形平均：先解开再取均值，免得跨越 0 点时算错
    const base = indices[0]
    const mean =
      base +
      indices.reduce((sum, i) => sum + (((i - base) % m) + m) % m, 0) / indices.length
    param.set(v, mean / m)
    pinned.set(v, perim.at(mean / m))
  }
  const pinnedOrder = [...param.keys()].sort((a, b) => param.get(a)! - param.get(b)!)

  const pos: Record<RegionId, Pt> = {}
  for (const v of graph.regions) {
    pos[v] = pinned.get(v) ? { ...pinned.get(v)! } : { ...seedPos[v] }
  }

  const interior = graph.regions.filter((v) => !pinned.has(v))
  const nbsOf = new Map<RegionId, RegionId[]>()
  for (const v of interior) nbsOf.set(v, neighborsOf(graph, v))

  // Gauss–Seidel 迭代：就地更新收敛得比 Jacobi 快
  for (let step = 0; step < iterations; step++) {
    let maxShift = 0
    for (const v of interior) {
      const nbs = nbsOf.get(v)!
      if (!nbs.length) continue
      let sx = 0
      let sy = 0
      for (const w of nbs) {
        sx += pos[w].x
        sy += pos[w].y
      }
      const nx = sx / nbs.length
      const ny = sy / nbs.length
      maxShift = Math.max(maxShift, Math.abs(nx - pos[v].x), Math.abs(ny - pos[v].y))
      pos[v] = { x: nx, y: ny }
    }
    if (maxShift < 1e-4) break
  }

  const bbox = frame.reduce(
    (acc, p) => ({
      minX: Math.min(acc.minX, p.x),
      maxX: Math.max(acc.maxX, p.x),
      minY: Math.min(acc.minY, p.y),
      maxY: Math.max(acc.maxY, p.y),
    }),
    { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity },
  )
  const shortSide = Math.min(bbox.maxX - bbox.minX, bbox.maxY - bbox.minY)

  return {
    pos,
    crossings: countCrossings(graph, pos),
    spread: shortSide > 0 ? minVertexGap(graph, pos) / shortSide : 0,
    pinnedOrder,
    pinnedParam: param,
    frame,
  }
}

/**
 * 区域(v) 在重心细分下的实际多边形：绕着 v 交替经过「边中点」和「面中心」。
 * 外面没有有限的中心点，遇到就返回 null（那种顶点还额外占着外环，不需要照顾）。
 */
function starArea(
  pos: Record<RegionId, Pt>,
  v: RegionId,
  emb: ReturnType<typeof buildEmbedding>,
): number | null {
  const nbs = emb.rotation.get(v) ?? []
  if (nbs.length < 2) return null

  const poly: Pt[] = []
  for (let i = 0; i < nbs.length; i++) {
    const u = nbs[i]
    const next = nbs[(i + 1) % nbs.length]
    poly.push({ x: (pos[v].x + pos[u].x) / 2, y: (pos[v].y + pos[u].y) / 2 })

    const idx = emb.faceOfDart.get(dartKey(v, next))
    if (idx === undefined || idx === emb.outerIndex) return null
    const face = emb.faces[idx]
    poly.push(
      face.darts.reduce(
        (acc, d) => ({
          x: acc.x + pos[d.from].x / face.darts.length,
          y: acc.y + pos[d.from].y / face.darts.length,
        }),
        { x: 0, y: 0 },
      ),
    )
  }

  let area = 0
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    area += a.x * b.y - b.x * a.y
  }
  return Math.abs(area) / 2
}

/**
 * 面积均衡。
 *
 * Tutte 嵌入保证了面是凸的，但没保证大小均匀：度数低又埋在里面的顶点，
 * 边长会很短，重心细分出来的区域就成了一条细透镜。这里直接盯着
 * 「区域实际面积」做梯度下降——面积偏小的顶点，把它的邻居往外推一点。
 *
 * 每一步都重新数交叉，一旦破坏了平面性就整步回退，所以永远不会把
 * 已经正确的地图改坏。不用随机数，结果是确定的。
 */
export interface BalanceInput {
  pos: Record<RegionId, Pt>
  pinnedOrder: RegionId[]
  pinnedParam: Map<RegionId, number>
  frame: Pt[]
}

/**
 * 面积均衡。
 *
 * Tutte 嵌入保证了面是凸的，但没保证大小均匀：度数低又埋在里面的顶点，
 * 边长会很短，重心细分出来的区域就成了一条细透镜。这里直接盯着
 * 「区域实际面积」做梯度下降——面积偏小的顶点，把它的邻居往外推一点。
 *
 * 钉在框上的顶点也要参与，但只允许**沿着框滑动**（保持环形次序、彼此留出间隔）。
 * 不让它们动的话，被挤扁的区域四周往往全是钉死的顶点，根本推不开。
 *
 * 每一步都重新数交叉；一步迈太大会把边推得互相穿过，那就把步长减半重试。
 * 全程不用随机数，同一张图每次得到同一个结果。
 */
export function balanceAreas(graph: GraphSpec, input: BalanceInput, rounds = 240): Record<RegionId, Pt> {
  const perim = makePerimeter(input.frame)
  const order = input.pinnedOrder
  const isPinned = new Set(order)
  let current = input.pos
  let params = new Map(input.pinnedParam)

  /**
   * 把滑动后的参数夹回合法范围：保持环形次序，两两至少隔开 minGap。
   *
   * 关键是**以本轮之前的参数为基准做局部夹紧**，而不是顺着数组一路推挤。
   * 后者不管步长多小都可能让某个点跳出去一大截，于是每一步都撞上交叉，
   * 均衡还没开始就停了。
   */
  const clampOrder = (
    prevParams: Map<RegionId, number>,
    raw: Map<RegionId, number>,
  ): Map<RegionId, number> => {
    const n = order.length
    if (n < 3) return raw
    // 只防止越序，不强加间距。强加间距会把初始就挨得很近的两点猛地拽开，
    // 那一下必然撞交叉，于是每个步长都被否掉，均衡还没开始就停了。
    const minGap = 1e-4
    const out = new Map(raw)
    for (let i = 0; i < n; i++) {
      const v = order[i]
      const before = prevParams.get(order[(i - 1 + n) % n])!
      const after = prevParams.get(order[(i + 1) % n])!
      const self = prevParams.get(v)!

      // 相对于前一个点解开环形，比较才有意义
      const rel = (t: number) => (((t - before) % 1) + 1) % 1
      const lo = minGap
      const hi = rel(after) - minGap
      if (hi <= lo) {
        out.set(v, self)
        continue
      }
      out.set(v, before + Math.min(Math.max(rel(out.get(v)!), lo), hi))
    }
    return out
  }

  for (let round = 0; round < rounds; round++) {
    const emb = buildEmbedding(graph, current)
    const areas = new Map<RegionId, number>()
    for (const v of graph.regions) {
      const a = starArea(current, v, emb)
      if (a !== null && a > 0) areas.set(v, a)
    }
    if (areas.size < 2) return current

    const sorted = [...areas.values()].sort((x, y) => x - y)
    const median = sorted[Math.floor(sorted.length / 2)]
    // 已经够匀了就收工
    if (sorted[0] / median > 0.5) return current

    // 面积偏小的顶点，把它的邻居沿着连线往外推
    const push: Record<RegionId, Pt> = {}
    for (const v of graph.regions) push[v] = { x: 0, y: 0 }
    for (const [v, area] of areas) {
      const want = Math.sqrt(median / area)
      if (want <= 1.02) continue
      const gain = Math.min(want - 1, 1.5)
      for (const u of emb.rotation.get(v) ?? []) {
        push[u].x += (current[u].x - current[v].x) * gain
        push[u].y += (current[u].y - current[v].y) * gain
      }
    }

    let applied: { pos: Record<RegionId, Pt>; params: Map<RegionId, number> } | null = null
    for (let step = 0.14; step > 0.003; step /= 2) {
      const nextParams = new Map(params)
      for (const v of order) {
        // 只取推力沿框切向的那一部分，顶点才不会脱离外框
        const t = params.get(v)!
        const eps = 1e-3
        const a = perim.at(t - eps)
        const b = perim.at(t + eps)
        const tx = b.x - a.x
        const ty = b.y - a.y
        const len = Math.hypot(tx, ty)
        if (len < 1e-9) continue
        const along = (push[v].x * tx + push[v].y * ty) / len
        nextParams.set(v, t + (along * step) / (len / (2 * eps)))
      }
      const settled = clampOrder(params, nextParams)

      const next: Record<RegionId, Pt> = {}
      for (const v of graph.regions) {
        next[v] = isPinned.has(v)
          ? perim.at(settled.get(v)!)
          : { x: current[v].x + push[v].x * step, y: current[v].y + push[v].y * step }
      }
      if (countCrossings(graph, next) === 0) {
        applied = { pos: next, params: settled }
        break
      }
    }

    if (!applied) return current
    current = applied.pos
    params = applied.params
  }

  return current
}
