import type { PointerEvent as ReactPointerEvent, ReactNode, Ref } from 'react'
import type { RenderedMap } from '../core/render'

interface Props {
  rendered: RenderedMap
  className?: string
  /** 叠加层（编辑手柄等） */
  children?: ReactNode
  labelSize: number
  onRegionClick?: (id: string) => void
  highlightRegion?: string | null
  svgRef?: Ref<SVGSVGElement>
  onPointerMove?: (e: ReactPointerEvent<SVGSVGElement>) => void
  onPointerUp?: (e: ReactPointerEvent<SVGSVGElement>) => void
}

/** 只负责把 RenderedMap 画出来；交互由外层通过 children 叠加 */
export default function MapView({
  rendered,
  className,
  children,
  labelSize,
  onRegionClick,
  highlightRegion,
  svgRef,
  onPointerMove,
  onPointerUp,
}: Props) {
  return (
    <svg
      ref={svgRef}
      className={className}
      viewBox={`0 0 ${rendered.width} ${rendered.height}`}
      xmlns="http://www.w3.org/2000/svg"
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
    >
      {rendered.seaColor && (
        <rect width={rendered.width} height={rendered.height} fill={rendered.seaColor} />
      )}

      <g>
        {rendered.regions.map((r) =>
          r.d ? (
            <path
              key={r.id}
              d={r.d}
              fill={r.fill}
              fillRule="evenodd"
              className={onRegionClick ? 'region clickable' : 'region'}
              onClick={onRegionClick ? () => onRegionClick(r.id) : undefined}
            />
          ) : null,
        )}
      </g>

      {highlightRegion && (
        <g>
          {rendered.regions
            .filter((r) => r.id === highlightRegion && r.d)
            .map((r) => (
              <path
                key={r.id}
                d={r.d}
                fill="none"
                stroke="#1668dc"
                strokeWidth={rendered.strokeWidth * 2.4}
                strokeLinejoin="round"
                opacity={0.9}
              />
            ))}
        </g>
      )}

      <g
        fill="none"
        stroke={rendered.strokeColor}
        strokeWidth={rendered.strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {rendered.arcs.map((a) => (a.d ? <path key={a.id} d={a.d} /> : null))}
      </g>

      {rendered.dual && (
        <g stroke="#1a1a1a" strokeWidth={2.2}>
          {rendered.dual.edges.map((e, i) => (
            <line key={i} x1={e.a.x} y1={e.a.y} x2={e.b.x} y2={e.b.y} />
          ))}
          {rendered.dual.nodes.map((n) => (
            <circle key={n.id} cx={n.p.x} cy={n.p.y} r={6} fill="#1a1a1a" />
          ))}
        </g>
      )}

      <g
        fontFamily="Georgia, 'Times New Roman', serif"
        fontStyle="italic"
        fontSize={labelSize}
        textAnchor="middle"
        dominantBaseline="central"
        pointerEvents="none"
      >
        {rendered.regions.map((r) =>
          r.label ? (
            <text key={r.id} x={r.label.x} y={r.label.y} fill={r.label.fill}>
              {r.label.text}
            </text>
          ) : null,
        )}
      </g>

      {children}
    </svg>
  )
}
