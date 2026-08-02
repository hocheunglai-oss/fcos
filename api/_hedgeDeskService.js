import { createHash } from 'node:crypto';
import { richTextPlainLength, sanitizeRichText } from './_richText.js';
import { hedgeSettlementPaymentDirection } from '../src/hedge/lib/domain.js';
import { verifyMopsSourceMessage } from './_hedgeMops.js';
import { reconcilePaperHedgeExpiry } from './_hedgeExpiry.js';

const SETTLEMENT_TEMPLATE_VARIABLES = new Set([
  'invoiceNumber', 'invoiceType', 'settlementMonth', 'counterparty', 'attn',
  'netAmount', 'direction', 'payer', 'payee', 'beneficiary', 'issueDate', 'dueDate',
]);

const COMMON_FIELDS = [
  'id', 'legacy_source_id', 'created_date', 'updated_date', 'created_by',
  'created_by_id', 'updated_by_id', 'revision',
];

const MOPS_SERVER_FIELDS = new Set([
  'verification_status', 'verification_snapshot', 'verification_hash', 'verified_at', 'verified_by_id',
]);

const ENTITY_CONFIG = {
  PhysicalTrade: {
    table: 'hedge_physical_trades',
    capability: 'hedge_book_manage',
    fields: [...COMMON_FIELDS, 'trade_date', 'product', 'counterparty', 'qty_min', 'qty_max', 'unit', 'vessel_name', 'delivery_date_from', 'delivery_date_to', 'sell_price_type', 'sell_price', 'sell_premium', 'sell_pricing_month', 'sell_pricing_basis', 'sell_bal_date', 'buy_price_type', 'buy_price', 'buy_premium', 'buy_pricing_month', 'buy_pricing_basis', 'buy_bal_date', 'notes', 'stem_number', 'sf_record_id', 'is_closed'],
  },
  SwapHedge: {
    table: 'hedge_swap_hedges',
    capability: 'hedge_book_manage',
    relationshipFields: ['physical_trade_ids'],
    fields: [...COMMON_FIELDS, 'physical_trade_ids', 'trade_date', 'product', 'direction', 'swap_month', 'quantity', 'unit', 'price', 'venue', 'broker', 'counterparty', 'notes', 'is_expired', 'round_trip', 'initial_margin', 'current_margin', 'pricing_basis', 'bal_start_date', 'trade_type', 'leg1_month', 'leg1_price', 'leg1_basis', 'leg1_bal_date', 'leg2_month', 'leg2_price', 'leg2_basis', 'leg2_bal_date', 'sf_record_id'],
  },
  MopsPrice: {
    table: 'hedge_market_prices',
    capability: 'hedge_book_manage',
    fields: [...COMMON_FIELDS, 'price_date', 's380', 's05', 'sgo', 'source', 'raw_input', 'is_estimate'],
  },
  ClearingAccount: {
    table: 'hedge_clearing_entries',
    capability: 'hedge_settlement_manage',
    aliases: { date: 'entry_date' },
    fields: [...COMMON_FIELDS, 'date', 'type', 'amount', 'notes', 'status'],
  },
  Invoice: {
    table: 'hedge_invoices',
    capability: 'hedge_settlement_manage',
    relationshipFields: ['line_items', 'swap_ids', 'physical_trade_ids'],
    fields: [...COMMON_FIELDS, 'invoice_number', 'invoice_type', 'issue_date', 'settlement_month', 'counterparty', 'section', 'line_items', 'subtotal', 'status', 'notes', 'swap_ids', 'physical_trade_ids', 'email_sent_at', 'email_sent_to', 'email_sent_cc', 'sender_mailbox_snapshot', 'pdf_payload', 'pdf_data_url'],
  },
  Counterparty: {
    table: 'hedge_counterparties',
    capability: 'hedge_book_manage',
    fields: [...COMMON_FIELDS, 'short_name', 'full_name', 'address_line1', 'address_line2', 'address_line3', 'attention', 'emails', 'bank_name', 'bank_swift', 'intermediary_bank', 'intermediary_swift', 'account_number', 'notes'],
  },
  AppConfig: {
    table: 'hedge_settings',
    capability: 'hedge_admin',
    fields: [...COMMON_FIELDS, 'key', 'value', 'label', 'notes'],
  },
};

