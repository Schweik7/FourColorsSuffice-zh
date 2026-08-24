import { useState } from 'react'
import { SLOTS, isHex, resolveColor, type Palette, type Slot } from '../core/palette'

interface Props {
  value: string
  palette: Palette
  onChange: (value: string) => void
}

const SLOT_LABEL: Record<Slot, string> = {
  red: '红',
  green: '绿',
  yellow: '黄',
  blue: '蓝',
  gray: '灰',
}

/** 五个调色板槽位 + 自定义十六进制色号 */
export default function ColorPicker({ value, palette, onChange }: Props) {
  const [draft, setDraft] = useState('')
  const custom = isHex(value)

  return (
    <div className="color-picker">
      {SLOTS.map((slot) => (
        <button
          key={slot}
          type="button"
          className={value === slot ? 'swatch on' : 'swatch'}
          style={{ background: palette.colors[slot] }}
          title={`${SLOT_LABEL[slot]} ${palette.colors[slot]}`}
          onClick={() => onChange(slot)}
        >
          <span className="sr-only">{SLOT_LABEL[slot]}</span>
        </button>
      ))}

      <label className={custom ? 'swatch custom on' : 'swatch custom'} title="自定义色号">
        <span style={{ background: custom ? value : 'transparent' }} />
        <input
          type="color"
          value={custom ? resolveColor(value, palette) : '#888888'}
          onChange={(e) => onChange(e.target.value)}
        />
      </label>

      <input
        className="hex-input"
        placeholder={custom ? value : '#rrggbb'}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (isHex(draft)) onChange(draft.trim().toLowerCase())
          setDraft('')
        }}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return
          if (isHex(draft)) onChange(draft.trim().toLowerCase())
          setDraft('')
        }}
      />
    </div>
  )
}
