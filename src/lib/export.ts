import {
  PDFDocument,
  PDFFont,
  PDFPage,
  PDFString,
  StandardFonts,
  degrees,
  rgb,
  BlendMode,
  LineCapStyle,
} from 'pdf-lib';
import type { Anno, FontKey, PageState, TextAnno } from './types';
import { hexToRgb } from './util';
import { applyFormValues } from './forms';

const FONT_MAP: Record<FontKey, StandardFonts> = {
  Helvetica: StandardFonts.Helvetica,
  'Helvetica-Bold': StandardFonts.HelveticaBold,
  'Helvetica-Oblique': StandardFonts.HelveticaOblique,
  'Times-Roman': StandardFonts.TimesRoman,
  'Times-Bold': StandardFonts.TimesRomanBold,
  'Times-Italic': StandardFonts.TimesRomanItalic,
  Courier: StandardFonts.Courier,
  'Courier-Bold': StandardFonts.CourierBold,
};

const col = (hex: string) => {
  const c = hexToRgb(hex);
  return rgb(c.r, c.g, c.b);
};

/** Greedy word wrap that also honours explicit newlines. */
function wrapText(
  text: string,
  font: PDFFont | { widthOfTextAtSize: (t: string, s: number) => number },
  size: number,
  maxWidth: number,
): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    if (!para) {
      out.push('');
      continue;
    }
    let line = '';
    for (const word of para.split(/(\s+)/)) {
      const next = line + word;
      if (line && font.widthOfTextAtSize(next, size) > maxWidth) {
        out.push(line.trimEnd());
        line = word.trimStart();
      } else {
        line = next;
      }
    }
    out.push(line.trimEnd());
  }
  return out;
}

export interface BuildOptions {
  annos: Anno[];
  formValues: Record<string, string>;
  /** field name -> font size, so saved text matches what was on screen */
  fieldFontSizes?: Record<string, number>;
  pages: PageState[];
  /** bake form fields into static page content */
  flattenForm?: boolean;
}

export async function buildPdf(
  originalBytes: ArrayBuffer,
  opts: BuildOptions,
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(originalBytes, {
    ignoreEncryption: true,
    updateMetadata: false,
  });

  applyFormValues(doc, opts.formValues, opts.fieldFontSizes);

  const fontCache = new Map<FontKey, PDFFont>();
  const getFont = async (k: FontKey) => {
    if (!fontCache.has(k)) fontCache.set(k, await doc.embedFont(FONT_MAP[k]));
    return fontCache.get(k)!;
  };
  const imageCache = new Map<string, any>();
  const getImage = async (src: string) => {
    if (!imageCache.has(src)) imageCache.set(src, await doc.embedPng(src));
    return imageCache.get(src)!;
  };

  const pdfPages = doc.getPages();

  // ---- annotations ------------------------------------------------------
  const byPage = new Map<number, Anno[]>();
  for (const a of opts.annos) {
    if (!byPage.has(a.page)) byPage.set(a.page, []);
    byPage.get(a.page)!.push(a);
  }

  for (const [pageIndex, list] of byPage) {
    const page = pdfPages[pageIndex];
    if (!page) continue;
    list.sort((a, b) => a.createdAt - b.createdAt);
    for (const a of list) {
      await drawAnno(doc, page, a, getFont, getImage);
    }
  }

  // ---- page rotation ----------------------------------------------------
  for (const ps of opts.pages) {
    const page = pdfPages[ps.index];
    if (!page || !ps.rotation) continue;
    const base = page.getRotation().angle;
    page.setRotation(degrees(((base + ps.rotation) % 360 + 360) % 360));
  }

  if (opts.flattenForm) {
    try {
      doc.getForm().flatten();
    } catch {
      /* nothing to flatten */
    }
  }

  // ---- deletion + reordering -------------------------------------------
  const keep = opts.pages.filter((p) => !p.deleted);
  const sameOrder =
    keep.length === pdfPages.length &&
    keep.every((p, i) => p.index === i);

  if (!sameOrder) {
    if (!keep.length) throw new Error('A document must keep at least one page.');
    const desired = keep.map((p) => pdfPages[p.index]).filter(Boolean);
    for (let i = doc.getPageCount() - 1; i >= 0; i--) doc.removePage(i);
    desired.forEach((p, i) => doc.insertPage(i, p));
  }

  doc.setProducer('Paperlane');
  doc.setModificationDate(new Date());

  return doc.save({ useObjectStreams: false });
}

