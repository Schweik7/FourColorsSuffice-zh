/**
 * 涂色式地图的冒烟测试。
 *
 *   pnpm paint-test            跑一遍并打印结果
 *   pnpm paint-test --write    额外把 SVG 落到 scripts/out/ 便于肉眼检查
 *
 * 要验的是四条不变量，它们撑起了整条链路：
 *
 *   1. **描边界不丢不乱**：每块的边界环首尾相接并闭合，弧两侧的区域对
 *      恰好等于从格子上量出来的邻接关系。
 *   2. **空洞能表示**：一块被另一块整个包住时，外面那块要描出两条环。
 *   3. **整形不动拓扑**：跑完局部搜索，邻接关系一条不差，每块仍然连通。
 *   4. **整形确实变好看**：总能量与最差紧凑度都要下降。
 */
import fs from 'node:fs'
import path from 'node:path'
import { buildMesh, cellsInDisc } from '../src/core/mesh'
import {
  SEA,
  addRegion,
  areasOf,
  componentCount,
  contactsOf,
  emptyPainting,
  fromSnapshot,
  graphFromPainting,
  paintCells,
  toSnapshot,
  unpair,
} from '../src/core/paint'
import { traceToModel } from '../src/core/trace'
import { compactnessOf, createRelax, energyOf, relaxRounds, DEFAULT_RELAX } from '../src/core/relax'
import { seedFromGraph } from '../src/core/seed'
import { verifyTopology } from '../src/core/generate'
import { parseGraphText } from '../src/core/parse'
import { fourColor, edgeKey } from '../src/core/graph'
import { toSvgString } from '../src/core/render'
import { embedMetadata } from '../src/core/serialize'
import { DEFAULT_PALETTE } from '../src/core/palette'
import type { Painting } from '../src/core/paint'

const WRITE = process.argv.includes('--write')
const OUT = path.resolve(process.cwd(), 'scripts', 'out')
const W = 900
const H = 640

let failures = 0

function check(name: string, ok: boolean, detail = '') {
  if (!ok) failures++
  const mark = ok ? '  ok  ' : ' FAIL '
  console.log(`${mark} ${name}${detail ? '  — ' + detail : ''}`)
}

/** 从格子上量出来的邻接，做成可比较的字符串集合 */
function adjacencyKeys(p: Painting): Set<string> {
  const out = new Set<string>()
  for (const key of contactsOf(p).keys()) {
    const [a, b] = unpair(key)
    out.add(edgeKey(p.names[a], p.names[b]))
  }
  return out
}

function sameSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false
  for (const x of a) if (!b.has(x)) return false
  return true
}

function dump(name: string, p: Painting) {
  if (!WRITE) return
  fs.mkdirSync(OUT, { recursive: true })
  const { model } = traceToModel(p)
  const svg = toSvgString(model, DEFAULT_PALETTE, embedMetadata(model))
  fs.writeFileSync(path.join(OUT, `paint-${name}.svg`), svg, 'utf8')
}

// ── 用例 1：三条竖条 ─────────────────────────────────────────
function stripes() {
  const mesh = buildMesh(W, H, 10)
  const p = emptyPainting(mesh)
  const slots = ['red', 'green', 'yellow']
  ;['A', 'B', 'C'].forEach((n, i) => addRegion(p, n, slots[i]))

  for (let i = 0; i < mesh.count; i++) {
    if (!mesh.paintable[i]) continue
    p.labels[i] = Math.min(2, Math.floor((mesh.cx[i] / W) * 3))
  }

  const { model, warnings } = traceToModel(p)
  const graph = graphFromPainting(p)
  check('竖条 · 描边界无告警', warnings.length === 0, warnings.join('; '))
  check(
    '竖条 · 邻接恰为 A-B、B-C',
    sameSet(adjacencyKeys(p), new Set([edgeKey('A', 'B'), edgeKey('B', 'C')])),
    [...adjacencyKeys(p)].join(', '),
  )
  const problems = verifyTopology(graph, model.arcs, model.regions, model.nodes)
  check('竖条 · 环闭合且弧两侧与邻接一致', problems.length === 0, problems.join('; '))
  dump('stripes', p)
}

// ── 用例 2：甜甜圈（B 被 A 整个包住） ────────────────────────
function donut() {
  const mesh = buildMesh(W, H, 9)
  const p = emptyPainting(mesh)
  addRegion(p, 'A', 'yellow')
  addRegion(p, 'B', 'blue')
  paintCells(p, cellsInDisc(mesh, W / 2, H / 2, 220), 0)
  paintCells(p, cellsInDisc(mesh, W / 2, H / 2, 90), 1)

  const { model, warnings } = traceToModel(p)
  const graph = graphFromPainting(p)
  const a = model.regions.find((r) => r.id === 'A')!
  const b = model.regions.find((r) => r.id === 'B')!

  check('甜甜圈 · 描边界无告警', warnings.length === 0, warnings.join('; '))
  check('甜甜圈 · A 有外环 + 洞两条环', a.loops.length === 2, `实际 ${a.loops.length} 条`)
  check('甜甜圈 · B 只有一条环', b.loops.length === 1, `实际 ${b.loops.length} 条`)
  check('甜甜圈 · 邻接恰为 A-B', sameSet(adjacencyKeys(p), new Set([edgeKey('A', 'B')])))
  const problems = verifyTopology(graph, model.arcs, model.regions, model.nodes)
  check('甜甜圈 · 环闭合且弧两侧与邻接一致', problems.length === 0, problems.join('; '))
  // 洞里那块的标签不能掉到洞外面去
  const inHole = Math.hypot(b.labelPos.x - W / 2, b.labelPos.y - H / 2) < 90
  check('甜甜圈 · B 的标签落在 B 里面', inHole)
  dump('donut', p)
}

