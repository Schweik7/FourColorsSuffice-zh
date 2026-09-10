/**
 * 网格着色：地图的可编辑表示。
 *
 * 地图不再是一堆解析曲线，而是「每个六边形格子属于哪一块」。
 * 好处是所有难做的事都变简单了：
 *
 *  - **邻接关系是量出来的，不是输入的。** 用户涂完，图自己就在那儿了。
 *  - **空洞、包围、飞地都是免费的**，它们只是着色的自然结果，不需要专门的构造。
 *  - **形状可以做局部搜索。** 每次只改一个格子的归属，改之前能在 O(1) 时间里
 *    验完「邻接关系没变、这块没被切断」，所以优化形状永远不会把拓扑弄坏。
 *    这正是解析构造缺的那个自由度。
 */

import type { GraphSpec, RegionId } from './types'
import { DIRS, type HexMesh } from './mesh'

/** 没有归属的格子（背景/海） */
export const SEA = -1

export interface Painting {
  mesh: HexMesh
  /** 每格属于第几块；SEA 表示背景 */
  labels: Int32Array
  /** 块号 → 区域名 */
  names: RegionId[]
  /** 块号 → 颜色（调色板槽位名或 #rrggbb），与 GraphSpec.colors 同一套取值 */
  colors: string[]
}

export function emptyPainting(mesh: HexMesh): Painting {
  return { mesh, labels: new Int32Array(mesh.count).fill(SEA), names: [], colors: [] }
}

export function clonePainting(p: Painting): Painting {
  return {
    mesh: p.mesh,
    labels: Int32Array.from(p.labels),
    names: [...p.names],
    colors: [...p.colors],
  }
}

/** 出界的邻居一律当成海，这样描边界时不用给边缘准备特例 */
export function labelOfNeighbor(p: Painting, cell: number, d: number): number {
  const j = p.mesh.nbr[cell * DIRS + d]
  return j < 0 ? SEA : p.labels[j]
}

// ── 面积、周长、接触长度 ────────────────────────────────────────

/** 每块占的格数，下标即块号 */
export function areasOf(p: Painting): Int32Array {
  const out = new Int32Array(p.names.length)
  for (let i = 0; i < p.labels.length; i++) {
    const k = p.labels[i]
    if (k >= 0 && k < out.length) out[k]++
  }
  return out
}

/** 每块的周长（异色格边的条数） */
export function perimetersOf(p: Painting): Int32Array {
  const out = new Int32Array(p.names.length)
  for (let i = 0; i < p.labels.length; i++) {
    const k = p.labels[i]
    if (k < 0 || k >= out.length) continue
    for (let d = 0; d < DIRS; d++) {
      if (labelOfNeighbor(p, i, d) !== k) out[k]++
    }
  }
  return out
}

/** 一对块号打成数值键（小的在前） */
export function pairKey(a: number, b: number): number {
  return a < b ? a * 4096 + b : b * 4096 + a
}

export function unpair(key: number): [number, number] {
  return [Math.floor(key / 4096), key % 4096]
}

/**
 * 两两之间共了多少条格边。
 * 只统计块与块，海不计——海不是图里的顶点。
 */
export function contactsOf(p: Painting): Map<number, number> {
  const out = new Map<number, number>()
  for (let i = 0; i < p.labels.length; i++) {
    const k = p.labels[i]
    if (k < 0) continue
    for (let d = 0; d < DIRS; d++) {
      const j = p.mesh.nbr[i * DIRS + d]
      // 每条格边只从格号小的那侧数一次
      if (j < 0 || j < i) continue
      const l = p.labels[j]
      if (l < 0 || l === k) continue
      const key = pairKey(k, l)
      out.set(key, (out.get(key) ?? 0) + 1)
    }
  }
  return out
}

// ── 连通性 ────────────────────────────────────────────────────

/**
 * 把 cell 从它现在这块里拿走，会不会把这块切成两半？
 *
 * 六边形网格里一个格子的六个邻居首尾相接构成一个六元环，
 * 所以只要**同色邻居在这个环上连成一段**，任何原本穿过 cell 的路径
 * 都能沿着这一段绕过去，拿走它就一定不会切断。反过来断成两段以上就会切断。
 * 于是这个判定只看六个邻居，是 O(1) 的。
 */
export function removalKeepsConnected(p: Painting, cell: number): boolean {
  const k = p.labels[cell]
  const same: boolean[] = []
  let n = 0
  for (let d = 0; d < DIRS; d++) {
    const hit = labelOfNeighbor(p, cell, d) === k
    same.push(hit)
    if (hit) n++
  }
  if (n === 0) return false // 孤立格：拿走等于这块消失，交给调用方判断
  if (n === DIRS) return true
  let runs = 0
  for (let d = 0; d < DIRS; d++) {
    if (same[d] && !same[(d + DIRS - 1) % DIRS]) runs++
  }
  return runs === 1
}

