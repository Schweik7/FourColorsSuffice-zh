import type { GraphSpec, Pt, RegionId } from './types'
import { edgeKey } from './graph'

export const SEA = -1
/** 不可生长（画布外 / 用户外框之外） */
export const BLOCKED = -2

export interface Raster {
  W: number
  H: number
  /** 一格 = 多少模型单位 */
  cell: number
  owner: Int16Array
  ids: RegionId[]
}

export interface GrowParams {
  width: number
  height: number
  cell: number
  /** 冲突检查的切比雪夫半径：决定不相邻区域之间水道的宽度 */
  guard: number
  /** 生长的最大层数；Infinity = 一直长到填满可生长区域 */
  maxDepth: number
  /** 只在这个多边形内生长（frame 风格） */
  clipPolygon?: Pt[]
}

function pointInPolygon(p: Pt, poly: Pt[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]
    const b = poly[j]
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside
    }
  }
  return inside
}

/**
 * 播种。
 *
 * 顶点摊成圆盘，边（可选地）摊成一条纵向劈成两半的带子——两半分属两个端点，
 * 于是它们沿中线相接。后者是「每个平面图都是某张地图的邻接图」的标准构造，
 * 能强行做出任何一条需要的邻接关系。
 *
 * 但带子会在成图上留下一条从这头戳到那头的细长「蜘蛛腿」，很难看。
 * 所以这里只给 `ribbonEdges` 里点名的边铺带子：调用方先只用圆盘种子长一遍，
 * 看哪些邻接关系没自然长出来，再回头单独给那几条补带子。
 * 绝大多数边靠圆盘扩张就能自然贴上，成图因此是块面感的。
 */
