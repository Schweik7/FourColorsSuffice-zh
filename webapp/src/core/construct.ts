import type { ArcModel, GraphSpec, Loop, NodeModel, Pt, RegionId, RegionModel } from './types'
import { buildEmbedding, dartKey, type Embedding } from './planar'
import { edgeKey } from './graph'

/**
 * 由平面嵌入确定性地构造地图（重心细分）。
 *
 * 每个面取一个中心点 c_f，每条边取中点 m_e，则
 *
 *     区域(v) = 绕着 v 的一圈四边形 (v, m_前, c_f, m_后)
 *
 * 这些四边形把整张图铺满，不留空隙。两个区域的公共边界只可能是
 * c_f–m_e 这样的线段，而它出现当且仅当 e 是一条边——**邻接关系由构造保证**，
 * 不需要事后校验，也不会出现飞地或蜘蛛腿：区域(v) 是绕 v 的一圈，天然连通。
 *
 * 边界的最小单位（弧）是 c_f → m_e → c_f'，恰好一条边对应一条弧。
 * 外面没有有限的中心点，改为展开到外框上：外围环游里每个半边分到框上一点，
 * 相邻两点之间的框段就是那个顶点的对外边界——这就形成了参考图里
 * 「圆角矩形外框 + 径向切分」的样子。
 */

export interface ConstructResult {
  nodes: NodeModel[]
  arcs: ArcModel[]
  regions: RegionModel[]
}

/** 采样一个圆角矩形，corner 是圆角半径 */
export function roundedRectPath(
  cx: number,
  cy: number,
  halfW: number,
  halfH: number,
  corner: number,
  samplesPerCorner = 10,
): Pt[] {
  const r = Math.max(0, Math.min(corner, halfW, halfH))
  const pts: Pt[] = []
  const arc = (ax: number, ay: number, from: number, to: number) => {
    for (let i = 0; i <= samplesPerCorner; i++) {
      const t = from + ((to - from) * i) / samplesPerCorner
      pts.push({ x: ax + r * Math.cos(t), y: ay + r * Math.sin(t) })
    }
  }
  // 从右边中点开始，顺时针（y 向下）走一圈
  pts.push({ x: cx + halfW, y: cy - halfH + r })
  arc(cx + halfW - r, cy + halfH - r, -0, Math.PI / 2)
  pts.push({ x: cx + halfW - r, y: cy + halfH })
  arc(cx - halfW + r, cy + halfH - r, Math.PI / 2, Math.PI)
  pts.push({ x: cx - halfW, y: cy + halfH - r })
  arc(cx - halfW + r, cy - halfH + r, Math.PI, (3 * Math.PI) / 2)
  pts.push({ x: cx - halfW + r, y: cy - halfH })
  arc(cx + halfW - r, cy - halfH + r, (3 * Math.PI) / 2, 2 * Math.PI)
  return pts
}

/** 闭合折线上的等周长采样器：t∈[0,1) 绕一圈 */
export interface Perimeter {
  at(t: number): Pt
  center: Pt
  /** 朝 target 方向的那个周长参数 */
  paramTowards(target: Pt): number
}

export function makePerimeter(poly: Pt[]): Perimeter {
  const { cum, total } = arcLengths(poly)
  const center = poly.reduce(
    (acc, p) => ({ x: acc.x + p.x / poly.length, y: acc.y + p.y / poly.length }),
    { x: 0, y: 0 },
  )
  return {
    center,
    at: (t) => pointAtPerimeter(poly, cum, total, t),
    paramTowards: (target) => perimeterParamTowards(poly, cum, total, center, target),
  }
}

/** 闭合折线的总长度与累积长度表 */
function arcLengths(poly: Pt[]): { total: number; cum: number[] } {
  const cum = [0]
  for (let i = 1; i <= poly.length; i++) {
    const a = poly[i - 1]
    const b = poly[i % poly.length]
    cum.push(cum[i - 1] + Math.hypot(b.x - a.x, b.y - a.y))
  }
  return { total: cum[poly.length], cum }
}

