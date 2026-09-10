/**
 * 六边形网格：涂色式地图的底座。
 *
 * ## 为什么是六边形，不是方格
 *
 * 方格网里四块会在一个角上碰头，于是「对角相邻的两块算不算相邻」没有唯一答案，
 * 描边界时还会出现自己掐自己的夹断点。六边形网格里**每个角点恰好由三个格子共用**，
 * 由此白得两条性质：
 *
 *  1. 两块要么共一条边，要么完全不挨着——不存在「只碰一个点」的暧昧情形；
 *  2. 任何一块格子集合的边界，一定是若干条互不相交的**简单**闭曲线。
 *     因为一个角点最多只能有两个格子属于同一块，绕这块走时每个角点恰好进一次出一次。
 *
 * 第 2 条是 `trace.ts` 能无歧义地把着色翻译成区域轮廓的前提，
 * 第 1 条是 `paint.ts` 里邻接关系有确定答案的前提。
 *
 * ## 坐标约定
 *
 * 尖顶六边形（pointy-top），odd-r 偏移排布：奇数行整体右移半格。
 * 角点 k 位于中心的 `60k - 90` 度方向；由此**第 d 个角点与第 d+1 个角点之间的那条边，
 * 正对第 d 个邻居**——`corner` 与 `nbr` 两张表用同一个下标 d 对齐，
 * 描边界时不用再做任何换算。
 *
 * 屏幕坐标 y 轴向下，所以按下标 0→1→…→5 走一圈是顺时针，
 * 格子内部落在行进方向的**右**侧。`trace.ts` 依赖这个定向。
 */

/** 角点/邻居的方向数 */
export const DIRS = 6

/** 角点方向的单位向量（外接圆半径为 1） */
const CORNER_X: number[] = []
const CORNER_Y: number[] = []
for (let k = 0; k < DIRS; k++) {
  const a = ((60 * k - 90) * Math.PI) / 180
  CORNER_X.push(Math.cos(a))
  CORNER_Y.push(Math.sin(a))
}

/** odd-r 偏移下的邻居列偏移/行偏移，按方向 d = 0..5（右上、右、右下、左下、左、左上） */
const NB_EVEN: readonly (readonly [number, number])[] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
]
const NB_ODD: readonly (readonly [number, number])[] = [
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 0],
  [0, -1],
]

export interface HexMesh {
  /** 外接圆半径，同时也是六边形的边长 */
  size: number
  cols: number
  rows: number
  count: number
  /** 画布尺寸（网格实际比它大一圈，见 PAD） */
  width: number
  height: number
  cx: Float64Array
  cy: Float64Array
  /** `DIRS * count`，按旋转序的邻居格号；-1 表示出界 */
  nbr: Int32Array
  /** `DIRS * count`，按旋转序的角点号；角点 d 与 d+1 之间的边正对 nbr[d] */
  corner: Int32Array
  vx: Float64Array
  vy: Float64Array
  vertCount: number
  /**
   * 中心落在画布内、允许上色的格子。
   * 外面那一圈只作为「海」的垫子存在：有了它，画布内的格子六个邻居必定都在网格里，
   * 描边界时就不必给出界方向准备一套特例。
   */
  paintable: Uint8Array
}

/** 网格向画布外多铺几圈，保证可涂格子的六个邻居都存在 */
const PAD = 2

/** 顶点去重用的量化倍率。相邻顶点至少隔开一个边长，这个精度绰绰有余 */
const QUANT = 8
/** 量化坐标平移到非负所加的偏置，以及打包时的进位基数 */
const BIAS = 1 << 20
const SPREAD = 1 << 22

