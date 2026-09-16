import { PDFDocument } from 'pdf-lib';
import { scanPage, type TextRun } from './scan';

export type { TextRun } from './scan';
export type { TextEdit, ApplyResult } from './apply';
export { applyTextEdits } from './apply';

/** pdf-lib parses the whole file, so keep one document per open file and the
 *  per-page scans that come from it. Both are dropped when the file changes. */
let held: { docId: number; doc: PDFDocument } | null = null;
const scans = new Map<string, TextRun[]>();

async function documentFor(docId: number, bytes: ArrayBuffer): Promise<PDFDocument> {
  if (held?.docId === docId) return held.doc;
  const doc = await PDFDocument.load(bytes, {
    ignoreEncryption: true,
    updateMetadata: false,
  });
  held = { docId, doc };
  return doc;
}

export function forgetScans(docId?: number) {
  if (docId === undefined || held?.docId !== docId) held = null;
  scans.clear();
}

/** Editable text runs on a page, scanned once and remembered. */
export async function runsForPage(
  docId: number,
  bytes: ArrayBuffer,
  page: number,
): Promise<TextRun[]> {
  const key = `${docId}:${page}`;
  const cached = scans.get(key);
  if (cached) return cached;
  try {
    const doc = await documentFor(docId, bytes);
    const { runs } = scanPage(doc, page);
    scans.set(key, runs);
    return runs;
  } catch {
    scans.set(key, []);
    return [];
  }
}

/** A CSS font stack that approximates what the PDF used. */
export function cssFontFor(run: TextRun): React.CSSProperties {
  const n = run.fontName;
  const serif = /times|serif|roman|georgia|garamond|book|minion/i.test(n);
  const fixed = /courier|mono|consol/i.test(n);
  return {
    fontFamily: fixed
      ? `"Courier New", Courier, monospace`
      : serif
        ? `"Times New Roman", Times, serif`
        : `Helvetica, Arial, sans-serif`,
    fontWeight: /bold|black|heavy|semibold/i.test(n) ? 700 : 400,
    fontStyle: /italic|oblique/i.test(n) ? 'italic' : 'normal',
  };
}
