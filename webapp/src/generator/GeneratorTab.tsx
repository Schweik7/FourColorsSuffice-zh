import { useMemo, useRef, useState } from 'react'
import type { GenerateResult, GraphSpec, MapModel, Pt, StyleKind } from '../core/types'
import { fourColor, normalizeGraph } from '../core/graph'
import { parseGraphText } from '../core/parse'
import { generateVariants } from '../core/generate'
import { extractModel, looksLikeModel } from '../core/serialize'
import { paletteByKey } from '../core/palette'
import { readStore, storageAvailable, usePersist } from '../core/persist'
import GraphInput from './GraphInput'
import StylePicker from './StylePicker'
import VariantGallery, { describeReport } from './VariantGallery'
import MapEditor from './MapEditor'

const WIDTH = 900
const HEIGHT = 640
const VARIANT_COUNT = 6

/**
 * 本地草稿分三条存，各写各的：
 * 参数很小、改得勤；候选一批将近一兆；编辑中的模型在拖动时每帧都变。
 * 混在一条里的话，拖一下边界就要把整批候选重新序列化一遍。
 */
const DRAFT_KEY = 'fct-gen-draft-v1'
const BATCH_KEY = 'fct-gen-batch-v1'
const MODEL_KEY = 'fct-gen-model-v1'

const STYLES: StyleKind[] = ['bands', 'geometric', 'map', 'frame']

interface Draft {
  graph: GraphSpec
  style: StyleKind
  framePolygon: Pt[]
  paletteKey: string
  seed: number
}

// ── 本地存储里的东西一律当作不可信输入：可能是上一版程序留下的，也可能被手改过 ──

function isGraph(value: unknown): value is GraphSpec {
  const g = value as Partial<GraphSpec> | null
  if (!g || typeof g !== 'object') return false
  if (!Array.isArray(g.regions) || !g.regions.every((id) => typeof id === 'string')) return false
  if (!Array.isArray(g.edges)) return false
  if (!g.edges.every((e) => Array.isArray(e) && e.length === 2 && e.every((x) => typeof x === 'string')))
    return false
  return !!g.colors && typeof g.colors === 'object'
}

function isPointList(value: unknown): value is Pt[] {
  return (
    Array.isArray(value) &&
    value.every((p) => p && typeof p.x === 'number' && typeof p.y === 'number')
  )
}

function randomSeed() {
  return Math.floor(Math.random() * 0xffffffff) >>> 0
}

function defaultDraft(): Draft {
  const { graph } = parseGraphText('A: B C D\nB: C D\nC: D')
  return {
    graph: { ...graph, colors: fourColor(graph) },
    style: 'bands',
    framePolygon: [],
    paletteKey: 'standard',
    seed: randomSeed(),
  }
}

/** 读上次的参数。有任何一处对不上就整份丢掉——宁可从示例重来，也别把半截状态铺开 */
function loadDraft(): Draft {
  const raw = readStore<Partial<Draft>>(DRAFT_KEY)
  if (!raw || !isGraph(raw.graph) || !STYLES.includes(raw.style as StyleKind)) return defaultDraft()
  return {
    graph: normalizeGraph(raw.graph),
    style: raw.style as StyleKind,
    framePolygon: isPointList(raw.framePolygon) ? raw.framePolygon : [],
    paletteKey: typeof raw.paletteKey === 'string' ? raw.paletteKey : 'standard',
    seed: typeof raw.seed === 'number' ? raw.seed >>> 0 : randomSeed(),
  }
}

/** 读上次那一批候选 */
function loadBatch(): GenerateResult[] {
  const raw = readStore<unknown>(BATCH_KEY)
  if (!Array.isArray(raw)) return []
  const ok = raw.every(
    (r) => r && typeof r === 'object' && looksLikeModel((r as GenerateResult).model) && (r as GenerateResult).report,
  )
  return ok ? (raw as GenerateResult[]) : []
}

/** 读上次正在编辑的那张图 */
function loadModel(): MapModel | null {
  const raw = readStore<unknown>(MODEL_KEY)
  return looksLikeModel(raw) ? raw : null
}

export default function GeneratorTab() {
  // 只在首次挂载时读一次本地草稿
  const [initial] = useState(loadDraft)

  const [graph, setGraph] = useState<GraphSpec>(initial.graph)
  const [style, setStyle] = useState<StyleKind>(initial.style)
  const [framePolygon, setFramePolygon] = useState<Pt[]>(initial.framePolygon)
  const [paletteKey, setPaletteKey] = useState(initial.paletteKey)
  const [variants, setVariants] = useState<GenerateResult[]>(loadBatch)
  const [model, setModel] = useState<MapModel | null>(loadModel)
  const [busy, setBusy] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const seedRef = useRef(initial.seed)
  const fileRef = useRef<HTMLInputElement>(null)

  const palette = useMemo(() => paletteByKey(paletteKey), [paletteKey])

  // 三条草稿各自落盘。model 用长一点的防抖：拖边界时它每帧都变
  usePersist(DRAFT_KEY, { graph, style, framePolygon, paletteKey, seed: seedRef.current })
  usePersist(BATCH_KEY, variants.length ? variants : null)
  usePersist(MODEL_KEY, model, 600)

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
          {!storageAvailable && (
            <p className="warn">
              浏览器不让本页使用本地存储（隐私模式？），刷新后草稿不会保留，请及时导出 SVG。
            </p>
          )}
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
            这个图画不成地图：{describeReport(picked.report).text}
            <br />
            地图的邻接图一定是平面图，反之亦然。再点「再来一批」也没用——
            生成过程是确定的，不是碰运气，换个种子结果一样。请回去改邻接关系。
          </p>
        )}
      </div>
    </div>
  )
}