function seed(
  raster: Raster,
  graph: GraphSpec,
  pos: Record<RegionId, Pt>,
  idx: Record<RegionId, number>,
  frozen: Uint8Array,
  ribbonEdges: ReadonlySet<string>,
) {
  const { W, H, cell, owner } = raster
  const px = (p: Pt) => ({ x: p.x / cell, y: p.y / cell })

  const put = (gx: number, gy: number, v: number) => {
    const x = Math.round(gx)
    const y = Math.round(gy)
    if (x < 0 || y < 0 || x >= W || y >= H) return
    const i = y * W + x
    if (owner[i] === BLOCKED) return
    owner[i] = v
    // 骨架格永不参与后续的平滑改写——它才是「邻接关系成立」的依据
    frozen[i] = 1
  }

  // 每个顶点上相邻两条边的最小夹角 → 决定该端点处带子的收敛速度
  const minAngle: Record<RegionId, number> = {}
  for (const id of graph.regions) {
    const dirs = graph.edges
      .filter(([a, b]) => a === id || b === id)
      .map(([a, b]) => {
        const other = a === id ? b : a
        return Math.atan2(pos[other].y - pos[id].y, pos[other].x - pos[id].x)
      })
      .sort((a, b) => a - b)
    if (dirs.length < 2) {
      minAngle[id] = Math.PI
      continue
    }
    let best = Infinity
    for (let i = 0; i < dirs.length; i++) {
      const next = dirs[(i + 1) % dirs.length]
      let d = next - dirs[i]
      if (i === dirs.length - 1) d += 2 * Math.PI
      best = Math.min(best, d)
    }
    minAngle[id] = best
  }

  const lengths = graph.edges.map(([a, b]) => Math.hypot(pos[a].x - pos[b].x, pos[a].y - pos[b].y))
  const shortest = lengths.length ? Math.min(...lengths) : Math.min(W, H) * cell * 0.5

  /**
   * 骨架尺寸受「净空」约束。
   * 粗骨架才有地图的块面感（细骨架长出来的是蜘蛛腿），但粗过头会闯祸：
   * 布局难免把某个顶点摆得离一条与它无关的边很近，圆盘一大就盖穿那条边带，
   * 把边带两侧区域各切成两截。所以每处的尺寸都要按各自的净空单独收敛。
   */
  const clearanceToSegment = (p: Pt, a: Pt, b: Pt): number => {
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len2 = dx * dx + dy * dy
    if (len2 < 1e-9) return Math.hypot(p.x - a.x, p.y - a.y)
    let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2
    t = Math.max(0, Math.min(1, t))
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
  }

  /** 顶点到所有与它无关的边、以及到其它顶点的最小距离 */
  const vertexClearance = (id: RegionId): number => {
    let best = Infinity
    for (const [a, b] of graph.edges) {
      if (a === id || b === id) continue
      best = Math.min(best, clearanceToSegment(pos[id], pos[a], pos[b]))
    }
    for (const other of graph.regions) {
      if (other === id) continue
      best = Math.min(best, Math.hypot(pos[id].x - pos[other].x, pos[id].y - pos[other].y) / 2)
    }
    return Number.isFinite(best) ? best : shortest
  }

  /** 边到所有不在它两端的顶点的最小距离 */
  const edgeClearance = (a: RegionId, b: RegionId): number => {
    let best = Infinity
    for (const v of graph.regions) {
      if (v === a || v === b) continue
      best = Math.min(best, clearanceToSegment(pos[v], pos[a], pos[b]))
    }
    return Number.isFinite(best) ? best : shortest
  }

  const diskR: Record<RegionId, number> = {}
  for (const id of graph.regions) {
    const incident = graph.edges
      .filter(([a, b]) => a === id || b === id)
      .map(([a, b]) => Math.hypot(pos[a].x - pos[b].x, pos[a].y - pos[b].y))
    const shortestIncident = incident.length ? Math.min(...incident) : shortest
    diskR[id] = Math.max(
      2.2,
      Math.min(shortestIncident * 0.32, vertexClearance(id) * 0.5) / cell,
    )
  }

  // 先铺带子，再盖顶点圆盘（圆盘要压在带子的根部之上）
  for (const [a, b] of graph.edges) {
    if (!ribbonEdges.has(edgeKey(a, b))) continue
    const pa = px(pos[a])
    const pb = px(pos[b])
    const dx = pb.x - pa.x
    const dy = pb.y - pa.y
    const len = Math.hypot(dx, dy)
    if (len < 1e-6) continue
    const ux = dx / len
    const uy = dy / len
    // 法向：s < 0 归 a，s > 0 归 b
    const nx = -uy
    const ny = ux
    const taperA = Math.min(0.34, 0.44 * minAngle[a])
    const taperB = Math.min(0.34, 0.44 * minAngle[b])
    // 补出来的带子只求「接上」，细一点才不显眼；同时不能挤到附近无关的顶点
    const maxHalfWidth = Math.max(
      1.2,
      Math.min(shortest * 0.09, edgeClearance(a, b) * 0.32) / cell,
    )

    for (let d = 0; d <= len; d += 0.45) {
      const w = Math.min(maxHalfWidth, Math.min(taperA * d, taperB * (len - d)) + 0.75)
      const cx = pa.x + ux * d
      const cy = pa.y + uy * d
      for (let s = -w; s <= w; s += 0.45) {
        put(cx + nx * s, cy + ny * s, s < 0 ? idx[a] : idx[b])
      }
    }
  }

  for (const id of graph.regions) {
    const c = px(pos[id])
    const r = diskR[id]
    for (let gy = -r; gy <= r; gy += 0.45) {
      const half = Math.sqrt(Math.max(0, r * r - gy * gy))
      for (let gx = -half; gx <= half; gx += 0.45) {
        put(c.x + gx, c.y + gy, idx[id])
      }
    }
  }
}

