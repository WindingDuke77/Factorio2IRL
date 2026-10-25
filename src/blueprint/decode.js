// Decode a Factorio blueprint string (or raw blueprint JSON) into its JSON object.
//
// Format (https://wiki.factorio.com/Blueprint_string_format):
//   '0' + base64( zlib-deflate( JSON ) )
// Factorio 2.0 also accepts raw JSON, so we do too.

const BASE64_RE = /^[A-Za-z0-9+/=]+$/;
// Node-only fallback module, hidden from the bundler (browsers use the Web Streams API instead).
const NODE_ZLIB = 'node:zlib';

/**
 * @param {string} input pasted text
 * @returns {Promise<object>} parsed JSON: `{ blueprint: {...} }` or `{ blueprint_book: {...} }`
 */
export async function decodeBlueprintString(input) {
  const text = String(input ?? '').trim();
  if (!text) throw new Error('Nothing to decode. Paste a blueprint string first.');

  if (text.startsWith('{')) {
    return parseJson(text);
  }

  const versionByte = text[0];
  if (versionByte !== '0') {
    throw new Error(`Unsupported blueprint string version byte "${versionByte}" (expected "0").`);
  }
  const b64 = text.slice(1).replace(/\s+/g, '');
  if (!BASE64_RE.test(b64)) {
    throw new Error('That does not look like a blueprint string (invalid base64).');
  }

  const compressed = base64ToBytes(b64);
  const json = await inflate(compressed);
  return parseJson(json);
}

function parseJson(text) {
  let obj;
  try {
    obj = JSON.parse(text);
  } catch (e) {
    throw new Error('Blueprint decoded but the JSON inside is invalid: ' + e.message);
  }
  if (!obj || typeof obj !== 'object' || !(obj.blueprint || obj.blueprint_book)) {
    throw new Error('Decoded JSON is not a blueprint or blueprint book.');
  }
  return obj;
}

function base64ToBytes(b64) {
  if (typeof atob === 'function') {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

async function inflate(bytes) {
  if (typeof DecompressionStream === 'function') {
    // Blueprint strings use the zlib container, which the Web Streams API calls "deflate".
    const ds = new DecompressionStream('deflate');
    const stream = new Blob([bytes]).stream().pipeThrough(ds);
    const buf = await new Response(stream).arrayBuffer();
    return new TextDecoder().decode(buf);
  }
  const zlib = await import(/* @vite-ignore */ NODE_ZLIB);
  return zlib.inflateSync(bytes).toString('utf8');
}

/**
 * Encode a blueprint JSON object into a blueprint string (used by tests and sample generation).
 */
export async function encodeBlueprintJson(obj) {
  const json = JSON.stringify(obj);
  if (typeof CompressionStream === 'function') {
    const cs = new CompressionStream('deflate');
    const stream = new Blob([new TextEncoder().encode(json)]).stream().pipeThrough(cs);
    const buf = new Uint8Array(await new Response(stream).arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
    return '0' + btoa(bin);
  }
  const zlib = await import(/* @vite-ignore */ NODE_ZLIB);
  return '0' + zlib.deflateSync(Buffer.from(json, 'utf8'), { level: 9 }).toString('base64');
}