/** 按周长参数 t∈[0,1) 取闭合折线上的点 */
function pointAtPerimeter(poly: Pt[], cum: number[], total: number, t: number): Pt {
  const target = ((t % 1) + 1) % 1 * total
  let lo = 0
  let hi = poly.length
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1
    if (cum[mid] <= target) lo = mid
    else hi = mid
  }
  const a = poly[lo]
  const b = poly[(lo + 1) % poly.length]
  const segLen = cum[lo + 1] - cum[lo]
  const f = segLen < 1e-9 ? 0 : (target - cum[lo]) / segLen
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }
}

/** 取闭合折线上离 p 的方向最近的周长参数（用射线方向而不是欧氏距离，切分才对得齐） */
function perimeterParamTowards(poly: Pt[], cum: number[], total: number, center: Pt, dir: Pt): number {
  const angle = Math.atan2(dir.y - center.y, dir.x - center.x)
  let bestT = 0
  let bestDiff = Infinity
  for (let i = 0; i < poly.length; i++) {
    const a = Math.atan2(poly[i].y - center.y, poly[i].x - center.x)
    let diff = Math.abs(a - angle)
    if (diff > Math.PI) diff = 2 * Math.PI - diff
    if (diff < bestDiff) {
      bestDiff = diff
      bestT = cum[i] / total
    }
  }
  return bestT
}

/**
 * 让一串环形参数严格递增且彼此至少隔开 minGap，同时尽量贴近各自的目标值。
 * 外框上的切分点必须保持外围环游的次序，否则区域会互相穿插。
 */
function spreadAroundCircle(targets: number[], minGap: number): number[] {
  const n = targets.length
  if (!n) return []
  if (n === 1) return [targets[0]]

  // 以第一个目标为基准解开环形，得到单调递增的一串
  const base = targets[0]
  const unwrapped = targets.map((t, i) => {
    let v = t - base
    v = ((v % 1) + 1) % 1
    return i === 0 ? 0 : v
  })
  for (let i = 1; i < n; i++) {
    while (unwrapped[i] < unwrapped[i - 1]) unwrapped[i] += 1
  }

  // 前向推开
  for (let i = 1; i < n; i++) {
    unwrapped[i] = Math.max(unwrapped[i], unwrapped[i - 1] + minGap)
  }
  // 首尾之间也要留出间隙；整体超过一圈就退化成均分
  const span = unwrapped[n - 1] - unwrapped[0]
  if (span > 1 - minGap) {
    for (let i = 0; i < n; i++) unwrapped[i] = unwrapped[0] + i / n
  }
  return unwrapped.map((v) => base + v)
}

/**
 * 单个连通分量 → 地图。
 * `pos` 必须是这个分量的无交叉直线画法。
 */