/** 某一块被分成了几个连通片。1 才是正常的地图区域 */
export function componentCount(p: Painting, label: number): number {
  const { labels } = p
  const seen = new Uint8Array(labels.length)
  let parts = 0
  const stack: number[] = []

  for (let i = 0; i < labels.length; i++) {
    if (labels[i] !== label || seen[i]) continue
    parts++
    seen[i] = 1
    stack.push(i)
    while (stack.length) {
      const c = stack.pop()!
      for (let d = 0; d < DIRS; d++) {
        const j = p.mesh.nbr[c * DIRS + d]
        if (j >= 0 && !seen[j] && labels[j] === label) {
          seen[j] = 1
          stack.push(j)
        }
      }
    }
  }
  return parts
}

// ── 笔刷操作 ──────────────────────────────────────────────────

/** 给一批格子上色，跳过不可涂的。返回真正改动了几格 */
export function paintCells(p: Painting, cells: readonly number[], label: number): number {
  let changed = 0
  for (const i of cells) {
    if (!p.mesh.paintable[i]) continue
    if (p.labels[i] === label) continue
    p.labels[i] = label
    changed++
  }
  return changed
}

/** 从 seed 出发，把与它同色且连通的一整片改成 label */
export function floodFill(p: Painting, seed: number, label: number): number {
  const from = p.labels[seed]
  if (from === label) return 0
  const stack = [seed]
  let changed = 0
  while (stack.length) {
    const c = stack.pop()!
    if (p.labels[c] !== from) continue
    if (!p.mesh.paintable[c]) continue
    p.labels[c] = label
    changed++
    for (let d = 0; d < DIRS; d++) {
      const j = p.mesh.nbr[c * DIRS + d]
      if (j >= 0 && p.labels[j] === from) stack.push(j)
    }
  }
  return changed
}

/**
 * 一块断成好几片时，只保留最大的那片，其余的并给周围最强势的邻居。
 *
 * 飞地在地图上是真实存在的东西（书里也画过），但绝大多数时候它是画出来的意外：
 * 笔刷擦肩而过留下的几格，或者栅格化时被另一块夹断的窄腰。
 * 并的时候从飞地边缘一圈圈往里推，所以并完的形状跟着邻居走，不会留下硬边。
 * 实在没有邻居可并的（四周全是海）就还给海。
 */
export function mergeStrayComponents(p: Painting): number {
  const { mesh } = p
  const seen = new Uint8Array(mesh.count)
  let merged = 0

  p.names.forEach((_, k) => {
    const parts: number[][] = []
    for (let i = 0; i < mesh.count; i++) {
      if (p.labels[i] !== k || seen[i]) continue
      const part: number[] = [i]
      seen[i] = 1
      for (let head = 0; head < part.length; head++) {
        const c = part[head]
        for (let d = 0; d < DIRS; d++) {
          const j = mesh.nbr[c * DIRS + d]
          if (j >= 0 && !seen[j] && p.labels[j] === k) {
            seen[j] = 1
            part.push(j)
          }
        }
      }
      parts.push(part)
    }
    if (parts.length < 2) return

    parts.sort((a, b) => b.length - a.length)
    for (const stray of parts.slice(1)) {
      merged++
      // 反复扫，让并入从飞地边缘一圈圈往里推
      for (let pass = 0; pass < 40 && stray.some((c) => p.labels[c] === k); pass++) {
        for (const c of stray) {
          if (p.labels[c] !== k) continue
          const tally = new Map<number, number>()
          for (let d = 0; d < DIRS; d++) {
            const x = labelOfNeighbor(p, c, d)
            if (x !== k) tally.set(x, (tally.get(x) ?? 0) + 1)
          }
          let best = SEA
          let bestN = 0
          for (const [x, n] of tally) {
            if (n > bestN) {
              bestN = n
              best = x
            }
          }
          if (bestN > 0) p.labels[c] = best
        }
      }
      for (const c of stray) if (p.labels[c] === k) p.labels[c] = SEA
    }
  })
  return merged
}

// ── 区域增删改 ────────────────────────────────────────────────

export function addRegion(p: Painting, name: RegionId, color: string): number {
  p.names.push(name)
  p.colors.push(color)
  return p.names.length - 1
}

/**
 * 删掉一块：它的格子还给海，后面的块号整体前移。
 * 块号是 labels 里的下标，所以删除必须同步重编号。
 */
export function removeRegionAt(p: Painting, label: number): void {
  if (label < 0 || label >= p.names.length) return
  for (let i = 0; i < p.labels.length; i++) {
    const k = p.labels[i]
    if (k === label) p.labels[i] = SEA
    else if (k > label) p.labels[i] = k - 1
  }
  p.names.splice(label, 1)
  p.colors.splice(label, 1)
}

// ── 与 GraphSpec 的往返 ───────────────────────────────────────