const SNAPSHOT_ENTITIES = [
  ['physicals', 'PhysicalTrade', 2000],
  ['swaps', 'SwapHedge', 2000],
  ['mops', 'MopsPrice', 2000],
  ['clearing', 'ClearingAccount', 2000],
  ['counterparties', 'Counterparty', 2000],
  ['invoices', 'Invoice', 2000],
];

function httpError(message, statusCode = 400, code = null, details = null) {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) error.code = code;
  if (details) error.details = details;
  return error;
}

function configFor(entity) {
  const config = ENTITY_CONFIG[String(entity || '')];
  if (!config) throw httpError('Unknown Hedge Desk entity.', 400);
  return config;
}

function safeLimit(value) {
  const number = Number(value || 1000);
  return Number.isInteger(number) ? Math.min(5000, Math.max(1, number)) : 1000;
}

function assertedField(config, field) {
  if (!config.fields.includes(field)) throw httpError(`Unsupported Hedge Desk field: ${field}.`, 400);
  return config.aliases?.[field] || field;
}

function browserField(config, databaseField) {
  const match = Object.entries(config.aliases || {}).find(([, value]) => value === databaseField);
  return match?.[0] || databaseField;
}

function mapDatabaseRow(config, row) {
  if (!row) return row;
  const result = {};
  for (const [key, value] of Object.entries(row)) result[browserField(config, key)] = value;
  return result;
}

function cleanPayload(config, payload, profile, { creating = false } = {}) {
  const relationships = {};
  const clean = {};
  for (const [field, value] of Object.entries(payload || {})) {
    if (MOPS_SERVER_FIELDS.has(field)) continue;
    if (['id', 'created_date', 'updated_date', 'created_by', 'created_by_id', 'updated_by_id', 'revision', 'legacy_source_id'].includes(field)) continue;
    assertedField(config, field);
    if (config.relationshipFields?.includes(field)) relationships[field] = value;
    else clean[config.aliases?.[field] || field] = value;
  }
  clean.updated_by_id = profile.id;
  if (creating) {
    clean.created_by = String(profile.email || '').toLowerCase();
    clean.created_by_id = profile.id;
  }
  return { clean, relationships };
}

function sanitizeAppConfigPayload(payload, configKey) {
  if (configKey !== 'email_settings') return payload;
  const value = payload?.value && typeof payload.value === 'object' ? payload.value : {};
  const subject = String(value.email_subject || '').trim().slice(0, 500);
  const emailBody = sanitizeRichText(value.email_body, 100000);
  if (!subject) throw httpError('Settlement email subject is required.');
  if (!emailBody || richTextPlainLength(emailBody) < 3) throw httpError('Settlement email message is required.');
  const templateText = `${subject} ${emailBody}`;
  for (const match of templateText.matchAll(/\{([^{}]+)\}/g)) {
    if (!SETTLEMENT_TEMPLATE_VARIABLES.has(match[1])) throw httpError(`Unknown settlement template variable: {${match[1]}}.`);
  }
  return {
    ...payload,
    value: {
      email_to: String(value.email_to || '').trim().slice(0, 1000),
      email_cc: String(value.email_cc || '').trim().slice(0, 1000),
      email_bcc: String(value.email_bcc || '').trim().slice(0, 1000),
      email_subject: subject,
      email_body: emailBody,
    },
  };
}

