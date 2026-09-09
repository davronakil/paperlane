// pdf.js needs CMaps (CJK / exotic encodings) and the 14 standard font files
// at runtime. Copy them next to the app so it works with no network at all.
import { cp, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const pairs = [
  ['node_modules/pdfjs-dist/cmaps', 'public/pdfjs/cmaps'],
  ['node_modules/pdfjs-dist/standard_fonts', 'public/pdfjs/standard_fonts'],
];

await mkdir('public/pdfjs', { recursive: true });
for (const [from, to] of pairs) {
  if (!existsSync(from)) {
    console.warn(`skipped ${from} (not found)`);
    continue;
  }
  await cp(from, to, { recursive: true });
}
console.log('pdf.js assets ready');
