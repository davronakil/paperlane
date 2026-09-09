import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { pdfjsLib, type PDFDocumentProxy, type PDFPageProxy } from '../lib/pdfjs';
import type { Anno, InkAnno, PageState, Pt, SearchHit, ShapeAnno } from '../lib/types';
import {
  distToSeg,
  makeGeom,
  pdfSpaceTransform,
  toPdf,
  toView,
  type Geom,
} from '../lib/geom';
import { useStore } from '../state/store';
import { AnnoSvg } from './AnnoSvg';
import { BoxAnnos } from './BoxAnnos';
import { FormLayer } from './FormLayer';
import { uid } from '../lib/util';

const DRAW_TOOLS = new Set(['ink', 'eraser', 'text', 'note', 'rect', 'ellipse', 'line', 'arrow']);
const MARKUP_TOOLS = new Set(['highlight', 'underline', 'strike']);

export interface PageHandle {
  el: HTMLDivElement;
  geom: Geom;
}

interface Props {
  pdf: PDFDocumentProxy;
  pageNum: number; // 1-based original page number
  pageState: PageState;
  availW: number;
  availH: number;
  displayIndex: number;
  hits: SearchHit[];
  activeHit: SearchHit | null;
  register: (n: number, h: PageHandle | null) => void;
  onIntersect: (n: number, ratio: number) => void;
}