function sanitizeInvoicePayload(payload, current = null) {
  const subtotal = Number(payload?.subtotal ?? current?.subtotal);
  if (!Number.isFinite(subtotal)) throw httpError('A signed settlement amount is required for an FCBHK invoice.', 400);
  const counterparty = String(payload?.counterparty ?? current?.counterparty ?? '').trim();
  if (!counterparty) throw httpError('A counterparty is required for an FCBHK invoice.', 400);
  const paymentDirection = hedgeSettlementPaymentDirection(subtotal, counterparty);
  const sanitized = { ...payload, invoice_type: paymentDirection.invoiceType };
  if (payload?.pdf_payload && typeof payload.pdf_payload === 'object') {
    sanitized.pdf_payload = {
      ...payload.pdf_payload,
      netAmount: paymentDirection.signedAmount,
      isReceivable: paymentDirection.isReceivable,
    };
  }
  return sanitized;
}

function sanitizeSwapPayload(payload, { creating = false } = {}) {
  const sanitized = { ...(payload || {}) };
  delete sanitized.is_expired;
  if (creating) sanitized.is_expired = false;
  return sanitized;
}

function sanitizeMopsPayload(payload, current, profile) {
  const merged = { ...(current || {}), ...(payload || {}) };
  if (merged.is_estimate === true) {
    return {
      verification_status: 'not_applicable',
      verification_snapshot: null,
      verification_hash: null,
      verified_at: null,
      verified_by_id: null,
    };
  }

  const sourceMessage = String(merged.raw_input || '').trim();
  if (!sourceMessage) {
    return {
      verification_status: 'unverified',
      verification_snapshot: null,
      verification_hash: null,
      verified_at: null,
      verified_by_id: null,
    };
  }

  const verification = verifyMopsSourceMessage(merged, sourceMessage);
  if (!verification.verified) {
    throw httpError(`The third-party MOPS message could not verify this row: ${verification.issues.join(' ')}`, 400, 'HEDGE_MOPS_VERIFICATION_FAILED', { issues: verification.issues });
  }
  return {
    verification_status: 'verified',
    verification_snapshot: verification.parsed,
    verification_hash: createHash('sha256').update(sourceMessage).digest('hex'),
    verified_at: new Date().toISOString(),
    verified_by_id: profile.id,
  };
}

function applySort(query, config, sort) {
  if (!sort) return query;
  const input = String(sort);
  const descending = input.startsWith('-');
  const field = assertedField(config, descending ? input.slice(1) : input);
  return query.order(field, { ascending: !descending, nullsFirst: false });
}

async function requireWriteCapability(capabilities, config) {
  const allowed = capabilities?.[config.capability] === true;
  if (!allowed) throw httpError('You do not have permission to change this Hedge Desk record.', 403);
}

async function hydrateSwapRelations(client, rows) {
  if (!rows.length) return rows;
  const { data, error } = await client.from('hedge_swap_physical_links')
    .select('swap_id,physical_trade_id,link_order')
    .in('swap_id', rows.map((row) => row.id))
    .order('link_order', { ascending: true });
  if (error) throw httpError(`Hedge links could not be loaded: ${error.message}`, 502);
  const links = new Map();
  for (const row of data || []) {
    if (!links.has(row.swap_id)) links.set(row.swap_id, []);
    links.get(row.swap_id).push(row.physical_trade_id);
  }
  return rows.map((row) => ({ ...row, physical_trade_ids: links.get(row.id) || [] }));
}