function growOnce(
  graph: GraphSpec,
  pos: Record<RegionId, Pt>,
  params: GrowParams,
  ribbonEdges: ReadonlySet<string>,
): Raster {
  const { width, height, cell, guard, maxDepth } = params
  const W = Math.max(4, Math.round(width / cell))
  const H = Math.max(4, Math.round(height / cell))
  const ids = [...graph.regions]
  const n = ids.length
  const idx: Record<RegionId, number> = {}
  ids.forEach((id, i) => (idx[id] = i))

  const owner = new Int16Array(W * H).fill(SEA)
  const raster: Raster = { W, H, cell, owner, ids }

  if (params.clipPolygon && params.clipPolygon.length >= 3) {
    const poly = params.clipPolygon
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const p = { x: (x + 0.5) * cell, y: (y + 0.5) * cell }
        if (!pointInPolygon(p, poly)) owner[y * W + x] = BLOCKED
      }
    }
  }

  if (!n) return raster

  // allow[i*n+j] = 区域 i、j 允许贴在一起
  const allow = new Uint8Array(n * n)
  for (let i = 0; i < n; i++) allow[i * n + i] = 1
  for (const [a, b] of graph.edges) {
    allow[idx[a] * n + idx[b]] = 1
    allow[idx[b] * n + idx[a]] = 1
  }

  const frozen = new Uint8Array(W * H)
  seed(raster, graph, pos, idx, frozen, ribbonEdges)

  /**
   * 能不能把 (x,y) 判给区域 r：
   * 以它为中心、切比雪夫半径 guard 的方块内，不许出现与 r 不相邻的区域。
   * 这一条就是整套算法的地基——它保证地图上不会冒出图里没有的邻接关系。
   * 半径取 guard 而不是 1，是为了让不相邻的两块之间留出一条看得见的水道。
   */
  const canClaim = (x: number, y: number, r: number): boolean => {
    const x0 = Math.max(0, x - guard)
    const x1 = Math.min(W - 1, x + guard)
    const y0 = Math.max(0, y - guard)
    const y1 = Math.min(H - 1, y + guard)
    for (let yy = y0; yy <= y1; yy++) {
      for (let xx = x0; xx <= x1; xx++) {
        const o = owner[yy * W + xx]
        if (o < 0 || o === r) continue
        if (!allow[o * n + r]) return false
      }
    }
    return true
  }

  // ── 按面积均衡的分轮扩张 ──
  // 单纯的同步 BFS 会让被围住的区域永远长不大（它的边带两半彼此贴死，谁也胀不开），
  // 结果就是一堆细长的「蜘蛛腿」。改成每轮只让面积最小的那几个区域各长一层，
  // 各区域的面积就能大致拉平，形状也就有了块面感。
  const areas = new Array<number>(n).fill(0)
  const frontier: number[][] = Array.from({ length: n }, () => [])
  const depth = new Array<number>(n).fill(0)
  for (let i = 0; i < owner.length; i++) {
    const o = owner[i]
    if (o < 0) continue
    areas[o]++
    frontier[o].push(i)
  }

  const expandOneLayer = (r: number) => {
    const next: number[] = []
    for (const i of frontier[r]) {
      const x = i % W
      const y = (i - x) / W
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
        const j = ny * W + nx
        if (owner[j] !== SEA) continue
        if (!canClaim(nx, ny, r)) continue
        owner[j] = r
        areas[r]++
        next.push(j)
      }
    }
    frontier[r] = next
    depth[r]++
  }

  for (let round = 0; round < 4000; round++) {
    const active: number[] = []
    for (let r = 0; r < n; r++) {
      if (frontier[r].length && depth[r] < maxDepth) active.push(r)
    }
    if (!active.length) break

    const minArea = Math.min(...active.map((r) => areas[r]))
    // 面积明显领先的先歇一轮，等落后的追上来
    const laggards = active.filter((r) => areas[r] <= minArea * 1.35 + 40)
    for (const r of laggards) expandOneLayer(r)
  }

  smoothOwners(raster, frozen, canClaim)
  return raster
}

/**
 * 生成地图栅格。
 *
 * 先只播圆盘种子长一遍——这样长出来的是有块面感的地图。
 * 然后看有哪些该有的邻接没自然长出来，只给那几条边补一条细带子再重来，
 * 最多补三轮。绝大多数图第一轮就成，一条带子都不用补。
 */
export function growRegions(
  graph: GraphSpec,
  pos: Record<RegionId, Pt>,
  params: GrowParams,
): Raster {
  const ribbons = new Set<string>()
  let raster = growOnce(graph, pos, params, ribbons)

  for (let pass = 0; pass < 3; pass++) {
    const realized = realizedAdjacency(raster)
    const missing = graph.edges.filter(([a, b]) => !realized.has(edgeKey(a, b)))
    if (!missing.length) break
    for (const [a, b] of missing) ribbons.add(edgeKey(a, b))
    raster = growOnce(graph, pos, params, ribbons)
  }

  return raster
}

/** 8 邻域环，按逆时针顺序 */
const RING: readonly (readonly [number, number])[] = [
  [-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0],
]

/**
 * 形态学里的「简单点」判据：把 (x,y) 从区域 r 里拿掉，会不会把 r 拧断。
 * 看它 8 邻域环上属于 r 的格子——只构成一段连续弧才是安全的；
 * 若分成两段，这一格就是连接两瓣的细颈，动不得。
 */