/** 从着色量出邻接关系。这是「用户涂出来的那张图」的唯一真相 */
export function graphFromPainting(p: Painting): GraphSpec {
  const edges: [RegionId, RegionId][] = []
  for (const key of contactsOf(p).keys()) {
    const [a, b] = unpair(key)
    const na = p.names[a]
    const nb = p.names[b]
    if (na === undefined || nb === undefined) continue
    edges.push(na < nb ? [na, nb] : [nb, na])
  }
  const colors: Record<RegionId, string> = {}
  p.names.forEach((n, i) => {
    colors[n] = p.colors[i] ?? 'gray'
  })
  return { regions: [...p.names], edges, colors }
}

export interface PaintIssue {
  kind: 'empty' | 'split' | 'tiny' | 'thin'
  text: string
}

/**
 * 涂出来的东西哪儿不像地图。
 * 这些都只是提示，不阻止操作——书里确实有很小的区域和很短的边界。
 */
export function inspect(p: Painting, minCells: number, minContact: number): PaintIssue[] {
  const out: PaintIssue[] = []
  const areas = areasOf(p)

  p.names.forEach((name, k) => {
    if (areas[k] === 0) {
      out.push({ kind: 'empty', text: `${name} 还没有涂任何格子` })
      return
    }
    if (areas[k] < minCells) {
      out.push({ kind: 'tiny', text: `${name} 只有 ${areas[k]} 格，印出来会很小` })
    }
    const parts = componentCount(p, k)
    if (parts > 1) {
      out.push({ kind: 'split', text: `${name} 断成了 ${parts} 块，不是一个连通区域` })
    }
  })

  for (const [key, n] of contactsOf(p)) {
    if (n >= minContact) continue
    const [a, b] = unpair(key)
    out.push({ kind: 'thin', text: `${p.names[a]} 与 ${p.names[b]} 只贴了 ${n} 格边，边界太短` })
  }

  return out
}

// ── 存档 ──────────────────────────────────────────────────────

export interface PaintingSnapshot {
  size: number
  width: number
  height: number
  names: RegionId[]
  colors: string[]
  /** labels 的游程编码：[值, 长度, 值, 长度, …] */
  runs: number[]
}

export function toSnapshot(p: Painting): PaintingSnapshot {
  const runs: number[] = []
  let cur = p.labels[0] ?? SEA
  let len = 0
  for (let i = 0; i < p.labels.length; i++) {
    if (p.labels[i] === cur) {
      len++
    } else {
      runs.push(cur, len)
      cur = p.labels[i]
      len = 1
    }
  }
  if (len) runs.push(cur, len)
  return {
    size: p.mesh.size,
    width: p.mesh.width,
    height: p.mesh.height,
    names: [...p.names],
    colors: [...p.colors],
    runs,
  }
}

export function isSnapshot(v: unknown): v is PaintingSnapshot {
  const s = v as Partial<PaintingSnapshot> | null
  if (!s || typeof s !== 'object') return false
  if (typeof s.size !== 'number' || typeof s.width !== 'number' || typeof s.height !== 'number') {
    return false
  }
  if (!Array.isArray(s.names) || !s.names.every((x) => typeof x === 'string')) return false
  if (!Array.isArray(s.colors) || !s.colors.every((x) => typeof x === 'string')) return false
  return Array.isArray(s.runs) && s.runs.every((x) => typeof x === 'number')
}

/**
 * 还原存档。网格由 size/width/height 重建，
 * 格数对不上就整份作废——宁可从空白开始，也别铺开一张错位的图。
 */
export function fromSnapshot(snap: PaintingSnapshot, mesh: HexMesh): Painting | null {
  if (mesh.size !== snap.size || mesh.width !== snap.width || mesh.height !== snap.height) return null
  const labels = new Int32Array(mesh.count).fill(SEA)
  let at = 0
  for (let i = 0; i + 1 < snap.runs.length; i += 2) {
    const value = snap.runs[i]
    const len = snap.runs[i + 1]
    if (len < 0 || at + len > labels.length) return null
    if (value >= snap.names.length) return null
    if (value >= 0) labels.fill(value, at, at + len)
    at += len
  }
  if (at !== labels.length) return null
  return { mesh, labels, names: [...snap.names], colors: [...snap.colors] }
}

/**
 * 换一个疏密不同的网格，把已经涂好的东西搬过去。
 * 逐格取新格中心在旧网格里落在哪一块——细→粗会丢掉窄于一格的细节，
 * 所以搬完照例要跑一遍 inspect 看看有没有把某块挤没。
 */
export function resampleOnto(p: Painting, mesh: HexMesh, cellAt: (x: number, y: number) => number): Painting {
  const labels = new Int32Array(mesh.count).fill(SEA)
  for (let i = 0; i < mesh.count; i++) {
    if (!mesh.paintable[i]) continue
    const src = cellAt(mesh.cx[i], mesh.cy[i])
    if (src >= 0) labels[i] = p.labels[src]
  }
  return { mesh, labels, names: [...p.names], colors: [...p.colors] }
}
