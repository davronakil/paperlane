/** Walk a page's content stream and describe every run of text it draws:
 *  what it says, where it lands on the page, which font drew it, and the byte
 *  range of the operator responsible — which is what makes editing possible. */

import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFPage,
  PDFRawStream,
  PDFRef,
  PDFStream,
  decodePDFRawStream,
} from 'pdf-lib';
import { tokenize, type Op, type Operand } from './tokenizer';
import { readFont, type FontInfo } from './fonts';

export type Matrix = [number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** a then b */
export function mul(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[1] * b[2],
    a[0] * b[1] + a[1] * b[3],
    a[2] * b[0] + a[3] * b[2],
    a[2] * b[1] + a[3] * b[3],
    a[4] * b[0] + a[5] * b[2] + b[4],
    a[4] * b[1] + a[5] * b[3] + b[5],
  ];
}

export interface TextRun {
  /** stable within one scan of a page: the operator's byte offset */
  id: number;
  page: number;
  text: string;
  /** baseline origin in PDF user space */
  x: number;
  y: number;
  /** advance width and nominal height in user space */
  width: number;
  fontSize: number;
  rotation: number;
  ascent: number;
  descent: number;
  color: [number, number, number];
  fontName: string;
  fontRef: string;
  /** byte range of the showing operator, operands included */
  start: number;
  end: number;
  /** the operator used, so a replacement can preserve line-advance semantics */
  op: string;
  /** operands preceding the string for the `"` operator */
  quoteArgs?: [number, number];
  /** false when the font cannot spell arbitrary text back out */
  canReencode: boolean;
  charSpacing: number;
  wordSpacing: number;
  horizScale: number;
}

export interface PageScan {
  runs: TextRun[];
  /** the concatenated content stream the offsets refer to */
  content: Uint8Array;
}

function decodeStream(obj: unknown): Uint8Array | null {
  if (obj instanceof PDFRawStream) {
    try { return decodePDFRawStream(obj).decode(); } catch { return null; }
  }
  if (obj instanceof PDFStream) {
    try { return (obj as any).getContents?.() ?? null; } catch { return null; }
  }
  return null;
}