export function buildMesh(width: number, height: number, size: number): HexMesh {
  const colW = Math.sqrt(3) * size
  const rowH = 1.5 * size
  const cols = Math.ceil(width / colW) + 2 * PAD + 1
  const rows = Math.ceil(height / rowH) + 2 * PAD + 1
  const originX = -PAD * colW
  const originY = -PAD * rowH
  const count = cols * rows

  const cx = new Float64Array(count)
  const cy = new Float64Array(count)
  const nbr = new Int32Array(DIRS * count).fill(-1)
  const corner = new Int32Array(DIRS * count).fill(-1)
  const paintable = new Uint8Array(count)

  const vxs: number[] = []
  const vys: number[] = []
  const vertOf = new Map<number, number>()

  const vertAt = (x: number, y: number): number => {
    const qx = Math.round(x * QUANT)
    const qy = Math.round(y * QUANT)
    // 打成一个整数键：两个分量先平移到非负，再错位相加。
    // 量级远在 2^53 以内，所以这是精确整数运算，不会撞键。
    const key = (qx + BIAS) * SPREAD + (qy + BIAS)
    const hit = vertOf.get(key)
    if (hit !== undefined) return hit
    const id = vxs.length
    vxs.push(x)
    vys.push(y)
    vertOf.set(key, id)
    return id
  }

  for (let r = 0; r < rows; r++) {
    const odd = r & 1
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c
      const x = originX + c * colW + (odd ? colW / 2 : 0)
      const y = originY + r * rowH
      cx[i] = x
      cy[i] = y
      paintable[i] = x >= 0 && x <= width && y >= 0 && y <= height ? 1 : 0

      for (let d = 0; d < DIRS; d++) {
        corner[i * DIRS + d] = vertAt(x + size * CORNER_X[d], y + size * CORNER_Y[d])
      }

      const table = odd ? NB_ODD : NB_EVEN
      for (let d = 0; d < DIRS; d++) {
        const nc = c + table[d][0]
        const nr = r + table[d][1]
        nbr[i * DIRS + d] = nc >= 0 && nc < cols && nr >= 0 && nr < rows ? nr * cols + nc : -1
      }
    }
  }

  return {
    size,
    cols,
    rows,
    count,
    width,
    height,
    cx,
    cy,
    nbr,
    corner,
    vx: Float64Array.from(vxs),
    vy: Float64Array.from(vys),
    vertCount: vxs.length,
    paintable,
  }
}

/**
 * 画布坐标 → 格号。取不到返回 -1。
 *
 * 六边形正是其中心在三角格上的 Voronoi 胞腔，所以「离哪个中心最近就是哪个格」
 * 就是准确答案，不需要那套容易写错的立方坐标取整。近似定位到几行几列之后
 * 只需在小邻域里比一下距离。
 */
export function cellAt(mesh: HexMesh, x: number, y: number): number {
  const colW = Math.sqrt(3) * mesh.size
  const rowH = 1.5 * mesh.size
  const originX = -PAD * colW
  const originY = -PAD * rowH

  const r0 = Math.round((y - originY) / rowH)
  let best = -1
  let bestD = Infinity

  for (let r = r0 - 1; r <= r0 + 1; r++) {
    if (r < 0 || r >= mesh.rows) continue
    const shift = r & 1 ? colW / 2 : 0
    const c0 = Math.round((x - originX - shift) / colW)
    for (let c = c0 - 1; c <= c0 + 1; c++) {
      if (c < 0 || c >= mesh.cols) continue
      const i = r * mesh.cols + c
      const dx = x - mesh.cx[i]
      const dy = y - mesh.cy[i]
      const d = dx * dx + dy * dy
      if (d < bestD) {
        bestD = d
        best = i
      }
    }
  }
  return best
}

/** 以 center 为中心、半径 radius（画布单位）内的所有格子 */
export function cellsInDisc(mesh: HexMesh, x: number, y: number, radius: number): number[] {
  const seed = cellAt(mesh, x, y)
  if (seed < 0) return []
  if (radius <= mesh.size) return [seed]

  // 从落点开始按邻居扩散，比扫全网格快得多
  const r2 = radius * radius
  const seen = new Set<number>([seed])
  const out: number[] = [seed]
  for (let head = 0; head < out.length; head++) {
    const i = out[head]
    for (let d = 0; d < DIRS; d++) {
      const j = mesh.nbr[i * DIRS + d]
      if (j < 0 || seen.has(j)) continue
      const dx = mesh.cx[j] - x
      const dy = mesh.cy[j] - y
      if (dx * dx + dy * dy > r2) continue
      seen.add(j)
      out.push(j)
    }
  }
  return out
}

/** 一个格子的六边形轮廓，按角点下标顺序（屏幕上顺时针） */
export function cellPolygon(mesh: HexMesh, i: number): { x: number; y: number }[] {
  const out = []
  for (let d = 0; d < DIRS; d++) {
    const v = mesh.corner[i * DIRS + d]
    out.push({ x: mesh.vx[v], y: mesh.vy[v] })
  }
  return out
}