// ── 用例 3：存档往返 ─────────────────────────────────────────
function snapshot() {
  const mesh = buildMesh(W, H, 12)
  const p = emptyPainting(mesh)
  addRegion(p, 'X', 'red')
  addRegion(p, 'Y', 'green')
  paintCells(p, cellsInDisc(mesh, 300, 320, 160), 0)
  paintCells(p, cellsInDisc(mesh, 600, 320, 160), 1)

  const back = fromSnapshot(toSnapshot(p), buildMesh(W, H, 12))
  const same = back !== null && back.labels.every((v, i) => v === p.labels[i])
  check('存档 · 游程编码往返一致', same)

  const wrongMesh = fromSnapshot(toSnapshot(p), buildMesh(W, H, 9))
  check('存档 · 网格对不上时整份作废', wrongMesh === null)
}

// ── 用例 4：由邻接关系铺草稿 + 整形 ──────────────────────────
const CASES: { name: string; text: string }[] = [
  { name: 'K4', text: 'A: B C D\nB: C D\nC: D' },
  { name: '轮W5', text: 'E: A B C D\nA B\nB C\nC D\nD A' },
  { name: '五国', text: 'A: B C D E\nB: C E\nC: D\nD: E' },
  {
    name: '十区域',
    text: 'A: B C D\nB: C E F\nC: D F G\nD: G H\nE: F I\nF: G I J\nG: H J\nH: J\nI: J',
  },
]

function seedAndRelax() {
  for (const c of CASES) {
    const { graph } = parseGraphText(c.text)
    const colored = { ...graph, colors: fourColor(graph) }
    const mesh = buildMesh(W, H, 7)
    const seeded = seedFromGraph(mesh, colored, { seed: 7, margin: 0.05, corner: 0.16, minArea: 8 })
    const p = seeded.painting

    const before = adjacencyKeys(p)
    const wanted = new Set(colored.edges.map(([a, b]) => edgeKey(a, b)))
    check(
      `${c.name} · 草稿邻接与目标一致`,
      sameSet(before, wanted),
      `缺 ${seeded.missing.length} 条、多 ${seeded.extra.length} 条`,
    )

    const seedConnected = p.names.every((_, k) => componentCount(p, k) === 1)
    check(`${c.name} · 草稿每块连通`, seedConnected, p.names.filter((_, k) => componentCount(p, k) !== 1).join(','))

    const st = createRelax(p, { ...DEFAULT_RELAX, minArea: 8, seed: 3 })
    const e0 = energyOf(st)
    const worst0 = Math.max(...compactnessOf(st))
    relaxRounds(st, 40)
    const e1 = energyOf(st)
    const worst1 = Math.max(...compactnessOf(st))

    check(`${c.name} · 整形后邻接一条不差`, sameSet(adjacencyKeys(p), before))
    const allConnected = p.names.every((_, k) => componentCount(p, k) === 1)
    check(`${c.name} · 整形后每块仍然连通`, allConnected)
    check(`${c.name} · 总能量下降`, e1 < e0, `${e0.toFixed(1)} → ${e1.toFixed(1)}`)
    check(
      `${c.name} · 最差紧凑度下降`,
      worst1 <= worst0,
      `${worst0.toFixed(2)} → ${worst1.toFixed(2)}`,
    )

    const areas = areasOf(p)
    const smallest = Math.min(...areas)
    check(`${c.name} · 没有小到看不见的块`, smallest >= 8, `最小 ${smallest} 格`)

    const { model, warnings } = traceToModel(p)
    const problems = verifyTopology(graphFromPainting(p), model.arcs, model.regions, model.nodes)
    check(`${c.name} · 描边界干净`, warnings.length === 0 && problems.length === 0, [...warnings, ...problems].join('; '))
    dump(c.name, p)
  }
}

// ── 用例 5：整形不许填掉海里的洞，也不许把区域捅穿 ───────────
function topologyHeld() {
  const mesh = buildMesh(W, H, 9)
  const p = emptyPainting(mesh)
  addRegion(p, 'A', 'yellow')
  addRegion(p, 'B', 'blue')
  addRegion(p, 'C', 'red')
  // 一条细长的 A 把 B、C 隔开：整形应该把它变粗，但不能让 B、C 碰上
  paintCells(p, cellsInDisc(mesh, 250, 320, 170), 1)
  paintCells(p, cellsInDisc(mesh, 650, 320, 170), 2)
  for (let i = 0; i < mesh.count; i++) {
    if (!mesh.paintable[i]) continue
    if (Math.abs(mesh.cx[i] - 450) < 26) p.labels[i] = 0
  }

  const before = adjacencyKeys(p)
  // A 这条带子把画布上下贯通，所以海本来就被切成左右两片
  const seaBefore = componentCount(p, SEA)
  check('隔离带 · B 与 C 一开始就不相邻', !before.has(edgeKey('B', 'C')))

  const st = createRelax(p, { ...DEFAULT_RELAX, minArea: 10, seed: 11 })
  relaxRounds(st, 60)

  check('隔离带 · 整形后 B 与 C 仍然不相邻', !adjacencyKeys(p).has(edgeKey('B', 'C')))
  check('隔离带 · 邻接一条不差', sameSet(adjacencyKeys(p), before))
  check('隔离带 · 隔离带没被捅穿', componentCount(p, 0) === 1)
  check('隔离带 · 海没被多切出新的片', componentCount(p, SEA) === seaBefore)
  dump('corridor', p)
}

stripes()
donut()
snapshot()
seedAndRelax()
topologyHeld()

console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项未通过`)
process.exit(failures === 0 ? 0 : 1)
