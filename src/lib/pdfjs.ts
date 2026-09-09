import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

export { pdfjsLib };
export type PDFDocumentProxy = pdfjsLib.PDFDocumentProxy;
export type PDFPageProxy = pdfjsLib.PDFPageProxy;

export async function loadPdf(data: ArrayBuffer, password?: string) {
  const task = pdfjsLib.getDocument({
    // pdf.js transfers/detaches the buffer it is given, so hand it a copy
    data: new Uint8Array(data.slice(0)),
    password,
    // served from public/ so the app needs no network
    cMapUrl: `${import.meta.env.BASE_URL}pdfjs/cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${import.meta.env.BASE_URL}pdfjs/standard_fonts/`,
  });
  return task.promise;
}
