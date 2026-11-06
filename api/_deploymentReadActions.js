const entities = new Set(['PhysicalTrade', 'SwapHedge', 'MopsPrice', 'ClearingAccount', 'Invoice', 'Counterparty', 'AppConfig']);
const sorts = new Set(['id', 'created_date', 'updated_date', 'trade_date', 'price_date', 'date', 'swap_month', 'contract_month', 'short_name', 'key']);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const onlyKeys = (value, keys) => Object.keys(value).every(key => keys.includes(key));

/** Code-owned staging read shapes; a mutation:false registry label is never sufficient. */
export function isReadOnlyHedgeDeskAction(body) {
  if (!plain(body) || typeof body.action !== 'string') return false;
  if (body.action === 'snapshot') return Object.keys(body).length === 1;
  if (!['list', 'filter', 'get'].includes(body.action) || !entities.has(body.entity)) return false;
  if (body.action === 'get') return onlyKeys(body, ['action', 'entity', 'id'])
    && typeof body.id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(body.id);
  if (!onlyKeys(body, body.action === 'filter' ? ['action', 'entity', 'params', 'sort', 'limit'] : ['action', 'entity', 'sort', 'limit'])) return false;
  if (body.sort !== undefined && (typeof body.sort !== 'string' || !sorts.has(body.sort.replace(/^-/, '')))) return false;
  if (body.limit !== undefined && (!Number.isSafeInteger(body.limit) || body.limit < 1 || body.limit > 5000)) return false;
  // The maintained UI filters only the AppConfig key. Other filtering requires review.
  if (body.action === 'filter') return body.entity === 'AppConfig' && plain(body.params)
    && Object.keys(body.params).length === 1 && Object.hasOwn(body.params, 'key')
    && typeof body.params.key === 'string' && /^[a-z][a-z0-9_]{0,79}$/.test(body.params.key);
  return true;
}
