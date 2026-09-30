// Small LZW compressor producing UTF-16-safe strings (15 bits per char, offset 32), so a career
// save (1-2 MB of JSON) fits in localStorage next to other slots. Pure and synchronous.
// The dictionary is a trie keyed by (prefix code * 256 + byte) and capped at 2^18 entries, which
// keeps memory small; after that the dictionary is frozen.

const MAX_BITS = 18;
const MAX_CODES = 1 << MAX_BITS;

export function compress(input: string): string {
  const bytes = new TextEncoder().encode(input);
  if (bytes.length === 0) return 'L1:0:';
  const trie = new Map<number, number>();
  let next = 256;
  let bits = 9;
  let buffer = 0;
  let bufferBits = 0;
  const out: number[] = [];
  const emit = (code: number) => {
    buffer = buffer * (1 << bits) + code;
    bufferBits += bits;
    while (bufferBits >= 15) {
      bufferBits -= 15;
      const div = 2 ** bufferBits;
      out.push(Math.floor(buffer / div) + 32);
      buffer = buffer % div;
    }
  };
  let w = bytes[0];
  for (let i = 1; i < bytes.length; i++) {
    const c = bytes[i];
    const key = w * 256 + c;
    const found = trie.get(key);
    if (found !== undefined) w = found;
    else {
      emit(w);
      if (next < MAX_CODES) {
        trie.set(key, next++);
        if (next > 1 << bits && bits < MAX_BITS) bits++;
      }
      w = c;
    }
  }
  emit(w);
  if (bufferBits > 0) out.push(buffer * 2 ** (15 - bufferBits) + 32);
  let s = '';
  const CHUNK = 8192;
  for (let i = 0; i < out.length; i += CHUNK) s += String.fromCharCode(...out.slice(i, i + CHUNK));
  return `L1:${bytes.length}:` + s;
}

export function decompress(data: string): string {
  if (!data.startsWith('L1:')) return data;
  const sep = data.indexOf(':', 3);
  const total = parseInt(data.substring(3, sep), 10);
  if (total === 0) return '';
  const body = data.substring(sep + 1);
  const prefix = new Int32Array(MAX_CODES);
  const suffix = new Uint8Array(MAX_CODES);
  const first = new Uint8Array(MAX_CODES);
  const length = new Int32Array(MAX_CODES);
  for (let i = 0; i < 256; i++) {
    prefix[i] = -1;
    suffix[i] = i;
    first[i] = i;
    length[i] = 1;
  }
  let next = 256;
  let bits = 9;
  let buffer = 0;
  let bufferBits = 0;
  let pos = 0;
  const read = (): number => {
    while (bufferBits < bits) {
      if (pos >= body.length) return -1;
      buffer = buffer * 32768 + (body.charCodeAt(pos++) - 32);
      bufferBits += 15;
    }
    bufferBits -= bits;
    const div = 2 ** bufferBits;
    const code = Math.floor(buffer / div);
    buffer = buffer % div;
    return code;
  };
  const out = new Uint8Array(total);
  let n = 0;
  const write = (code: number) => {
    const len = length[code];
    let p = n + len - 1;
    let c = code;
    while (c >= 0 && p >= n) {
      if (p < total) out[p] = suffix[c];
      p--;
      c = prefix[c];
    }
    n += len;
  };
  let prev = read();
  if (prev < 0) return '';
  write(prev);
  while (n < total) {
    // the encoder widens right after adding an entry: mirror that one step ahead
    if (next < MAX_CODES && next + 1 > 1 << bits && bits < MAX_BITS) bits++;
    const code = read();
    if (code < 0) break;
    let firstByte: number;
    if (code < next) firstByte = first[code];
    else firstByte = first[prev]; // the KwKwK case
    if (next < MAX_CODES) {
      prefix[next] = prev;
      suffix[next] = firstByte;
      first[next] = first[prev];
      length[next] = length[prev] + 1;
      next++;
    }
    write(code);
    prev = code;
  }
  return new TextDecoder().decode(out.subarray(0, Math.min(n, total)));
}