/** All of a page's content streams joined into one buffer. */
export function pageContent(doc: PDFDocument, page: PDFPage): Uint8Array {
  const contents = page.node.get(PDFName.of('Contents'));
  const resolved = contents instanceof PDFRef ? doc.context.lookup(contents) : contents;
  const parts: Uint8Array[] = [];
  if (resolved instanceof PDFArray) {
    for (let i = 0; i < resolved.size(); i++) {
      const bytes = decodeStream(resolved.lookup(i));
      if (bytes) parts.push(bytes, new Uint8Array([0x0a]));
    }
  } else {
    const bytes = decodeStream(resolved);
    if (bytes) parts.push(bytes);
  }
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

function fontResources(doc: PDFDocument, page: PDFPage): Map<string, PDFDict> {
  const out = new Map<string, PDFDict>();
  const res = page.node.Resources();
  const fonts = res ? doc.context.lookup(res.get(PDFName.of('Font'))) : undefined;
  if (fonts instanceof PDFDict) {
    for (const [key, value] of fonts.entries()) {
      const dict = value instanceof PDFRef ? doc.context.lookup(value) : value;
      if (dict instanceof PDFDict) out.set(key.asString().replace(/^\//, ''), dict);
    }
  }
  return out;
}

const num = (o: Operand | undefined) => (o && o.kind === 'num' ? o.value : 0);

export function scanPage(doc: PDFDocument, pageIndex: number): PageScan {
  const page = doc.getPages()[pageIndex];
  const content = pageContent(doc, page);
  const runs: TextRun[] = [];
  if (!content.length) return { runs, content };

  const resources = fontResources(doc, page);
  const fontCache = new Map<string, FontInfo>();
  const getFont = (name: string): FontInfo | null => {
    if (fontCache.has(name)) return fontCache.get(name)!;
    const dict = resources.get(name);
    if (!dict) return null;
    const info = readFont(doc, dict, name);
    fontCache.set(name, info);
    return info;
  };

  let ops: Op[];
  try { ops = tokenize(content); } catch { return { runs, content }; }

  let ctm: Matrix = IDENTITY;
  const stack: { ctm: Matrix; color: [number, number, number] }[] = [];
  let color: [number, number, number] = [0, 0, 0];

  let tm: Matrix = IDENTITY;
  let tlm: Matrix = IDENTITY;
  let font: FontInfo | null = null;
  let fontName = '';
  let size = 0;
  let charSpacing = 0;
  let wordSpacing = 0;
  let horizScale = 1;
  let leading = 0;
  let rise = 0;
  let renderMode = 0;

  const show = (op: Op, pieces: Operand[], quoteArgs?: [number, number]) => {
    if (!font || !size) return;
    const m = mul(tm, ctm);
    const xScale = Math.hypot(m[0], m[1]);
    const yScale = Math.hypot(m[2], m[3]);
    const rotation = Math.atan2(m[1], m[0]);

    let text = '';
    let advance = 0; // text-space units, font size applied
    for (const piece of pieces) {
      if (piece.kind === 'num') {
        advance += (-piece.value / 1000) * size * horizScale;
        continue;
      }
      if (piece.kind !== 'string') continue;
      text += font.decode(piece.bytes);
      for (const code of font.codesOf(piece.bytes)) {
        const w = (font.widthOf(code) / 1000) * size;
        const isSpace = font.codeBytes === 1 && code === 32;
        advance += (w + charSpacing + (isSpace ? wordSpacing : 0)) * horizScale;
      }
    }

    if (text.trim() && renderMode !== 3 && renderMode !== 7) {
      runs.push({
        id: op.start,
        page: pageIndex,
        text,
        x: m[4],
        y: m[5] + rise * yScale,
        width: advance * xScale,
        fontSize: size * yScale,
        rotation,
        ascent: font.ascent,
        descent: font.descent,
        color: [...color] as [number, number, number],
        fontName: font.baseFont,
        fontRef: fontName,
        start: op.start,
        end: op.end,
        op: op.op,
        quoteArgs,
        canReencode: font.encode(text) !== null,
        charSpacing,
        wordSpacing,
        horizScale,
      });
    }

    tm = mul([1, 0, 0, 1, advance, 0], tm);
  };

  const nextLine = () => {
    tlm = mul([1, 0, 0, 1, 0, -leading], tlm);
    tm = tlm;
  };

  for (const op of ops) {
    const a = op.operands;
    switch (op.op) {
      case 'q': stack.push({ ctm, color: [...color] as [number, number, number] }); break;
      case 'Q': {
        const prev = stack.pop();
        if (prev) { ctm = prev.ctm; color = prev.color; }
        break;
      }
      case 'cm':
        ctm = mul([num(a[0]), num(a[1]), num(a[2]), num(a[3]), num(a[4]), num(a[5])], ctm);
        break;
      case 'BT': tm = IDENTITY; tlm = IDENTITY; break;
      case 'ET': break;
      case 'Tf': {
        fontName = a[0]?.kind === 'name' ? a[0].value : '';
        font = getFont(fontName);
        size = num(a[1]);
        break;
      }
      case 'Tc': charSpacing = num(a[0]); break;
      case 'Tw': wordSpacing = num(a[0]); break;
      case 'Tz': horizScale = num(a[0]) / 100; break;
      case 'TL': leading = num(a[0]); break;
      case 'Ts': rise = num(a[0]); break;
      case 'Tr': renderMode = num(a[0]); break;
      case 'Td':
        tlm = mul([1, 0, 0, 1, num(a[0]), num(a[1])], tlm);
        tm = tlm;
        break;
      case 'TD':
        leading = -num(a[1]);
        tlm = mul([1, 0, 0, 1, num(a[0]), num(a[1])], tlm);
        tm = tlm;
        break;
      case 'Tm':
        tlm = [num(a[0]), num(a[1]), num(a[2]), num(a[3]), num(a[4]), num(a[5])];
        tm = tlm;
        break;
      case 'T*': nextLine(); break;
      case 'Tj': show(op, [a[0]].filter(Boolean) as Operand[]); break;
      case 'TJ': show(op, a[0]?.kind === 'array' ? a[0].items : []); break;
      case "'":
        nextLine();
        show(op, [a[0]].filter(Boolean) as Operand[]);
        break;
      case '"':
        wordSpacing = num(a[0]);
        charSpacing = num(a[1]);
        nextLine();
        show(op, [a[2]].filter(Boolean) as Operand[], [num(a[0]), num(a[1])]);
        break;
      case 'g': { const v = num(a[0]); color = [v, v, v]; break; }
      case 'rg': color = [num(a[0]), num(a[1]), num(a[2])]; break;
      case 'k': {
        const [c, m2, y2, k2] = [num(a[0]), num(a[1]), num(a[2]), num(a[3])];
        color = [(1 - c) * (1 - k2), (1 - m2) * (1 - k2), (1 - y2) * (1 - k2)];
        break;
      }
      case 'sc':
      case 'scn': {
        const nums = a.filter((o) => o.kind === 'num') as Extract<Operand, { kind: 'num' }>[];
        if (nums.length === 1) color = [nums[0].value, nums[0].value, nums[0].value];
        else if (nums.length === 3) color = [nums[0].value, nums[1].value, nums[2].value];
        break;
      }
      default: break;
    }
  }

  return { runs, content };
}
