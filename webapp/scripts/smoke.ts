/**
 * 生成器核心算法的冒烟测试。
 *
 *   pnpm smoke            跑一遍并打印每个用例的结果
 *   pnpm smoke --write    额外把生成的 SVG 落到 scripts/out/ 便于肉眼检查
 *
 * 判据是「地图上真正做出来的邻接关系」必须与输入的图完全一致，
 * 且没有区域被拆成几块。已知非平面的用例反过来必须失败。
 */
import fs from 'node:fs'
import path from 'node:path'
import { parseGraphText } from '../src/core/parse'
import { fourColor, planarityWarning } from '../src/core/graph'
import { generateMap } from '../src/core/generate'
import { renderModel, toSvgString } from '../src/core/render'
import { extractModel, embedMetadata } from '../src/core/serialize'
import { DEFAULT_PALETTE } from '../src/core/palette'
import type { StyleKind } from '../src/core/types'

const WRITE = process.argv.includes('--write')
// 这个脚本是先 bundle 到 node_modules/.tmp 再跑的，import.meta.dirname 指向那里，
// 所以输出目录要相对于工作目录（也就是 webapp/）算
const OUT = path.resolve(process.cwd(), 'scripts', 'out')

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
  { name: '十四区域', text: buildGrid(4, 4) },
  { name: '孤立点', text: 'A\nB\nC' },
  { name: '单区域', text: 'A' },
  { name: 'K5', text: 'A: B C D E\nB: C D E\nC: D E\nD: E', nonPlanar: true },
  { name: 'K33', text: 'A: D E F\nB: D E F\nC: D E F', nonPlanar: true },
]

/** 生成一个 rows×cols 的棋盘格邻接图，用来压一压区域数多的情况 */
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

for (const style of ['geometric', 'map'] as StyleKind[]) {
  for (const c of CASES) {
    const { graph, warnings } = parseGraphText(c.text)
    const colored = fourColor(graph)
    for (const id of graph.regions) graph.colors[id] = colored[id]

    const t0 = Date.now()
    const { model, report } = generateMap(graph, { style, seed: 12345, width: 900, height: 640 })
    const ms = Date.now() - t0

    const rendered = renderModel(model, DEFAULT_PALETTE)
    const noPath = rendered.regions.filter((r) => !r.d).map((r) => r.id)

    const expectedOk = !c.nonPlanar
    const pass = report.ok === expectedOk
    console.log(
      `[${pass ? 'PASS' : 'FAIL'}] ${style.padEnd(9)} ${c.name.padEnd(8)} ` +
        `区域=${String(graph.regions.length).padStart(2)} 边=${String(graph.edges.length).padStart(2)} ` +
        `弧=${String(model.arcs.length).padStart(3)} 尝试=${report.attempts} ` +
        `交叉=${report.crossings} ${String(ms).padStart(4)}ms`,
    )

    if (!pass) {
      note(
        c.nonPlanar
          ? '非平面图却报告画成功了——校验漏了什么'
          : `平面图没画成：缺失=${JSON.stringify(report.missingEdges)} 多余=${JSON.stringify(report.extraEdges)} 分裂=${JSON.stringify(report.splitRegions)} 空缺=${JSON.stringify(report.emptyRegions)}`,
      )
    }
    if (warnings.length) note(`解析警告 ${JSON.stringify(warnings)}`)
    if (expectedOk && noPath.length) note(`这些区域没渲染出路径 ${JSON.stringify(noPath)}`)
    if (expectedOk && !c.nonPlanar) {
      const warn = planarityWarning(graph)
      if (warn) note(`本应是平面图却触发了边数上限警告：${warn}`)
    }

    // 顺带验一遍 SVG 往返：导出再导入，模型必须一模一样
    if (style === 'map' && graph.regions.length > 1) {
      const svg = toSvgString(model, DEFAULT_PALETTE, embedMetadata(model))
      const back = extractModel(svg)
      if (!back.model) note(`SVG 往返失败：${back.error}`)
      else if (JSON.stringify(back.model) !== JSON.stringify(model)) note('SVG 往返后模型对不上')
    }

    if (WRITE) {
      fs.writeFileSync(
        path.join(OUT, `${style}-${c.name}.svg`),
        toSvgString(model, DEFAULT_PALETTE, embedMetadata(model)),
        'utf8',
      )
    }
  }
}

console.log(failures ? `\n${failures} 项异常` : '\n全部通过')
process.exit(failures ? 1 : 0)
