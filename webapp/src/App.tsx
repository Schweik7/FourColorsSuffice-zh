import { useState } from 'react'
import ReviewTab from './review/ReviewTab'
import GeneratorTab from './generator/GeneratorTab'
import PaintTab from './generator/PaintTab'
import { readStore, usePersist } from './core/persist'

type Tab = 'paint' | 'generator' | 'review'

const TAB_KEY = 'fct-tab-v1'

const TABS: { key: Tab; label: string; hint: string }[] = [
  { key: 'paint', label: '地图绘制台', hint: '在网格上涂出区域，邻接关系自动量出来' },
  { key: 'generator', label: 'SVG 生成器', hint: '按邻接关系生成四色地图' },
  { key: 'review', label: '插图校对台', hint: '原图与重绘 SVG 对照审阅' },
]

export default function App() {
  const [tab, setTab] = useState<Tab>(() => {
    const saved = readStore<Tab>(TAB_KEY)
    return TABS.some((t) => t.key === saved) ? saved! : 'paint'
  })
  usePersist(TAB_KEY, tab, 0)

  return (
    <div className="app">
      <header className="app-header">
        <h1>《四色足矣》插图工作台</h1>
        <nav className="tabs">
          {TABS.map((t) => (
            <button
              key={t.key}
              className={t.key === tab ? 'tab on' : 'tab'}
              onClick={() => setTab(t.key)}
              title={t.hint}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      {/* 各页都保持挂载：画布、校对进度、生成器里的草稿都不该因为切页而丢失 */}
      <div className="tab-panel" hidden={tab !== 'paint'}>
        <PaintTab />
      </div>
      <div className="tab-panel" hidden={tab !== 'generator'}>
        <GeneratorTab />
      </div>
      <div className="tab-panel" hidden={tab !== 'review'}>
        <ReviewTab />
      </div>
    </div>
  )
}