async function hydrateInvoiceRelations(client, rows) {
  if (!rows.length) return rows;
  const ids = rows.map((row) => row.id);
  const [lineResult, swapResult, physicalResult] = await Promise.all([
    client.from('hedge_invoice_lines').select('*').in('invoice_id', ids).order('line_order', { ascending: true }),
    client.from('hedge_invoice_swaps').select('invoice_id,swap_id,link_order').in('invoice_id', ids).order('link_order', { ascending: true }),
    client.from('hedge_invoice_physicals').select('invoice_id,physical_trade_id,link_order').in('invoice_id', ids).order('link_order', { ascending: true }),
  ]);
  const error = lineResult.error || swapResult.error || physicalResult.error;
  if (error) throw httpError(`Hedge invoice relationships could not be loaded: ${error.message}`, 502);
  const lines = new Map();
  const swaps = new Map();
  const physicals = new Map();
  for (const line of lineResult.data || []) {
    if (!lines.has(line.invoice_id)) lines.set(line.invoice_id, []);
    lines.get(line.invoice_id).push({
      product: line.product,
      direction: line.direction,
      quantity: line.quantity,
      unit: line.unit,
      price: line.price,
      mtm_value: line.mtm_value,
      mtm_avg: line.mtm_avg,
      handling_fee: line.handling_fee,
      net_value: line.net_value,
      ...(line.source_snapshot || {}),
    });
  }
  for (const link of swapResult.data || []) {
    if (!swaps.has(link.invoice_id)) swaps.set(link.invoice_id, []);
    swaps.get(link.invoice_id).push(link.swap_id);
  }
  for (const link of physicalResult.data || []) {
    if (!physicals.has(link.invoice_id)) physicals.set(link.invoice_id, []);
    physicals.get(link.invoice_id).push(link.physical_trade_id);
  }
  return rows.map((row) => ({
    ...row,
    line_items: lines.get(row.id) || [],
    swap_ids: swaps.get(row.id) || [],
    physical_trade_ids: physicals.get(row.id) || [],
  }));
}

async function hydrateRows(client, entity, rows) {
  if (entity === 'SwapHedge') return hydrateSwapRelations(client, rows);
  if (entity === 'Invoice') return hydrateInvoiceRelations(client, rows);
  return rows;
}

async function listRows(client, entity, config, { sort = '-created_date', limit = 1000, filters = null } = {}) {
  let query = client.from(config.table).select('*');
  for (const [field, value] of Object.entries(filters || {})) {
    const databaseField = assertedField(config, field);
    if (config.relationshipFields?.includes(field)) throw httpError(`Filtering by ${field} is not supported.`, 400);
    query = Array.isArray(value) ? query.in(databaseField, value) : query.eq(databaseField, value);
  }
  query = applySort(query, config, sort).limit(safeLimit(limit));
  const { data, error } = await query;
  if (error) throw httpError(`Hedge Desk data could not be loaded: ${error.message}`, 502);
  const rows = (data || []).map((row) => mapDatabaseRow(config, row));
  return hydrateRows(client, entity, rows);
}

async function loadOne(client, entity, config, id) {
  const { data, error } = await client.from(config.table).select('*').eq('id', String(id || '')).maybeSingle();
  if (error) throw httpError(`Hedge Desk record could not be loaded: ${error.message}`, 502);
  if (!data) throw httpError('Hedge Desk record was not found.', 404);
  return (await hydrateRows(client, entity, [mapDatabaseRow(config, data)]))[0];
}

function normalizedIds(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || '').trim()).filter(Boolean))];
}

async function validateIds(client, table, ids, label) {
  if (!ids.length) return;
  const { data, error } = await client.from(table).select('id').in('id', ids);
  if (error) throw httpError(`${label} could not be validated: ${error.message}`, 502);
  if ((data || []).length !== ids.length) throw httpError(`One or more selected ${label.toLowerCase()} records are invalid or stale.`, 409);
}

