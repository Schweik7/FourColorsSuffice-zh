import type { GraphSpec, RegionId } from './types'
import { edgeKey, normalizeGraph } from './graph'

export interface ParseResult {
  graph: GraphSpec
  warnings: string[]
}

/** 区域名允许字母/数字/下划线/汉字，但不含空格与各种分隔符 */
const NAME_RE = /^[^\s,;:()[\]{}'"=<>-]+$/

function isName(token: string): boolean {
  return token.length > 0 && NAME_RE.test(token)
}

/** Python 里常见但与图无关的样板行，直接跳过、不必啰嗦 */
const BOILERPLATE_RE = /^\s*(import|from|def|class|return|print|if|for|while|@)\b/

/**
 * 这行像不像代码。
 * 纯文本的三种写法（邻接表 / 边表 / 孤立点）里不会出现括号和等号，
 * 所以见到它们就说明这是代码——而不该按「一行多个名字 = 一条链」去硬解，
 * 否则 `import networkx as nx` 会被读成 import–networkx–as–nx 四个区域。
 */
function looksLikeCode(line: string): boolean {
  return BOILERPLATE_RE.test(line) || /[=(){}[\]]/.test(line)
}

/**
 * 宽松解析 NetworkX 风格的图描述。同时接受：
 *
 *   邻接表      A: B C D          /  A -> B, C
 *   边表        A B   A-B   A--B  /  A,B
 *   孤立点      A
 *   Python 代码 G.add_edge("A", "B")
 *               G.add_edges_from([("A","B"), ("B","C")])
 *               G.add_nodes_from(["A", "B"])
 *               nx.Graph([("A","B")])
 *
 * `#` 与 `//` 之后是注释。
 */
export function parseGraphText(text: string): ParseResult {
  const warnings: string[] = []
  const regions: RegionId[] = []
  const seenRegion = new Set<RegionId>()
  const edges: [RegionId, RegionId][] = []
  const seenEdge = new Set<string>()

  const addRegion = (name: RegionId) => {
    if (seenRegion.has(name)) return
    seenRegion.add(name)
    regions.push(name)
  }
  const addEdge = (a: RegionId, b: RegionId) => {
    addRegion(a)
    addRegion(b)
    if (a === b) return
    const key = edgeKey(a, b)
    if (seenEdge.has(key)) return
    seenEdge.add(key)
    edges.push(a < b ? [a, b] : [b, a])
  }

  // ── 先扫一遍 Python 代码形态。带引号的字符串对是最可靠的信号 ──
  const codeLines = new Set<number>()
  const lines = text.split(/\r?\n/)

  lines.forEach((raw, i) => {
    if (!/add_edge|add_node|add_edges_from|add_nodes_from|nx\.|Graph\(/.test(raw)) return
    codeLines.add(i)

    // 字典写法：{"A": ["B", "C"], ...}
    // 必须排在元组之前——`["B", "C"]` 这段本身也符合元组的样子，
    // 先跑元组会把邻居列表误读成一条 B–C 边，把表头 A 整个丢掉。
    let m: RegExpExecArray | null
    const dictRe = /['"]([^'"]+)['"]\s*:\s*\[([^\]]*)\]/g
    let matchedDict = false
    while ((m = dictRe.exec(raw))) {
      const head = m[1]
      addRegion(head)
      const nbRe = /['"]([^'"]+)['"]/g
      let nb: RegExpExecArray | null
      while ((nb = nbRe.exec(m[2]))) addEdge(head, nb[1])
      matchedDict = true
    }
    if (matchedDict) return

    // 成对元组：("A","B") 或 ('A', 'B')
    const tupleRe = /[([]\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*[)\]]/g
    let matchedTuple = false
    while ((m = tupleRe.exec(raw))) {
      addEdge(m[1], m[2])
      matchedTuple = true
    }
    if (matchedTuple) return

    // 单独的节点列表：add_nodes_from(["A", "B"]) / add_node("A")
    if (/add_nodes?(_from)?\s*\(/.test(raw)) {
      const nameRe = /['"]([^'"]+)['"]/g
      while ((m = nameRe.exec(raw))) addRegion(m[1])
      return
    }

    // 未加引号的写法：G.add_edge(A, B)
    const bare = /add_edge\s*\(\s*([^\s,()'"]+)\s*,\s*([^\s,()'"]+)\s*\)/.exec(raw)
    if (bare) {
      addEdge(bare[1], bare[2])
      return
    }

    codeLines.delete(i) // 认不出来，交给下面的纯文本分支
  })

  // ── 纯文本形态 ──
  lines.forEach((raw, i) => {
    if (codeLines.has(i)) return
    const line = raw.replace(/#.*$/, '').replace(/\/\/.*$/, '').trim()
    if (!line) return

    // 没被上面认出来的代码行，不能再按纯文本硬解
    if (looksLikeCode(line)) {
      if (!BOILERPLATE_RE.test(line)) {
        warnings.push(`第 ${i + 1} 行：认不出这句代码，已跳过 —— "${line}"`)
      }
      return
    }

    // 邻接表：左边一个名字，冒号/箭头后跟邻居列表
    const adj = /^([^\s:>]+)\s*(?::|->|=>)\s*(.*)$/.exec(line)
    if (adj) {
      const head = adj[1].trim()
      if (!isName(head)) {
        warnings.push(`第 ${i + 1} 行："${head}" 不是合法的区域名，已跳过`)
        return
      }
      addRegion(head)
      const rest = adj[2].split(/[\s,;]+/).filter(Boolean)
      for (const nb of rest) {
        if (isName(nb)) addEdge(head, nb)
        else warnings.push(`第 ${i + 1} 行："${nb}" 不是合法的区域名，已跳过`)
      }
      return
    }

    // 边表 / 孤立点：把各种连接符统一成空格再切
    const tokens = line
      .replace(/--+/g, ' ')
      .split(/[\s,;]+|(?<=[^\s])-(?=[^\s])/)
      .map((t) => t.trim())
      .filter(Boolean)

    if (tokens.length === 1) {
      if (isName(tokens[0])) addRegion(tokens[0])
      else warnings.push(`第 ${i + 1} 行：无法识别 "${line}"`)
      return
    }

    if (tokens.every(isName)) {
      // 一行多个名字视为一条链：A B C == A-B, B-C
      for (let k = 0; k + 1 < tokens.length; k++) addEdge(tokens[k], tokens[k + 1])
      return
    }

    warnings.push(`第 ${i + 1} 行：无法识别 "${line}"`)
  })

  const colors: Record<RegionId, string> = {}
  for (const id of regions) colors[id] = 'gray'

  return { graph: normalizeGraph({ regions, edges, colors }), warnings }
}

/** 反向：把图导出成邻接表文本，供文本框回显 */
export function graphToText(graph: GraphSpec): string {
  const lines: string[] = []
  const emitted = new Set<string>()

  for (const id of graph.regions) {
    const nbs = graph.edges
      .filter(([a, b]) => a === id || b === id)
      .map(([a, b]) => (a === id ? b : a))
      // 只在「字典序靠前」的一侧列出，避免 A: B 和 B: A 重复
      .filter((nb) => {
        const key = edgeKey(id, nb)
        if (emitted.has(key)) return false
        emitted.add(key)
        return true
      })
    lines.push(nbs.length ? `${id}: ${nbs.join(' ')}` : id)
  }
  return lines.join('\n')
}
