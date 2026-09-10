/**
 * 着色 → 地图模型。
 *
 * 把「每格属于哪一块」翻译成现有的 节点/弧/区域 三件套，
 * 于是渲染、手工微调、SVG 导出全都原样复用，不必为涂色模式另起一套。
 *
 * 之所以能干净地翻译，全靠六边形网格的那条性质（见 mesh.ts）：
 * **每个角点恰好由三个格子共用**。由此
 *
 *  - 边界图里顶点的度数只可能是 0、2、3。度数 3 就是三块碰头的交汇点，
 *    正是弧该断开的地方；度数 2 是弧的内部。
 *  - 绕任何一块走时，每个角点恰好进一次出一次，所以边界一定是若干条
 *    互不相交的简单闭曲线，不会出现自己掐自己、要靠人为约定拆开的夹断点。
 *
 * 弧是全局只描一次的，两侧区域引用的是同一条，所以共享边界的几何严丝合缝——
 * 后面拖控制点时也仍然是两边一起动。
 */

import type { ArcModel, MapModel, NodeModel, Pt, RegionId, RegionModel, StyleKind } from './types'
import { PROTOCOL, PROTOCOL_VERSION } from './types'
import { DIRS } from './mesh'
import { SEA, graphFromPainting, labelOfNeighbor, type Painting } from './paint'
import { chaikinClosed, chaikinOpen, resample, taubin } from './smooth'

export interface TraceOptions {
  /** Chaikin 磨角轮数。0 = 保留六边形折线的原样 */
  smooth: number
  /**
   * 磨完之后重采样的控制点间距，相对格子边长。
   *
   * 这里必须等距重采样，不能用 RDP 简化。渲染端画的是**均匀参数化**的
   * Catmull–Rom：控制点疏密不均时，密处的切线会被稀处的间距放大，曲线就在
   * 直边上甩出一串小波浪。RDP 恰好制造疏密不均（弯处密、直处疏），于是磨完角
   * 反而更抖。等距点则让每段的参数长度一致，画出来才是干净的。
   */
  spacing: number
  style: StyleKind
  seed: number
}

export const DEFAULT_TRACE: TraceOptions = { smooth: 3, spacing: 1.1, style: 'map', seed: 1 }

export interface TraceResult {
  model: MapModel
  warnings: string[]
}

/** 描出来的一条弧，先用顶点号表示 */
interface RawArc {
  verts: number[]
  left: number
  right: number
}