async function replaceRelationships(client, entity, recordId, relationships) {
  if (entity === 'SwapHedge' && Object.hasOwn(relationships, 'physical_trade_ids')) {
    const ids = normalizedIds(relationships.physical_trade_ids);
    await validateIds(client, 'hedge_physical_trades', ids, 'Physical trades');
    const removed = await client.from('hedge_swap_physical_links').delete().eq('swap_id', recordId);
    if (removed.error) throw httpError(`Existing hedge links could not be replaced: ${removed.error.message}`, 502);
    if (ids.length) {
      const inserted = await client.from('hedge_swap_physical_links').insert(ids.map((id, index) => ({ swap_id: recordId, physical_trade_id: id, link_order: index })));
      if (inserted.error) throw httpError(`Hedge links could not be saved: ${inserted.error.message}`, 502);
    }
  }
  if (entity !== 'Invoice') return;

  if (Object.hasOwn(relationships, 'line_items')) {
    const lines = Array.isArray(relationships.line_items) ? relationships.line_items : [];
    const removed = await client.from('hedge_invoice_lines').delete().eq('invoice_id', recordId);
    if (removed.error) throw httpError(`Existing invoice lines could not be replaced: ${removed.error.message}`, 502);
    if (lines.length) {
      const rows = lines.map((line, index) => ({
        invoice_id: recordId,
        line_order: index,
        product: line.product || null,
        direction: line.direction || null,
        quantity: Number.isFinite(Number(line.quantity)) ? Number(line.quantity) : null,
        unit: line.unit || null,
        price: Number.isFinite(Number(line.price)) ? Number(line.price) : null,
        mtm_avg: Number.isFinite(Number(line.mtm_avg ?? line.mtmAvg)) ? Number(line.mtm_avg ?? line.mtmAvg) : null,
        mtm_value: Number.isFinite(Number(line.mtm_value ?? line.mtmValue)) ? Number(line.mtm_value ?? line.mtmValue) : null,
        handling_fee: Number.isFinite(Number(line.handling_fee ?? line.handlingFee)) ? Number(line.handling_fee ?? line.handlingFee) : null,
        net_value: Number.isFinite(Number(line.net_value ?? line.netValue)) ? Number(line.net_value ?? line.netValue) : null,
        source_snapshot: line,
      }));
      const inserted = await client.from('hedge_invoice_lines').insert(rows);
      if (inserted.error) throw httpError(`Invoice lines could not be saved: ${inserted.error.message}`, 502);
    }
  }
  for (const [field, table, foreignKey, sourceTable, label] of [
    ['swap_ids', 'hedge_invoice_swaps', 'swap_id', 'hedge_swap_hedges', 'Paper hedges'],
    ['physical_trade_ids', 'hedge_invoice_physicals', 'physical_trade_id', 'hedge_physical_trades', 'Physical trades'],
  ]) {
    if (!Object.hasOwn(relationships, field)) continue;
    const ids = normalizedIds(relationships[field]);
    await validateIds(client, sourceTable, ids, label);
    const removed = await client.from(table).delete().eq('invoice_id', recordId);
    if (removed.error) throw httpError(`Existing ${label.toLowerCase()} links could not be replaced: ${removed.error.message}`, 502);
    if (ids.length) {
      const inserted = await client.from(table).insert(ids.map((id, index) => ({ invoice_id: recordId, [foreignKey]: id, link_order: index })));
      if (inserted.error) throw httpError(`${label} links could not be saved: ${inserted.error.message}`, 502);
    }
  }
}

async function writeEvent(client, { eventType, entity, record, before = null, profile, label = null, metadata = {} }) {
  const { error } = await client.from('hedge_events').insert({
    event_type: eventType,
    entity_type: entity,
    entity_id: record?.id || before?.id || null,
    entity_legacy_id: record?.legacy_source_id || before?.legacy_source_id || null,
    label,
    before_data: before,
    after_data: record,
    metadata,
    actor_user_id: profile.id,
    actor_email: String(profile.email || '').toLowerCase(),
    source: 'fcos',
  });
  if (error) throw httpError(`Hedge Desk audit history could not be saved: ${error.message}`, 502);
}

async function recentEvents(client) {
  const { data, error } = await client.from('hedge_events').select('id,event_type,entity_type,entity_id,label,actor_email,created_at,before_data,after_data').order('created_at', { ascending: false }).limit(500);
  if (error) throw httpError(`Hedge Desk activity could not be loaded: ${error.message}`, 502);
  return (data || []).map((row) => ({
    id: row.id,
    action: row.event_type.replace(/^record_/, ''),
    entity: row.entity_type,
    record_id: row.entity_id,
    label: row.label,
    user: row.actor_email,
    created_date: row.created_at,
    before: row.before_data,
    after: row.after_data,
  }));
}

