import type { PageViewport } from 'pdfjs-dist';

export interface Geom {
  scale: number;
  vp: PageViewport;
  /** unrotated page size in points */
  pdfW: number;
  pdfH: number;
  /** viewBox origin */
  x0: number;
  y0: number;
  rotation: number;
  /** css px size of the rendered (rotated) canvas */
  cw: number;
  ch: number;
}

export function makeGeom(vp: PageViewport, scale: number): Geom {
  const { pageWidth, pageHeight, pageX, pageY } = vp.rawDims as any;
  return {
    scale,
    vp,
    pdfW: pageWidth,
    pdfH: pageHeight,
    x0: pageX,
    y0: pageY,
    rotation: ((vp.rotation % 360) + 360) % 360,
    cw: vp.width,
    ch: vp.height,
  };
}

/** canvas-relative css px -> PDF user space */
export function toPdf(g: Geom, cx: number, cy: number): [number, number] {
  const p = g.vp.convertToPdfPoint(cx, cy);
  return [p[0], p[1]];
}

/** PDF user space -> canvas-relative css px */
export function toView(g: Geom, px: number, py: number): [number, number] {
  const p = g.vp.convertToViewportPoint(px, py);
  return [p[0], p[1]];
}

/** CSS transform that maps the unrotated "pdf space" overlay onto the canvas */
export function pdfSpaceTransform(g: Geom): string {
  const W = g.pdfW * g.scale;
  const H = g.pdfH * g.scale;
  switch (g.rotation) {
    case 90:
      return `translate(${H}px, 0px) rotate(90deg)`;
    case 180:
      return `translate(${W}px, ${H}px) rotate(180deg)`;
    case 270:
      return `translate(0px, ${W}px) rotate(270deg)`;
    default:
      return 'none';
  }
}

/** PDF rect (bottom-left origin) -> css box inside the pdf-space overlay */
export function boxCss(g: Geom, x: number, y: number, w: number, h: number) {
  return {
    left: (x - g.x0) * g.scale,
    top: (g.y0 + g.pdfH - y - h) * g.scale,
    width: w * g.scale,
    height: h * g.scale,
  };
}

/** Distance from point p to segment ab, in PDF units. */
export function distToSeg(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
) {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  let t = len ? ((px - ax) * dx + (py - ay) * dy) / len : 0;
  t = Math.max(0, Math.min(1, t));
  const qx = ax + t * dx;
  const qy = ay + t * dy;
  return Math.hypot(px - qx, py - qy);
}

/** Convert a screen-space drag delta into PDF-space deltas. */
export function screenDeltaToPdf(g: Geom, dx: number, dy: number): [number, number] {
  const s = g.scale;
  switch (g.rotation) {
    case 90:
      return [dy / s, dx / s];
    case 180:
      return [-dx / s, dy / s];
    case 270:
      return [-dy / s, -dx / s];
    default:
      return [dx / s, -dy / s];
  }
}
