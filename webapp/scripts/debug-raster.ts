/** 把某个用例的栅格打成 ASCII，排查区域分裂/邻接异常时用 */
import { parseGraphText } from '../src/core/parse'
import { normalizeGraph } from '../src/core/graph'
import { makeRng } from '../src/core/rng'
import { layoutGraph } from '../src/core/layout'
import { growRegions, regionPieceCounts, realizedAdjacency } from '../src/core/grow'

const text = process.argv[2] ?? 'A: B C D\nB: C D\nC: D'
const seed = Number(process.argv[3] ?? 12345)

const graph = normalizeGraph(parseGraphText(text).graph)
const rng = makeRng(seed)
const layout = layoutGraph(graph, rng, 900, 640)
console.log('布局：', Object.fromEntries(
  Object.entries(layout.pos).map(([k, p]) => [k, `${p.x.toFixed(0)},${p.y.toFixed(0)}`]),
))
console.log('交叉：', layout.crossings)

const meanLen =
  graph.edges.reduce((s, [a, b]) => s + Math.hypot(layout.pos[a].x - layout.pos[b].x, layout.pos[a].y - layout.pos[b].y), 0) /
  Math.max(graph.edges.length, 1)

const raster = growRegions(graph, layout.pos, {
  width: 900,
  height: 640,
  cell: 4,
  guard: 3,
  maxDepth: Number.POSITIVE_INFINITY,
})

const glyphs = 'ABCDEFGHIJKLMNOP'
for (let y = 0; y < raster.H; y += 3) {
  let line = ''
  for (let x = 0; x < raster.W; x += 2) {
    const o = raster.owner[y * raster.W + x]
    line += o < 0 ? '.' : glyphs[o]
  }
  console.log(line)
}

console.log('平均边长', meanLen.toFixed(0))
console.log('每区块数：', Object.fromEntries(regionPieceCounts(raster).map((c, i) => [graph.regions[i], c])))
console.log('实际邻接：', [...realizedAdjacency(raster)].sort())
console.log('期望邻接：', graph.edges.map(([a, b]) => `${a} ${b}`).sort())