export async function loadHedgeDeskSnapshot({ client, capabilities }) {
  const expiryAutomation = await reconcilePaperHedgeExpiry(client);
  const entries = await Promise.all(SNAPSHOT_ENTITIES.map(async ([key, entity, limit]) => [
    key,
    await listRows(client, entity, configFor(entity), { limit }),
  ]));
  const auditLogs = await recentEvents(client);
  return { ...Object.fromEntries(entries), auditLogs, capabilities, expiryAutomation };
}

export async function handleHedgeDeskEntity(body, profile, { client, capabilities }) {
  const action = String(body?.action || 'list');
  if (action === 'snapshot') return loadHedgeDeskSnapshot({ client, capabilities });
  const entity = String(body?.entity || '');
  const config = configFor(entity);

  if (action === 'list') return listRows(client, entity, config, { sort: body.sort, limit: body.limit });
  if (action === 'filter') return listRows(client, entity, config, { sort: body.sort, limit: body.limit, filters: body.params });
  if (action === 'get') return loadOne(client, entity, config, body.id);

  let writeConfig = config;
  if (entity === 'AppConfig') {
    let configKey = body?.payload?.key;
    if (!configKey && body.id) {
      const current = await client.from(config.table).select('key').eq('id', body.id).maybeSingle();
      if (current.error) throw httpError(`Hedge Desk setting could not be validated: ${current.error.message}`, 502);
      configKey = current.data?.key;
    }
    if (configKey === 'closed_months') writeConfig = { ...config, capability: 'hedge_close_approve' };
    if (configKey === 'fwd_spreads') writeConfig = { ...config, capability: 'hedge_book_manage' };
    body = { ...body, payload: sanitizeAppConfigPayload(body.payload, configKey) };
  }
  await requireWriteCapability(capabilities, writeConfig);

  if (action === 'create') {
    if (entity === 'Invoice') body = { ...body, payload: sanitizeInvoicePayload(body.payload) };
    if (entity === 'SwapHedge') body = { ...body, payload: sanitizeSwapPayload(body.payload, { creating: true }) };
    const mopsServerFields = entity === 'MopsPrice' ? sanitizeMopsPayload(body.payload, null, profile) : null;
    const { clean, relationships } = cleanPayload(config, body.payload, profile, { creating: true });
    if (mopsServerFields) Object.assign(clean, mopsServerFields);
    const { data, error } = await client.from(config.table).insert(clean).select('*').single();
    if (error) throw httpError(`Hedge Desk record could not be created: ${error.message}`, 502);
    try {
      await replaceRelationships(client, entity, data.id, relationships);
      const record = await loadOne(client, entity, config, data.id);
      await writeEvent(client, { eventType: 'record_created', entity, record, profile, label: body.label || null });
      if (entity === 'MopsPrice') await reconcilePaperHedgeExpiry(client, { profile });
      return record;
    } catch (errorAfterInsert) {
      await client.from(config.table).delete().eq('id', data.id);
      throw errorAfterInsert;
    }
  }

  if (action === 'update') {
    const before = await loadOne(client, entity, config, body.id);
    const expectedRevision = Number(body.expectedRevision);
    if (!Number.isInteger(expectedRevision) || expectedRevision !== Number(before.revision)) {
      throw httpError('This Hedge Desk record changed after it was opened. Refresh before saving.', 409, 'REVISION_CONFLICT', { current: before });
    }
    if (entity === 'Invoice') body = { ...body, payload: sanitizeInvoicePayload(body.payload, before) };
    if (entity === 'SwapHedge') body = { ...body, payload: sanitizeSwapPayload(body.payload) };
    const mopsServerFields = entity === 'MopsPrice' ? sanitizeMopsPayload(body.payload, before, profile) : null;
    const { clean, relationships } = cleanPayload(config, body.payload, profile);
    if (mopsServerFields) Object.assign(clean, mopsServerFields);
    const { data, error } = await client.from(config.table).update(clean).eq('id', before.id).eq('revision', expectedRevision).select('*').maybeSingle();
    if (error) throw httpError(`Hedge Desk record could not be updated: ${error.message}`, 502);
    if (!data) throw httpError('This Hedge Desk record changed after it was opened. Refresh before saving.', 409, 'REVISION_CONFLICT');
    await replaceRelationships(client, entity, before.id, relationships);
    const record = await loadOne(client, entity, config, before.id);
    await writeEvent(client, { eventType: 'record_updated', entity, record, before, profile, label: body.label || null });
    if (entity === 'MopsPrice') await reconcilePaperHedgeExpiry(client, { profile });
    return record;
  }

  if (action === 'delete') {
    const before = await loadOne(client, entity, config, body.id);
    const expectedRevision = Number(body.expectedRevision);
    if (!Number.isInteger(expectedRevision) || expectedRevision !== Number(before.revision)) {
      throw httpError('This Hedge Desk record changed after it was opened. Refresh before deleting.', 409, 'REVISION_CONFLICT', { current: before });
    }
    const { error } = await client.from(config.table).delete().eq('id', before.id).eq('revision', expectedRevision);
    if (error) throw httpError(`Hedge Desk record could not be deleted: ${error.message}`, 409);
    await writeEvent(client, { eventType: 'record_deleted', entity, before, profile, label: body.label || null });
    return true;
  }

  throw httpError('Unsupported Hedge Desk data action.', 400);
}

