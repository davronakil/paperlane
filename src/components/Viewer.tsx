import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { Page, MARKUP_TOOLS, type PageHandle } from './Page';
import { toPdf } from '../lib/geom';
import type { Anno, MarkupAnno } from '../lib/types';
import { uid } from '../lib/util';

export function Viewer() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const handles = useRef(new Map<number, PageHandle>());
  const ratios = useRef(new Map<number, number>());
  const [size, setSize] = useState({ w: 900, h: 700 });

  const pdf = useStore((s) => s.pdf);
  const pages = useStore((s) => s.pages);
  const tool = useStore((s) => s.tool);
  const color = useStore((s) => s.color);
  const opacity = useStore((s) => s.opacity);
  const searchHits = useStore((s) => s.searchHits);
  const activeHit = useStore((s) => s.activeHit);
  const currentPage = useStore((s) => s.currentPage);
  const addAnno = useStore((s) => s.addAnno);

  const register = useCallback((n: number, h: PageHandle | null) => {
    if (h) handles.current.set(n, h);
    else handles.current.delete(n);
  }, []);

  // IntersectionObserver callbacks can land in the middle of a concurrent
  // render, so the store write is deferred (and coalesced) out of the callback.
  const pendingScan = useRef<number | null>(null);
  const onIntersect = useCallback((n: number, ratio: number) => {
    ratios.current.set(n, ratio);
    if (pendingScan.current !== null) return;
    pendingScan.current = window.setTimeout(() => {
      pendingScan.current = null;
      let best = -1;
      let bestRatio = 0;
      for (const [k, v] of ratios.current) {
        if (v > bestRatio + 0.001) {
          bestRatio = v;
          best = k;
        }
      }
      if (best > 0 && useStore.getState().currentPage !== best)
        useStore.getState().set('currentPage', best);
    }, 60);
  }, []);

  useEffect(
    () => () => {
      if (pendingScan.current !== null) clearTimeout(pendingScan.current);
    },
    [],
  );

  // ---- container size ---------------------------------------------------
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // ---- text-markup from a selection ------------------------------------
  useEffect(() => {
    if (!MARKUP_TOOLS.has(tool)) return;
    const onUp = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) return;
      const rects = Array.from(sel.getRangeAt(0).getClientRects()).filter(
        (r) => r.width > 1 && r.height > 1,
      );
      if (!rects.length) return;

      const made: Anno[] = [];
      for (const [pageNum, h] of handles.current) {
        const box = h.el.getBoundingClientRect();
        const mine = rects.filter((r) => {
          const cx = (r.left + r.right) / 2;
          const cy = (r.top + r.bottom) / 2;
          return (
            cx >= box.left - 1 &&
            cx <= box.right + 1 &&
            cy >= box.top - 1 &&
            cy <= box.bottom + 1
          );
        });
        if (!mine.length) continue;

        // drop rects fully contained in another (duplicate line boxes)
        const kept = mine.filter(
          (r, i) =>
            !mine.some(
              (o, j) =>
                j !== i &&
                o.left <= r.left + 0.5 &&
                o.right >= r.right - 0.5 &&
                o.top <= r.top + 0.5 &&
                o.bottom >= r.bottom - 0.5 &&
                (o.width > r.width || o.height > r.height),
            ),
        );

        const pdfRects = kept.map((r) => {
          const a = toPdf(h.geom, r.left - box.left, r.top - box.top);
          const b = toPdf(h.geom, r.right - box.left, r.bottom - box.top);
          return {
            x: Math.min(a[0], b[0]),
            y: Math.min(a[1], b[1]),
            w: Math.abs(b[0] - a[0]),
            h: Math.abs(b[1] - a[1]),
          };
        });

        made.push({
          id: uid(),
          page: pageNum - 1,
          kind: tool as MarkupAnno['kind'],
          createdAt: Date.now(),
          rects: pdfRects,
          color,
          opacity: tool === 'highlight' ? opacity : 1,
        } as MarkupAnno);
      }

      if (made.length) {
        made.forEach((a) => addAnno(a));
        sel.removeAllRanges();
      }
    };
    document.addEventListener('mouseup', onUp);
    return () => document.removeEventListener('mouseup', onUp);
  }, [tool, color, opacity, addAnno]);

  // ---- ctrl/cmd + wheel zoom -------------------------------------------
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const s = useStore.getState();
      const cur =
        s.fitMode === 'none'
          ? s.zoom
          : (handles.current.get(s.currentPage)?.geom.scale ?? s.zoom);
      const next = Math.min(8, Math.max(0.15, cur * (1 - e.deltaY * 0.0016)));
      useStore.setState({ zoom: next, fitMode: 'none' });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // ---- hand tool panning ------------------------------------------------
  const [panning, setPanning] = useState(false);
  useEffect(() => {
    if (tool !== 'hand') return;
    const el = scrollRef.current;
    if (!el) return;
    let sx = 0,
      sy = 0,
      l = 0,
      t = 0,
      down = false;
    const md = (e: PointerEvent) => {
      down = true;
      setPanning(true);
      sx = e.clientX;
      sy = e.clientY;
      l = el.scrollLeft;
      t = el.scrollTop;
    };
    const mm = (e: PointerEvent) => {
      if (!down) return;
      el.scrollLeft = l - (e.clientX - sx);
      el.scrollTop = t - (e.clientY - sy);
    };
    const mu = () => {
      down = false;
      setPanning(false);
    };
    el.addEventListener('pointerdown', md);
    window.addEventListener('pointermove', mm);
    window.addEventListener('pointerup', mu);
    return () => {
      el.removeEventListener('pointerdown', md);
      window.removeEventListener('pointermove', mm);
      window.removeEventListener('pointerup', mu);
    };
  }, [tool]);

  // ---- scroll to a requested page / hit ---------------------------------
  const scrollToPage = useCallback((n: number) => {
    const el = scrollRef.current?.querySelector(`[data-page="${n}"]`);
    el?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, []);

  useEffect(() => {
    (window as any).__paperlaneScrollToPage = scrollToPage;
  }, [scrollToPage]);

  useEffect(() => {
    if (activeHit < 0 || !searchHits[activeHit]) return;
    const hit = searchHits[activeHit];
    const h = handles.current.get(hit.page + 1);
    const scroller = scrollRef.current;
    if (!h || !scroller) {
      scrollToPage(hit.page + 1);
      return;
    }
    const box = h.el.getBoundingClientRect();
    const sBox = scroller.getBoundingClientRect();
    const r = hit.rects[0];
    if (!r) return;
    const [, vy] = h.geom.vp.convertToViewportPoint(r.x, r.y + r.h);
    scroller.scrollTo({
      top: scroller.scrollTop + (box.top - sBox.top) + vy - scroller.clientHeight / 3,
      behavior: 'smooth',
    });
  }, [activeHit, searchHits, scrollToPage]);

  const hitsByPage = useMemo(() => {
    const m = new Map<number, typeof searchHits>();
    for (const h of searchHits) {
      if (!m.has(h.page)) m.set(h.page, []);
      m.get(h.page)!.push(h);
    }
    return m;
  }, [searchHits]);

  const ordered = pages;

  if (!pdf) return null;

  const cls = [
    'viewer',
    tool === 'hand' ? 'tool-hand' : '',
    panning ? 'panning' : '',
    MARKUP_TOOLS.has(tool) || tool === 'select' ? '' : 'no-select',
    tool === 'text' ? 'tool-text' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={cls} ref={scrollRef}>
      {ordered.map((ps, i) => (
        <Page
          key={ps.index}
          pdf={pdf}
          pageNum={ps.index + 1}
          pageState={ps}
          displayIndex={i}
          availW={size.w}
          availH={size.h}
          hits={hitsByPage.get(ps.index) ?? []}
          activeHit={searchHits[activeHit] ?? null}
          register={register}
          onIntersect={onIntersect}
        />
      ))}
      <div style={{ height: 1 }} data-current={currentPage} />
    </div>
  );
}
