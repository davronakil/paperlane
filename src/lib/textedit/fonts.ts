/** Enough of a PDF font to read text back out and write new text in. */

import { Font as AfmFont, FontNames, Encodings } from '@pdf-lib/standard-fonts';
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFStream,
  PDFString,
  decodePDFRawStream,
} from 'pdf-lib';

/** WinAnsiEncoding is Latin-1 apart from this block. */
const WIN_ANSI_HIGH: Record<number, number> = {
  0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e, 0x85: 0x2026,
  0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02c6, 0x89: 0x2030, 0x8a: 0x0160,
  0x8b: 0x2039, 0x8c: 0x0152, 0x8e: 0x017d, 0x91: 0x2018, 0x92: 0x2019,
  0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014,
  0x98: 0x02dc, 0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a, 0x9c: 0x0153,
  0x9e: 0x017e, 0x9f: 0x0178,
};

/** Glyph names that appear in /Differences often enough to matter. */
const GLYPH_NAMES: Record<string, number> = {
  space: 32, exclam: 33, quotedbl: 34, numbersign: 35, dollar: 36, percent: 37,
  ampersand: 38, quotesingle: 39, parenleft: 40, parenright: 41, asterisk: 42,
  plus: 43, comma: 44, hyphen: 45, period: 46, slash: 47, zero: 48, one: 49,
  two: 50, three: 51, four: 52, five: 53, six: 54, seven: 55, eight: 56,
  nine: 57, colon: 58, semicolon: 59, less: 60, equal: 61, greater: 62,
  question: 63, at: 64, bracketleft: 91, backslash: 92, bracketright: 93,
  asciicircum: 94, underscore: 95, grave: 96, braceleft: 123, bar: 124,
  braceright: 125, asciitilde: 126, quoteleft: 0x2018, quoteright: 0x2019,
  quotedblleft: 0x201c, quotedblright: 0x201d, endash: 0x2013, emdash: 0x2014,
  bullet: 0x2022, ellipsis: 0x2026, fi: 0xfb01, fl: 0xfb02, dagger: 0x2020,
  daggerdbl: 0x2021, perthousand: 0x2030, Euro: 0x20ac, trademark: 0x2122,
  degree: 0xb0, germandbls: 0xdf, adieresis: 0xe4, odieresis: 0xf6,
  udieresis: 0xfc, Adieresis: 0xc4, Odieresis: 0xd6, Udieresis: 0xdc,
  eacute: 0xe9, egrave: 0xe8, ccedilla: 0xe7, ntilde: 0xf1, copyright: 0xa9,
  registered: 0xae, nbspace: 32,
};

function glyphNameToUnicode(name: string): number | undefined {
  if (name in GLYPH_NAMES) return GLYPH_NAMES[name];
  if (/^[A-Za-z]$/.test(name)) return name.charCodeAt(0);
  let m = /^uni([0-9A-Fa-f]{4})$/.exec(name);
  if (m) return parseInt(m[1], 16);
  m = /^u([0-9A-Fa-f]{4,6})$/.exec(name);
  if (m) return parseInt(m[1], 16);
  return undefined;
}

function streamBytes(obj: unknown): Uint8Array | null {
  if (obj instanceof PDFRawStream) {
    try {
      return decodePDFRawStream(obj).decode();
    } catch {
      return null;
    }
  }
  if (obj instanceof PDFStream) {
    try {
      return (obj as any).getContents?.() ?? null;
    } catch {
      return null;
    }
  }
  return null;
}

