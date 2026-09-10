import type {
  ArcModel,
  GenerateOptions,
  GenerateReport,
  GenerateResult,
  GraphSpec,
  MapModel,
  NodeModel,
  Pt,
  RegionId,
  RegionModel,
  StyleKind,
} from './types'
import { PROTOCOL, PROTOCOL_VERSION } from './types'
import { edgeKey, normalizeGraph, planarityWarning } from './graph'
import { makeRng, type Rng } from './rng'
import { layoutGraph } from './layout'
import { connectedComponents, countCrossings, nonConvexFaces } from './planar'
import { constructBalanced, roundedRectPath } from './construct'
import { onionLayout } from './onion'
import { balanceAreas, tutteEmbed, vertexEdgeGap } from './tutte'
import { jitter, resample } from './smooth'

interface StyleConfig {
  /** 外框圆角半径相对短边的比例 */
  cornerRatio: number
  /** 边界重采样间距（模型单位），0 = 不重采样 */
  resample: number
  /** 手绘抖动幅度（模型单位） */
  jitter: number
}

const STYLE_CONFIG: Record<StyleKind, StyleConfig> = {
  // 嵌套色带：圆角外框，边界基本笔直，只带一点点手抖
  bands: { cornerRatio: 0.42, resample: 34, jitter: 1.6 },
  // 规整几何：直角外框、纯直线边界
  geometric: { cornerRatio: 0.06, resample: 0, jitter: 0 },
  // 地图手绘：圆角外框 + 明显的手绘抖动
  map: { cornerRatio: 0.5, resample: 22, jitter: 5.5 },
  // 自绘外框：外框由用户给出，其余同地图风
  frame: { cornerRatio: 0.5, resample: 22, jitter: 5.5 },
}

/**
 * 外圈顶点钉在外框的百分之多少处。
 * 剩下的那一圈环带留给最外层的区域——太大内部会挤，太小外圈会变成细边。
 */
const OUTER_RING = 0.66

/** 把若干连通分量排成接近正方的网格，各占一格 */
function islandGrid(count: number, width: number, height: number) {
  const cols = Math.ceil(Math.sqrt(count))
  const rows = Math.ceil(count / cols)
  return { cols, rows, cellW: width / cols, cellH: height / rows }
}

/**
 * 给一个连通分量求无交叉的直线画法。
 *
 * 先试洋葱布局（分层同心，观感最接近书里的插图，而且完全确定）；
 * 不行再退回力导向 + 消交叉。
 *
 * **判据不能只看交叉数。** 顶点滑到一条不相邻的边上面时，边与边并没有真正相交，
 * 交叉数照样是 0，可那个顶点周围已经有面被压成零面积了。重心细分要求面心落在
 * 面内，面一旦退化，绕顶点的那一圈扇形就会翻面叠在一起——组合上仍然「环闭合、
 * 弧两侧对得上」，几何上却是一团互相盖住的乱麻。复杂的图之所以画出来特别奇怪，
 * 根子就在这里。所以还要看顶点离非邻接边有多远，退化的画法一律不用。
 */
