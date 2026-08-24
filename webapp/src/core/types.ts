/** 全局唯一的模型协议号，写进导出的 SVG，供再次导入时校验 */
export const PROTOCOL = 'fourcolors-suffice/map-model'
export const PROTOCOL_VERSION = 1

export interface Pt {
  x: number
  y: number
}

export type RegionId = string

/** 第一步的输入：区域集合 + 邻接关系 + 每个区域的颜色选择 */
export interface GraphSpec {
  /** 区域名，按用户添加顺序；同时也是标签文字 */
  regions: RegionId[]
  /** 无向边，存储时保证 a < b 且无重复 */
  edges: [RegionId, RegionId][]
  /** 区域 → 颜色。值可以是调色板槽位名（red/green/yellow/blue/gray）或 #rrggbb */
  colors: Record<RegionId, string>
}

export type StyleKind =
  /** 嵌套色带：圆角矩形外框、环形分层、径向切分 */
  | 'bands'
  /** 规整几何：直角外框、纯直线边界 */
  | 'geometric'
  /** 地图风：样条平滑 + 明显的手绘抖动 */
  | 'map'
  /** 自绘外框：地图风，但整体轮廓用用户画的多边形 */
  | 'frame'

/** 边界交汇点。多条弧段共用同一个节点，拖动它会同时带动所有弧段 */
export interface NodeModel {
  id: string
  p: Pt
}

/**
 * 一段边界弧：两个交汇点之间的一条链。
 * 这是编辑的最小单位——拖它的控制点，两侧区域的轮廓同时更新，
 * 因此邻接关系天然不会被改坏。
 */
export interface ArcModel {
  id: string
  n0: string
  n1: string
  /** 中间控制点（不含两端节点） */
  mid: Pt[]
  /** 弧两侧的区域；null 表示图外（海/背景） */
  left: RegionId | null
  right: RegionId | null
}

/** 区域轮廓的一条闭合环。一个区域可能有多条环（外环 + 洞） */
export interface Loop {
  arcs: { arc: string; rev: boolean }[]
}

export interface RegionModel {
  id: RegionId
  loops: Loop[]
  /** 标签锚点（区域内部的一个点，取极点距离最大处） */
  labelPos: Pt
  showLabel: boolean
}

export interface MapModel {
  protocol: typeof PROTOCOL
  version: number
  style: StyleKind
  seed: number
  width: number
  height: number
  graph: GraphSpec
  nodes: NodeModel[]
  arcs: ArcModel[]
  regions: RegionModel[]
  /** 渲染选项 */
  strokeColor: string
  strokeWidth: number
  labelSize: number
  labelColor: string
  /** 背景（海）填充，null = 透明 */
  seaColor: string | null
  /** 是否叠加显示对偶图（顶点 + 连线） */
  showDual: boolean
  /** 布局中每个区域的中心点，用于绘制对偶图叠加层 */
  dualPos: Record<RegionId, Pt>
}

export interface GenerateOptions {
  style: StyleKind
  seed: number
  width: number
  height: number
  /** frame 风格下用户画的外框多边形（模型坐标） */
  framePolygon?: Pt[]
}

/**
 * 生成过程的诊断信息。
 *
 * 地图是由平面嵌入确定性构造出来的，邻接关系与区域连通性由构造保证，
 * 所以这里只剩下一件真正会失败的事：找不到无交叉的画法（即图非平面）。
 * `problems` 是构造的自检结果，正常情况下永远是空的。
 */
export interface GenerateReport {
  ok: boolean
  /** 直线画法里剩余的边交叉数；> 0 即失败 */
  crossings: number
  /** 构造自检发现的问题；构造正确时为空 */
  problems: string[]
  /** 由欧拉公式推论得出的非平面提示 */
  nonPlanarHint: string | null
}

export interface GenerateResult {
  model: MapModel
  report: GenerateReport
}