/** Parse the bfchar/bfrange sections of a ToUnicode CMap. */
function parseToUnicode(bytes: Uint8Array): Map<number, string> {
  const map = new Map<number, string>();
  const text = new TextDecoder('latin1').decode(bytes);
  const hexToStr = (hex: string) => {
    let s = '';
    for (let i = 0; i + 3 < hex.length + 1; i += 4) {
      const unit = parseInt(hex.slice(i, i + 4), 16);
      if (Number.isFinite(unit)) s += String.fromCharCode(unit);
    }
    return s;
  };

  for (const block of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const m of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      map.set(parseInt(m[1], 16), hexToStr(m[2]));
    }
  }
  for (const block of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    const body = block[1];
    for (const m of body.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      const lo = parseInt(m[1], 16);
      const hi = parseInt(m[2], 16);
      const base = parseInt(m[3], 16);
      for (let c = lo; c <= hi && c - lo < 65536; c++) {
        map.set(c, String.fromCharCode(base + (c - lo)));
      }
    }
    for (const m of body.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*\[([\s\S]*?)\]/g)) {
      const lo = parseInt(m[1], 16);
      const items = [...m[3].matchAll(/<([0-9A-Fa-f]+)>/g)];
      items.forEach((it, k) => map.set(lo + k, hexToStr(it[1])));
    }
  }
  return map;
}

export interface FontInfo {
  resourceName: string;
  baseFont: string;
  /** bytes per character code */
  codeBytes: number;
  /** serif / fixed pitch / bold / italic, for choosing a stand-in */
  flags: { serif: boolean; fixed: boolean; bold: boolean; italic: boolean };
  ascent: number;
  descent: number;
  decode(bytes: Uint8Array): string;
  /** null when the font has no way to write one of the characters */
  encode(text: string): Uint8Array | null;
  /** advance width of a code, in 1/1000 em */
  widthOf(code: number): number;
  codesOf(bytes: Uint8Array): number[];
}

