import type { GraphSpec, Pt, RegionId } from './types'
import { normalizeGraph } from './graph'

/**
 * 平面嵌入。
 *
 * 一旦手上有了一张**无交叉**的直线画法，组合嵌入就是白送的：
 * 把每个顶点的邻居按方位角排序，就得到了旋转系统；沿旋转系统走一圈就得到所有的面。
 * 不需要跑 Boyer–Myrvold 之类的平面性算法——画得出无交叉的图，本身就是平面性的构造性证明。
 */

/** 有向边（半边） */
export interface Dart {
  from: RegionId
  to: RegionId
}

export interface Face {
  darts: Dart[]
  /** 多边形有向面积，用来认出外面 */
  area: number
}

export interface Embedding {
  /** 顶点 → 邻居，按方位角排序 */
  rotation: Map<RegionId, RegionId[]>
  faces: Face[]
  /** faces 里外面的下标；图没有边时为 -1 */
  outerIndex: number
  /** 半边 "from→to" → 它所属的面下标 */
  faceOfDart: Map<string, number>
}

export function dartKey(from: RegionId, to: RegionId): string {
  return `${from}${to}`
}

function orient(a: Pt, b: Pt, c: Pt): number {
  const v = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
  return Math.abs(v) < 1e-9 ? 0 : Math.sign(v)
}

/** 真交叉：两段在内部相交，共享端点不算 */
export function segmentsCross(p1: Pt, p2: Pt, p3: Pt, p4: Pt): boolean {
  const d1 = orient(p3, p4, p1)
  const d2 = orient(p3, p4, p2)
  const d3 = orient(p1, p2, p3)
  const d4 = orient(p1, p2, p4)
  return d1 !== d2 && d3 !== d4 && d1 !== 0 && d2 !== 0 && d3 !== 0 && d4 !== 0
}

export function countCrossings(graph: GraphSpec, pos: Record<RegionId, Pt>): number {
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

/**
 * 顶点离得太近会让方位角失去意义，旋转系统就不可靠了。
 * 返回最小的顶点间距，调用方拿它做健全性检查。
 */
export function minVertexGap(graph: GraphSpec, pos: Record<RegionId, Pt>): number {
  let best = Infinity
  const ids = graph.regions
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      best = Math.min(best, Math.hypot(pos[ids[i]].x - pos[ids[j]].x, pos[ids[i]].y - pos[ids[j]].y))
    }
  }
  return best
}

/** 把图拆成连通分量，每个分量仍是一张完整的 GraphSpec */
export function connectedComponents(graph: GraphSpec): GraphSpec[] {
  const adj = new Map<RegionId, RegionId[]>()
  for (const id of graph.regions) adj.set(id, [])
  for (const [a, b] of graph.edges) {
    adj.get(a)!.push(b)
    adj.get(b)!.push(a)
  }

  const seen = new Set<RegionId>()
  const out: GraphSpec[] = []

  for (const start of graph.regions) {
    if (seen.has(start)) continue
    const members: RegionId[] = []
    const stack = [start]
    seen.add(start)
    while (stack.length) {
      const v = stack.pop()!
      members.push(v)
      for (const w of adj.get(v)!) {
        if (seen.has(w)) continue
        seen.add(w)
        stack.push(w)
      }
    }
    const inside = new Set(members)
    const colors: Record<RegionId, string> = {}
    for (const id of members) colors[id] = graph.colors[id] ?? 'gray'
    out.push(
      normalizeGraph({
        // 保持原来的相对顺序，输出才稳定
        regions: graph.regions.filter((id) => inside.has(id)),
        edges: graph.edges.filter(([a, b]) => inside.has(a) && inside.has(b)),
        colors,
      }),
    )
  }
  return out
}

/**
 * 由无交叉的直线画法建立组合嵌入。
 *
 * 追踪面的规则：走完半边 (u→v) 之后，接着走 (v→w)，
 * 其中 w 是 v 的旋转序里 u 的下一个。所有半边恰好各被走到一次，
 * 面的总长度等于 2|E|。
 */
export function buildEmbedding(graph: GraphSpec, pos: Record<RegionId, Pt>): Embedding {
  const rotation = new Map<RegionId, RegionId[]>()
  for (const id of graph.regions) {
    const nbs = graph.edges
      .filter(([a, b]) => a === id || b === id)
      .map(([a, b]) => (a === id ? b : a))
    nbs.sort(
      (p, q) =>
        Math.atan2(pos[p].y - pos[id].y, pos[p].x - pos[id].x) -
        Math.atan2(pos[q].y - pos[id].y, pos[q].x - pos[id].x),
    )
    rotation.set(id, nbs)
  }

  const indexIn = new Map<string, number>()
  for (const [v, nbs] of rotation) {
    nbs.forEach((n, i) => indexIn.set(dartKey(v, n), i))
  }

  const faces: Face[] = []
  const faceOfDart = new Map<string, number>()

  for (const [a, b] of graph.edges) {
    for (const [from, to] of [
      [a, b],
      [b, a],
    ] as [RegionId, RegionId][]) {
      if (faceOfDart.has(dartKey(from, to))) continue

      const darts: Dart[] = []
      let cur: Dart = { from, to }
      const faceIndex = faces.length

      // 半边总数有限，这个循环一定会绕回起点
      for (let guard = 0; guard <= 2 * graph.edges.length + 1; guard++) {
        const key = dartKey(cur.from, cur.to)
        if (faceOfDart.has(key)) break
        faceOfDart.set(key, faceIndex)
        darts.push(cur)

        const nbs = rotation.get(cur.to)!
        const i = indexIn.get(dartKey(cur.to, cur.from))!
        cur = { from: cur.to, to: nbs[(i + 1) % nbs.length] }
      }

      // 有向面积：外面的绕向与内面相反
      let area = 0
      for (const d of darts) {
        area += pos[d.from].x * pos[d.to].y - pos[d.to].x * pos[d.from].y
      }
      faces.push({ darts, area: area / 2 })
    }
  }

  // 外面是唯一绕向相反的那个；退化情形（树、单边）里取面积绝对值最大的
  let outerIndex = -1
  if (faces.length) {
    const inner = faces.filter((f) => f.area > 1e-9)
    const outer = faces.filter((f) => f.area < -1e-9)
    if (outer.length === 1) {
      outerIndex = faces.indexOf(outer[0])
    } else if (inner.length === 1 && faces.length === 1) {
      outerIndex = 0
    } else {
      // 所有面都退化（比如整张图是一棵树，只有一个面）时按半边数最多的算
      let best = 0
      for (let i = 1; i < faces.length; i++) {
        if (faces[i].darts.length > faces[best].darts.length) best = i
      }
      outerIndex = best
    }
  }

  return { rotation, faces, outerIndex, faceOfDart }
}
