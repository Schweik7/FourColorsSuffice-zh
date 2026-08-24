/**
 * 生成器核心的冒烟测试。
 *
 *   pnpm smoke            跑一遍并打印每个用例的结果
 *   pnpm smoke --write    额外把生成的 SVG 落到 scripts/out/ 便于肉眼检查
 *
 * 地图由平面嵌入确定性构造，邻接关系与区域连通性由构造保证，
 * 所以判据是：平面图必须**每一张候选都合法**（不是「多试几次能碰到一张」），
 * 已知非平面的用例则必须失败。
 */
import fs from 'node:fs'
import path from 'node:path'
import { parseGraphText } from '../src/core/parse'
import { fourColor } from '../src/core/graph'
import { generateVariants } from '../src/core/generate'
import { renderModel, toSvgString } from '../src/core/render'
import { extractModel, embedMetadata } from '../src/core/serialize'
import { DEFAULT_PALETTE } from '../src/core/palette'
import type { StyleKind } from '../src/core/types'

const WRITE = process.argv.includes('--write')
const OUT = path.resolve(process.cwd(), 'scripts', 'out')
const BATCH = 8

interface Case {
  name: string
  text: string
  /** 已知非平面：期望它画不出来 */
  nonPlanar?: boolean
}

const CASES: Case[] = [
  { name: '三角形', text: 'A B\nB C\nA C' },
  { name: '链', text: 'A B C D' },
  { name: 'K4', text: 'A: B C D\nB: C D\nC: D' },
  { name: '轮W5', text: 'E: A B C D\nA B\nB C\nC D\nD A' },
  { name: '五国', text: 'A: B C D E\nB: C E\nC: D\nD: E' },
  {
    name: '十区域',
    text: 'A: B C D\nB: C E F\nC: D F G\nD: G H\nE: F I\nF: G I J\nG: H J\nH: J\nI: J',
  },
  {
    // 用户报过的用例：旧的栅格生长实现下每批只有一张合法
    name: '肯普链构型',
    text: `A: Green Yellow C H
B: G H I
C: Yellow Blue D E A
D: Yellow Blue E C
E: Blue C D F
F: Yellow I E
G: Yellow B H I
H: Green B G I A
I: B G H F
Green: A H
Yellow: A C D F G
Blue: C D E`,
  },
  { name: '网格4x4', text: buildGrid(4, 4) },
  { name: '网格6x5', text: buildGrid(6, 5) },
  { name: '星', text: 'A: B C D E F G' },
  { name: '树', text: 'A: B C\nB: D E\nC: F G' },
  { name: '孤立点', text: 'A\nB\nC' },
  { name: '单区域', text: 'A' },
  { name: '两个分量', text: 'A B\nB C\nD E\nE F\nF D' },
  { name: 'K5', text: 'A: B C D E\nB: C D E\nC: D E\nD: E', nonPlanar: true },
  { name: 'K33', text: 'A: D E F\nB: D E F\nC: D E F', nonPlanar: true },
]

/** rows×cols 的棋盘格邻接图，用来压区域数多的情况 */
function buildGrid(rows: number, cols: number): string {
  const name = (r: number, c: number) => `${String.fromCharCode(65 + r)}${c + 1}`
  const lines: string[] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const nbs: string[] = []
      if (c + 1 < cols) nbs.push(name(r, c + 1))
      if (r + 1 < rows) nbs.push(name(r + 1, c))
      lines.push(nbs.length ? `${name(r, c)}: ${nbs.join(' ')}` : name(r, c))
    }
  }
  return lines.join('\n')
}

let failures = 0
const note = (msg: string) => {
  failures++
  console.log(`      ↳ ${msg}`)
}

if (WRITE) fs.mkdirSync(OUT, { recursive: true })

for (const style of ['bands', 'map', 'geometric'] as StyleKind[]) {
  for (const c of CASES) {
    const { graph, warnings } = parseGraphText(c.text)
    Object.assign(graph.colors, fourColor(graph))

    const t0 = Date.now()
    const variants = generateVariants(graph, { style, seed: 12345, width: 900, height: 640 }, BATCH)
    const ms = Date.now() - t0

    const okCount = variants.filter((v) => v.report.ok).length
    const expected = c.nonPlanar ? 0 : BATCH
    const pass = okCount === expected

    const first = variants[0]
    const rendered = renderModel(first.model, DEFAULT_PALETTE)
    const noPath = rendered.regions.filter((r) => !r.d).map((r) => r.id)

    console.log(
      `[${pass ? 'PASS' : 'FAIL'}] ${style.padEnd(9)} ${c.name.padEnd(10)} ` +
        `区域=${String(graph.regions.length).padStart(2)} 边=${String(graph.edges.length).padStart(2)} ` +
        `弧=${String(first.model.arcs.length).padStart(3)} 合法=${okCount}/${BATCH} ` +
        `交叉=${first.report.crossings} ${String(ms).padStart(4)}ms`,
    )

    if (!pass) {
      note(
        c.nonPlanar
          ? `非平面图却画成功了 ${okCount}/${BATCH} 张`
          : `只有 ${okCount}/${BATCH} 张合法：交叉=${first.report.crossings} 自检=${JSON.stringify(first.report.problems)}`,
      )
    }
    if (!c.nonPlanar && first.report.problems.length) {
      note(`构造自检报错 ${JSON.stringify(first.report.problems)}`)
    }
    if (warnings.length) note(`解析警告 ${JSON.stringify(warnings)}`)
    if (!c.nonPlanar && noPath.length) note(`这些区域没渲染出路径 ${JSON.stringify(noPath)}`)

    // 顺带验 SVG 往返：导出再导入，模型必须一模一样
    if (style === 'bands' && !c.nonPlanar) {
      const svg = toSvgString(first.model, DEFAULT_PALETTE, embedMetadata(first.model))
      const back = extractModel(svg)
      if (!back.model) note(`SVG 往返失败：${back.error}`)
      else if (JSON.stringify(back.model) !== JSON.stringify(first.model)) note('SVG 往返后模型对不上')
    }

    if (WRITE) {
      fs.writeFileSync(
        path.join(OUT, `${style}-${c.name}.svg`),
        toSvgString(first.model, DEFAULT_PALETTE, embedMetadata(first.model)),
        'utf8',
      )
    }
  }
}

console.log(failures ? `\n${failures} 项异常` : '\n全部通过')
process.exit(failures ? 1 : 0)