export function Page({
  pdf,
  pageNum,
  pageState,
  availW,
  availH,
  displayIndex,
  hits,
  activeHit,
  register,
  onIntersect,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const stackRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);

  const [page, setPage] = useState<PDFPageProxy | null>(null);
  const [near, setNear] = useState(false);
  const [draft, setDraft] = useState<Anno | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  const tool = useStore((s) => s.tool);
  const zoom = useStore((s) => s.zoom);
  const fitMode = useStore((s) => s.fitMode);
  const color = useStore((s) => s.inkColor);
  const strokeWidth = useStore((s) => s.strokeWidth);
  const opacity = useStore((s) => s.opacity);
  const fontSize = useStore((s) => s.fontSize);
  const fontKey = useStore((s) => s.fontKey);
  const fillEnabled = useStore((s) => s.fillEnabled);
  const annos = useStore((s) => s.annos);
  const fields = useStore((s) => s.fields);
  const showFields = useStore((s) => s.showFields);
  const selectedAnno = useStore((s) => s.selectedAnno);
  const pendingStamp = useStore((s) => s.pendingStamp);
  const addAnno = useStore((s) => s.addAnno);
  const removeAnno = useStore((s) => s.removeAnno);
  const setState = useStore((s) => s.set);

  const idx = pageNum - 1;
  const pageAnnos = useMemo(() => annos.filter((a) => a.page === idx), [annos, idx]);
  const pageFields = useMemo(() => fields.filter((f) => f.page === idx), [fields, idx]);

  // ---- load the page object --------------------------------------------
  useEffect(() => {
    let alive = true;
    pdf.getPage(pageNum).then((p) => alive && setPage(p));
    return () => {
      alive = false;
    };
  }, [pdf, pageNum]);

  // ---- geometry ---------------------------------------------------------
  const totalRotation = page
    ? (((page.rotate + pageState.rotation) % 360) + 360) % 360
    : 0;

  const geom = useMemo(() => {
    if (!page) return null;
    const unit = page.getViewport({ scale: 1, rotation: totalRotation });
    let scale = zoom;
    if (fitMode === 'width') scale = Math.max(0.1, (availW - 64) / unit.width);
    else if (fitMode === 'page')
      scale = Math.max(
        0.1,
        Math.min((availW - 64) / unit.width, (availH - 56) / unit.height),
      );
    scale = Math.min(8, Math.max(0.1, scale));
    return makeGeom(page.getViewport({ scale, rotation: totalRotation }), scale);
  }, [page, totalRotation, zoom, fitMode, availW, availH]);

  // ---- visibility -------------------------------------------------------
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) onIntersect(pageNum, e.intersectionRatio);
      },
      { threshold: [0, 0.1, 0.35, 0.6, 0.9] },
    );
    const nearIo = new IntersectionObserver(
      (entries) => setNear(entries.some((e) => e.isIntersecting)),
      { rootMargin: '1200px 0px' },
    );
    io.observe(el);
    nearIo.observe(el);
    return () => {
      io.disconnect();
      nearIo.disconnect();
    };
  }, [pageNum, onIntersect]);

  // ---- register handle for cross-page features --------------------------
  useLayoutEffect(() => {
    if (stackRef.current && geom) register(pageNum, { el: stackRef.current, geom });
    return () => register(pageNum, null);
  }, [pageNum, geom, register]);

  // ---- canvas render ----------------------------------------------------
  useEffect(() => {
    if (!page || !geom || !near) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(2.5, window.devicePixelRatio || 1);
    canvas.width = Math.floor(geom.cw * dpr);
    canvas.height = Math.floor(geom.ch * dpr);
    canvas.style.width = `${geom.cw}px`;
    canvas.style.height = `${geom.ch}px`;
    const ctx = canvas.getContext('2d', { alpha: false })!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, geom.cw, geom.ch);

    const task = page.render({
      canvasContext: ctx as any,
      viewport: geom.vp,
      // draw form widgets ourselves; keep static annotations from the file
      annotationMode: pdfjsLib.AnnotationMode.ENABLE,
    });
    task.promise.catch(() => {});
    return () => task.cancel();
  }, [page, geom, near]);

  // A rendered page holds a full-resolution bitmap — roughly 19 MB at fit-width
  // on a Retina display. Keeping every page that has ever scrolled past would
  // grow without bound and eventually take the web process down, so drop the
  // backing store as soon as a page leaves the render window. The element keeps
  // its CSS size, so layout and scroll position are untouched, and the effect
  // above repaints it if the page comes back.
  useEffect(() => {
    if (near) return;
    const canvas = canvasRef.current;
    if (canvas && canvas.width > 0) {
      canvas.width = 0;
      canvas.height = 0;
    }
    // pdf.js also caches the page's parsed operator list and fonts after a
    // render; without this a long document keeps every page it has shown.
    try {
      page?.cleanup();
    } catch {
      /* a render was still settling — it will be cleaned up next time */
    }
  }, [near, page]);

  // ---- text layer -------------------------------------------------------
  useEffect(() => {
    if (!page || !geom || !near) return;
    const container = textRef.current;
    if (!container) return;
    container.replaceChildren();
    container.style.setProperty('--scale-factor', String(geom.scale));
    let cancelled = false;
    let layer: any = null;
    (async () => {
      const tc = await page.getTextContent();
      if (cancelled) return;
      layer = new (pdfjsLib as any).TextLayer({
        textContentSource: tc,
        container,
        viewport: geom.vp,
      });
      await layer.render();
      if (cancelled) return;
      container.style.width = `${geom.cw}px`;
      container.style.height = `${geom.ch}px`;
    })();
    return () => {
      cancelled = true;
      try {
        layer?.cancel?.();
      } catch {
        /* noop */
      }
    };
  }, [page, geom, near]);

  // ---- drawing ----------------------------------------------------------
  const drawing = useRef<{
    kind: string;
    start: [number, number];
    pts: Pt[];
    end: [number, number];
  } | null>(null);

  const localPoint = (e: React.PointerEvent | PointerEvent): [number, number] => {
    const r = stackRef.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };

  const eraseAt = (px: number, py: number, tol: number) => {
    for (let i = pageAnnos.length - 1; i >= 0; i--) {
      const a = pageAnnos[i];
      let hit = false;
      if (a.kind === 'ink') {
        for (const path of a.paths) {
          for (let j = 1; j < path.length && !hit; j++)
            if (
              distToSeg(px, py, path[j - 1].x, path[j - 1].y, path[j].x, path[j].y) <
              tol + a.width
            )
              hit = true;
          if (path.length === 1 && Math.hypot(path[0].x - px, path[0].y - py) < tol)
            hit = true;
          if (hit) break;
        }
      } else if (
        a.kind === 'rect' ||
        a.kind === 'ellipse' ||
        a.kind === 'line' ||
        a.kind === 'arrow'
      ) {
        const lo = { x: Math.min(a.x1, a.x2), y: Math.min(a.y1, a.y2) };
        const hi = { x: Math.max(a.x1, a.x2), y: Math.max(a.y1, a.y2) };
        hit =
          px > lo.x - tol && px < hi.x + tol && py > lo.y - tol && py < hi.y + tol;
      } else if (
        a.kind === 'highlight' ||
        a.kind === 'underline' ||
        a.kind === 'strike'
      ) {
        hit = a.rects.some(
          (r) => px > r.x && px < r.x + r.w && py > r.y && py < r.y + r.h,
        );
      } else if (a.kind === 'text' || a.kind === 'image') {
        hit = px > a.x && px < a.x + a.w && py > a.y && py < a.y + a.h;
      } else if (a.kind === 'note') {
        hit = px > a.x && px < a.x + 22 && py > a.y && py < a.y + 22;
      }
      if (hit) {
        removeAnno(a.id);
        return;
      }
    }
  };

  const onCaptureDown = (e: React.PointerEvent) => {
    if (!geom) return;
    e.preventDefault();
    const [cx, cy] = localPoint(e);
    const [px, py] = toPdf(geom, cx, cy);

    if (pendingStamp) {
      const h = pendingStamp.kind === 'initials' ? 34 : 46;
      const w = h * pendingStamp.ratio;
      addAnno({
        id: uid(),
        page: idx,
        kind: 'image',
        createdAt: Date.now(),
        x: px - w / 2,
        y: py - h / 2,
        w,
        h,
        src: pendingStamp.src,
        label: pendingStamp.label,
      });
      setState('pendingStamp', null);
      setState('tool', 'select');
      return;
    }

    if (tool === 'eraser') {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      drawing.current = { kind: 'eraser', start: [px, py], pts: [], end: [px, py] };
      eraseAt(px, py, 4 / geom.scale);
      return;
    }

    if (tool === 'text') {
      const w = 180;
      const h = Math.max(20, fontSize * 1.6);
      const a: Anno = {
        id: uid(),
        page: idx,
        kind: 'text',
        createdAt: Date.now(),
        x: px,
        y: py - h,
        w,
        h,
        text: '',
        color,
        size: fontSize,
        font: fontKey,
        align: 'left',
      };
      addAnno(a);
      setEditing(a.id);
      setState('tool', 'select');
      return;
    }

    if (tool === 'note') {
      const a: Anno = {
        id: uid(),
        page: idx,
        kind: 'note',
        createdAt: Date.now(),
        x: px - 11,
        y: py - 11,
        text: '',
        color,
      };
      addAnno(a);
      setEditing(a.id);
      setState('tool', 'select');
      return;
    }

    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drawing.current = {
      kind: tool,
      start: [px, py],
      pts: [{ x: px, y: py }],
      end: [px, py],
    };
    if (tool === 'ink') {
      setDraft({
        id: '__draft',
        page: idx,
        kind: 'ink',
        createdAt: Date.now(),
        paths: [[{ x: px, y: py }]],
        color,
        width: strokeWidth,
        opacity: 1,
      } as InkAnno);
    } else {
      setDraft({
        id: '__draft',
        page: idx,
        kind: tool as ShapeAnno['kind'],
        createdAt: Date.now(),
        x1: px,
        y1: py,
        x2: px,
        y2: py,
        color,
        fill: fillEnabled ? color : null,
        width: strokeWidth,
        opacity: fillEnabled ? opacity : 1,
      } as ShapeAnno);
    }
  };

  const onCaptureMove = (e: React.PointerEvent) => {
    const d = drawing.current;
    if (!d || !geom) return;
    const [cx, cy] = localPoint(e);
    const [px, py] = toPdf(geom, cx, cy);

    if (d.kind === 'eraser') {
      eraseAt(px, py, 4 / geom.scale);
      return;
    }
    if (d.kind === 'ink') {
      const last = d.pts[d.pts.length - 1];
      if (Math.hypot(px - last.x, py - last.y) * geom.scale < 1.4) return;
      d.pts.push({ x: px, y: py });
      setDraft((prev) =>
        prev && prev.kind === 'ink'
          ? ({ ...prev, paths: [d.pts.slice()] } as InkAnno)
          : prev,
      );
      return;
    }
    let x2 = px;
    let y2 = py;
    if (e.shiftKey) {
      if (d.kind === 'line' || d.kind === 'arrow') {
        const dx = px - d.start[0];
        const dy = py - d.start[1];
        if (Math.abs(dx) > Math.abs(dy)) y2 = d.start[1];
        else x2 = d.start[0];
      } else {
        const s = Math.max(Math.abs(px - d.start[0]), Math.abs(py - d.start[1]));
        x2 = d.start[0] + Math.sign(px - d.start[0] || 1) * s;
        y2 = d.start[1] + Math.sign(py - d.start[1] || 1) * s;
      }
    }
    d.end = [x2, y2];
    setDraft((prev) =>
      prev && prev.kind !== 'ink' ? ({ ...prev, x2, y2 } as ShapeAnno) : prev,
    );
  };

  // NB: the annotation is built from the ref, never from inside a state
  // updater — under StrictMode those run twice and would duplicate it.
  const onCaptureUp = () => {
    const d = drawing.current;
    drawing.current = null;
    setDraft(null);
    if (!d || d.kind === 'eraser') return;

    if (d.kind === 'ink') {
      if (d.pts.length < 1) return;
      addAnno({
        id: uid(),
        page: idx,
        kind: 'ink',
        createdAt: Date.now(),
        paths: [d.pts],
        color,
        width: strokeWidth,
        opacity: 1,
      } as InkAnno);
      return;
    }

    const [x2, y2] = d.end;
    if (Math.hypot(x2 - d.start[0], y2 - d.start[1]) <= 2) return;
    addAnno({
      id: uid(),
      page: idx,
      kind: d.kind as ShapeAnno['kind'],
      createdAt: Date.now(),
      x1: d.start[0],
      y1: d.start[1],
      x2,
      y2,
      color,
      fill: fillEnabled ? color : null,
      width: strokeWidth,
      opacity: fillEnabled ? opacity : 1,
    } as ShapeAnno);
  };

  // ---- render -----------------------------------------------------------
  const captureActive = !!pendingStamp || DRAW_TOOLS.has(tool);
  const interactive = tool === 'select' && !pendingStamp;

  const wrapStyle: React.CSSProperties = geom
    ? { width: geom.cw, height: geom.ch }
    : { width: Math.min(820, availW - 64), height: (availW - 64) * 1.29 };

  return (
    <div className="page-wrap" ref={wrapRef} data-page={pageNum} style={wrapStyle}>
      <div className="page-number-tag">{displayIndex + 1}</div>
      <div
        className="page-stack"
        ref={stackRef}
        style={geom ? { width: geom.cw, height: geom.ch } : undefined}
        onPointerDown={(e) => {
          if (interactive && e.target === e.currentTarget) {
            setState('selectedAnno', null);
            setEditing(null);
          }
        }}
      >
        <canvas ref={canvasRef} />
        {near && <div className="textLayer" ref={textRef} />}

        {geom && (
          <>
            {/* search highlights */}
            {hits.length > 0 && (
              <svg className="anno-svg" width={geom.cw} height={geom.ch}>
                {hits.map((h, i) =>
                  h.rects.map((r, j) => {
                    const a = toView(geom, r.x, r.y);
                    const b = toView(geom, r.x + r.w, r.y + r.h);
                    const isActive = activeHit === h;
                    return (
                      <rect
                        key={`${i}-${j}`}
                        x={Math.min(a[0], b[0])}
                        y={Math.min(a[1], b[1])}
                        width={Math.abs(b[0] - a[0])}
                        height={Math.abs(b[1] - a[1])}
                        fill={isActive ? '#ff9f0a' : '#ffe066'}
                        opacity={isActive ? 0.55 : 0.42}
                        rx={2}
                      />
                    );
                  }),
                )}
              </svg>
            )}

            <AnnoSvg
              annos={pageAnnos}
              geom={geom}
              selected={selectedAnno}
              interactive={interactive}
              draft={draft}
              onPick={(id) => {
                setState('selectedAnno', id);
                setEditing(null);
              }}
            />

            <div
              className={`pdf-space${showFields ? '' : ' fields-hidden'}`}
              style={{
                width: geom.pdfW * geom.scale,
                height: geom.pdfH * geom.scale,
                transform: pdfSpaceTransform(geom),
              }}
            >
              {pageFields.length > 0 && (
                <FormLayer fields={pageFields} geom={geom} />
              )}
              <BoxAnnos
                annos={pageAnnos}
                geom={geom}
                selected={selectedAnno}
                editing={editing}
                interactive={interactive}
                onSelect={(id) => setState('selectedAnno', id)}
                onEdit={setEditing}
              />
            </div>

            {captureActive && (
              <div
                className="capture"
                style={{ cursor: tool === 'eraser' ? 'cell' : 'crosshair' }}
                onPointerDown={onCaptureDown}
                onPointerMove={onCaptureMove}
                onPointerUp={onCaptureUp}
                onPointerCancel={onCaptureUp}
              />
            )}
          </>
        )}

        {pageState.deleted && <div className="page-deleted">Removed</div>}
      </div>
    </div>
  );
}

export { MARKUP_TOOLS };
