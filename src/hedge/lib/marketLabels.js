const PRODUCT_LABELS = Object.freeze({
  hsfo380: 'HSFO 380',
  hsfo: 'HSFO 380',
  s380: 'HSFO 380',
  vlsfo: 'S0.5%',
  s05: 'S0.5%',
  lsmgo: 'LSMGO',
  sgo: 'LSMGO',
});

const SYMBOL_LABELS = Object.freeze({
  MFSPD00: 'Singapore S0.5% delivered',
  MFSKD00: 'South Korea S0.5% delivered',
  WKMFA00: 'South Korea (West) S0.5% delivered',
  MFZSD00: 'Zhoushan S0.5% delivered',
  MFHKD00: 'Hong Kong S0.5% delivered',
  PUAFT00: 'Singapore HSFO 380 delivered',
  PUAFR00: 'South Korea HSFO 380 delivered',
  PUAER00: 'Hong Kong HSFO 380 delivered',
  BFDZA00: 'Zhoushan HSFO 380 delivered',
  AAXYO00: 'Singapore LSMGO delivered',
  AAXYS00: 'South Korea LSMGO delivered',
  AAXYQ00: 'Hong Kong LSMGO delivered',
  MGZSD00: 'Zhoushan LSMGO delivered',
  CB1AR00: 'Kaohsiung LS180 / S0.5% posted price',
  CB3AN00: 'Kaohsiung MF-380 / HSFO 380 posted price',
  CBGAP00: 'Kaohsiung Marine Gasoil / LSMGO posted price',
  AMFSA00: 'S0.5 MOPS · FOB Singapore 0.5% cargo',
  PPXDK00: 'S380 MOPS · FOB Singapore 380 CST cargo',
  POABC00: 'SGO MOPS · FOB Singapore gasoil',
  FOFS000: 'S0.5% balance-month outright',
  FOFS001: 'S0.5% M1 outright',
  FOFS002: 'S0.5% M2 outright',
  FPLSM01: 'HSFO 380 M1 outright',
  FPLSM02: 'HSFO 380 M2 outright',
  FQLSM01: 'HSFO East-West M1 spread',
  FQLSM02: 'HSFO East-West M2 spread',
  BSGSL00: 'LSMGO balance-month outright',
  MSGSL00: 'LSMGO M1 outright',
  MSHSL00: 'LSMGO M2 outright',
  MSJSL00: 'Gasoil EFS balance month',
  MSKSL00: 'Gasoil EFS M0',
  MSLSL00: 'Gasoil EFS M1',
  MSMSL00: 'Gasoil EFS M2',
});

export function marketProductLabel(productKey, fallback = null) {
  return PRODUCT_LABELS[String(productKey || '').toLowerCase()] || fallback || productKey || 'Market';
}

export function marketSymbolLabel(sourceSymbol, context = {}) {
  const symbol = String(sourceSymbol || '').trim().toUpperCase();
  const explicit = String(context.primaryLabel || '').trim();
  if (!symbol) return explicit || 'No exact series';
  if (explicit) return explicit.includes(symbol) ? explicit : `${explicit} (${symbol})`;

  const known = SYMBOL_LABELS[symbol];
  if (known) return `${known} (${symbol})`;

  const product = marketProductLabel(context.productKey, context.productLabel);
  const port = String(context.portLabel || '').trim();
  const tenor = String(context.tenor || '').trim().toUpperCase();
  const family = String(context.marketFamily || '').toLowerCase();
  const basis = String(context.settlementBasis || '').toLowerCase();
  let label = product;
  if (family === 'delivered') label = [port, product, 'delivered'].filter(Boolean).join(' ');
  else if (family === 'cargo' || basis === 'mops') label = `${product} MOPS`;
  else if (family === 'forward' || basis === 'outright') label = [product, tenor, 'outright'].filter(Boolean).join(' ');
  else if (basis === 'east_west_spread') label = ['HSFO East-West', tenor, 'spread'].filter(Boolean).join(' ');
  else if (basis === 'gasoil_efs') label = ['Gasoil EFS', tenor].filter(Boolean).join(' ');
  else if (tenor) label = `${product} ${tenor} market assessment`;
  else label = `${product} market assessment`;
  return `${label} (${symbol})`;
}
