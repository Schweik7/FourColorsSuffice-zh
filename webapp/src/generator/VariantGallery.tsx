import type { GenerateResult } from '../core/types'
import type { Palette } from '../core/palette'
import { renderModel } from '../core/render'
import MapView from './MapView'

interface Props {
  variants: GenerateResult[]
  palette: Palette
  busy: boolean
  onPick: (result: GenerateResult) => void
  onRegenerate: () => void
}

/** 把生成报告翻译成一句人话 */
export function describeReport(r: GenerateResult['report']): { tone: 'ok' | 'warn'; text: string } {
  if (r.ok) return { tone: 'ok', text: '邻接关系完全吻合' }
  if (r.problems.length) return { tone: 'warn', text: r.problems.join('；') }
  if (r.nonPlanarHint) return { tone: 'warn', text: r.nonPlanarHint }
  return { tone: 'warn', text: `画法里还剩 ${r.crossings} 处边交叉，这个图画不成地图` }
}

export default function VariantGallery({ variants, palette, busy, onPick, onRegenerate }: Props) {
  return (
    <div className="panel">
      <div className="panel-head">
        <h3>候选地图</h3>
        <button className="btn primary" onClick={onRegenerate} disabled={busy}>
          {busy ? '生成中…' : variants.length ? '↻ 再来一批' : '生成'}
        </button>
      </div>

      {!variants.length && !busy && (
        <p className="muted">点右上角「生成」，会一次画出若干张不同的候选，挑一张顺眼的进入编辑。</p>
      )}

      <div className="gallery">
        {variants.map((v, i) => {
          const rendered = renderModel(v.model, palette)
          const note = describeReport(v.report)
          return (
            <figure key={i} className="variant">
              <button className="variant-btn" onClick={() => onPick(v)} title="选它，进入编辑">
                <MapView rendered={rendered} labelSize={v.model.labelSize} className="variant-svg" />
              </button>
              <figcaption className={note.tone === 'ok' ? 'ok' : 'warn'}>
                {note.tone === 'ok' ? '✓' : '⚠'} {note.text}
              </figcaption>
            </figure>
          )
        })}
      </div>
    </div>
  )
}