async function drawAnno(
  doc: PDFDocument,
  page: PDFPage,
  a: Anno,
  getFont: (k: FontKey) => Promise<PDFFont>,
  getImage: (src: string) => Promise<any>,
) {
  switch (a.kind) {
    case 'highlight': {
      for (const r of a.rects) {
        page.drawRectangle({
          x: r.x,
          y: r.y,
          width: r.w,
          height: r.h,
          color: col(a.color),
          opacity: a.opacity,
          blendMode: BlendMode.Multiply,
        });
      }
      break;
    }
    case 'underline':
    case 'strike': {
      for (const r of a.rects) {
        const thickness = Math.max(0.9, r.h * 0.07);
        const y = a.kind === 'underline' ? r.y + r.h * 0.06 : r.y + r.h * 0.42;
        page.drawRectangle({
          x: r.x,
          y,
          width: r.w,
          height: thickness,
          color: col(a.color),
          opacity: a.opacity,
        });
      }
      break;
    }
    case 'ink': {
      for (const path of a.paths) {
        if (path.length === 1) {
          page.drawCircle({
            x: path[0].x,
            y: path[0].y,
            size: a.width / 2,
            color: col(a.color),
            opacity: a.opacity,
          });
          continue;
        }
        for (let i = 1; i < path.length; i++) {
          page.drawLine({
            start: path[i - 1],
            end: path[i],
            thickness: a.width,
            color: col(a.color),
            opacity: a.opacity,
            lineCap: LineCapStyle.Round,
          });
        }
      }
      break;
    }
    case 'rect': {
      const x = Math.min(a.x1, a.x2);
      const y = Math.min(a.y1, a.y2);
      page.drawRectangle({
        x,
        y,
        width: Math.abs(a.x2 - a.x1),
        height: Math.abs(a.y2 - a.y1),
        borderColor: col(a.color),
        borderWidth: a.width,
        color: a.fill ? col(a.fill) : undefined,
        opacity: a.fill ? a.opacity : undefined,
        borderOpacity: a.opacity,
      });
      break;
    }
    case 'ellipse': {
      page.drawEllipse({
        x: (a.x1 + a.x2) / 2,
        y: (a.y1 + a.y2) / 2,
        xScale: Math.abs(a.x2 - a.x1) / 2,
        yScale: Math.abs(a.y2 - a.y1) / 2,
        borderColor: col(a.color),
        borderWidth: a.width,
        color: a.fill ? col(a.fill) : undefined,
        opacity: a.fill ? a.opacity : undefined,
        borderOpacity: a.opacity,
      });
      break;
    }
    case 'line':
    case 'arrow': {
      page.drawLine({
        start: { x: a.x1, y: a.y1 },
        end: { x: a.x2, y: a.y2 },
        thickness: a.width,
        color: col(a.color),
        opacity: a.opacity,
        lineCap: LineCapStyle.Round,
      });
      if (a.kind === 'arrow') {
        const ang = Math.atan2(a.y2 - a.y1, a.x2 - a.x1);
        const len = Math.max(8, a.width * 4);
        for (const s of [1, -1]) {
          const t = ang + s * (Math.PI - 0.42);
          page.drawLine({
            start: { x: a.x2, y: a.y2 },
            end: {
              x: a.x2 + Math.cos(t) * len,
              y: a.y2 + Math.sin(t) * len,
            },
            thickness: a.width,
            color: col(a.color),
            opacity: a.opacity,
            lineCap: LineCapStyle.Round,
          });
        }
      }
      break;
    }
    case 'text': {
      const t = a as TextAnno;
      if (!t.text.trim()) break;
      const font = await getFont(t.font);
      const lines = wrapText(t.text, font, t.size, t.w - 4);
      const lh = t.size * 1.25;
      let y = t.y + t.h - t.size - 2;
      for (const line of lines) {
        if (y < t.y - lh) break;
        let x = t.x + 2;
        if (t.align !== 'left') {
          const wdt = font.widthOfTextAtSize(line, t.size);
          x =
            t.align === 'center'
              ? t.x + (t.w - wdt) / 2
              : t.x + t.w - wdt - 2;
        }
        page.drawText(line, {
          x,
          y,
          size: t.size,
          font,
          color: col(t.color),
        });
        y -= lh;
      }
      break;
    }
    case 'note': {
      const s = 22;
      const c = hexToRgb(a.color);
      page.drawRectangle({
        x: a.x,
        y: a.y,
        width: s,
        height: s * 0.82,
        color: col(a.color),
        borderColor: rgb(c.r * 0.55, c.g * 0.55, c.b * 0.55),
        borderWidth: 0.8,
      });
      page.drawLine({
        start: { x: a.x + 3, y: a.y + s * 0.82 - 5 },
        end: { x: a.x + s - 3, y: a.y + s * 0.82 - 5 },
        thickness: 1,
        color: rgb(1, 1, 1),
        opacity: 0.85,
      });
      page.drawLine({
        start: { x: a.x + 3, y: a.y + s * 0.82 - 9 },
        end: { x: a.x + s - 6, y: a.y + s * 0.82 - 9 },
        thickness: 1,
        color: rgb(1, 1, 1),
        opacity: 0.85,
      });
      // Real PDF sticky note so other readers show the comment too.
      const ref = doc.context.register(
        doc.context.obj({
          Type: 'Annot',
          Subtype: 'Text',
          Name: 'Comment',
          Rect: [a.x, a.y, a.x + s, a.y + s],
          Contents: PDFString.of(a.text || ''),
          T: PDFString.of('Paperlane'),
          C: [c.r, c.g, c.b],
          F: 4,
        }),
      );
      page.node.addAnnot(ref);
      break;
    }
    case 'image': {
      try {
        const img = await getImage(a.src);
        page.drawImage(img, { x: a.x, y: a.y, width: a.w, height: a.h });
      } catch {
        /* unreadable image data */
      }
      break;
    }
  }
}

/** Append the pages of another PDF to the current document bytes. */
export async function mergePdfs(
  baseBytes: ArrayBuffer,
  incoming: ArrayBuffer,
  atIndex?: number,
): Promise<Uint8Array> {
  const base = await PDFDocument.load(baseBytes, { ignoreEncryption: true });
  const add = await PDFDocument.load(incoming, { ignoreEncryption: true });
  const copied = await base.copyPages(add, add.getPageIndices());
  const at = atIndex ?? base.getPageCount();
  copied.forEach((p, i) => base.insertPage(at + i, p));
  return base.save({ useObjectStreams: false });
}

/** Build a new PDF containing only the given (original) page indices. */
export async function extractPages(
  bytes: ArrayBuffer,
  indices: number[],
): Promise<Uint8Array> {
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const out = await PDFDocument.create();
  const copied = await out.copyPages(src, indices);
  copied.forEach((p) => out.addPage(p));
  return out.save({ useObjectStreams: false });
}

if (import.meta.env.DEV) (window as any).__buildPdf = buildPdf;
