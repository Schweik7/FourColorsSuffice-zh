/**
 * 由邻接关系铺一张起始草稿。
 *
 * ## 为什么不直接采样解析构造出来的地图
 *
 * 因为它在复杂用例上会翻面。重心细分要求面心落在面的内部，而这只在面是凸的时候
 * 才由「顶点的凸组合仍在面内」保证；Tutte 塌掉退回力导向画法、或者事后又挪过顶点
 * 之后，面不再是凸的，面心跑到面外，绕顶点的那一圈扇形就自己叠在自己身上。
 * 组合上仍然「环闭合、弧两侧对得上」，几何上却是一团互相盖住的乱麻——
 * 这正是复杂地图看起来特别奇怪的根源。
 *
 * ## 改成栅格化平面画法
 *
 * 只取那张**无交叉的直线画法**（这一步本来就有，而且交叉数为 0 是验过的），
 * 然后逐格问：离我最近的是哪条边上的哪一半？前一半归 a，后一半归 b。
 *
 * 这是重心细分的离散版，好处是它按定义就是一个**划分**——每格恰好属于一块，
 * 不可能重叠，也不可能翻面。剩下的偏差只有一类：面的度数大于 3 时，
 * 那个面上的几块会在面心附近挤到一起，非相邻的两块可能贴上一两格。
 * 这类瑕疵很小而且位置确定，用 `separateExtras` 就地挖成海即可——
 * 四块围一圈中间是个小湖，本来就是地图上常见的样子。
 */

import type { GraphSpec, MapModel, Pt, RegionId } from './types'
import { arcById, arcPoints, nodePos } from './render'
import { edgeKey, normalizeGraph, splitEdgeKey } from './graph'
import { generateMap } from './generate'
import { roundedRectPath } from './construct'
import { DIRS, cellAt, type HexMesh } from './mesh'
import {
  SEA,
  areasOf,
  componentCount,
  contactsOf,
  labelOfNeighbor,
  pairKey,
  mergeStrayComponents,
  removalKeepsConnected,
  unpair,
  type Painting,
} from './paint'

export interface SeedOptions {
  seed: number
  /** 外框相对短边留出的白边，0 = 铺满画布 */
  margin: number
  /** 外框圆角，相对短边 */
  corner: number
  /** 每块至少留几格，挖湖时不许把谁削到这条线以下 */
  minArea: number
}

export const DEFAULT_SEED: SeedOptions = { seed: 1, margin: 0.05, corner: 0.16, minArea: 8 }

export interface SeedResult {
  painting: Painting
  /** 目标里有、草稿上还没做出来的邻接 */
  missing: [RegionId, RegionId][]
  /** 草稿上多出来、目标里没有的邻接 */
  extra: [RegionId, RegionId][]
  /** 非平面之类的硬伤 */
  note: string | null
}

// ── 几何小工具 ────────────────────────────────────────────────

/** 点到线段的最近点参数 t∈[0,1] 与距离平方 */
function nearestOnSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  const t = len2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2))
  const qx = ax + dx * t - px
  const qy = ay + dy * t - py
  return { t, d2: qx * qx + qy * qy }
}

function insidePolygon(poly: Pt[], x: number, y: number): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]
    const b = poly[j]
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

// ── 栅格化 ────────────────────────────────────────────────────

/**
 * 把一张无交叉的直线画法铺到网格上。
 * 每格归给「离它最近的那条边的、离它较近的那一端」。
 */
export function rasterizeDrawing(
  mesh: HexMesh,
  names: RegionId[],
  colors: readonly string[],
  pos: Record<RegionId, Pt>,
  edges: readonly (readonly [RegionId, RegionId])[],
  frame: Pt[] | null,
): Painting {
  const index = new Map(names.map((n, i) => [n, i]))
  const labels = new Int32Array(mesh.count).fill(SEA)

  // 没有边的退化情形：整块地盘归唯一那个区域
  const usable = edges.filter(([a, b]) => pos[a] && pos[b])
  if (!usable.length) {
    const only = names.findIndex((n) => pos[n])
    if (only >= 0) {
      for (let i = 0; i < mesh.count; i++) {
        if (mesh.paintable[i] && (!frame || insidePolygon(frame, mesh.cx[i], mesh.cy[i]))) {
          labels[i] = only
        }
      }
    }
    return { mesh, labels, names: [...names], colors: [...colors] }
  }

  for (let i = 0; i < mesh.count; i++) {
    if (!mesh.paintable[i]) continue
    const x = mesh.cx[i]
    const y = mesh.cy[i]
    if (frame && !insidePolygon(frame, x, y)) continue

    let best = Infinity
    let owner = SEA
    for (const [a, b] of usable) {
      const pa = pos[a]
      const pb = pos[b]
      const hit = nearestOnSegment(x, y, pa.x, pa.y, pb.x, pb.y)
      if (hit.d2 >= best) continue
      best = hit.d2
      owner = index.get(hit.t < 0.5 ? a : b) ?? SEA
    }
    labels[i] = owner
  }

  return { mesh, labels, names: [...names], colors: [...colors] }
}

