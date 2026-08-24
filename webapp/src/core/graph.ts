import type { GraphSpec, RegionId } from './types'
import { SLOTS, type Slot } from './palette'

/** 邻接对字符串键的分隔符。区域名不允许含空白，所以用空格就够了 */
const SEP = ' '

/** 把一对区域规范成与顺序无关的字符串键，便于放进 Set/Map */
export function edgeKey(a: RegionId, b: RegionId): string {
  return a < b ? a + SEP + b : b + SEP + a
}

export function splitEdgeKey(key: string): [RegionId, RegionId] {
  const i = key.indexOf(SEP)
  return [key.slice(0, i), key.slice(i + SEP.length)]
}

export function emptyGraph(): GraphSpec {
  return { regions: [], edges: [], colors: {} }
}

export function neighborsOf(graph: GraphSpec, id: RegionId): RegionId[] {
  const out: RegionId[] = []
  for (const [a, b] of graph.edges) {
    if (a === id) out.push(b)
    else if (b === id) out.push(a)
  }
  return out
}

export function adjacencySet(graph: GraphSpec): Set<string> {
  return new Set(graph.edges.map(([a, b]) => edgeKey(a, b)))
}

/** 规范化：去掉自环、重复边、指向不存在区域的边；补齐缺失的颜色 */
export function normalizeGraph(graph: GraphSpec): GraphSpec {
  const known = new Set(graph.regions)
  const seen = new Set<string>()
  const edges: [RegionId, RegionId][] = []

  for (const [a, b] of graph.edges) {
    if (a === b || !known.has(a) || !known.has(b)) continue
    const key = edgeKey(a, b)
    if (seen.has(key)) continue
    seen.add(key)
    edges.push(a < b ? [a, b] : [b, a])
  }

  const colors: Record<RegionId, string> = {}
  for (const id of graph.regions) colors[id] = graph.colors[id] ?? 'gray'

  return { regions: [...graph.regions], edges, colors }
}

export function setEdge(graph: GraphSpec, a: RegionId, b: RegionId, on: boolean): GraphSpec {
  const rest = graph.edges.filter(([x, y]) => edgeKey(x, y) !== edgeKey(a, b))
  return normalizeGraph({
    ...graph,
    edges: on ? [...rest, a < b ? [a, b] : [b, a]] : rest,
  })
}

export function renameRegion(graph: GraphSpec, from: RegionId, to: RegionId): GraphSpec {
  if (from === to) return graph
  const swap = (x: RegionId) => (x === from ? to : x)
  const colors: Record<RegionId, string> = {}
  for (const [k, v] of Object.entries(graph.colors)) colors[swap(k)] = v
  return normalizeGraph({
    regions: graph.regions.map(swap),
    edges: graph.edges.map(([a, b]) => [swap(a), swap(b)] as [RegionId, RegionId]),
    colors,
  })
}

export function removeRegion(graph: GraphSpec, id: RegionId): GraphSpec {
  const colors = { ...graph.colors }
  delete colors[id]
  return normalizeGraph({
    regions: graph.regions.filter((r) => r !== id),
    edges: graph.edges.filter(([a, b]) => a !== id && b !== id),
    colors,
  })
}

/** 下一个可用的区域名：A…Z，用完接 A1、B1…… */
export function nextRegionName(existing: readonly RegionId[]): RegionId {
  const used = new Set(existing)
  for (let round = 0; ; round++) {
    for (let i = 0; i < 26; i++) {
      const name = String.fromCharCode(65 + i) + (round === 0 ? '' : String(round))
      if (!used.has(name)) return name
    }
  }
}

/**
 * 回溯四色着色。四色定理保证平面图一定有解，
 * 但这里的图不一定平面，所以失败时退回到贪心 + 灰色兜底。
 */
export function fourColor(graph: GraphSpec): Record<RegionId, Slot> {
  const order = [...graph.regions].sort(
    (a, b) => neighborsOf(graph, b).length - neighborsOf(graph, a).length,
  )
  const adj = adjacencySet(graph)
  const assign: Record<RegionId, Slot> = {}
  const choices: Slot[] = ['red', 'green', 'yellow', 'blue']

  const solve = (i: number): boolean => {
    if (i === order.length) return true
    const id = order[i]
    for (const slot of choices) {
      const clash = order
        .slice(0, i)
        .some((other) => assign[other] === slot && adj.has(edgeKey(id, other)))
      if (clash) continue
      assign[id] = slot
      if (solve(i + 1)) return true
      delete assign[id]
    }
    return false
  }

  if (solve(0)) return assign

  // 非平面图：尽力而为，冲突处用灰色
  const fallback: Record<RegionId, Slot> = {}
  for (const id of order) {
    const taken = new Set(
      order.filter((o) => fallback[o] && adj.has(edgeKey(id, o))).map((o) => fallback[o]),
    )
    fallback[id] = SLOTS.find((s) => !taken.has(s)) ?? 'gray'
  }
  return fallback
}

/**
 * 平面性的必要条件快检（欧拉公式推论）。
 * 返回 null 表示没查出问题——注意这不能证明图是平面的，
 * 真正的判定放在生成后比对实际邻接关系。
 */
export function planarityWarning(graph: GraphSpec): string | null {
  const v = graph.regions.length
  const e = graph.edges.length
  if (v >= 3 && e > 3 * v - 6) {
    return `${v} 个区域最多只能有 ${3 * v - 6} 条邻接关系，现在有 ${e} 条——这个图不是平面图，画不出对应的地图。`
  }
  return null
}