export function traceToModel(p: Painting, opts: TraceOptions = DEFAULT_TRACE): TraceResult {
  const { mesh } = p
  const warnings: string[] = []

  // ── 1. 收集边界格边 ──
  // 每条只从格号小的那侧记一次；按角点 d → d+1 的方向走，格子 i 落在右边。
  const ea: number[] = []
  const eb: number[] = []
  const eRight: number[] = []
  const eLeft: number[] = []

  for (let i = 0; i < mesh.count; i++) {
    const k = p.labels[i]
    for (let d = 0; d < DIRS; d++) {
      const j = mesh.nbr[i * DIRS + d]
      if (j >= 0 && j < i) continue
      const l = j < 0 ? SEA : p.labels[j]
      if (l === k) continue
      ea.push(mesh.corner[i * DIRS + d])
      eb.push(mesh.corner[i * DIRS + ((d + 1) % DIRS)])
      eRight.push(k)
      eLeft.push(l)
    }
  }
  const edgeCount = ea.length

  // ── 2. 顶点上挂的边界边。度数至多 3，所以定长三槽就够 ──
  const SLOTS = 3
  const vdeg = new Int32Array(mesh.vertCount)
  const vinc = new Int32Array(mesh.vertCount * SLOTS).fill(-1)
  const attach = (v: number, e: number) => {
    if (vdeg[v] < SLOTS) vinc[v * SLOTS + vdeg[v]] = e
    vdeg[v]++
  }
  for (let e = 0; e < edgeCount; e++) {
    attach(ea[e], e)
    attach(eb[e], e)
  }

  const isJunction = (v: number) => vdeg[v] >= SLOTS
  const other = (e: number, v: number) => (ea[e] === v ? eb[e] : ea[e])
  const nextEdgeAt = (v: number, from: number): number => {
    for (let s = 0; s < vdeg[v] && s < SLOTS; s++) {
      const e = vinc[v * SLOTS + s]
      if (e >= 0 && e !== from) return e
    }
    return -1
  }

  // ── 3. 描弧：从交汇点出发，一路穿过度数 2 的顶点，到下一个交汇点为止 ──
  const used = new Uint8Array(edgeCount)
  const raw: RawArc[] = []

  const walk = (startV: number, startE: number, stopAtStart: boolean): RawArc => {
    const verts = [startV]
    let prev = startV
    let e = startE
    for (let guard = 0; guard <= edgeCount; guard++) {
      used[e] = 1
      const next = other(e, prev)
      verts.push(next)
      if (stopAtStart ? next === startV : isJunction(next)) break
      const cand = nextEdgeAt(next, e)
      if (cand < 0 || used[cand]) break
      prev = next
      e = cand
    }
    // 弧上每条边分隔的都是同一对块（内部顶点度数 2，周围只有两种颜色），
    // 所以取首条边的左右即可；方向按 startV 是不是首条边的起点来定
    const forward = ea[startE] === startV
    return { verts, left: forward ? eLeft[startE] : eRight[startE], right: forward ? eRight[startE] : eLeft[startE] }
  }

  for (let v = 0; v < mesh.vertCount; v++) {
    if (!isJunction(v)) continue
    for (let s = 0; s < SLOTS; s++) {
      const e = vinc[v * SLOTS + s]
      if (e < 0 || used[e]) continue
      raw.push(walk(v, e, false))
    }
  }
  // 剩下的都是整条不碰交汇点的闭曲线（比如一块被另一块完全包住）
  for (let e = 0; e < edgeCount; e++) {
    if (used[e]) continue
    raw.push(walk(ea[e], e, true))
  }

  // ── 4. 顶点 → 节点、弧 → ArcModel ──
  const nodes: NodeModel[] = []
  const nodeOf = new Map<number, string>()
  const nodeId = (v: number): string => {
    const hit = nodeOf.get(v)
    if (hit) return hit
    const id = `pn${nodes.length}`
    nodes.push({ id, p: { x: mesh.vx[v], y: mesh.vy[v] } })
    nodeOf.set(v, id)
    return id
  }

  const step = mesh.size * opts.spacing
  const nameOf = (k: number): RegionId | null => (k >= 0 ? (p.names[k] ?? null) : null)

  // 磨角先压最高频的六边形锯齿，重采样把控制点摊匀，
  // 最后 Taubin 压掉外框量化出来的低频阶梯——三步各治一段频率，缺一不可
  const chaikinRounds = Math.min(opts.smooth, 2)
  const taubinPasses = opts.smooth * opts.smooth * 4

  const shape = (pts: Pt[], closed: boolean): Pt[] => {
    let cur = closed
      ? chaikinClosed(pts.slice(0, -1), chaikinRounds)
      : chaikinOpen(pts, chaikinRounds)
    if (closed) cur = [...cur, cur[0]]
    if (step > 0 && cur.length > 2) {
      // resample 保两端，所以闭合弧仍然闭合、共享弧的接头仍然严丝合缝
      const even = resample(cur, step)
      if (even.length >= 2) cur = even
    }
    if (taubinPasses > 0 && cur.length > 3) {
      if (closed) {
        const body = taubin(cur.slice(0, -1), taubinPasses, true)
        cur = [...body, body[0]]
      } else {
        cur = taubin(cur, taubinPasses, false)
      }
    }
    return cur
  }

  const arcs: ArcModel[] = raw.map((a, idx) => {
    const closed = a.verts[0] === a.verts[a.verts.length - 1]
    const pts: Pt[] = a.verts.map((v) => ({ x: mesh.vx[v], y: mesh.vy[v] }))
    const shaped = shape(pts, closed)
    return {
      id: `pa${idx}`,
      n0: nodeId(a.verts[0]),
      n1: nodeId(a.verts[a.verts.length - 1]),
      mid: shaped.slice(1, -1),
      left: nameOf(a.left),
      right: nameOf(a.right),
    }
  })

  // 格边 → 弧号，用来把区域的环拆成弧引用
  const arcOfEdge = new Map<number, number>()
  const edgeKeyOf = (x: number, y: number) => (x < y ? x * mesh.vertCount + y : y * mesh.vertCount + x)
  raw.forEach((a, idx) => {
    for (let i = 0; i + 1 < a.verts.length; i++) {
      arcOfEdge.set(edgeKeyOf(a.verts[i], a.verts[i + 1]), idx)
    }
  })

  // ── 5. 每块的边界环 ──
  // 绕一块走时，格子在行进方向的右侧（见 mesh.ts 的定向约定）。
  // 每个角点最多两个格子属于同一块，所以每块在每个角点上恰好有一条出边——
  // 串环不需要任何选择，也就不会走岔。
  const nextOf = new Int32Array(mesh.vertCount).fill(-1)
  const regions: RegionModel[] = []
  const poles = poleCells(p)

  p.names.forEach((name, k) => {
    const touched: number[] = []
    for (let i = 0; i < mesh.count; i++) {
      if (p.labels[i] !== k) continue
      for (let d = 0; d < DIRS; d++) {
        if (labelOfNeighbor(p, i, d) === k) continue
        const from = mesh.corner[i * DIRS + d]
        nextOf[from] = mesh.corner[i * DIRS + ((d + 1) % DIRS)]
        touched.push(from)
      }
    }

    const loops: RegionModel['loops'] = []
    const seen = new Set<number>()
    for (const start of touched) {
      if (seen.has(start)) continue
      const loop: number[] = []
      let v = start
      for (let guard = 0; guard <= touched.length + 1; guard++) {
        if (seen.has(v)) break
        seen.add(v)
        loop.push(v)
        const nx = nextOf[v]
        if (nx < 0) break
        v = nx
        if (v === start) break
      }
      if (loop.length >= 3) {
        const refs = loopToArcs(loop, arcOfEdge, edgeKeyOf, raw, arcs, isJunction)
        if (refs) loops.push({ arcs: refs })
        else warnings.push(`${name} 的边界环没能拆成弧，这张图先别用`)
      }
    }

    for (const v of touched) nextOf[v] = -1

    const pole = poles[k]
    regions.push({
      id: name,
      loops,
      labelPos: pole >= 0 ? { x: mesh.cx[pole], y: mesh.cy[pole] } : { x: mesh.width / 2, y: mesh.height / 2 },
      showLabel: true,
    })
  })

  const graph = graphFromPainting(p)
  const dualPos: Record<RegionId, Pt> = {}
  p.names.forEach((name, k) => {
    const pole = poles[k]
    if (pole >= 0) dualPos[name] = { x: mesh.cx[pole], y: mesh.cy[pole] }
  })

  const model: MapModel = {
    protocol: PROTOCOL,
    version: PROTOCOL_VERSION,
    style: opts.style,
    seed: opts.seed,
    width: mesh.width,
    height: mesh.height,
    graph,
    nodes,
    arcs,
    regions,
    strokeColor: '#2f2f2f',
    strokeWidth: 2,
    labelSize: 22,
    labelColor: 'auto',
    seaColor: null,
    showDual: false,
    dualPos,
  }

  return { model, warnings }
}

