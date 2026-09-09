import { memo } from 'react';
import type { Anno, InkAnno, MarkupAnno, ShapeAnno } from '../lib/types';
import { toView, type Geom } from '../lib/geom';

interface Props {
  annos: Anno[];
  geom: Geom;
  selected: string | null;
  interactive: boolean;
  onPick: (id: string, e: React.PointerEvent) => void;
  draft?: Anno | null;
}

const V = (g: Geom, x: number, y: number) => toView(g, x, y);

function markupPath(g: Geom, r: { x: number; y: number; w: number; h: number }) {
  const a = V(g, r.x, r.y);
  const b = V(g, r.x + r.w, r.y + r.h);
  return {
    x: Math.min(a[0], b[0]),
    y: Math.min(a[1], b[1]),
    w: Math.abs(b[0] - a[0]),
    h: Math.abs(b[1] - a[1]),
  };
}

function Markup({
  a,
  g,
  interactive,
  onPick,
  selected,
}: {
  a: MarkupAnno;
  g: Geom;
  interactive: boolean;
  onPick: Props['onPick'];
  selected: boolean;
}) {
  return (
    <g
      className={interactive ? 'hit-fill' : undefined}
      onPointerDown={interactive ? (e) => onPick(a.id, e) : undefined}
      style={{ mixBlendMode: a.kind === 'highlight' ? 'multiply' : 'normal' }}
    >
      {a.rects.map((r, i) => {
        const b = markupPath(g, r);
        if (a.kind === 'highlight')
          return (
            <rect
              key={i}
              x={b.x}
              y={b.y}
              width={b.w}
              height={b.h}
              fill={a.color}
              opacity={a.opacity}
              rx={1.5}
            />
          );
        const th = Math.max(1, b.h * 0.07);
        const y = a.kind === 'underline' ? b.y + b.h * 0.94 : b.y + b.h * 0.55;
        return (
          <g key={i}>
            <rect
              x={b.x}
              y={y}
              width={b.w}
              height={th}
              fill={a.color}
              opacity={a.opacity}
            />
            {interactive && (
              <rect x={b.x} y={b.y} width={b.w} height={b.h} fill="transparent" />
            )}
          </g>
        );
      })}
      {selected &&
        a.rects.map((r, i) => {
          const b = markupPath(g, r);
          return (
            <rect
              key={`s${i}`}
              x={b.x - 1}
              y={b.y - 1}
              width={b.w + 2}
              height={b.h + 2}
              fill="none"
              stroke="#2f6bff"
              strokeWidth={1}
              strokeDasharray="3 2"
            />
          );
        })}
    </g>
  );
}

function Ink({
  a,
  g,
  interactive,
  onPick,
  selected,
}: {
  a: InkAnno;
  g: Geom;
  interactive: boolean;
  onPick: Props['onPick'];
  selected: boolean;
}) {
  const w = Math.max(0.6, a.width * g.scale);
  return (
    <g
      className={interactive ? 'hit' : undefined}
      onPointerDown={interactive ? (e) => onPick(a.id, e) : undefined}
    >
      {a.paths.map((p, i) => {
        const d = p
          .map((pt, j) => {
            const v = V(g, pt.x, pt.y);
            return `${j ? 'L' : 'M'}${v[0].toFixed(2)} ${v[1].toFixed(2)}`;
          })
          .join(' ');
        return (
          <path
            key={i}
            d={p.length === 1 ? `${d} l0.01 0.01` : d}
            fill="none"
            stroke={a.color}
            strokeWidth={w}
            strokeOpacity={a.opacity}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
            style={
              selected
                ? { filter: 'drop-shadow(0 0 2px #2f6bff)' }
                : undefined
            }
          />
        );
      })}
    </g>
  );
}

function Shape({
  a,
  g,
  interactive,
  onPick,
  selected,
}: {
  a: ShapeAnno;
  g: Geom;
  interactive: boolean;
  onPick: Props['onPick'];
  selected: boolean;
}) {
  const p1 = V(g, a.x1, a.y1);
  const p2 = V(g, a.x2, a.y2);
  const sw = Math.max(0.6, a.width * g.scale);
  const common = {
    stroke: a.color,
    strokeWidth: sw,
    strokeOpacity: a.opacity,
    fill: a.fill ?? 'none',
    fillOpacity: a.fill ? a.opacity : 0,
  } as const;
  const pick = interactive ? (e: React.PointerEvent) => onPick(a.id, e) : undefined;
  const cls = interactive ? (a.fill ? 'hit-fill' : 'hit') : undefined;

  let body: React.ReactNode = null;
  if (a.kind === 'rect') {
    body = (
      <rect
        x={Math.min(p1[0], p2[0])}
        y={Math.min(p1[1], p2[1])}
        width={Math.abs(p2[0] - p1[0])}
        height={Math.abs(p2[1] - p1[1])}
        {...common}
      />
    );
  } else if (a.kind === 'ellipse') {
    body = (
      <ellipse
        cx={(p1[0] + p2[0]) / 2}
        cy={(p1[1] + p2[1]) / 2}
        rx={Math.abs(p2[0] - p1[0]) / 2}
        ry={Math.abs(p2[1] - p1[1]) / 2}
        {...common}
      />
    );
  } else {
    const ang = Math.atan2(p2[1] - p1[1], p2[0] - p1[0]);
    const len = Math.max(8, a.width * 4) * g.scale;
    body = (
      <>
        <line x1={p1[0]} y1={p1[1]} x2={p2[0]} y2={p2[1]} {...common} fill="none" />
        {a.kind === 'arrow' &&
          [1, -1].map((s) => {
            const t = ang + s * (Math.PI - 0.42);
            return (
              <line
                key={s}
                x1={p2[0]}
                y1={p2[1]}
                x2={p2[0] + Math.cos(t) * len}
                y2={p2[1] + Math.sin(t) * len}
                {...common}
                fill="none"
              />
            );
          })}
      </>
    );
  }

  return (
    <g
      className={cls}
      onPointerDown={pick}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {body}
      {selected && (
        <rect
          x={Math.min(p1[0], p2[0]) - 3}
          y={Math.min(p1[1], p2[1]) - 3}
          width={Math.abs(p2[0] - p1[0]) + 6}
          height={Math.abs(p2[1] - p1[1]) + 6}
          fill="none"
          stroke="#2f6bff"
          strokeWidth={1}
          strokeDasharray="3 2"
        />
      )}
    </g>
  );
}

function AnnoSvgBase({ annos, geom, selected, interactive, onPick, draft }: Props) {
  const all = draft ? [...annos, draft] : annos;
  return (
    <svg className="anno-svg" width={geom.cw} height={geom.ch}>
      {all.map((a) => {
        const isSel = a.id === selected;
        const inter = interactive && a !== draft;
        if (a.kind === 'highlight' || a.kind === 'underline' || a.kind === 'strike')
          return (
            <Markup
              key={a.id}
              a={a}
              g={geom}
              interactive={inter}
              onPick={onPick}
              selected={isSel}
            />
          );
        if (a.kind === 'ink')
          return (
            <Ink
              key={a.id}
              a={a}
              g={geom}
              interactive={inter}
              onPick={onPick}
              selected={isSel}
            />
          );
        if (
          a.kind === 'rect' ||
          a.kind === 'ellipse' ||
          a.kind === 'line' ||
          a.kind === 'arrow'
        )
          return (
            <Shape
              key={a.id}
              a={a}
              g={geom}
              interactive={inter}
              onPick={onPick}
              selected={isSel}
            />
          );
        return null;
      })}
    </svg>
  );
}

export const AnnoSvg = memo(AnnoSvgBase);