function isSimplePoint(
  snapshot: Int16Array,
  W: number,
  H: number,
  x: number,
  y: number,
  r: number,
): boolean {
  const ring = RING.map(([dx, dy]) => {
    const nx = x + dx
    const ny = y + dy
    return nx < 0 || ny < 0 || nx >= W || ny >= H ? false : snapshot[ny * W + nx] === r
  })

  let runs = 0
  for (let i = 0; i < 8; i++) {
    if (ring[i] && !ring[(i + 7) % 8]) runs++
  }
  // runs === 0 有两种情形：整圈都是 r（内部点，不该动）或整圈都不是 r（孤立碎屑，尽管拿掉）
  if (runs === 0) return !ring[0]
  return runs === 1
}

/**
 * 生长完之后把锯齿状的边界揉圆：
 * 若某格周围压倒性地属于另一个区域，就把它让出去。
 * 三道保险：
 *   骨架格冻结不动          → 必需的邻接关系揉不没
 *   改写前过一遍 canClaim   → 揉不出多余的邻接关系
 *   只动「简单点」          → 区域不会被拧成两瓣
 */
function smoothOwners(
  raster: Raster,
  frozen: Uint8Array,
  canClaim: (x: number, y: number, r: number) => boolean,
) {
  const { W, H, owner } = raster

  for (let pass = 0; pass < 3; pass++) {
    const snapshot = Int16Array.from(owner)
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x
        if (frozen[i] || owner[i] === BLOCKED) continue

        const tally = new Map<number, number>()
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue
            const nx = x + dx
            const ny = y + dy
            // 画布外按海算，这样凸出去的角会被削平
            const o = nx < 0 || ny < 0 || nx >= W || ny >= H ? SEA : snapshot[ny * W + nx]
            if (o === BLOCKED) continue
            tally.set(o, (tally.get(o) ?? 0) + 1)
          }
        }

        let bestOwner = snapshot[i]
        let bestCount = 0
        for (const [o, count] of tally) {
          if (count > bestCount) {
            bestCount = count
            bestOwner = o
          }
        }
        const cur = owner[i]
        if (bestCount < 5 || bestOwner === cur) continue
        if (bestOwner >= 0 && !canClaim(x, y, bestOwner)) continue
        // 这一格要离开 cur，先确认它不是 cur 的细颈
        if (cur >= 0 && !isSimplePoint(snapshot, W, H, x, y, cur)) continue
        owner[i] = bestOwner
      }
    }
  }
}

/** 从栅格反读实际做出来的邻接关系（边界要有一定长度才算数，避免像素级毛刺） */
export function realizedAdjacency(raster: Raster, minRun = 3): Set<string> {
  const { W, H, owner, ids } = raster
  const counts = new Map<string, number>()
  const bump = (a: number, b: number) => {
    if (a < 0 || b < 0 || a === b) return
    const key = edgeKey(ids[a], ids[b])
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = owner[y * W + x]
      if (x + 1 < W) bump(o, owner[y * W + x + 1])
      if (y + 1 < H) bump(o, owner[(y + 1) * W + x])
    }
  }
  const out = new Set<string>()
  for (const [key, count] of counts) if (count >= minRun) out.add(key)
  return out
}

/** 每个区域占了多少格 —— 用来剔除退化（被挤没了）的区域 */
export function regionAreas(raster: Raster): number[] {
  const areas = new Array(raster.ids.length).fill(0)
  for (const o of raster.owner) if (o >= 0) areas[o]++
  return areas
}

/**
 * 每个区域被分成了几个互不相连的块。
 * 正常的地图里每个国家都应该是一整块；出现 >1 说明这张图画不成合法的地图
 * （非平面图会逼出这种「分裂国家」——正文里 fig-011/012 讨论的正是这种情形）。
 * 小于 minPiece 格的碎屑忽略不计，它们是栅格化的毛刺。
 */
export function regionPieceCounts(raster: Raster, minPiece = 12): number[] {
  const { W, H, owner, ids } = raster
  const seen = new Uint8Array(W * H)
  const counts = new Array(ids.length).fill(0)
  const stack: number[] = []

  for (let start = 0; start < owner.length; start++) {
    const o = owner[start]
    if (o < 0 || seen[start]) continue
    let size = 0
    stack.push(start)
    seen[start] = 1
    while (stack.length) {
      const i = stack.pop()!
      size++
      const x = i % W
      const y = (i - x) / W
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
        const j = ny * W + nx
        if (seen[j] || owner[j] !== o) continue
        seen[j] = 1
        stack.push(j)
      }
    }
    if (size >= minPiece) counts[o]++
  }
  return counts
}
