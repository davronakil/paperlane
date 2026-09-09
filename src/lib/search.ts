import type { PDFDocumentProxy } from './pdfjs';
import type { SearchHit } from './types';

interface Span {
  start: number;
  str: string;
  x: number;
  y: number;
  w: number;
  h: number;
  size: number;
}

/** Sub-string widths, scaled so the whole run matches the width pdf.js
 *  reports. Proportional beats dividing the run evenly by character count. */
const measure = (() => {
  let ctx: CanvasRenderingContext2D | null = null;
  return (text: string, size: number) => {
    if (!text) return 0;
    if (!ctx) ctx = document.createElement('canvas').getContext('2d');
    if (!ctx) return text.length * size * 0.5;
    ctx.font = `${size}px Helvetica, Arial, sans-serif`;
    return ctx.measureText(text).width;
  };
})();

/** Flatten a page's text content and keep a positional index for each run. */
async function pageIndex(pdf: PDFDocumentProxy, pageNum: number) {
  const page = await pdf.getPage(pageNum);
  const tc = await page.getTextContent();
  let text = '';
  const spans: Span[] = [];
  for (const item of tc.items as any[]) {
    if (typeof item.str !== 'string') continue;
    const str = item.str;
    if (str.length) {
      const t = item.transform as number[];
      const h = Math.abs(item.height) || Math.hypot(t[2], t[3]) || 10;
      spans.push({
        start: text.length,
        str,
        x: t[4],
        y: t[5] - h * 0.22,
        w: item.width ?? 0,
        h: h * 1.18,
        size: h,
      });
      text += str;
    }
    if (item.hasEOL) text += '\n';
  }
  return { text, spans };
}

export async function searchDocument(
  pdf: PDFDocumentProxy,
  query: string,
  signal?: { cancelled: boolean },
): Promise<SearchHit[]> {
  const q = query.trim().toLowerCase();
  if (q.length < 1) return [];
  const hits: SearchHit[] = [];

  for (let p = 1; p <= pdf.numPages; p++) {
    if (signal?.cancelled) return hits;
    let idx;
    try {
      idx = await pageIndex(pdf, p);
    } catch {
      continue;
    }
    const hay = idx.text.toLowerCase();
    let from = 0;
    for (;;) {
      const at = hay.indexOf(q, from);
      if (at < 0) break;
      const end = at + q.length;
      const rects: SearchHit['rects'] = [];
      for (const s of idx.spans) {
        const sEnd = s.start + s.str.length;
        if (sEnd <= at || s.start >= end) continue;
        const a = Math.max(at, s.start) - s.start;
        const b = Math.min(end, sEnd) - s.start;
        const total = measure(s.str, s.size);
        const k = total > 0 ? s.w / total : 0;
        const wa = measure(s.str.slice(0, a), s.size) * k;
        const wb = measure(s.str.slice(0, b), s.size) * k;
        rects.push({
          x: s.x + wa,
          y: s.y,
          w: Math.max(2, wb - wa),
          h: s.h,
        });
      }
      const ctxFrom = Math.max(0, at - 34);
      hits.push({
        page: p - 1,
        index: at,
        text:
          (ctxFrom ? '…' : '') +
          idx.text.slice(ctxFrom, Math.min(idx.text.length, end + 34)).replace(/\s+/g, ' '),
        rects,
      });
      from = end;
      if (hits.length > 800) return hits;
    }
  }
  return hits;
}