/** 采样一张已经算好的地图模型（用于把导入的 SVG 接着拿来涂） */
export function rasterizeModel(mesh: HexMesh, model: MapModel, colorsOf: GraphSpec['colors']): Painting {
  const names = model.regions.map((r) => r.id)
  const labels = new Int32Array(mesh.count).fill(SEA)
  const arcs = arcById(model)
  const nodes = nodePos(model)

  names.forEach((name, k) => {
    const region = model.regions.find((r) => r.id === name)!
    const loops: Pt[][] = []
    for (const loop of region.loops) {
      const pts: Pt[] = []
      for (const ref of loop.arcs) {
        const arc = arcs.get(ref.arc)
        if (!arc) continue
        const seq = arcPoints(arc, nodes, ref.rev)
        if (seq.length >= 2) pts.push(...seq.slice(0, -1))
      }
      if (pts.length >= 3) loops.push(pts)
    }
    if (!loops.length) return
    for (let i = 0; i < mesh.count; i++) {
      if (!mesh.paintable[i] || labels[i] !== SEA) continue
      // 奇偶规则跨所有环一起算，洞因此自动挖掉
      let inside = false
      for (const poly of loops) if (insidePolygon(poly, mesh.cx[i], mesh.cy[i])) inside = !inside
      if (inside) labels[i] = k
    }
  })

  return { mesh, labels, names, colors: names.map((n) => colorsOf[n] ?? 'gray') }
}

// ── 修补 ──────────────────────────────────────────────────────

/** 一格与它六个邻居里某一块贴了几条边 */
function edgesTo(p: Painting, cell: number, label: number): number {
  let n = 0
  for (let d = 0; d < DIRS; d++) if (labelOfNeighbor(p, cell, d) === label) n++
  return n
}

/**
 * 把多出来的邻接挖开：在两块贴上的地方挖出一小片海。
 * 只挖那些挖了也不会切断本块、不会削过头、更不会弄丢必需邻接的格子。
 */
function separateExtras(p: Painting, required: Set<number>, minArea: number): void {
  for (let iter = 0; iter < 4; iter++) {
    let contacts = contactsOf(p)
    const bad = new Set([...contacts.keys()].filter((k) => !required.has(k)))
    if (!bad.size) return

    const areas = areasOf(p)
    const victims: number[] = []
    for (let i = 0; i < p.mesh.count; i++) {
      const k = p.labels[i]
      if (k < 0 || !p.mesh.paintable[i]) continue
      for (let d = 0; d < DIRS; d++) {
        const x = labelOfNeighbor(p, i, d)
        if (x >= 0 && x !== k && bad.has(pairKey(k, x))) {
          victims.push(i)
          break
        }
      }
    }
    if (!victims.length) return

    // 先挖地盘大的那一边，小块不容易被削没
    victims.sort((a, b) => areas[p.labels[b]] - areas[p.labels[a]])

    let carved = 0
    for (const i of victims) {
      const from = p.labels[i]
      if (from < 0) continue
      if (areas[from] - 1 < minArea) continue
      if (!removalKeepsConnected(p, i)) continue

      // 必需的邻接不能因为挖这一格而归零
      let safe = true
      for (let d = 0; d < DIRS && safe; d++) {
        const x = labelOfNeighbor(p, i, d)
        if (x < 0 || x === from) continue
        const key = pairKey(from, x)
        if (required.has(key) && (contacts.get(key) ?? 0) - edgesTo(p, i, x) <= 0) safe = false
      }
      if (!safe) continue

      p.labels[i] = SEA
      areas[from]--
      carved++
      contacts = contactsOf(p)
    }
    if (!carved) return
  }
}

/**
 * 一张草稿有多少毛病：多出来的邻接 + 断成几片 + 太小的块。
 * 修补动作一律用它来判断该不该留下——只认「比动手之前更好」，
 * 不要求一步到位，也就不会因为存量问题而把有用的修补全撤掉。
 */
function problemScore(p: Painting, required: Set<number>, minArea: number): number {
  let score = 0
  for (const key of contactsOf(p).keys()) if (!required.has(key)) score += 3
  const areas = areasOf(p)
  p.names.forEach((_, k) => {
    if (areas[k] === 0) return
    score += (componentCount(p, k) - 1) * 3
    if (areas[k] < minArea) score += 1
  })
  return score
}

/**
 * 把缺掉的邻接接上：在两块之间找一条最短通路，前半段划给 a、后半段划给 b。
 * 接完复核一遍，只要总体毛病没减少就整条撤销——宁可如实报「这条没接上」，
 * 也不要为了凑数把别处弄坏。
 */
