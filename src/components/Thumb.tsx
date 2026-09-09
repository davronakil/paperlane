import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from '../lib/pdfjs';

const cache = new Map<string, string>();

export function Thumb({
  pdf,
  docId,
  pageNum,
  rotation,
  width = 132,
}: {
  pdf: PDFDocumentProxy;
  docId: number;
  pageNum: number;
  rotation: number;
  width?: number;
}) {
  const key = `${docId}:${pageNum}:${rotation}:${width}`;
  const [url, setUrl] = useState<string | null>(cache.get(key) ?? null);
  const ref = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (e) => e.some((x) => x.isIntersecting) && setSeen(true),
      { rootMargin: '600px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!seen) return;
    const hit = cache.get(key);
    if (hit) {
      setUrl(hit);
      return;
    }
    let alive = true;
    (async () => {
      const page = await pdf.getPage(pageNum);
      const total = (((page.rotate + rotation) % 360) + 360) % 360;
      const unit = page.getViewport({ scale: 1, rotation: total });
      const scale = width / unit.width;
      const vp = page.getViewport({ scale, rotation: total });
      const c = document.createElement('canvas');
      c.width = Math.ceil(vp.width);
      c.height = Math.ceil(vp.height);
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: ctx as any, viewport: vp }).promise;
      if (!alive) return;
      const data = c.toDataURL('image/jpeg', 0.72);
      if (cache.size > 300) cache.clear();
      cache.set(key, data);
      setUrl(data);
    })().catch(() => {});
    return () => {
      alive = false;
    };
  }, [seen, key, pdf, pageNum, rotation, width]);

  const ratio = 1.294;
  return (
    <div ref={ref} className="thumb-inner" style={{ width }}>
      {url ? (
        <img src={url} alt="" style={{ width, display: 'block' }} />
      ) : (
        <div style={{ width, height: width * ratio, background: '#fff' }} />
      )}
    </div>
  );
}