function drawComponent(
  graph: GraphSpec,
  rng: Rng,
  cell: { width: number; height: number; ox: number; oy: number },
  margin: number,
  innerFrame: Pt[],
): { pos: Record<RegionId, Pt>; crossings: number } {
  const { width, height, ox, oy } = cell

  /**
   * 候选画法的好坏，依次比：交叉数 → 凹面数 → 顶点离非邻接边的距离。
   * 前两项决定构造出来的地图对不对，第三项只是同分时挑个稳当的。
   */
  type Draft = { pos: Record<RegionId, Pt>; crossings: number; concave: number; gap: number }
  const rate = (pos: Record<RegionId, Pt>): Draft => ({
    pos,
    crossings: countCrossings(graph, pos),
    concave: nonConvexFaces(graph, pos),
    gap: vertexEdgeGap(graph, pos),
  })
  const better = (a: Draft, b: Draft) =>
    a.crossings !== b.crossings
      ? a.crossings - b.crossings
      : a.concave !== b.concave
        ? a.concave - b.concave
        : b.gap - a.gap

  // 第一步：先求一张能用的画法，供 Tutte 认出外面
  const drafts: Draft[] = []
  const viaOnion = onionLayout(graph, width, height, margin)
  if (viaOnion) drafts.push(rate(viaOnion.pos))
  // 洋葱那版已经完美就不动力导向了：它要消耗随机数
  if (!drafts.length || drafts[0].crossings > 0 || drafts[0].concave > 0) {
    drafts.push(rate(layoutGraph(graph, rng, width, height).pos))
  }
  drafts.sort(better)
  const first = drafts[0]
  if (!first) return { pos: {}, crossings: 0 }

  // 上面两路都在 (0,0)–(width,height) 里算，统一挪到本格的绝对位置，
  // 后面 Tutte 用的内缩框是绝对坐标，两边必须对齐
  shift(first.pos, ox, oy)
  if (first.crossings > 0) return { pos: first.pos, crossings: first.crossings }

  // 第二步：把外面钉到内缩框上做 Tutte 松弛，让各个面摊得均匀。
  // 重心细分里区域面积随面的面积走，面均匀了区域才不会被挤成细条。
  // 第三步：Tutte 保证了面是凸的但没保证大小均匀，再把区域面积拉平。
  //
  // 三张一起进候选池按同一把尺子挑，而不是「达标就用、不达标退回上一步」——
  // 后者会在 Tutte 明明更好、只是没到阈值时，退回一张更差的画法。
  const finals: Draft[] = [{ ...first, pos: first.pos }]
  const relaxed = tutteEmbed(graph, first.pos, innerFrame)
  if (relaxed && relaxed.crossings === 0 && relaxed.spread > 0.012) {
    finals.push(rate(relaxed.pos))
    finals.push(rate(balanceAreas(graph, relaxed)))
  }
  finals.sort(better)
  return { pos: finals[0].pos, crossings: finals[0].crossings }
}

/** 平移一组坐标 */
function shift(pos: Record<RegionId, Pt>, dx: number, dy: number) {
  for (const p of Object.values(pos)) {
    p.x += dx
    p.y += dy
  }
}

/**
 * 自检：区域的每条边界环必须首尾相接，且弧两侧的区域对必须恰好等于图里的边。
 * 构造本身已经保证了这两点，这里是防止将来改坏的断言。
 */
export function verifyTopology(
  graph: GraphSpec,
  arcs: ArcModel[],
  regions: RegionModel[],
  nodes: NodeModel[],
) {
  const nodeIds = new Set(nodes.map((n) => n.id))
  const byId = new Map(arcs.map((a) => [a.id, a]))
  const problems: string[] = []

  for (const region of regions) {
    for (const loop of region.loops) {
      let expected: string | null = null
      for (const ref of loop.arcs) {
        const arc = byId.get(ref.arc)
        if (!arc) {
          problems.push(`${region.id} 引用了不存在的弧 ${ref.arc}`)
          break
        }
        const start = ref.rev ? arc.n1 : arc.n0
        const end = ref.rev ? arc.n0 : arc.n1
        if (!nodeIds.has(start) || !nodeIds.has(end)) {
          problems.push(`${region.id} 的弧 ${ref.arc} 端点不在节点表里`)
          break
        }
        if (expected !== null && start !== expected) {
          problems.push(`${region.id} 的边界环断开于 ${ref.arc}`)
          break
        }
        expected = end
      }
      const first = loop.arcs[0]
      if (first && expected !== null) {
        const arc = byId.get(first.arc)!
        const firstStart = first.rev ? arc.n1 : arc.n0
        if (firstStart !== expected) problems.push(`${region.id} 的边界环没有闭合`)
      }
    }
  }

  const realized = new Set<string>()
  for (const arc of arcs) {
    if (arc.left && arc.right) realized.add(edgeKey(arc.left, arc.right))
  }
  const wanted = new Set(graph.edges.map(([a, b]) => edgeKey(a, b)))
  for (const key of wanted) if (!realized.has(key)) problems.push(`邻接 ${key} 没有做出来`)
  for (const key of realized) if (!wanted.has(key)) problems.push(`多出了邻接 ${key}`)

  return problems
}

/**
 * 生成地图。
 *
 * 流程是确定性的：求一张无交叉的直线画法 → 重心细分构造。
 * 第二步不会失败，所以不存在「多生成几张碰运气」这回事；
 * 唯一可能出问题的是第一步找不到无交叉画法，那说明图非平面。
 * seed 只影响手绘抖动和力导向兜底那一路，不影响拓扑正确性。
 */
