/** Write edited text back into a page's content stream.
 *
 *  The original showing operator is replaced, not painted over, so the old
 *  text is genuinely gone from the file — it cannot be selected, searched or
 *  recovered afterwards. */

import {
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRef,
  StandardFonts,
  rgb,
} from 'pdf-lib';
import { readFont } from './fonts';
import { scanPage, type TextRun } from './scan';

export interface TextEdit {
  page: number;
  /** TextRun.id — the operator's byte offset in the scanned content */
  runId: number;
  text: string;
  /** keep the run's original advance width by squeezing or stretching */
  fitWidth?: boolean;
}

const hex = (bytes: Uint8Array) =>
  '<' + [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('') + '>';

const fmt = (n: number) => {
  const r = Math.round(n * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
};

/** What the replacement operator must look like to preserve line advance. */
function replacementFor(run: TextRun, encoded: Uint8Array, scale: number | null): string {
  const body = scale === null ? `${hex(encoded)} Tj` :
    `${fmt(scale * 100)} Tz ${hex(encoded)} Tj ${fmt(run.horizScale * 100)} Tz`;
  switch (run.op) {
    case "'":
      return `T* ${body}`;
    case '"': {
      const [aw, ac] = run.quoteArgs ?? [0, 0];
      return `${fmt(aw)} Tw ${fmt(ac)} Tc T* ${body}`;
    }
    default:
      return body;
  }
}

/** Advance width of `text` in the run's own font, in user-space units. */
function measure(run: TextRun, text: string, font: ReturnType<typeof readFont>): number {
  const encoded = font.encode(text);
  if (!encoded) return run.width;
  let advance = 0;
  const sizeRatio = run.fontSize;
  for (const code of font.codesOf(encoded)) {
    const w = (font.widthOf(code) / 1000) * sizeRatio;
    const isSpace = font.codeBytes === 1 && code === 32;
    advance += (w + run.charSpacing + (isSpace ? run.wordSpacing : 0)) * run.horizScale;
  }
  return advance;
}

export interface ApplyResult {
  applied: number;
  /** edits whose font could not spell the new text and were redrawn instead */
  redrawn: number;
  /** edits no available font could render; the original was left untouched */
  skipped: string[];
}

export async function applyTextEdits(
  doc: PDFDocument,
  edits: TextEdit[],
): Promise<ApplyResult> {
  if (!edits.length) return { applied: 0, redrawn: 0, skipped: [] };

  const byPage = new Map<number, TextEdit[]>();
  for (const e of edits) {
    if (!byPage.has(e.page)) byPage.set(e.page, []);
    byPage.get(e.page)!.push(e);
  }

  let applied = 0;
  let redrawn = 0;
  const skippedText: string[] = [];
  const fallbackFonts = new Map<string, any>();
  const fallbackFor = async (run: TextRun) => {
    const { serif, fixed, bold, italic } = runFlags(run);
    const key = `${serif}-${fixed}-${bold}-${italic}`;
    if (!fallbackFonts.has(key)) {
      const name = fixed
        ? bold ? StandardFonts.CourierBold : italic ? StandardFonts.CourierOblique : StandardFonts.Courier
        : serif
          ? bold ? StandardFonts.TimesRomanBold : italic ? StandardFonts.TimesRomanItalic : StandardFonts.TimesRoman
          : bold ? StandardFonts.HelveticaBold : italic ? StandardFonts.HelveticaOblique : StandardFonts.Helvetica;
      fallbackFonts.set(key, await doc.embedFont(name));
    }
    return fallbackFonts.get(key);
  };

  for (const [pageIndex, pageEdits] of byPage) {
    const page = doc.getPages()[pageIndex];
    if (!page) continue;
    const { runs, content } = scanPage(doc, pageIndex);
    const byId = new Map(runs.map((r) => [r.id, r]));

    const resources = page.node.Resources();
    const fontsDict = resources
      ? doc.context.lookup(resources.get(PDFName.of('Font')))
      : undefined;

    interface Splice { start: number; end: number; text: string }
    const splices: Splice[] = [];
    const redraws: { run: TextRun; text: string }[] = [];
    const skipped: { run: TextRun; text: string }[] = [];

    for (const edit of pageEdits) {
      const run = byId.get(edit.runId);
      if (!run) continue;

      let font: ReturnType<typeof readFont> | null = null;
      if (fontsDict instanceof PDFDict) {
        const raw = fontsDict.get(PDFName.of(run.fontRef));
        const dict = raw instanceof PDFRef ? doc.context.lookup(raw) : raw;
        if (dict instanceof PDFDict) font = readFont(doc, dict, run.fontRef);
      }

      const encoded = font?.encode(edit.text) ?? null;
      if (!font || !encoded) {
        // The run's own font cannot spell the new text. Only remove the
        // original once a stand-in that *can* draw it is in hand — deleting
        // first and failing afterwards would destroy the line.
        const stand = await fallbackFor(run);
        let usable = true;
        try {
          stand.widthOfTextAtSize(edit.text, run.fontSize);
        } catch {
          usable = false;
        }
        if (!usable) {
          skipped.push({ run, text: edit.text });
          continue;
        }
        splices.push({ start: run.start, end: run.end, text: '' });
        redraws.push({ run, text: edit.text });
        applied++;
        redrawn++;
        continue;
      }
      {
        let scale: number | null = null;
        if (edit.fitWidth) {
          const newWidth = measure(run, edit.text, font);
          scale = newWidth > 0 ? (run.width / newWidth) * run.horizScale : run.horizScale;
        }
        splices.push({ start: run.start, end: run.end, text: replacementFor(run, encoded, scale) });
        applied++;
      }
    }

    for (const s of skipped) skippedText.push(s.text);
    if (!splices.length) continue;

    splices.sort((a, b) => b.start - a.start);
    let out = content;
    for (const s of splices) {
      const head = out.subarray(0, s.start);
      const tail = out.subarray(s.end);
      const mid = new TextEncoder().encode(s.text);
      const next = new Uint8Array(head.length + mid.length + tail.length);
      next.set(head, 0);
      next.set(mid, head.length);
      next.set(tail, head.length + mid.length);
      out = next;
    }

    const stream = doc.context.flateStream(out);
    page.node.set(PDFName.of('Contents'), doc.context.register(stream));

    for (const { run, text } of redraws) {
      const font = await fallbackFor(run);
      page.drawText(text, {
        x: run.x,
        y: run.y,
        size: run.fontSize,
        font,
        color: rgb(run.color[0], run.color[1], run.color[2]),
      });
    }
  }

  return { applied, redrawn, skipped: skippedText };
}

function runFlags(run: TextRun) {
  const n = run.fontName;
  return {
    serif: /times|serif|georgia|garamond|roman|book|minion/i.test(n),
    fixed: /courier|mono|consol/i.test(n),
    bold: /bold|black|heavy|semibold/i.test(n),
    italic: /italic|oblique/i.test(n),
  };
}
