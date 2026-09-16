import { useEffect, useMemo, useRef, useState } from 'react';
import { boxCss, type Geom } from '../lib/geom';
import { cssFontFor, runsForPage, type TextRun } from '../lib/textedit';
import { useStore } from '../state/store';

/** Colour of the page just outside a run, so the original can be masked while
 *  the replacement is previewed. Reading the rendered canvas handles tinted
 *  and shaded backgrounds that a hardcoded white would get wrong. */
function sampleBackground(
  canvas: HTMLCanvasElement | null,
  geom: Geom,
  run: TextRun,
): string {
  if (!canvas || !canvas.width) return '#ffffff';
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return '#ffffff';
  const dpr = canvas.width / Math.max(1, geom.cw);
  const [vx, vy] = geom.vp.convertToViewportPoint(run.x, run.y);
  const h = (run.ascent - run.descent) * run.fontSize * geom.scale;
  const w = run.width * geom.scale;

  const probes: [number, number][] = [
    [vx - 4, vy - h * 0.5],
    [vx + w + 4, vy - h * 0.5],
    [vx + w * 0.5, vy - h * 1.15],
    [vx + w * 0.5, vy + h * 0.35],
  ];
  const seen: number[][] = [];
  for (const [px, py] of probes) {
    const cx = Math.round(px * dpr);
    const cy = Math.round(py * dpr);
    if (cx < 0 || cy < 0 || cx >= canvas.width || cy >= canvas.height) continue;
    try {
      const d = ctx.getImageData(cx, cy, 1, 1).data;
      seen.push([d[0], d[1], d[2]]);
    } catch {
      /* tainted or zero-sized canvas */
    }
  }
  if (!seen.length) return '#ffffff';
  // the lightest probe is the one least likely to have clipped a glyph
  const best = seen.reduce((a, b) => (a[0] + a[1] + a[2] >= b[0] + b[1] + b[2] ? a : b));
  return `rgb(${best[0]}, ${best[1]}, ${best[2]})`;
}

interface Props {
  page: number;
  geom: Geom;
  canvas: HTMLCanvasElement | null;
  active: boolean;
}

export function TextEditLayer({ page, geom, canvas, active }: Props) {
  const docId = useStore((s) => s.docId);
  const bytes = useStore((s) => s.bytes);
  const textEdits = useStore((s) => s.textEdits);
  const setTextEdit = useStore((s) => s.setTextEdit);
  const notify = useStore((s) => s.notify);

  const [runs, setRuns] = useState<TextRun[] | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!active || !bytes || runs) return;
    let alive = true;
    runsForPage(docId, bytes, page).then((r) => alive && setRuns(r));
    return () => {
      alive = false;
    };
  }, [active, bytes, docId, page, runs]);

  useEffect(() => setRuns(null), [docId]);

  useEffect(() => {
    if (editing !== null) inputRef.current?.focus();
  }, [editing]);

  const editFor = useMemo(() => {
    const m = new Map<number, string>();
    for (const e of textEdits) if (e.page === page) m.set(e.runId, e.text);
    return m;
  }, [textEdits, page]);

  if (!runs?.length) return null;

  const commit = (run: TextRun, value: string) => {
    setEditing(null);
    if (value === (editFor.get(run.id) ?? run.text)) return;
    if (!run.canReencode && value.trim() === '') return;
    setTextEdit(page, run.id, value, run.text);
  };

  return (
    <>
      {runs.map((run) => {
        // Text on a slant would need the box to rotate with it; leave those be
        // rather than offering an edit that lands in the wrong place.
        if (Math.abs(run.rotation) > 0.01) return null;

        const height = (run.ascent - run.descent) * run.fontSize;
        const css = boxCss(geom, run.x, run.y + run.descent * run.fontSize, run.width, height);
        const edited = editFor.get(run.id);
        const isEditing = editing === run.id;
        const shown = edited ?? run.text;
        const style: React.CSSProperties = {
          ...cssFontFor(run),
          fontSize: run.fontSize * geom.scale,
          color: `rgb(${run.color.map((c) => Math.round(c * 255)).join(',')})`,
          lineHeight: `${css.height}px`,
        };

        if (isEditing) {
          return (
            <input
              key={run.id}
              ref={inputRef}
              className="text-run editing"
              style={{ ...css, ...style, background: sampleBackground(canvas, geom, run) }}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => commit(run, draft)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') commit(run, draft);
                if (e.key === 'Escape') setEditing(null);
              }}
            />
          );
        }

        if (edited !== undefined) {
          return (
            <div
              key={run.id}
              className={`text-run edited${active ? ' live' : ''}`}
              style={{ ...css, ...style, background: sampleBackground(canvas, geom, run) }}
              title={`Was: ${run.text}`}
              onClick={() => {
                if (!active) return;
                setDraft(shown);
                setEditing(run.id);
              }}
            >
              {shown}
            </div>
          );
        }

        if (!active) return null;

        return (
          <div
            key={run.id}
            className="text-run"
            style={css}
            title={run.canReencode ? run.text : `${run.text} — this font may need substituting`}
            onClick={() => {
              if (!run.canReencode) {
                notify('This font has a limited character set — edits may be redrawn in a close match.');
              }
              setDraft(run.text);
              setEditing(run.id);
            }}
          />
        );
      })}
    </>
  );
}
