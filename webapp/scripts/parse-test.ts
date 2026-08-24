/** 图输入解析器的测试：pnpm parse-test */
import { parseGraphText, graphToText } from '../src/core/parse'

interface Case {
  name: string
  text: string
  regions: string[]
  edges: string[]
}

const CASES: Case[] = [
  {
    name: '邻接表',
    text: 'A: B C D\nB: C',
    regions: ['A', 'B', 'C', 'D'],
    edges: ['A-B', 'A-C', 'A-D', 'B-C'],
  },
  {
    name: '箭头邻接表',
    text: 'A -> B, C',
    regions: ['A', 'B', 'C'],
    edges: ['A-B', 'A-C'],
  },
  {
    name: '边表（空格/连字符/逗号）',
    text: 'A B\nB-C\nC, D\nD--A',
    regions: ['A', 'B', 'C', 'D'],
    edges: ['A-B', 'A-D', 'B-C', 'C-D'],
  },
  {
    name: '一行多名视为链',
    text: 'A B C D',
    regions: ['A', 'B', 'C', 'D'],
    edges: ['A-B', 'B-C', 'C-D'],
  },
  {
    name: '孤立点与注释',
    text: 'A\nB  # 这是注释\n// 整行注释\nC',
    regions: ['A', 'B', 'C'],
    edges: [],
  },
  {
    name: 'NetworkX 代码（含样板行）',
    text: [
      'import networkx as nx',
      'G = nx.Graph()',
      'G.add_edges_from([("英格兰","苏格兰"), ("英格兰","威尔士")])',
      'G.add_edge("苏格兰", "威尔士")',
      'G.add_node("爱尔兰")',
    ].join('\n'),
    regions: ['英格兰', '苏格兰', '威尔士', '爱尔兰'],
    edges: ['威尔士-英格兰', '威尔士-苏格兰', '苏格兰-英格兰'],
  },
  {
    name: '未加引号的 add_edge',
    text: 'G.add_edge(A, B)\nG.add_edge(B, C)',
    regions: ['A', 'B', 'C'],
    edges: ['A-B', 'B-C'],
  },
  {
    name: '字典写法',
    text: 'G = nx.Graph({"A": ["B", "C"], "B": ["C"]})',
    regions: ['A', 'B', 'C'],
    edges: ['A-B', 'A-C', 'B-C'],
  },
  {
    name: '自环与重复边要去掉',
    text: 'A: A B\nB: A\nA B',
    regions: ['A', 'B'],
    edges: ['A-B'],
  },
]

let failures = 0
const check = (name: string, label: string, got: string, want: string) => {
  if (got === want) return
  failures++
  console.log(`  ✗ ${name} / ${label}\n      得到 ${got}\n      期望 ${want}`)
}

for (const c of CASES) {
  const { graph } = parseGraphText(c.text)
  const regions = [...graph.regions].sort().join(',')
  const edges = graph.edges.map(([a, b]) => `${a}-${b}`).sort().join(',')
  const ok = regions === [...c.regions].sort().join(',') && edges === [...c.edges].sort().join(',')
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${c.name}`)
  check(c.name, '区域', regions, [...c.regions].sort().join(','))
  check(c.name, '邻接', edges, [...c.edges].sort().join(','))

  // 回显成文本再解析一遍，图必须不变
  const round = parseGraphText(graphToText(graph)).graph
  check(
    c.name,
    '文本回显往返',
    [...round.regions].sort().join(',') + '|' + round.edges.map(([a, b]) => `${a}-${b}`).sort().join(','),
    regions + '|' + edges,
  )
}

console.log(failures ? `\n${failures} 项异常` : '\n全部通过')
process.exit(failures ? 1 : 0)