function weldMissing(p: Painting, required: Set<number>, minArea: number): void {
  for (const key of required) {
    const [a, b] = unpair(key)
    if ((contactsOf(p).get(key) ?? 0) > 0) continue

    const path = shortestPath(p, a, b)
    if (!path) continue

    const backup = Int32Array.from(p.labels)
    const before = problemScore(p, required, minArea)
    const half = Math.ceil(path.length / 2)
    path.forEach((cell, i) => {
      if (p.mesh.paintable[cell]) p.labels[cell] = i < half ? a : b
    })
    mergeStrayComponents(p)

    const connected = (contactsOf(p).get(key) ?? 0) > 0
    if (!connected || problemScore(p, required, minArea) > before) p.labels.set(backup)
  }
}

/** 从 a 的地盘走到 b 的地盘的最短格路（不含两端所属的格子之外的东西） */
function shortestPath(p: Painting, a: number, b: number): number[] | null {
  const prev = new Int32Array(p.mesh.count).fill(-2)
  const queue: number[] = []
  for (let i = 0; i < p.mesh.count; i++) {
    if (p.labels[i] === a) {
      prev[i] = -1
      queue.push(i)
    }
  }
  if (!queue.length) return null

  for (let head = 0; head < queue.length; head++) {
    const c = queue[head]
    if (p.labels[c] === b) {
      const path: number[] = []
      for (let x = c; x >= 0 && prev[x] !== -1; x = prev[x]) path.push(x)
      return path.reverse()
    }
    for (let d = 0; d < DIRS; d++) {
      const j = p.mesh.nbr[c * DIRS + d]
      if (j < 0 || prev[j] !== -2 || !p.mesh.paintable[j]) continue
      prev[j] = c
      queue.push(j)
    }
  }
  return null
}

// ── 入口 ──────────────────────────────────────────────────────

/** 目标邻接与草稿实际邻接的差集 */
function diffAdjacency(p: Painting, target: GraphSpec) {
  const want = new Set(target.edges.map(([a, b]) => edgeKey(a, b)))
  const got = new Map<string, [RegionId, RegionId]>()
  for (const key of contactsOf(p).keys()) {
    const [a, b] = unpair(key)
    const na = p.names[a]
    const nb = p.names[b]
    if (na === undefined || nb === undefined) continue
    got.set(edgeKey(na, nb), na < nb ? [na, nb] : [nb, na])
  }
  const missing: [RegionId, RegionId][] = []
  for (const key of want) if (!got.has(key)) missing.push(splitEdgeKey(key))
  const extra: [RegionId, RegionId][] = []
  for (const [key, pv] of got) if (!want.has(key)) extra.push(pv)
  return { missing, extra }
}

export function seedFromGraph(
  mesh: HexMesh,
  graph: GraphSpec,
  opts: SeedOptions = DEFAULT_SEED,
): SeedResult {
  const clean = normalizeGraph(graph)
  // 只借它那张无交叉的直线画法（dualPos），构造出来的多边形一概不用
  const { model, report } = generateMap(clean, {
    style: 'geometric',
    seed: opts.seed,
    width: mesh.width,
    height: mesh.height,
  })

  const short = Math.min(mesh.width, mesh.height)
  const frame =
    opts.margin > 0
      ? roundedRectPath(
          mesh.width / 2,
          mesh.height / 2,
          mesh.width / 2 - short * opts.margin,
          mesh.height / 2 - short * opts.margin,
          short * opts.corner,
          16,
        )
      : null

  const painting = rasterizeDrawing(
    mesh,
    clean.regions,
    clean.regions.map((n) => clean.colors[n] ?? 'gray'),
    model.dualPos,
    clean.edges,
    frame,
  )

  const index = new Map(clean.regions.map((n, i) => [n, i]))
  const required = new Set<number>()
  for (const [a, b] of clean.edges) {
    const ia = index.get(a)
    const ib = index.get(b)
    if (ia !== undefined && ib !== undefined) required.add(pairKey(ia, ib))
  }

  // 修补顺序有讲究：先把飞地并掉，再挖开多余的邻接，最后缝上缺掉的。
  // 缝合会动到别人的地盘，所以缝完再挖一次、再并一次。
  mergeStrayComponents(painting)
  separateExtras(painting, required, opts.minArea)
  weldMissing(painting, required, opts.minArea)
  separateExtras(painting, required, opts.minArea)
  mergeStrayComponents(painting)

  const { missing, extra } = diffAdjacency(painting, clean)
  const note = report.ok
    ? null
    : (report.nonPlanarHint ?? `这个图画不成地图（还剩 ${report.crossings} 处交叉）`)

  return { painting, missing, extra, note }
}

/** 网格上离某点最近的格子，界面里拾取用 */
export function pickCell(mesh: HexMesh, x: number, y: number): number {
  return cellAt(mesh, x, y)
}