/**
 * 把一条顶点环拆成弧引用。
 * 先转到某个交汇点开头，环就正好是若干条完整的弧首尾相接，逐条按长度切下去即可。
 */
function loopToArcs(
  loop: number[],
  arcOfEdge: Map<number, number>,
  edgeKeyOf: (a: number, b: number) => number,
  raw: RawArc[],
  arcs: ArcModel[],
  isJunction: (v: number) => boolean,
): { arc: string; rev: boolean }[] | null {
  const at = loop.findIndex(isJunction)
  const rot = at > 0 ? [...loop.slice(at), ...loop.slice(0, at)] : loop
  const out: { arc: string; rev: boolean }[] = []

  let i = 0
  while (i < rot.length) {
    const a = rot[i]
    const b = rot[(i + 1) % rot.length]
    const idx = arcOfEdge.get(edgeKeyOf(a, b))
    if (idx === undefined) return null
    const verts = raw[idx].verts
    // 正向的判据要同时看头两个顶点：有的弧两端是同一个交汇点，只看端点分不清方向
    out.push({ arc: arcs[idx].id, rev: !(verts[0] === a && verts[1] === b) })
    i += verts.length - 1
  }
  return out
}

/**
 * 每块的「最深处」格子，用来放标签。
 *
 * 从这块所有贴着别人的格子同时向内做 BFS，走得最远的那格离边界最远。
 * 这是离散版的极点距离，对细长、带洞、被包住的怪形状都给得出合理位置——
 * 用重心的话标签会掉到区域外面去。
 */
export function poleCells(p: Painting): Int32Array {
  const { mesh, labels } = p
  const out = new Int32Array(p.names.length).fill(-1)
  const dist = new Int32Array(mesh.count).fill(-1)
  const queue: number[] = []

  for (let i = 0; i < mesh.count; i++) {
    const k = labels[i]
    if (k < 0) continue
    for (let d = 0; d < DIRS; d++) {
      if (labelOfNeighbor(p, i, d) !== k) {
        dist[i] = 0
        queue.push(i)
        break
      }
    }
  }

  const best = new Int32Array(p.names.length).fill(-1)
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head]
    const k = labels[i]
    if (dist[i] > best[k]) {
      best[k] = dist[i]
      out[k] = i
    }
    for (let d = 0; d < DIRS; d++) {
      const j = mesh.nbr[i * DIRS + d]
      if (j >= 0 && dist[j] < 0 && labels[j] === k) {
        dist[j] = dist[i] + 1
        queue.push(j)
      }
    }
  }
  return out
}
