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
  /** 规整几何：直线边界、棱角分明 */
  | 'geometric'
  /** 地图风：样条平滑 + 手绘抖动 */
  | 'map'
  /** 自绘外框：地图风，但整体轮廓被用户画的多边形裁剪 */
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

/** 生成过程的诊断信息，UI 用它提示用户 */
export interface GenerateReport {
  ok: boolean
  /** 图里有、但地图上没能做出来的邻接 */
  missingEdges: [RegionId, RegionId][]
  /** 地图上多出来的、图里没有的邻接 */
  extraEdges: [RegionId, RegionId][]
  /** 被画成了好几块、不连成一片的区域（合法地图里不该出现） */
  splitRegions: RegionId[]
  /** 一格没占到的区域 */
  emptyRegions: RegionId[]
  /** 布局里的边交叉数（>0 说明图可能非平面） */
  crossings: number
  /** 尝试了几轮 */
  attempts: number
}

export interface GenerateResult {
  model: MapModel
  report: GenerateReport
}
