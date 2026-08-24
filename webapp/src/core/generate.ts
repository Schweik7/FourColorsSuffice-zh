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
import { adjacencySet, edgeKey, normalizeGraph, splitEdgeKey } from './graph'
import { makeRng } from './rng'
import { layoutGraph } from './layout'
import { growRegions, realizedAdjacency, regionAreas, regionPieceCounts } from './grow'
import { depinch, traceRaster } from './trace'
import { jitter, rdp, resample } from './smooth'

interface StyleConfig {
  cell: number
  guard: number
  /** 生长层数上限相对于平均边长的比例；null = 长满 */
  depthRatio: number | null
  /** RDP 简化阈值（以格为单位） */
  simplify: number
  /** 重采样间距（以格为单位），0 = 不重采样 */
  resample: number
  /** 抖动幅度（以格为单位） */
  jitter: number
}

const STYLE_CONFIG: Record<StyleKind, StyleConfig> = {
  // 棱角分明：长满整个画布，狠狠简化成直线多边形
  geometric: { cell: 4, guard: 3, depthRatio: null, simplify: 3.2, resample: 0, jitter: 0 },
  // 手绘地图：长到一定层数形成有机的海岸线，再加低频抖动。
  // 重采样间距别太密：控制点既是抖动的采样点，也是用户要拖的手柄，
  // 密了既难拖，抖动也会碎成高频毛刺，反而不像手画的。
  map: { cell: 3.4, guard: 3, depthRatio: 0.62, simplify: 1.1, resample: 12, jitter: 2.8 },
  // 自绘外框：在用户画的多边形里长满，其余同地图风
  frame: { cell: 3.4, guard: 3, depthRatio: null, simplify: 1.1, resample: 12, jitter: 2.2 },
}

function meanEdgeLength(graph: GraphSpec, pos: Record<RegionId, Pt>): number {
  if (!graph.edges.length) return 0
  const total = graph.edges.reduce(
    (sum, [a, b]) => sum + Math.hypot(pos[a].x - pos[b].x, pos[a].y - pos[b].y),
    0,
  )
  return total / graph.edges.length
}

