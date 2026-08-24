/// <reference types="vite/client" />

declare module 'virtual:book-manifest' {
  /** 由 plugins/bookAssets.ts 在构建期扫描 ../images 生成 */
  export interface FigureEntry {
    id: string
    desc: string
    orig: string
    svg: string
  }
  const figures: FigureEntry[]
  export default figures
}
