/** A minimal tokenizer for PDF content streams.
 *
 *  It only needs to be good enough to walk operators in order and know the
 *  byte span of each one, so that a text-showing operator can later be
 *  replaced in place. Anything it does not understand it skips over safely —
 *  including inline images, whose binary payload would otherwise be read as
 *  operators. */

export type Operand =
  | { kind: 'num'; value: number }
  | { kind: 'name'; value: string }
  | { kind: 'string'; bytes: Uint8Array }
  | { kind: 'array'; items: Operand[] }
  | { kind: 'dict' }
  | { kind: 'other' };

export interface Op {
  op: string;
  operands: Operand[];
  /** byte range of the whole expression, operands included */
  start: number;
  end: number;
}

const WHITESPACE = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);
const DELIM = new Set([0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25]);

const isWS = (c: number) => WHITESPACE.has(c);
const isDelim = (c: number) => DELIM.has(c);
const isRegular = (c: number) => !isWS(c) && !isDelim(c);

export function tokenize(data: Uint8Array): Op[] {
  const ops: Op[] = [];
  let i = 0;
  let operands: Operand[] = [];
  let operandStart = -1;

  const n = data.length;

  const skipWhitespaceAndComments = () => {
    for (;;) {
      while (i < n && isWS(data[i])) i++;
      if (i < n && data[i] === 0x25) {
        while (i < n && data[i] !== 0x0a && data[i] !== 0x0d) i++;
        continue;
      }
      return;
    }
  };

  /** literal string: balanced parens, backslash escapes */
  const readString = (): Uint8Array => {
    i++; // (
    let depth = 1;
    const out: number[] = [];
    while (i < n) {
      const c = data[i];
      if (c === 0x5c) {
        i++;
        const e = data[i];
        switch (e) {
          case 0x6e: out.push(0x0a); i++; break;
          case 0x72: out.push(0x0d); i++; break;
          case 0x74: out.push(0x09); i++; break;
          case 0x62: out.push(0x08); i++; break;
          case 0x66: out.push(0x0c); i++; break;
          case 0x0a: i++; break;
          case 0x0d: i++; if (data[i] === 0x0a) i++; break;
          default:
            if (e >= 0x30 && e <= 0x37) {
              let oct = 0;
              let k = 0;
              while (k < 3 && data[i] >= 0x30 && data[i] <= 0x37) {
                oct = oct * 8 + (data[i] - 0x30);
                i++;
                k++;
              }
              out.push(oct & 0xff);
            } else {
              out.push(e);
              i++;
            }
        }
        continue;
      }
      if (c === 0x28) depth++;
      if (c === 0x29) {
        depth--;
        if (depth === 0) {
          i++;
          break;
        }
      }
      out.push(c);
      i++;
    }
    return Uint8Array.from(out);
  };

  const readHexString = (): Uint8Array => {
    i++; // <
    const digits: number[] = [];
    while (i < n && data[i] !== 0x3e) {
      const c = data[i];
      const v =
        c >= 0x30 && c <= 0x39 ? c - 0x30
        : c >= 0x41 && c <= 0x46 ? c - 0x37
        : c >= 0x61 && c <= 0x66 ? c - 0x57
        : -1;
      if (v >= 0) digits.push(v);
      i++;
    }
    i++; // >
    if (digits.length % 2) digits.push(0);
    const out = new Uint8Array(digits.length / 2);
    for (let k = 0; k < out.length; k++) out[k] = digits[k * 2] * 16 + digits[k * 2 + 1];
    return out;
  };

  const readName = (): string => {
    i++; // /
    let s = '';
    while (i < n && isRegular(data[i])) {
      if (data[i] === 0x23 && i + 2 < n) {
        s += String.fromCharCode(parseInt(String.fromCharCode(data[i + 1], data[i + 2]), 16));
        i += 3;
      } else {
        s += String.fromCharCode(data[i]);
        i++;
      }
    }
    return s;
  };

  const readToken = (): string => {
    let s = '';
    while (i < n && isRegular(data[i])) {
      s += String.fromCharCode(data[i]);
      i++;
    }
    return s;
  };

  /** `<<` … `>>`, nesting-aware; contents are not needed */
  const skipDict = () => {
    let depth = 0;
    while (i < n) {
      if (data[i] === 0x3c && data[i + 1] === 0x3c) { depth++; i += 2; continue; }
      if (data[i] === 0x3e && data[i + 1] === 0x3e) { depth--; i += 2; if (!depth) return; continue; }
      if (data[i] === 0x28) { readString(); continue; }
      i++;
    }
  };

  /** BI … ID <binary> EI — the payload must not be tokenized */
  const skipInlineImage = () => {
    while (i < n - 1 && !(data[i] === 0x49 && data[i + 1] === 0x44)) i++;
    i += 2;
    if (i < n && isWS(data[i])) i++;
    while (i < n - 1) {
      if (
        data[i] === 0x45 && data[i + 1] === 0x49 &&
        (i + 2 >= n || !isRegular(data[i + 2])) &&
        (i === 0 || isWS(data[i - 1]))
      ) {
        i += 2;
        return;
      }
      i++;
    }
    i = n;
  };

  const readArray = (): Operand[] => {
    i++; // [
    const items: Operand[] = [];
    for (;;) {
      skipWhitespaceAndComments();
      if (i >= n || data[i] === 0x5d) { i++; break; }
      const c = data[i];
      if (c === 0x28) items.push({ kind: 'string', bytes: readString() });
      else if (c === 0x3c && data[i + 1] !== 0x3c) items.push({ kind: 'string', bytes: readHexString() });
      else if (c === 0x3c) { skipDict(); items.push({ kind: 'dict' }); }
      else if (c === 0x2f) items.push({ kind: 'name', value: readName() });
      else if (c === 0x5b) items.push({ kind: 'array', items: readArray() });
      else {
        const tok = readToken();
        if (!tok) { i++; continue; }
        const num = Number(tok);
        items.push(Number.isFinite(num) ? { kind: 'num', value: num } : { kind: 'other' });
      }
    }
    return items;
  };

  while (i < n) {
    skipWhitespaceAndComments();
    if (i >= n) break;
    if (operandStart < 0) operandStart = i;
    const c = data[i];

    if (c === 0x28) { operands.push({ kind: 'string', bytes: readString() }); continue; }
    if (c === 0x3c && data[i + 1] === 0x3c) { skipDict(); operands.push({ kind: 'dict' }); continue; }
    if (c === 0x3c) { operands.push({ kind: 'string', bytes: readHexString() }); continue; }
    if (c === 0x2f) { operands.push({ kind: 'name', value: readName() }); continue; }
    if (c === 0x5b) { operands.push({ kind: 'array', items: readArray() }); continue; }
    if (c === 0x5d || c === 0x7b || c === 0x7d) { i++; continue; }

    const tokStart = i;
    const tok = readToken();
    if (!tok) { i++; continue; }

    const num = Number(tok);
    if (tok !== '' && Number.isFinite(num) && /^[+-.\d]/.test(tok)) {
      operands.push({ kind: 'num', value: num });
      continue;
    }

    if (tok === 'BI') {
      skipInlineImage();
      operands = [];
      operandStart = -1;
      continue;
    }

    ops.push({ op: tok, operands, start: operandStart < 0 ? tokStart : operandStart, end: i });
    operands = [];
    operandStart = -1;
  }

  return ops;
}
