import { useMemo, useRef, useState } from 'react'
import type { GenerateResult, GraphSpec, MapModel, Pt, StyleKind } from '../core/types'
import { fourColor } from '../core/graph'
import { parseGraphText } from '../core/parse'
import { generateVariants } from '../core/generate'
import { extractModel } from '../core/serialize'
import { paletteByKey } from '../core/palette'
import GraphInput from './GraphInput'
import StylePicker from './StylePicker'
import VariantGallery, { describeReport } from './VariantGallery'
import MapEditor from './MapEditor'

const WIDTH = 900
const HEIGHT = 640
const VARIANT_COUNT = 6

function initialGraph(): GraphSpec {
  const { graph } = parseGraphText('A: B C D\nB: C D\nC: D')
  const colors = fourColor(graph)
  return { ...graph, colors }
}

export default function GeneratorTab() {
  const [graph, setGraph] = useState<GraphSpec>(initialGraph)
  const [style, setStyle] = useState<StyleKind>('map')
  const [framePolygon, setFramePolygon] = useState<Pt[]>([])
  const [variants, setVariants] = useState<GenerateResult[]>([])
  const [model, setModel] = useState<MapModel | null>(null)
  const [paletteKey, setPaletteKey] = useState('standard')
  const [busy, setBusy] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const seedRef = useRef(Math.floor(Math.random() * 0xffffffff))
  const fileRef = useRef<HTMLInputElement>(null)

  const palette = useMemo(() => paletteByKey(paletteKey), [paletteKey])

  const regenerate = () => {
    if (!graph.regions.length) return
    setBusy(true)
    // 让浏览器先把「生成中」画出来，再做这几十毫秒的同步计算
    setTimeout(() => {
      seedRef.current = (seedRef.current + 0x1000193) >>> 0
      setVariants(
        generateVariants(
          graph,
          { style, seed: seedRef.current, width: WIDTH, height: HEIGHT, framePolygon },
          VARIANT_COUNT,
        ),
      )
      setBusy(false)
    }, 0)
  }

  const importSvg = async (file: File) => {
    setImportError(null)
    const text = await file.text()
    const { model: parsed, error } = extractModel(text)
    if (!parsed) {
      setImportError(error)
      return
    }
    setModel(parsed)
    setGraph(parsed.graph)
    setStyle(parsed.style)
    setVariants([])
  }

  if (model) {
    return (
      <MapEditor
        model={model}
        palette={palette}
        paletteKey={paletteKey}
        onPaletteChange={setPaletteKey}
        onChange={setModel}
        onBack={() => setModel(null)}
      />
    )
  }

  const picked = variants.find((v) => v.report.ok) ?? variants[0]

  return (
    <div className="generator">
      <div className="generator-left">
        <GraphInput graph={graph} palette={palette} onChange={setGraph} />
        <StylePicker
          style={style}
          onStyleChange={setStyle}
          framePolygon={framePolygon}
          onFrameChange={setFramePolygon}
          width={WIDTH}
          height={HEIGHT}
        />

        <div className="panel">
          <div className="panel-head">
            <h3>导入已有 SVG</h3>
          </div>
          <p className="muted">
            本工具导出的 SVG 里嵌了完整模型，拖回来就能接着改边界、配色和标签。
          </p>
          <input
            ref={fileRef}
            type="file"
            accept=".svg,image/svg+xml"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void importSvg(file)
              e.target.value = ''
            }}
          />
          <button className="btn" onClick={() => fileRef.current?.click()}>
            选择 SVG 文件…
          </button>
          {importError && <p className="warn strong">{importError}</p>}
        </div>
      </div>

      <div className="generator-right">
        <VariantGallery
          variants={variants}
          palette={palette}
          busy={busy}
          onPick={(v) => setModel(v.model)}
          onRegenerate={regenerate}
        />
        {picked && !picked.report.ok && (
          <p className="warn strong">
            这批候选都没能完全对上邻接关系（最好的一版：{describeReport(picked.report).text}）。
            多半是这个图不是平面图——平面图才画得出地图。可以再点几次「再来一批」碰运气，
            或回去检查邻接关系。
          </p>
        )}
      </div>
    </div>
  )
}
