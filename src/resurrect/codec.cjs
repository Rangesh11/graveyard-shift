'use strict';
// Lossless JSON encoding for generated test values: keeps undefined, NaN,
// Infinity, -0, bigint, sparse arrays, null-prototype objects and own
// "__proto__" keys, which plain JSON would lose or mangle. The proof runner
// encodes recorded cases with it, and generated proof tests inline it to decode.

function encode(value) {
  if (value === undefined) return { $undef: 1 };
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') {
    if (Object.is(value, -0)) return { $num: '-0' };
    if (!Number.isFinite(value)) return { $num: String(value) };
    return value;
  }
  if (typeof value === 'bigint') return { $big: String(value) };
  if (Array.isArray(value)) {
    let sparse = false;
    for (let i = 0; i < value.length; i++) if (!(i in value)) { sparse = true; break; }
    if (!sparse) return value.map(encode);
    const items = [];
    for (let i = 0; i < value.length; i++) if (i in value) items.push([i, encode(value[i])]);
    return { $sparse: value.length, items };
  }
  if (typeof value === 'object') {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) throw new TypeError('cannot encode ' + Object.prototype.toString.call(value));
    const out = { $obj: Object.keys(value).map((k) => [k, encode(value[k])]) };
    if (proto === null) out.nullProto = true;
    return out;
  }
  throw new TypeError('cannot encode ' + typeof value);
}

function decode(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(decode);
  if ('$undef' in value) return undefined;
  if ('$num' in value) return value.$num === '-0' ? -0 : Number(value.$num);
  if ('$big' in value) return BigInt(value.$big);
  if ('$sparse' in value) {
    const arr = new Array(value.$sparse);
    for (const [i, v] of value.items) arr[i] = decode(v);
    return arr;
  }
  if ('$obj' in value) {
    const obj = value.nullProto ? Object.create(null) : {};
    for (const [k, v] of value.$obj) {
      Object.defineProperty(obj, k, { value: decode(v), enumerable: true, writable: true, configurable: true });
    }
    return obj;
  }
  throw new TypeError('unknown encoded value');
}

module.exports = { encode, decode };
