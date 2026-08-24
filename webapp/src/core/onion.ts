import type { GraphSpec, Pt, RegionId } from './types'
import { neighborsOf } from './graph'
import { countCrossings } from './planar'
import { makePerimeter, roundedRectPath } from './construct'

/**
 * 洋葱布局：从某个中心点出发做 BFS 分层，各层摆在同心的圆角矩形环上。
 *
 * 这样画出来的图，重心细分之后就是一圈套一圈的条带——正是参考图里
 * 「圆角矩形外框 + 环形分层 + 径向切分」的样子。
 *
 * 层内的次序用「父节点方位角的平均值」排，这是分层图减交叉的常规做法；
 * 层与层之间的边基本就不会绞在一起了。
 */

export interface OnionResult {
  pos: Record<RegionId, Pt>
  crossings: number
  root: RegionId
  levels: number
}

function bfsLevels(graph: GraphSpec, root: RegionId): Map<RegionId, number> {
  const level = new Map<RegionId, number>([[root, 0]])
  const queue = [root]
  for (let head = 0; head < queue.length; head++) {
    const v = queue[head]
    for (const w of neighborsOf(graph, v)) {
      if (level.has(w)) continue
      level.set(w, level.get(v)! + 1)
      queue.push(w)
    }
  }
  return level
}

/** 一组角度的圆周平均；集合为空时返回 null */
function circularMean(angles: number[]): number | null {
  if (!angles.length) return null
  let sx = 0
  let sy = 0
  for (const a of angles) {
    sx += Math.cos(a)
    sy += Math.sin(a)
  }
  if (Math.abs(sx) < 1e-9 && Math.abs(sy) < 1e-9) return null
  return Math.atan2(sy, sx)
}

function layoutFromRoot(
  graph: GraphSpec,
  root: RegionId,
  width: number,
  height: number,
  margin: number,
  cornerRatio: number,
  refine: boolean,
): OnionResult {
  const level = bfsLevels(graph, root)
  const maxLevel = Math.max(0, ...level.values())

  const byLevel: RegionId[][] = Array.from({ length: maxLevel + 1 }, () => [])
  for (const id of graph.regions) {
    const k = level.get(id)
    // BFS 到不了的顶点（图不连通时）统一丢到最外层
    byLevel[k === undefined ? maxLevel : k].push(id)
  }

  const cx = width / 2
  const cy = height / 2
  const halfW = width / 2 - margin
  const halfH = height / 2 - margin

  const pos: Record<RegionId, Pt> = {}
  const angleOf: Record<RegionId, number> = {}

  // 每一层落在一个同心圆角矩形环上；最内层若只有一个顶点就放正中心
  for (let k = 0; k <= maxLevel; k++) {
    const members = byLevel[k]
    if (!members.length) continue

    if (k === 0 && members.length === 1) {
      pos[members[0]] = { x: cx, y: cy }
      angleOf[members[0]] = 0
      continue
    }

    // 半径系数：最内层也要留出一点地方，别缩成一个点
    const t = (k + 0.85) / (maxLevel + 0.85)
    const ring = roundedRectPath(cx, cy, halfW * t, halfH * t, Math.min(halfW, halfH) * t * cornerRatio)
    const perim = makePerimeter(ring)

    // 按「上一层邻居的平均方位角」排序，层间连线就不容易交叉
    const target = new Map<RegionId, number>()
    for (const v of members) {
      const parents = neighborsOf(graph, v).filter((w) => angleOf[w] !== undefined)
      target.set(v, circularMean(parents.map((w) => angleOf[w])) ?? 0)
    }
    const ordered = [...members].sort((a, b) => target.get(a)! - target.get(b)!)

    const first = target.get(ordered[0])!
    ordered.forEach((v, i) => {
      const angle = first + (2 * Math.PI * i) / ordered.length
      angleOf[v] = angle
      const probe = { x: cx + Math.cos(angle) * width, y: cy + Math.sin(angle) * height }
      pos[v] = perim.at(perim.paramTowards(probe))
    })
  }

  if (refine) refineBySwapping(graph, pos, byLevel)
  return { pos, crossings: countCrossings(graph, pos), root, levels: maxLevel + 1 }
}

/**
 * 层内交换消交叉：同一层的两个顶点互换位置，交叉数不增就保留。
 *
 * 只在层内换，环形分层的结构就不会被破坏。遍历顺序固定、不用随机数，
 * 所以结果是确定的——同样的图每次得到同一张布局。
 */
function refineBySwapping(
  graph: GraphSpec,
  pos: Record<RegionId, Pt>,
  byLevel: RegionId[][],
) {
  let crossings = countCrossings(graph, pos)
  if (crossings === 0) return

  for (let round = 0; round < 6 && crossings > 0; round++) {
    let improved = false
    for (const members of byLevel) {
      for (let i = 0; i < members.length; i++) {
        for (let j = i + 1; j < members.length; j++) {
          const a = members[i]
          const b = members[j]
          const tmp = pos[a]
          pos[a] = pos[b]
          pos[b] = tmp

          const next = countCrossings(graph, pos)
          if (next < crossings) {
            crossings = next
            improved = true
            if (crossings === 0) return
          } else {
            pos[b] = pos[a]
            pos[a] = tmp
          }
        }
      }
    }
    if (!improved) return
  }
}

/**
 * 布局阶段试用的环形形状。
 *
 * 这一组是**布局**参数，与外框最终画多圆无关——环形形状会影响能不能消掉交叉
 * （比如网格图在接近直角的环上才排得开），要是让渲染风格决定它，
 * 就会出现「同一张图换个风格就画不出来」这种莫名其妙的事。
 */
const RING_SHAPES = [0.05, 0.28, 0.5]

/**
 * 扫一遍「中心点 × 环形形状」，取交叉最少的一版；仍有交叉时再对最好的几版
 * 做层内交换改良。顺序固定、不用随机数，所以同一张图每次得到同一个结果。
 */
export function onionLayout(
  graph: GraphSpec,
  width: number,
  height: number,
  margin: number,
): OnionResult | null {
  if (!graph.regions.length) return null

  // 度数高的点当中心更像「一圈套一圈」，所以优先试它们
  const roots = [...graph.regions].sort(
    (a, b) => neighborsOf(graph, b).length - neighborsOf(graph, a).length,
  )

  const tried: { root: RegionId; shape: number; crossings: number; result: OnionResult }[] = []
  for (const shape of RING_SHAPES) {
    for (const root of roots) {
      const result = layoutFromRoot(graph, root, width, height, margin, shape, false)
      if (result.crossings === 0) return result
      tried.push({ root, shape, crossings: result.crossings, result })
    }
  }

  // 都没有直接干净的，挑最接近的几版做层内交换
  tried.sort((a, b) => a.crossings - b.crossings)
  let best = tried[0]?.result ?? null
  for (const candidate of tried.slice(0, 4)) {
    const refined = layoutFromRoot(graph, candidate.root, width, height, margin, candidate.shape, true)
    if (refined.crossings === 0) return refined
    if (!best || refined.crossings < best.crossings) best = refined
  }
  return best
}