function buildModel(
  graph: GraphSpec,
  opts: GenerateOptions,
  cfg: StyleConfig,
  attemptSeed: number,
): { model: MapModel; report: GenerateReport } {
  const rng = makeRng(attemptSeed)
  const { width, height, style } = opts

  const layout = layoutGraph(graph, rng, width, height)
  const meanLen = meanEdgeLength(graph, layout.pos)
  const maxDepth =
    cfg.depthRatio === null || meanLen === 0
      ? Number.POSITIVE_INFINITY
      : Math.max(4, (meanLen / cfg.cell) * cfg.depthRatio)

  const raster = growRegions(graph, layout.pos, {
    width,
    height,
    cell: cfg.cell,
    guard: cfg.guard,
    maxDepth,
    clipPolygon: style === 'frame' ? opts.framePolygon : undefined,
  })

  depinch(raster)

  // ── 校验：地图上真正做出来的邻接关系，必须与输入的图一模一样 ──
  const realized = realizedAdjacency(raster)
  const wanted = adjacencySet(graph)
  const missingEdges: [RegionId, RegionId][] = []
  const extraEdges: [RegionId, RegionId][] = []
  for (const [a, b] of graph.edges) if (!realized.has(edgeKey(a, b))) missingEdges.push([a, b])
  for (const key of realized) {
    if (!wanted.has(key)) extraEdges.push(splitEdgeKey(key))
  }

  // 被挤没了、或被撕成好几块的区域，同样算这一版没画成
  const emptyRegions = regionAreas(raster)
    .map((area, i) => (area === 0 ? graph.regions[i] : null))
    .filter((x): x is RegionId => x !== null)
  const splitRegions = regionPieceCounts(raster)
    .map((pieces, i) => (pieces > 1 ? graph.regions[i] : null))
    .filter((x): x is RegionId => x !== null)

  const traced = traceRaster(raster)

  // ── 弧段几何：简化 →（地图风）重采样 + 抖动 ──
  const arcs: ArcModel[] = traced.arcs.map((raw) => {
    let pts = rdp(raw.pts, cfg.simplify * cfg.cell)
    if (cfg.resample > 0) pts = resample(pts, cfg.resample * cfg.cell)
    if (cfg.jitter > 0) pts = jitter(pts, cfg.jitter * cfg.cell, rng)
    return {
      id: raw.id,
      n0: `n${raw.n0}`,
      n1: `n${raw.n1}`,
      mid: pts.slice(1, -1),
      left: raw.left >= 0 ? graph.regions[raw.left] : null,
      right: raw.right >= 0 ? graph.regions[raw.right] : null,
    }
  })

  // 简化与抖动都保端点不动，所以节点位置直接取原始弧段的两端，
  // 这样 arc 的端点与 node 严格重合，共享边界不会裂开缝
  const nodePos = new Map<string, Pt>()
  for (const raw of traced.arcs) {
    nodePos.set(`n${raw.n0}`, { ...raw.pts[0] })
    nodePos.set(`n${raw.n1}`, { ...raw.pts[raw.pts.length - 1] })
  }
  const nodes: NodeModel[] = [...nodePos.entries()].map(([id, p]) => ({ id, p }))

  const regions: RegionModel[] = graph.regions.map((id, i) => ({
    id,
    loops: (traced.loops.get(i) ?? []).map((loop) => ({ arcs: loop.arcs })),
    labelPos: traced.labelPos.get(i) ?? { x: width / 2, y: height / 2 },
    showLabel: true,
  }))

  const model: MapModel = {
    protocol: PROTOCOL,
    version: PROTOCOL_VERSION,
    style,
    seed: attemptSeed,
    width,
    height,
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
    dualPos: layout.pos,
  }

  const report: GenerateReport = {
    ok:
      missingEdges.length === 0 &&
      extraEdges.length === 0 &&
      splitRegions.length === 0 &&
      emptyRegions.length === 0,
    missingEdges,
    extraEdges,
    splitRegions,
    emptyRegions,
    crossings: layout.crossings,
    attempts: 1,
  }

  return { model, report }
}

/** 越小越好：缺失的邻接最要命，其次是多余的邻接与分裂的区域 */
function badness(r: GenerateReport): number {
  return (
    r.missingEdges.length * 20 +
    r.emptyRegions.length * 20 +
    r.extraEdges.length * 8 +
    r.splitRegions.length * 5 +
    r.crossings
  )
}

/**
 * 生成一张地图。内部会反复尝试不同的布局随机种子，
 * 直到地图上的邻接关系与输入的图完全吻合为止；
 * 若始终吻合不上（多半是图本身非平面），返回最接近的一版并如实报告差异。
 */
export function generateMap(graph: GraphSpec, opts: GenerateOptions, maxAttempts = 5): GenerateResult {
  const clean = normalizeGraph(graph)
  const cfg = STYLE_CONFIG[opts.style]

  let best: GenerateResult | null = null

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // 每次尝试换一个派生种子，但由 opts.seed 完全决定，保证可重现
    const seed = (opts.seed + attempt * 0x9e3779b1) >>> 0
    const { model, report } = buildModel(clean, opts, cfg, seed)
    report.attempts = attempt + 1

    const score = badness(report)
    if (!best || score < badness(best.report)) best = { model, report }
    if (report.ok) break
  }

  return best!
}

/** 一次生成若干张候选供挑选：每张用不同的种子 */
export function generateVariants(
  graph: GraphSpec,
  opts: GenerateOptions,
  count: number,
): GenerateResult[] {
  const out: GenerateResult[] = []
  for (let i = 0; i < count; i++) {
    out.push(generateMap(graph, { ...opts, seed: (opts.seed + i * 0x85ebca6b) >>> 0 }))
  }
  return out
}
