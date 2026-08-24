import type { ArcModel, Loop, MapModel, Pt, RegionId } from './types'
import { polylineTo, round, smoothTo } from './smooth'
import { readableTextOn, resolveColor, type Palette } from './palette'

export interface RenderedRegion {
  id: RegionId
  d: string
  fill: string
  label: { text: string; x: number; y: number; fill: string } | null
}

export interface RenderedArc {
  id: string
  d: string
}

export interface RenderedMap {
  width: number
  height: number
  regions: RenderedRegion[]
  arcs: RenderedArc[]
  dual: { nodes: { id: RegionId; p: Pt }[]; edges: { a: Pt; b: Pt }[] } | null
  seaColor: string | null
  strokeColor: string
  strokeWidth: number
}

export function arcById(model: MapModel): Map<string, ArcModel> {
  return new Map(model.arcs.map((a) => [a.id, a]))
}

export function nodePos(model: MapModel): Map<string, Pt> {
  return new Map(model.nodes.map((n) => [n.id, n.p]))
}

/** 一条弧的完整控制点序列（含两端节点），可按需反向 */
export function arcPoints(arc: ArcModel, nodes: Map<string, Pt>, rev: boolean): Pt[] {
  const p0 = nodes.get(arc.n0)
  const p1 = nodes.get(arc.n1)
  if (!p0 || !p1) return []
  const pts = [p0, ...arc.mid, p1]
  return rev ? [...pts].reverse() : pts
}

/**
 * 单条弧的 path 片段（不含起始 M）。
 * 只依赖这条弧自己的点，不看邻弧——因此正向和反向画出的是同一条曲线，
 * 相邻两个区域共享这条边界时几何完全一致。
 */
function arcSegment(pts: Pt[], smooth: boolean): string {
  if (pts.length < 2) return ''
  return smooth ? smoothTo(pts, false) : polylineTo(pts)
}

function loopPath(model: MapModel, loop: Loop, arcs: Map<string, ArcModel>, nodes: Map<string, Pt>): string {
  const smooth = model.style !== 'geometric'
  let d = ''
  let started = false

  for (const ref of loop.arcs) {
    const arc = arcs.get(ref.arc)
    if (!arc) continue
    const pts = arcPoints(arc, nodes, ref.rev)
    if (pts.length < 2) continue
    if (!started) {
      d += `M${round(pts[0].x)} ${round(pts[0].y)}`
      started = true
    }
    d += arcSegment(pts, smooth)
  }
  return started ? d + 'Z' : ''
}

export function renderModel(model: MapModel, palette: Palette): RenderedMap {
  const arcs = arcById(model)
  const nodes = nodePos(model)
  const smooth = model.style !== 'geometric'

  const regions: RenderedRegion[] = model.regions.map((region) => {
    const fill = resolveColor(model.graph.colors[region.id], palette)
    const d = region.loops.map((loop) => loopPath(model, loop, arcs, nodes)).join('')
    return {
      id: region.id,
      d,
      fill,
      label: region.showLabel
        ? {
            text: region.id,
            x: round(region.labelPos.x),
            y: round(region.labelPos.y),
            fill: model.labelColor === 'auto' ? readableTextOn(fill) : model.labelColor,
          }
        : null,
    }
  })

  const renderedArcs: RenderedArc[] = model.arcs.map((arc) => {
    const pts = arcPoints(arc, nodes, false)
    if (pts.length < 2) return { id: arc.id, d: '' }
    return { id: arc.id, d: `M${round(pts[0].x)} ${round(pts[0].y)}` + arcSegment(pts, smooth) }
  })

  const dual = model.showDual
    ? {
        nodes: model.graph.regions
          .filter((id) => model.dualPos[id])
          .map((id) => ({ id, p: model.dualPos[id] })),
        edges: model.graph.edges
          .filter(([a, b]) => model.dualPos[a] && model.dualPos[b])
          .map(([a, b]) => ({ a: model.dualPos[a], b: model.dualPos[b] })),
      }
    : null

  return {
    width: model.width,
    height: model.height,
    regions,
    arcs: renderedArcs,
    dual,
    seaColor: model.seaColor,
    strokeColor: model.strokeColor,
    strokeWidth: model.strokeWidth,
  }
}

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!,
  )
}

/** 导出独立 SVG 文件。模型本身由 serialize.ts 以 metadata 形式嵌进来 */
export function toSvgString(model: MapModel, palette: Palette, metadata: string): string {
  const r = renderModel(model, palette)
  const parts: string[] = []

  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${r.width} ${r.height}" width="${r.width}" height="${r.height}">`,
  )
  parts.push(metadata)

  if (r.seaColor) parts.push(`<rect width="${r.width}" height="${r.height}" fill="${r.seaColor}"/>`)

  parts.push('<g id="regions">')
  for (const region of r.regions) {
    if (!region.d) continue
    parts.push(
      `<path id="region-${escapeXml(region.id)}" d="${region.d}" fill="${region.fill}" fill-rule="evenodd"/>`,
    )
  }
  parts.push('</g>')

  parts.push(
    `<g id="borders" fill="none" stroke="${r.strokeColor}" stroke-width="${r.strokeWidth}" stroke-linecap="round" stroke-linejoin="round">`,
  )
  for (const arc of r.arcs) {
    if (arc.d) parts.push(`<path id="${arc.id}" d="${arc.d}"/>`)
  }
  parts.push('</g>')

  if (r.dual) {
    parts.push('<g id="dual" stroke="#1a1a1a" stroke-width="2.2">')
    for (const e of r.dual.edges) {
      parts.push(`<line x1="${round(e.a.x)}" y1="${round(e.a.y)}" x2="${round(e.b.x)}" y2="${round(e.b.y)}"/>`)
    }
    for (const n of r.dual.nodes) {
      parts.push(`<circle cx="${round(n.p.x)}" cy="${round(n.p.y)}" r="6" fill="#1a1a1a"/>`)
    }
    parts.push('</g>')
  }

  const labels = r.regions.filter((x) => x.label)
  if (labels.length) {
    parts.push(
      `<g id="labels" font-family="Georgia, 'Times New Roman', serif" font-style="italic" font-size="${model.labelSize}" text-anchor="middle" dominant-baseline="central">`,
    )
    for (const region of labels) {
      const l = region.label!
      parts.push(`<text x="${l.x}" y="${l.y}" fill="${l.fill}">${escapeXml(l.text)}</text>`)
    }
    parts.push('</g>')
  }

  parts.push('</svg>')
  return parts.join('\n')
}
