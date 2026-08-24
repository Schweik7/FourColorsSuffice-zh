/**
 * 全书统一色号。
 * standard 来自 _redraw_tools/GUIDE.md 的重绘规范；
 * muted 是 fig-102《绿红部分相连合并情况图》里实际用的淡色版，
 * 用于「不凸显」的底色场景（正文在这类图里靠深色标出正在讨论的链）。
 */
export type Slot = 'red' | 'green' | 'yellow' | 'blue' | 'gray'

export const SLOTS: Slot[] = ['red', 'green', 'yellow', 'blue', 'gray']

export interface Palette {
  key: string
  label: string
  hint: string
  colors: Record<Slot, string>
}

export const PALETTES: Palette[] = [
  {
    key: 'standard',
    label: '标准四色',
    hint: 'GUIDE.md 规定的全书标准色号',
    colors: {
      red: '#c0504d',
      green: '#5a9257',
      yellow: '#e0b23c',
      blue: '#4f7cac',
      gray: '#6f6f6f',
    },
  },
  {
    key: 'muted',
    label: '淡色（fig-102 同款）',
    hint: '与 fig-102 色号统一的不凸显版本',
    colors: {
      red: '#e8c0bf',
      green: '#c4d8c3',
      yellow: '#f4e3b9',
      blue: '#c0d0e1',
      gray: '#d9d9d9',
    },
  },
  {
    key: 'grayscale',
    label: '全灰',
    hint: '只用深浅灰，适合黑白印刷稿',
    colors: {
      red: '#8a8a8a',
      green: '#a8a8a8',
      yellow: '#c6c6c6',
      blue: '#e4e4e4',
      gray: '#6f6f6f',
    },
  },
]

export const DEFAULT_PALETTE = PALETTES[0]

export function paletteByKey(key: string): Palette {
  return PALETTES.find((p) => p.key === key) ?? DEFAULT_PALETTE
}

const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i

export function isHex(value: string): boolean {
  return HEX_RE.test(value.trim())
}

/** 把区域上存的颜色值（槽位名或 hex）解析成实际 hex */
export function resolveColor(value: string | undefined, palette: Palette): string {
  if (!value) return '#ffffff'
  if (isHex(value)) return value.trim().toLowerCase()
  return palette.colors[value as Slot] ?? '#ffffff'
}

/** 依据填充色的明度决定标签文字用黑还是白 */
export function readableTextOn(hex: string): string {
  let h = hex.replace('#', '')
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  // 感知亮度（ITU-R BT.601）
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? '#222222' : '#ffffff'
}