export function readFont(
  doc: PDFDocument,
  dict: PDFDict,
  resourceName: string,
): FontInfo {
  const look = (d: PDFDict | undefined, key: string) =>
    d ? d.context.lookup(d.get(PDFName.of(key))) : undefined;

  const subtype = (look(dict, 'Subtype') as PDFName | undefined)?.asString() ?? '';
  const isType0 = subtype === '/Type0';
  const baseFont = ((look(dict, 'BaseFont') as PDFName | undefined)?.asString() ?? '').replace(/^\//, '');

  let metricsDict: PDFDict | undefined = dict;
  if (isType0) {
    const desc = look(dict, 'DescendantFonts') as PDFArray | undefined;
    const first = desc?.get(0);
    const resolved = first instanceof PDFRef ? doc.context.lookup(first) : first;
    if (resolved instanceof PDFDict) metricsDict = resolved;
  }

  const descriptor = look(metricsDict, 'FontDescriptor') as PDFDict | undefined;
  const flagBits = (look(descriptor, 'Flags') as PDFNumber | undefined)?.asNumber() ?? 0;
  const italicAngle = (look(descriptor, 'ItalicAngle') as PDFNumber | undefined)?.asNumber() ?? 0;
  const ascent = (look(descriptor, 'Ascent') as PDFNumber | undefined)?.asNumber() ?? 750;
  const descent = (look(descriptor, 'Descent') as PDFNumber | undefined)?.asNumber() ?? -220;
  const stemV = (look(descriptor, 'StemV') as PDFNumber | undefined)?.asNumber() ?? 0;

  const nameSaysBold = /bold|black|heavy|semibold/i.test(baseFont);
  const nameSaysItalic = /italic|oblique/i.test(baseFont);
  const flags = {
    serif: !!(flagBits & 2) || /times|serif|georgia|garamond|roman|book/i.test(baseFont),
    fixed: !!(flagBits & 1) || /courier|mono/i.test(baseFont),
    bold: !!(flagBits & (1 << 18)) || stemV > 120 || nameSaysBold,
    italic: !!(flagBits & (1 << 6)) || italicAngle !== 0 || nameSaysItalic,
  };

  // ---- code -> unicode -------------------------------------------------
  const toUni = streamBytes(look(dict, 'ToUnicode'));
  const cmap = toUni ? parseToUnicode(toUni) : new Map<number, string>();

  const simpleMap = new Map<number, string>();
  if (!isType0) {
    const encoding = look(dict, 'Encoding');
    let baseName = '';
    let differences: PDFArray | undefined;
    if (encoding instanceof PDFName) baseName = encoding.asString();
    else if (encoding instanceof PDFDict) {
      baseName = (look(encoding, 'BaseEncoding') as PDFName | undefined)?.asString() ?? '';
      differences = look(encoding, 'Differences') as PDFArray | undefined;
    }
    const winAnsi = baseName === '/WinAnsiEncoding' || baseName === '';
    for (let c = 32; c < 256; c++) {
      const u = winAnsi && c in WIN_ANSI_HIGH ? WIN_ANSI_HIGH[c] : c;
      simpleMap.set(c, String.fromCharCode(u));
    }
    if (differences) {
      let code = 0;
      for (let k = 0; k < differences.size(); k++) {
        const item = differences.lookup(k);
        if (item instanceof PDFNumber) code = item.asNumber();
        else if (item instanceof PDFName) {
          const u = glyphNameToUnicode(item.asString().replace(/^\//, ''));
          if (u !== undefined) simpleMap.set(code, String.fromCharCode(u));
          code++;
        }
      }
    }
  }

  const codeBytes = isType0 ? 2 : 1;

  const codesOf = (bytes: Uint8Array): number[] => {
    const out: number[] = [];
    if (codeBytes === 1) for (const b of bytes) out.push(b);
    else for (let i = 0; i + 1 < bytes.length; i += 2) out.push((bytes[i] << 8) | bytes[i + 1]);
    return out;
  };

  const unicodeOf = (code: number): string | undefined =>
    cmap.get(code) ?? simpleMap.get(code);

  const decode = (bytes: Uint8Array): string =>
    codesOf(bytes).map((c) => unicodeOf(c) ?? '').join('');

  // ---- unicode -> code (only possible when the mapping is invertible) ---
  const reverse = new Map<string, number>();
  for (const [code, str] of cmap) if (str.length === 1 && !reverse.has(str)) reverse.set(str, code);
  for (const [code, str] of simpleMap) if (!reverse.has(str)) reverse.set(str, code);

  const encode = (text: string): Uint8Array | null => {
    const codes: number[] = [];
    for (const ch of text) {
      const code = reverse.get(ch);
      if (code === undefined) return null;
      codes.push(code);
    }
    const out = new Uint8Array(codes.length * codeBytes);
    codes.forEach((c, k) => {
      if (codeBytes === 1) out[k] = c & 0xff;
      else {
        out[k * 2] = (c >> 8) & 0xff;
        out[k * 2 + 1] = c & 0xff;
      }
    });
    return out;
  };

  // ---- widths ----------------------------------------------------------
  const missingWidth =
    (look(descriptor, 'MissingWidth') as PDFNumber | undefined)?.asNumber() ?? 0;

  let widthOf: (code: number) => number;
  if (isType0) {
    const dw = (look(metricsDict, 'DW') as PDFNumber | undefined)?.asNumber() ?? 1000;
    const w = look(metricsDict, 'W') as PDFArray | undefined;
    const table = new Map<number, number>();
    if (w) {
      let k = 0;
      while (k < w.size()) {
        const first = w.lookup(k);
        const second = w.lookup(k + 1);
        if (first instanceof PDFNumber && second instanceof PDFArray) {
          const start = first.asNumber();
          for (let j = 0; j < second.size(); j++) {
            const v = second.lookup(j);
            if (v instanceof PDFNumber) table.set(start + j, v.asNumber());
          }
          k += 2;
        } else if (first instanceof PDFNumber && second instanceof PDFNumber) {
          const third = w.lookup(k + 2);
          if (third instanceof PDFNumber) {
            for (let c = first.asNumber(); c <= second.asNumber(); c++) table.set(c, third.asNumber());
          }
          k += 3;
        } else k += 1;
      }
    }
    widthOf = (code) => table.get(code) ?? dw;
  } else {
    const firstChar = (look(dict, 'FirstChar') as PDFNumber | undefined)?.asNumber() ?? 0;
    const widths = look(dict, 'Widths') as PDFArray | undefined;
    const table: number[] = [];
    if (widths) {
      for (let k = 0; k < widths.size(); k++) {
        const v = widths.lookup(k);
        table.push(v instanceof PDFNumber ? v.asNumber() : missingWidth);
      }
    }
    widthOf = (code) => {
      const idx = code - firstChar;
      if (idx >= 0 && idx < table.length && table[idx] > 0) return table[idx];
      const std = standardWidth(baseFont, unicodeOf(code));
      if (std !== null) return std;
      return missingWidth || 500;
    };
  }

  return {
    resourceName,
    baseFont,
    codeBytes,
    flags,
    ascent: ascent / 1000,
    descent: descent / 1000,
    decode,
    encode,
    widthOf,
    codesOf,
  };
}

/** The standard 14 are routinely written with no /Widths at all, because every
 *  reader is expected to know their metrics. Use the real AFM tables rather
 *  than guessing, or every measurement of such a page is wrong. */
const STANDARD_14: Record<string, string> = {
  helvetica: FontNames.Helvetica,
  'helvetica-bold': FontNames.HelveticaBold,
  'helvetica-oblique': FontNames.HelveticaOblique,
  'helvetica-boldoblique': FontNames.HelveticaBoldOblique,
  arial: FontNames.Helvetica,
  'arial-bold': FontNames.HelveticaBold,
  'arial,bold': FontNames.HelveticaBold,
  'times-roman': FontNames.TimesRoman,
  'times-bold': FontNames.TimesRomanBold,
  'times-italic': FontNames.TimesRomanItalic,
  'times-bolditalic': FontNames.TimesRomanBoldItalic,
  timesnewroman: FontNames.TimesRoman,
  courier: FontNames.Courier,
  'courier-bold': FontNames.CourierBold,
  'courier-oblique': FontNames.CourierOblique,
  'courier-boldoblique': FontNames.CourierBoldOblique,
  symbol: FontNames.Symbol,
  zapfdingbats: FontNames.ZapfDingbats,
};

const afmCache = new Map<string, any>();

function afmFor(baseFont: string): any | null {
  // subset prefixes look like "ABCDEF+Helvetica"
  const bare = baseFont.replace(/^[A-Z]{6}\+/, '').toLowerCase();
  const name = STANDARD_14[bare] ?? guessStandard(bare);
  if (!name) return null;
  if (!afmCache.has(name)) {
    try {
      afmCache.set(name, AfmFont.load(name as any));
    } catch {
      afmCache.set(name, null);
    }
  }
  return afmCache.get(name);
}

function guessStandard(bare: string): string | null {
  const bold = /bold|black|heavy/.test(bare);
  const italic = /italic|oblique/.test(bare);
  if (/courier|mono/.test(bare))
    return bold && italic ? FontNames.CourierBoldOblique
      : bold ? FontNames.CourierBold : italic ? FontNames.CourierOblique : FontNames.Courier;
  if (/times|serif|roman|georgia|garamond|book/.test(bare))
    return bold && italic ? FontNames.TimesRomanBoldItalic
      : bold ? FontNames.TimesRomanBold : italic ? FontNames.TimesRomanItalic : FontNames.TimesRoman;
  if (/helvetica|arial|sans|verdana|tahoma|calibri/.test(bare))
    return bold && italic ? FontNames.HelveticaBoldOblique
      : bold ? FontNames.HelveticaBold : italic ? FontNames.HelveticaOblique : FontNames.Helvetica;
  return null;
}

/** Width of a character code via the AFM tables, or null if unavailable. */
function standardWidth(baseFont: string, unicode: string | undefined): number | null {
  const font = afmFor(baseFont);
  if (!font || !unicode) return null;
  try {
    const glyph = Encodings.WinAnsi.encodeUnicodeCodePoint(unicode.codePointAt(0)!);
    const w = font.getWidthOfGlyph(glyph.name);
    return typeof w === 'number' && w > 0 ? w : null;
  } catch {
    return null;
  }
}

export { PDFString, PDFHexString };
