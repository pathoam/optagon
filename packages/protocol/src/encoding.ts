// Isomorphic base64 helpers

function hasBuffer(): boolean {
  return typeof Buffer !== 'undefined' && typeof Buffer.from === 'function';
}

function hasAtobBtoa(): boolean {
  // In browsers
  return typeof atob === 'function' && typeof btoa === 'function';
}

/** Encode arbitrary text data to base64 (browser/node). */
export function encodeData(data: string): string {
  if (hasAtobBtoa()) {
    // btoa expects Latin1. For our usage (terminal text chunks), this suffices.
    // If needed, switch to TextEncoder-based conversion later.
    // eslint-disable-next-line no-undef
    return btoa(data);
  }
  if (hasBuffer()) {
    return Buffer.from(data).toString('base64');
  }
  throw new Error('No base64 encoder available');
}

/** Decode base64 to text (browser/node). */
export function decodeData(data: string): string {
  if (hasAtobBtoa()) {
    // eslint-disable-next-line no-undef
    return atob(data);
  }
  if (hasBuffer()) {
    return Buffer.from(data, 'base64').toString();
  }
  throw new Error('No base64 decoder available');
}

/** Encode terminal data (Buffer or string) to base64. */
export function encodeTerminalData(input: string | Uint8Array): string {
  if (hasBuffer()) {
    // @ts-ignore Buffer type may not exist in browser
    const buf = typeof input === 'string' ? Buffer.from(input) : Buffer.from(input);
    return buf.toString('base64');
  }
  // Fallback: assume string path in browsers
  if (typeof input === 'string') {
    return encodeData(input);
  }
  // As a last resort, convert Uint8Array to string via char codes (may be lossy)
  let s = '';
  for (let i = 0; i < input.length; i++) s += String.fromCharCode(input[i]);
  return encodeData(s);
}

/** Decode terminal data (base64) to text. */
export function decodeTerminalData(data: string): string {
  return decodeData(data);
}

