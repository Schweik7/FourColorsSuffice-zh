import type { MapModel } from './types'
import { PROTOCOL, PROTOCOL_VERSION } from './types'

export const NS = 'https://github.com/Schweik7/FourColorsSuffice-zh/ns/map-model'
const TAG = 'fcs:model'

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!,
  )
}

/**
 * 把整个模型塞进 SVG 的 <metadata>。
 * 用 XML 实体转义而不是 CDATA——区域名里万一出现 `]]>` 会把 CDATA 提前截断。
 */
export function embedMetadata(model: MapModel): string {
  const json = JSON.stringify(model)
  return [
    '<metadata>',
    `  <!-- 本图由《四色足矣》SVG 生成器绘制。下面这段是完整的可编辑模型，`,
    `       把本文件重新拖回生成器即可继续修改边界、配色与标签。 -->`,
    `  <${TAG} xmlns:fcs="${NS}" protocol="${PROTOCOL}" version="${PROTOCOL_VERSION}">${escapeXml(json)}</${TAG}>`,
    '</metadata>',
  ].join('\n')
}

function looksLikeModel(value: unknown): value is MapModel {
  if (!value || typeof value !== 'object') return false
  const m = value as Partial<MapModel>
  return (
    m.protocol === PROTOCOL &&
    typeof m.version === 'number' &&
    Array.isArray(m.arcs) &&
    Array.isArray(m.nodes) &&
    Array.isArray(m.regions) &&
    !!m.graph &&
    Array.isArray(m.graph.regions)
  )
}

export interface ExtractResult {
  model: MapModel | null
  error: string | null
}

/** 从 SVG 文本里取回模型 */
export function extractModel(svgText: string): ExtractResult {
  let raw: string | null = null

  try {
    const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml')
    if (!doc.querySelector('parsererror')) {
      const el =
        doc.getElementsByTagNameNS(NS, 'model')[0] ??
        doc.getElementsByTagName(TAG)[0] ??
        null
      if (el) raw = el.textContent
    }
  } catch {
    // 交给下面的正则兜底
  }

  if (raw === null) {
    const m = new RegExp(`<${TAG}[^>]*>([\\s\\S]*?)</${TAG}>`).exec(svgText)
    if (m) {
      // 正则路径拿到的是未解码的实体，手动还原
      raw = m[1]
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&apos;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&')
    }
  }

  if (raw === null) {
    return { model: null, error: '这个 SVG 里没有生成器的模型数据，无法继续编辑。只有本工具导出的 SVG 才能重新导入。' }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { model: null, error: '模型数据损坏，JSON 解析失败。' }
  }

  if (!looksLikeModel(parsed)) {
    return { model: null, error: '模型数据格式不认识（协议号对不上）。' }
  }
  if (parsed.version > PROTOCOL_VERSION) {
    return {
      model: null,
      error: `这个文件是用更新版本的生成器做的（模型 v${parsed.version}，当前支持到 v${PROTOCOL_VERSION}）。`,
    }
  }

  return { model: parsed, error: null }
}