export function constructComponent(
  graph: GraphSpec,
  pos: Record<RegionId, Pt>,
  frame: Pt[],
  idPrefix: string,
  /**
   * 每个区域的「膨胀权重」，默认全 1。
   *
   * 重心细分只要求边中点落在边的内部、面心落在面的内部——这两个点具体放哪
   * 完全自由，挪动它们不会改变任何邻接关系。Tutte 嵌入保证了面是凸的，
   * 所以面心取顶点的任意凸组合都仍在面内。于是可以拿它来重新分配面积：
   * 权重大的区域，边上的分割点被推得离它更远、面心也被推开，地盘就变大。
   * 这比挪顶点安全得多，也有效得多——挪顶点要担心破坏平面性。
   */
  weights?: Map<RegionId, number>,
): ConstructResult {
  const w = (v: RegionId) => weights?.get(v) ?? 1

  /** 边 (a,b) 上的分割点：a 的权重越大，分割点越靠近 b */
  const splitPoint = (a: RegionId, b: RegionId): Pt => {
    const t = w(a) / (w(a) + w(b))
    return { x: pos[a].x + (pos[b].x - pos[a].x) * t, y: pos[a].y + (pos[b].y - pos[a].y) * t }
  }

  /** 面心：权重越大的顶点把面心推得离自己越远 */
  const faceCenter = (darts: { from: RegionId }[]): Pt => {
    let sx = 0
    let sy = 0
    let sw = 0
    for (const d of darts) {
      const k = 1 / w(d.from)
      sx += pos[d.from].x * k
      sy += pos[d.from].y * k
      sw += k
    }
    return { x: sx / sw, y: sy / sw }
  }
  const nodes: NodeModel[] = []
  const arcs: ArcModel[] = []
  const regions: RegionModel[] = []
  const nodeOf = new Map<string, string>()

  const addNode = (key: string, p: Pt): string => {
    const existing = nodeOf.get(key)
    if (existing) return existing
    const id = `${idPrefix}n${nodes.length}`
    nodes.push({ id, p })
    nodeOf.set(key, id)
    return id
  }

  const { cum, total } = arcLengths(frame)
  const frameCenter = frame.reduce(
    (acc, p, _i, all) => ({ x: acc.x + p.x / all.length, y: acc.y + p.y / all.length }),
    { x: 0, y: 0 },
  )

  // ── 没有边的退化情形：整块外框就是这个区域 ──
  if (!graph.edges.length) {
    const only = graph.regions[0]
    if (!only) return { nodes, arcs, regions }
    const n0 = addNode('frame0', frame[0])
    const arcId = `${idPrefix}a0`
    arcs.push({ id: arcId, n0, n1: n0, mid: frame.slice(1), left: only, right: null })
    regions.push({
      id: only,
      loops: [{ arcs: [{ arc: arcId, rev: false }] }],
      labelPos: { ...frameCenter },
      showLabel: true,
    })
    return { nodes, arcs, regions }
  }

  const emb: Embedding = buildEmbedding(graph, pos)
  const outer = emb.faces[emb.outerIndex]

  // ── 外围环游的每个半边分到外框上一点 ──
  const outerPos = new Map<string, number>()
  outer.darts.forEach((d, i) => outerPos.set(dartKey(d.from, d.to), i))

  const rawTargets = outer.darts.map((d) =>
    perimeterParamTowards(frame, cum, total, frameCenter, splitPoint(d.from, d.to)),
  )
  const spread = spreadAroundCircle(rawTargets, 0.6 / outer.darts.length)
  const framePointAt = (walkIndex: number): Pt =>
    pointAtPerimeter(frame, cum, total, spread[walkIndex])

  /** 半边对应的边界节点：内面用面心，外面用外框上的切分点 */
  const nodeOfDart = (from: RegionId, to: RegionId): string => {
    const key = dartKey(from, to)
    const faceIndex = emb.faceOfDart.get(key)!
    if (faceIndex !== emb.outerIndex) {
      return addNode(`f${faceIndex}`, faceCenter(emb.faces[faceIndex].darts))
    }
    const walkIndex = outerPos.get(key)!
    return addNode(`r${walkIndex}`, framePointAt(walkIndex))
  }

  // ── 每条边一条弧：面心 → 边中点 → 面心 ──
  const arcOfEdge = new Map<string, string>()
  graph.edges.forEach(([a, b], i) => {
    const id = `${idPrefix}a${i}`
    arcs.push({
      id,
      n0: nodeOfDart(a, b),
      n1: nodeOfDart(b, a),
      mid: [splitPoint(a, b)],
      left: a,
      right: b,
    })
    arcOfEdge.set(edgeKey(a, b), id)
  })

  // ── 外框段：环游里相邻两个切分点之间的那段框，归它们中间那个顶点 ──
  const frameArcs = new Map<number, string>()
  outer.darts.forEach((d, j) => {
    const next = (j + 1) % outer.darts.length
    const id = `${idPrefix}fa${j}`
    const from = spread[j]
    const to = spread[next] > from ? spread[next] : spread[next] + 1
    // 沿框采样，圆角才是圆的而不是被拉成直线
    const steps = Math.max(2, Math.round((to - from) * frame.length))
    const mid: Pt[] = []
    for (let s = 1; s < steps; s++) {
      mid.push(pointAtPerimeter(frame, cum, total, from + ((to - from) * s) / steps))
    }
    arcs.push({
      id,
      n0: addNode(`r${j}`, framePointAt(j)),
      n1: addNode(`r${next}`, framePointAt(next)),
      mid,
      // d 的终点就是夹在这两个切分点之间的那个顶点
      left: d.to,
      right: null,
    })
    frameArcs.set(j, id)
  })

  // ── 区域边界：按旋转序把弧串成一圈 ──
  for (const v of graph.regions) {
    const nbs = emb.rotation.get(v) ?? []
    const items: Loop['arcs'] = []

    for (const u of nbs) {
      const arcId = arcOfEdge.get(edgeKey(v, u))!
      const startNode = nodeOfDart(v, u)
      const arc = arcs.find((a) => a.id === arcId)!
      items.push({ arc: arcId, rev: arc.n0 !== startNode })

      // 走到 u 再折回来，落在 (u→v) 所属的面上；若那是外面，
      // 就要顺着外框走到下一条边的起点
      const backKey = dartKey(u, v)
      if (emb.faceOfDart.get(backKey) === emb.outerIndex) {
        const j = outerPos.get(backKey)!
        items.push({ arc: frameArcs.get(j)!, rev: false })
      }
    }

    const anchor = pos[v]
    regions.push({
      id: v,
      loops: items.length ? [{ arcs: items }] : [],
      labelPos: { ...anchor },
      showLabel: true,
    })
  }

  return { nodes, arcs, regions }
}


