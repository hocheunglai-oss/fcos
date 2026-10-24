// Paid policy only: reject lossy/non-JSON evidence BEFORE legacy serialization.
const LIMITS = Object.freeze({ bytes: 1_000_000, nodes: 100_000, depth: 24 });
export function copyPaidSupplierProofJson(value) {
  let nodes = 0; const visiting = new Set();
  const walk = (item, depth) => {
    if (++nodes > LIMITS.nodes || depth > LIMITS.depth) throw Error('bound');
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return item;
    if (typeof item === 'number' && Number.isFinite(item) && !Object.is(item, -0)) return item;
    if (typeof item !== 'object' || visiting.has(item)
      || Object.getPrototypeOf(item) !== (Array.isArray(item) ? Array.prototype : Object.prototype)) throw Error('json');
    visiting.add(item);
    const descriptors = Object.getOwnPropertyDescriptors(item); const keys = Reflect.ownKeys(descriptors);
    if (keys.some(key => typeof key !== 'string')) throw Error('json');
    const array = Array.isArray(item); const result = array ? [] : {};
    if (array && keys.length !== item.length + 1) throw Error('sparse');
    for (const key of keys) {
      if (array && key === 'length') continue;
      const d = descriptors[key];
      if (!Object.hasOwn(d, 'value') || !d.enumerable
        || array && (!/^(?:0|[1-9]\d*)$/.test(key) || Number(key) >= item.length)) throw Error('json');
      Object.defineProperty(result, key, { value: walk(d.value, depth + 1), enumerable: true, writable: true, configurable: true });
    }
    visiting.delete(item); return result;
  };
  const copied = walk(value, 0);
  if (!copied || typeof copied !== 'object' || Array.isArray(copied)
    || Buffer.byteLength(JSON.stringify(copied)) > LIMITS.bytes) throw Error('bound');
  return copied;
}