export function generateMap(graph: GraphSpec, opts: GenerateOptions): GenerateResult {
  const clean = normalizeGraph(graph)
  const cfg = STYLE_CONFIG[opts.style]
  const rng = makeRng(opts.seed)
  const { width, height, style } = opts

  const parts = connectedComponents(clean)
  const nodes: NodeModel[] = []
  const arcs: ArcModel[] = []
  const regions: RegionModel[] = []
  const dualPos: Record<RegionId, Pt> = {}
  let crossings = 0

  const { cols, cellW, cellH } = islandGrid(parts.length, width, height)
  const margin = Math.min(cellW, cellH) * 0.09

  parts.forEach((part, i) => {
    const ox = (i % cols) * cellW
    const oy = Math.floor(i / cols) * cellH
    const cx = ox + cellW / 2
    const cy = oy + cellH / 2
    const halfW = cellW / 2 - margin
    const halfH = cellH / 2 - margin
    const corner = Math.min(cellW, cellH) * cfg.cornerRatio * 0.5

    const frame =
      style === 'frame' && opts.framePolygon && opts.framePolygon.length >= 3 && parts.length === 1
        ? opts.framePolygon
        : roundedRectPath(cx, cy, halfW, halfH, corner, 14)

    // 外圈顶点钉在内缩的一圈上，不是直接钉在外框上——
    // 中间留出的这条环带就是最外层那些区域的地盘，
    // 钉在外框上的话它们会被压成没有厚度的一条线。
    const inner = roundedRectPath(cx, cy, halfW * OUTER_RING, halfH * OUTER_RING, corner * OUTER_RING, 14)

    const drawn = drawComponent(part, rng, { width: cellW, height: cellH, ox, oy }, margin * 2.2, inner)
    crossings += drawn.crossings

    const built = constructBalanced(part, drawn.pos, frame, `c${i}`)
    nodes.push(...built.nodes)
    arcs.push(...built.arcs)
    regions.push(...built.regions)
    Object.assign(dualPos, drawn.pos)
  })

  // ── 边界修饰：重采样后加低频抖动，营造手绘感 ──
  // 端点不动，所以相邻区域共用的那条边界仍然严丝合缝
  const styled: ArcModel[] = arcs.map((arc) => {
    if (!cfg.resample && !cfg.jitter) return arc
    const p0 = nodes.find((n) => n.id === arc.n0)!.p
    const p1 = nodes.find((n) => n.id === arc.n1)!.p
    let pts = [p0, ...arc.mid, p1]
    if (cfg.resample > 0) pts = resample(pts, cfg.resample)
    if (cfg.jitter > 0) pts = jitter(pts, cfg.jitter, rng)
    return { ...arc, mid: pts.slice(1, -1) }
  })

  const problems = verifyTopology(clean, styled, regions, nodes)
  const planarNote = planarityWarning(clean)

  const model: MapModel = {
    protocol: PROTOCOL,
    version: PROTOCOL_VERSION,
    style,
    seed: opts.seed,
    width,
    height,
    graph: clean,
    nodes,
    arcs: styled,
    regions,
    strokeColor: '#2f2f2f',
    strokeWidth: 2,
    labelSize: 22,
    labelColor: 'auto',
    seaColor: null,
    showDual: false,
    dualPos,
  }

  const report: GenerateReport = {
    ok: crossings === 0 && problems.length === 0,
    crossings,
    problems,
    nonPlanarHint: planarNote,
  }

  return { model, report }
}

/**
 * 一次生成若干张候选。
 *
 * 拓扑由构造保证，各张之间差别只在观感：不同的抖动、以及交叉数不为 0 时
 * 力导向兜底给出的不同画法。所以候选之间「全对或全错」，不会出现有的合法有的不合法。
 */
export function generateVariants(
  graph: GraphSpec,
  opts: GenerateOptions,
  count: number,
): GenerateResult[] {
  const out: GenerateResult[] = []
  for (let i = 0; i < count; i++) {
    out.push(generateMap(graph, { ...opts, seed: (opts.seed + i * 0x9e3779b1) >>> 0 }))
  }
  return out
}

/** 图能不能画成地图，以及画不成的原因 */
export function diagnose(graph: GraphSpec, width: number, height: number): string | null {
  const clean = normalizeGraph(graph)
  const hint = planarityWarning(clean)
  if (hint) return hint

  const rng = makeRng(1)
  for (const part of connectedComponents(clean)) {
    const inner = roundedRectPath(width / 2, height / 2, width * 0.33, height * 0.33, 40, 14)
    const drawn = drawComponent(part, rng, { width, height, ox: 0, oy: 0 }, 40, inner)
    if (drawn.crossings > 0) {
      const left = countCrossings(part, drawn.pos)
      return `找不到无交叉的画法（还剩 ${left} 处交叉）——这个图多半不是平面图，画不出对应的地图。`
    }
  }
  return null
}