export async function handleHedgeMarkets(body, profile, { client, capabilities }) {
  const action = String(body?.action || 'snapshot');
  if (action === 'snapshot') {
    const expiryAutomation = await reconcilePaperHedgeExpiry(client);
    const [mops, settingsResult] = await Promise.all([
      listRows(client, 'MopsPrice', configFor('MopsPrice'), { limit: 2000 }),
      client.from('hedge_settings').select('id,key,value,revision,created_date,updated_date').in('key', ['general', 'fwd_spreads']),
    ]);
    if (settingsResult.error) throw httpError(`Market settings could not be loaded: ${settingsResult.error.message}`, 502);
    const settings = Object.fromEntries((settingsResult.data || []).map((row) => [row.key, row]));
    return {
      mops,
      settings: {
        general: settings.general?.value || {},
        forwardSpreads: settings.fwd_spreads?.value || {},
        forwardSpreadsUpdatedAt: settings.fwd_spreads?.updated_date || null,
        forwardSpreadsRevision: Number(settings.fwd_spreads?.revision || 0),
      },
      capabilities: { hedge_book_manage: capabilities?.hedge_book_manage === true },
      expiryAutomation,
    };
  }

  if (action === 'save_spreads') {
    const current = await client.from('hedge_settings').select('id,key,value,revision').eq('key', 'fwd_spreads').maybeSingle();
    if (current.error) throw httpError(`Forward adjustments could not be validated: ${current.error.message}`, 502);
    const payload = { key: 'fwd_spreads', value: body.value || {}, label: 'fwd_spreads' };
    if (!current.data) return handleHedgeDeskEntity({ action: 'create', entity: 'AppConfig', payload }, profile, { client, capabilities });
    return handleHedgeDeskEntity({ action: 'update', entity: 'AppConfig', id: current.data.id, expectedRevision: body.expectedRevision, payload }, profile, { client, capabilities });
  }

  if (String(body?.entity || '') !== 'MopsPrice') throw httpError('Markets may access only market-price records.', 403);
  return handleHedgeDeskEntity(body, profile, { client, capabilities });
}

export function hedgeEntityWriteCapability(entity) {
  return configFor(entity).capability;
}