/** 从构造结果里量出每个区域的多边形面积 */
export function regionAreas(built: ConstructResult): Map<RegionId, number> {
  const nodes = new Map(built.nodes.map((n) => [n.id, n.p]))
  const arcs = new Map(built.arcs.map((a) => [a.id, a]))
  const out = new Map<RegionId, number>()

  for (const region of built.regions) {
    let total = 0
    for (const loop of region.loops) {
      const pts: Pt[] = []
      for (const ref of loop.arcs) {
        const arc = arcs.get(ref.arc)
        if (!arc) continue
        const n0 = nodes.get(arc.n0)
        const n1 = nodes.get(arc.n1)
        if (!n0 || !n1) continue
        const seq = [n0, ...arc.mid, n1]
        pts.push(...(ref.rev ? [...seq].reverse() : seq).slice(0, -1))
      }
      let s = 0
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i]
        const b = pts[(i + 1) % pts.length]
        s += a.x * b.y - b.x * a.y
      }
      total += s / 2
    }
    out.set(region.id, Math.abs(total))
  }
  return out
}

/**
 * 面积均衡：反复量面积、调权重、重建。
 *
 * 权重只影响细分点的位置，不影响任何邻接关系，所以这个循环**不可能**把地图改错——
 * 不需要每步验证平面性，也就不会像挪顶点那样一撞交叉就卡死。
 * 权重上下限用来兜住极端情形：让某块无限膨胀会把邻居压成零宽。
 */
export function constructBalanced(
  graph: GraphSpec,
  pos: Record<RegionId, Pt>,
  frame: Pt[],
  idPrefix: string,
  rounds = 80,
): ConstructResult {
  const weights = new Map<RegionId, number>(graph.regions.map((v) => [v, 1]))
  let built = constructComponent(graph, pos, frame, idPrefix, weights)
  if (graph.regions.length < 2) return built

  for (let round = 0; round < rounds; round++) {
    const areas = regionAreas(built)
    const values = [...areas.values()].filter((a) => a > 0)
    if (values.length < 2) break
    const target = values.reduce((a, b) => a + b, 0) / values.length

    const smallest = Math.min(...values)
    if (smallest / target > 0.55) break

    for (const v of graph.regions) {
      const area = areas.get(v) ?? target
      if (area <= 0) continue
      // 阻尼开方，避免来回震荡
      const adjust = Math.pow(target / area, 0.3)
      const next = (weights.get(v) ?? 1) * adjust
      weights.set(v, Math.min(Math.max(next, 0.12), 9))
    }
    built = constructComponent(graph, pos, frame, idPrefix, weights)
  }

  return built
}
