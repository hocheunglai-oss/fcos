import { createHash } from 'node:crypto';
import { requireExternalActionGate } from './_externalActionGates.js';
import { getApiVersion, sfCompositeQueries, sfQuery, sfRequest } from './_salesforce.js';

const SALESFORCE_ID = /^[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?$/;
const VARIABLE_CHARGE_STEM_CREATED_FROM = '2026-01-01T00:00:00Z';
const VIEW_ONLY_USER_TYPES = new Set(['finance', 'administrator', 'general_manager']);
const CASE_SELECT = [
  'id', 'stem_id', 'stem_name', 'workflow_status', 'confirmation_status',
  'delivery_date', 'due_date', 'revision', 'assigned_buyer_user_id',
  'assigned_buyer_name', 'assigned_buyer_email', 'assignment_source',
  'override_expires_at', 'source_fingerprint', 'supplier_fingerprint',
  'salesforce_stem_last_modified_at', 'invoice_state', 'post_invoice_detected_at',
  'post_invoice_resolution', 'post_invoice_reference', 'created_at', 'updated_at',
].join(',');
const HK_HOLIDAY_CACHE = new Map();

function httpError(message, status = 400, code = 'VARIABLE_CHARGE_ERROR', details) {
  const error = new Error(message);
  error.status = status;
  error.statusCode = status;
  error.code = code;
  error.expose = status < 500;
  if (details !== undefined) error.details = details;
  return error;
}

function text(value, max = 1000) {
  return String(value ?? '').trim().slice(0, max);
}

function normalizedEmail(value) {
  return text(value, 320).toLowerCase();
}

function normalizedName(value) {
  return text(value, 320)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function escapeSoql(value) {
  return String(value ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function quotedIds(values) {
  return [...new Set((values || []).filter((value) => SALESFORCE_ID.test(String(value || ''))))]
    .map((value) => `'${escapeSoql(value)}'`)
    .join(',');
}

function chunks(values, size = 180) {
  const result = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

async function queryAll(soql, options = {}) {
  const result = await sfQuery(soql, { limit: options.limit || 50_000, softFail: false });
  return result.records || [];
}

async function queryIds(objectName, fields, ids, suffix = '') {
  const uniqueIds = [...new Set((ids || []).filter(Boolean))];
  if (!uniqueIds.length) return [];
  const results = await sfCompositeQueries(chunks(uniqueIds).map((group) => ({
    soql: `SELECT ${fields} FROM ${objectName} WHERE Id IN (${quotedIds(group)}) ${suffix}`,
    limit: 50_000,
  })));
  return results.flatMap((result) => result.records || []);
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

function sha256(value) {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

function isoDate(value) {
  const match = text(value, 40).match(/^\d{4}-\d{2}-\d{2}$/);
  return match ? match[0] : null;
}

function addUtcDays(value, days) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function hongKongToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Hong_Kong', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

function isWeekend(value) {
  const day = new Date(`${value}T00:00:00.000Z`).getUTCDay();
  return day === 0 || day === 6;
}

export function nextHongKongBusinessDay(deliveryDate, holidays = new Set()) {
  const normalized = isoDate(deliveryDate);
  if (!normalized) return null;
  let candidate = addUtcDays(normalized, 1);
  for (let guard = 0; guard < 20; guard += 1) {
    if (!isWeekend(candidate) && !holidays.has(candidate)) return candidate;
    candidate = addUtcDays(candidate, 1);
  }
  throw httpError('Hong Kong business-day calculation could not be completed.', 503, 'HK_BUSINESS_DAY_UNAVAILABLE');
}

async function hongKongHolidays(year) {
  const key = String(year);
  const cached = HK_HOLIDAY_CACHE.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.dates;
  const response = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${encodeURIComponent(key)}/HK`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw httpError('Hong Kong public-holiday data is unavailable. Charge due dates were not guessed.', 503, 'HK_HOLIDAY_UNAVAILABLE');
  const rows = await response.json();
  const dates = new Set((Array.isArray(rows) ? rows : []).map((row) => isoDate(row?.date)).filter(Boolean));
  HK_HOLIDAY_CACHE.set(key, { dates, expiresAt: Date.now() + 12 * 60 * 60 * 1000 });
  return dates;
}

async function dueDateForDelivery(deliveryDate) {
  const date = isoDate(deliveryDate);
  if (!date) return null;
  const years = new Set([Number(date.slice(0, 4)), Number(addUtcDays(date, 14).slice(0, 4))]);
  const dates = new Set();
  for (const year of years) for (const holiday of await hongKongHolidays(year)) dates.add(holiday);
  return nextHongKongBusinessDay(date, dates);
}

function isVariableChargeAccount(account) {
  return account?.Is_Agent__c === true;
}

function finalInvoice(invoice) {
  return invoice?.Proforma__c !== true && !/(?:^|-)CN(?:-|$)/i.test(text(invoice?.Name, 255));
}

function lineFingerprint(row) {
  return {
    kind: 'line_item', id: row.Id, supplierId: row.Original_Supplier__c,
    cancelled: row.Cancelled__c === true, productId: row.Product__c || null,
    quantity: row.Quantity__c ?? null, deliveredQuantity: row.Quantity_Delivered_Per_BDN__c ?? null,
    quantityMax: row.Quantity_Max__c ?? null,
    uom: row.Unit_of_Measure__c || null, cost: row.Unit_Buy_At__c ?? null,
    price: row.Unit_Sell_At__c ?? null, totalCost: row.Total_Cost__c ?? null,
    totalPrice: row.Total_Price__c ?? null, paymentTerm: row.Payment_Term__c || null,
    currency: row.CurrencyIsoCode || null, unitSellAt: row.Unit_Sell_At__c || null,
    unitBuyAt: row.Unit_Buy_At__c || null, commissionCost: row.Commission_Cost__c ?? null,
  };
}

function extraFingerprint(row) {
  return {
    kind: 'extra_cost', id: row.Id, supplierId: row.Supplier__c,
    cancelled: row.Cancelled__c === true, productId: row.Product2Id__c || null,
    description: row.Description__c || null,
    quantity: row.Quantity__c ?? null, deliveredQuantity: row.Quantity_Delivered_Per_BDN__c ?? null,
    quantityRangeMax: row.Quantity_Range_Max__c ?? null,
    uom: row.Unit_of_Measure__c || null, unitCost: row.Unit_Cost__c ?? null,
    unitPrice: row.Unit_Price__c ?? null, fixedCost: row.Lumpsum_Cost__c ?? null,
    fixedPrice: row.Lumpsum_Price__c ?? null, lineCost: row.Line_Total_Buy__c ?? null,
    linePrice: row.Line_Total__c ?? null, paymentTerm: row.Payment_Term__c || null,
    currency: row.CurrencyIsoCode || null, supplierInvoiceId: row.Supplier_Invoice__c || null,
    stemLineItemId: row.STEM_Line_Item__c || null, recordTypeId: row.RecordTypeId || null,
  };
}

function liveFingerprint(liveCase) {
  return sha256({
    stemId: liveCase.stem.Id,
    deliveryDate: liveCase.stem.Delivery_Date__c || null,
    stemFinancials: {
      accountId: liveCase.stem.Account__c || null,
      paymentTerm: liveCase.stem.Payment_Term__c || null,
      total: liveCase.stem.Total__c ?? null,
      costsTotal: liveCase.stem.Costs_Total__c ?? null,
      invoiceTotal: liveCase.stem.Total_Invoice_Amount__c ?? null,
      receivableBalance: liveCase.stem.Receivable_Balance__c ?? null,
      payableBalance: liveCase.stem.Payable_Balance__c ?? null,
      currency: liveCase.stem.CurrencyIsoCode || null,
    },
    accounts: liveCase.accounts.map((row) => ({ id: row.Id, isAgent: row.Is_Agent__c === true, paymentTerm: row.Supplier_Payment_Term__c || null })).sort((a, b) => a.id.localeCompare(b.id)),
    supplierStages: (liveCase.supplierStages || []).map((row) => ({ id: row.Id, supplierId: row.Supplier__c, manual: row.Manual_Review_Required__c === true, status: row.Supplier_Status__c, revision: row.Revision__c ?? null, fingerprint: row.Reviewed_Source_Fingerprint__c || null })).sort((a, b) => String(a.supplierId).localeCompare(String(b.supplierId))),
    nominations: liveCase.nominations.map((row) => ({ id: row.Id, trader: row.Buyer_Supplier_Trader__c || null, email: row.BT_ST_Email_Address__c || null, buyerConfirmation: row.Buyer_Confirmation__c || null })).sort((a, b) => a.id.localeCompare(b.id)),
    lineItems: liveCase.lineItems.map(lineFingerprint).sort((a, b) => a.id.localeCompare(b.id)),
    extraCosts: liveCase.extraCosts.map(extraFingerprint).sort((a, b) => a.id.localeCompare(b.id)),
  });
}

function supplierLiveFingerprint(liveCase, supplierId) {
  return sha256({
    account: liveCase.accounts.filter((row) => row.Id === supplierId).map((row) => ({
      id: row.Id,
      isAgent: row.Is_Agent__c === true,
      paymentTerm: row.Supplier_Payment_Term__c || null,
      lastModifiedAt: row.LastModifiedDate || null,
    })),
    nominations: (liveCase.supplierNominations || []).filter((row) => row.Account__c === supplierId).map((row) => ({
      id: row.Id,
      trader: row.Buyer_Supplier_Trader__c || null,
      email: normalizedEmail(row.BT_ST_Email_Address__c),
      lastModifiedAt: row.LastModifiedDate || null,
    })),
    lineItems: liveCase.lineItems.filter((row) => row.Original_Supplier__c === supplierId).map(lineFingerprint).sort((a, b) => a.id.localeCompare(b.id)),
    extraCosts: liveCase.extraCosts.filter((row) => row.Supplier__c === supplierId).map(extraFingerprint).sort((a, b) => a.id.localeCompare(b.id)),
  });
}

async function activeProfileDirectory(client) {
  const { data, error } = await client.from('user_profiles').select('id,email,full_name,user_type,active').eq('active', true);
  if (error) throw error;
  return data || [];
}

async function salesforceUserEmails(traderNames) {
  const names = [...new Set((traderNames || []).map(text).filter(Boolean))];
  if (!names.length) return new Map();
  const rows = [];
  for (const group of chunks(names, 100)) {
    rows.push(...await queryAll(`SELECT Id, Name, Email FROM User WHERE IsActive = true AND Name IN (${group.map((name) => `'${escapeSoql(name)}'`).join(',')})`));
  }
  const byName = new Map();
  for (const row of rows) {
    const key = normalizedName(row.Name);
    const list = byName.get(key) || [];
    list.push(normalizedEmail(row.Email));
    byName.set(key, list.filter(Boolean));
  }
  return byName;
}

function uniqueMatch(rows, predicate) {
  const matches = rows.filter(predicate);
  return matches.length === 1 ? matches[0] : null;
}

async function resolveAssignments(client, liveCases) {
  const profiles = await activeProfileDirectory(client);
  const traderNames = liveCases.flatMap((entry) => entry.nominations.map((row) => row.Buyer_Supplier_Trader__c));
  const sfEmails = await salesforceUserEmails(traderNames);
  for (const entry of liveCases) {
    const identities = [];
    for (const nomination of entry.nominations) {
      const name = text(nomination.Buyer_Supplier_Trader__c, 320);
      const formulaEmail = normalizedEmail(nomination.BT_ST_Email_Address__c);
      const emails = [...new Set([formulaEmail, ...(sfEmails.get(normalizedName(name)) || [])].filter(Boolean))];
      identities.push({ name, emails });
    }
    const identityKeys = new Set(identities.map((item) => `${normalizedName(item.name)}|${item.emails.sort().join(',')}`));
    if (!identities.length) {
      entry.assignment = { status: 'missing_nomination', message: 'No active Buyer Confirmation trader is assigned.' };
      continue;
    }
    if (identityKeys.size !== 1) {
      entry.assignment = { status: 'ambiguous_nomination', message: 'Active Buyer Confirmations disagree on the Buyer Trader.' };
      continue;
    }
    const identity = identities[0];
    let profile = null;
    let matchedBy = null;
    for (const email of identity.emails) {
      const byEmail = uniqueMatch(profiles, (row) => normalizedEmail(row.email) === email);
      if (byEmail) { profile = byEmail; matchedBy = 'email'; break; }
    }
    if (!profile) {
      profile = uniqueMatch(profiles, (row) => normalizedName(row.full_name) === normalizedName(identity.name));
      if (profile) matchedBy = 'name';
    }
    entry.assignment = profile ? {
      status: 'resolved', profileId: profile.id, name: profile.full_name || identity.name,
      email: profile.email || null, userType: profile.user_type || null, matchedBy,
    } : {
      status: 'unresolved_profile', name: identity.name,
      message: 'The Buyer Trader does not resolve to one active FCOS profile.',
    };
  }
}

async function resolveSupplierAssignments(client, liveCases) {
  const profiles = await activeProfileDirectory(client);
  const traderNames = liveCases.flatMap((entry) => (entry.supplierNominations || []).map((row) => row.Buyer_Supplier_Trader__c));
  const sfEmails = await salesforceUserEmails(traderNames);
  for (const entry of liveCases) {
    entry.supplierRequirements = entry.accounts.map((account) => {
      const nominations = (entry.supplierNominations || []).filter((row) => row.Account__c === account.Id);
      const identities = nominations.map((nomination) => {
        const name = text(nomination.Buyer_Supplier_Trader__c, 320);
        const formulaEmail = normalizedEmail(nomination.BT_ST_Email_Address__c);
        const emails = [...new Set([formulaEmail, ...(sfEmails.get(normalizedName(name)) || [])].filter(Boolean))].sort();
        return { name, emails };
      });
      const identityKeys = new Set(identities.map((item) => `${normalizedName(item.name)}|${item.emails.join(',')}`));
      const identity = identities[0] || { name: '', emails: [] };
      let profile = null;
      let matchedBy = null;
      if (identityKeys.size === 1) {
        for (const email of identity.emails) {
          profile = uniqueMatch(profiles, (row) => normalizedEmail(row.email) === email);
          if (profile) { matchedBy = 'email'; break; }
        }
        if (!profile && identity.name) {
          profile = uniqueMatch(profiles, (row) => normalizedName(row.full_name) === normalizedName(identity.name));
          if (profile) matchedBy = 'name';
        }
      }
      const stage = (entry.supplierStages || []).find((row) => row.Supplier__c === account.Id) || null;
      const assignmentStatus = !identities.length ? 'missing_nomination'
        : identityKeys.size !== 1 ? 'ambiguous_nomination'
          : profile ? 'resolved' : 'unresolved_profile';
      return {
        supplierId: account.Id,
        supplierName: account.Name,
        isAgent: account.Is_Agent__c === true,
        manualReviewRequired: stage?.Manual_Review_Required__c === true,
        effectiveRequired: account.Is_Agent__c === true || stage?.Manual_Review_Required__c === true,
        requirementSource: account.Is_Agent__c === true ? 'Account · Is Agent' : 'Manual STEM selection',
        stageId: stage?.Id || null,
        status: stage?.Supplier_Status__c || 'Pending',
        revision: Number(stage?.Revision__c || 0),
        verifiedAt: stage?.Verified_At__c || null,
        lastModifiedAt: stage?.LastModifiedDate || null,
        reviewedSourceFingerprint: stage?.Reviewed_Source_Fingerprint__c || null,
        sourceFingerprint: supplierLiveFingerprint(entry, account.Id),
        assignmentStatus,
        assignmentMessage: assignmentStatus === 'resolved' ? null
          : assignmentStatus === 'missing_nomination' ? 'No active Supplier Nomination is assigned.'
            : assignmentStatus === 'ambiguous_nomination' ? 'Active Supplier Nominations disagree on the Supplier Trader.'
              : 'The Supplier Trader does not resolve to one active FCOS profile.',
        assignedSupplierTrader: profile ? {
          id: profile.id, name: profile.full_name || identity.name, email: profile.email || identity.emails[0] || null,
          matchedBy,
        } : { id: null, name: identity.name || null, email: identity.emails[0] || null, matchedBy: null },
      };
    }).filter((row) => row.effectiveRequired);
  }
}

function candidateWhere(stemIds, fieldName = 'STEM__c') {
  const ids = quotedIds(stemIds || []);
  return ids ? ` AND ${fieldName} IN (${ids})` : '';
}

async function loadLiveCases({ client, stemIds = null, stemAccessCondition = null }) {
  const requested = stemIds ? [...new Set(stemIds.filter((id) => SALESFORCE_ID.test(String(id || ''))))] : null;
  if (stemIds && requested.length !== stemIds.length) throw httpError('A valid Salesforce STEM is required.', 400, 'INVALID_STEM_ID');
  const [allLineItems, allExtraCosts] = await Promise.all([
    queryAll(`SELECT Id, STEM__c, Original_Supplier__c, Product__c, Product__r.Name, Quantity__c, Quantity_Delivered_Per_BDN__c, Quantity_Max__c, Unit_of_Measure__c, Unit_Sell_At__c, Unit_Buy_At__c, Total_Cost__c, Total_Price__c, Commission_Cost__c, Payment_Term__c, Buyer_Invoice__c, Supplier_Invoice__c, Cancelled__c, LastModifiedDate FROM STEM_Line_Item__c WHERE Cancelled__c = false AND Original_Supplier__c != null AND STEM__r.CreatedDate >= ${VARIABLE_CHARGE_STEM_CREATED_FROM}${candidateWhere(requested)}`),
    queryAll(`SELECT Id, STEM__c, STEM_Line_Item__c, Supplier__c, Supplier_Invoice__c, Product2Id__c, Product2Id__r.Name, Description__c, RecordTypeId, RecordType.Name, Quantity__c, Quantity_Delivered_Per_BDN__c, Quantity_Range_Max__c, Unit_of_Measure__c, Unit_Cost__c, Unit_Price__c, Lumpsum_Cost__c, Lumpsum_Price__c, Line_Total_Buy__c, Line_Total__c, Payment_Term__c, Buyer_Invoice__c, Cancelled__c, LastModifiedDate FROM STEM_Extra_Cost__c WHERE Cancelled__c = false AND Supplier__c != null AND STEM__r.CreatedDate >= ${VARIABLE_CHARGE_STEM_CREATED_FROM}${candidateWhere(requested)}`),
  ]);
  const supplierStages = await queryAll(`SELECT Id, STEM__c, Supplier__c, Manual_Review_Required__c, Supplier_Status__c, Verified_At__c, Verified_By_Email__c, Reviewed_Source_Fingerprint__c, Revision__c, LastModifiedDate FROM STEM_Variable_Charge_Supplier__c WHERE STEM__r.CreatedDate >= ${VARIABLE_CHARGE_STEM_CREATED_FROM}${candidateWhere(requested)}`);
  const supplierIds = [...new Set([
    ...allLineItems.map((row) => row.Original_Supplier__c),
    ...allExtraCosts.map((row) => row.Supplier__c), ...supplierStages.map((row) => row.Supplier__c),
  ].filter(Boolean))];
  const accounts = (await queryIds('Account', 'Id, Name, Is_Agent__c, Supplier_Payment_Term__c, Inactive_Suspended__c, LastModifiedDate', supplierIds))
    .filter((account) => account.Inactive_Suspended__c !== true);
  const accountMap = new Map(accounts.map((row) => [row.Id, row]));
  const manualPairKeys = new Set(supplierStages.filter((row) => row.Manual_Review_Required__c === true).map((row) => `${row.STEM__c}:${row.Supplier__c}`));
  const relevantLines = allLineItems.filter((row) => isVariableChargeAccount(accountMap.get(row.Original_Supplier__c)) || manualPairKeys.has(`${row.STEM__c}:${row.Original_Supplier__c}`));
  const relevantExtras = allExtraCosts.filter((row) => isVariableChargeAccount(accountMap.get(row.Supplier__c)) || manualPairKeys.has(`${row.STEM__c}:${row.Supplier__c}`));
  const detectedStemIds = [...new Set([...relevantLines, ...relevantExtras].map((row) => row.STEM__c).filter(Boolean))];
  const targetStemIds = requested || detectedStemIds;
  if (!targetStemIds.length) return [];
  const stemRows = [];
  for (const group of chunks(targetStemIds)) {
    const accessClause = stemAccessCondition ? ` AND (${stemAccessCondition})` : '';
    stemRows.push(...await queryAll(`SELECT Id, Name, KeyStem__c, Account__c, CreatedDate, Delivery_Date__c, Payment_Term__c, Total__c, Costs_Total__c, Total_Invoice_Amount__c, Receivable_Balance__c, Payable_Balance__c, Variable_Charges_Confirmed__c, LastModifiedDate FROM STEM__c WHERE Id IN (${quotedIds(group)}) AND CreatedDate >= ${VARIABLE_CHARGE_STEM_CREATED_FROM}${accessClause}`));
  }
  const accessibleStemIds = new Set(stemRows.map((row) => row.Id));
  const [nominations, supplierNominations, invoices] = await Promise.all([
    accessibleStemIds.size ? queryAll(`SELECT Id, STEM__c, Buyer_Supplier_Trader__c, BT_ST_Email_Address__c, Buyer_Confirmation__c, LastModifiedDate FROM Nomination__c WHERE STEM__c IN (${quotedIds([...accessibleStemIds])}) AND Deprecated__c = false AND RecordType.DeveloperName = 'Buyer'`) : [],
    accessibleStemIds.size ? queryAll(`SELECT Id, STEM__c, Account__c, Buyer_Supplier_Trader__c, BT_ST_Email_Address__c, LastModifiedDate FROM Nomination__c WHERE STEM__c IN (${quotedIds([...accessibleStemIds])}) AND Deprecated__c = false AND RecordType.DeveloperName = 'Supplier'`) : [],
    accessibleStemIds.size ? queryAll(`SELECT Id, Name, STEM__c, Proforma__c, Sent__c, File__c, LastModifiedDate FROM Invoice__c WHERE STEM__c IN (${quotedIds([...accessibleStemIds])})`) : [],
  ]);
  const result = stemRows.map((stem) => {
    const lineItems = relevantLines.filter((row) => row.STEM__c === stem.Id);
    const extraCosts = relevantExtras.filter((row) => row.STEM__c === stem.Id);
    const usedAccountIds = new Set([...lineItems.map((row) => row.Original_Supplier__c), ...extraCosts.map((row) => row.Supplier__c)]);
    const entry = {
      stem, lineItems, extraCosts,
      accounts: [...usedAccountIds].map((id) => accountMap.get(id)).filter(Boolean),
      nominations: nominations.filter((row) => row.STEM__c === stem.Id),
      supplierNominations: supplierNominations.filter((row) => row.STEM__c === stem.Id && usedAccountIds.has(row.Account__c)),
      supplierStages: supplierStages.filter((row) => row.STEM__c === stem.Id && usedAccountIds.has(row.Supplier__c)),
      invoices: invoices.filter((row) => row.STEM__c === stem.Id),
      hasVariableCharges: lineItems.length > 0 || extraCosts.length > 0,
      hasShipAgent: lineItems.length > 0 || extraCosts.length > 0,
    };
    entry.fingerprint = liveFingerprint(entry);
    return entry;
  });
  await resolveAssignments(client, result);
  await resolveSupplierAssignments(client, result);
  return result;
}

function effectiveAssignee(row) {
  return {
    id: row?.assigned_buyer_user_id,
    name: row?.assigned_buyer_name,
    email: row?.assigned_buyer_email,
  };
}

async function activeGeneralManager(client, userId) {
  const { data, error } = await client.from('collaboration_roles').select('user_id').eq('role', 'general_manager').eq('active', true);
  if (error) throw error;
  const ids = [...new Set((data || []).map((row) => row.user_id).filter(Boolean))];
  let activeProfile = null;
  if (userId) {
    const result = await client.from('user_profiles').select('id,user_type,active').eq('id', userId).eq('active', true).maybeSingle();
    if (result.error) throw result.error;
    activeProfile = result.data;
  }
  return {
    isGeneralManager: ids.length === 1 && ids[0] === userId && text(activeProfile?.user_type, 100).toLowerCase() === 'general_manager',
    configured: ids.length === 1,
  };
}

function capabilitiesFor(row, profile, gm) {
  const assignee = effectiveAssignee(row);
  const normalEditor = assignee.id === profile?.id && !VIEW_ONLY_USER_TYPES.has(text(profile?.user_type, 100).toLowerCase());
  return {
    canView: true,
    canEdit: normalEditor,
    canConfirm: normalEditor,
    canGmOverride: gm.isGeneralManager,
    canResolvePostInvoice: normalEditor || gm.isGeneralManager,
    readOnlyReason: normalEditor || gm.isGeneralManager ? null : (assignee.name ? `Assigned to ${assignee.name}.` : 'No active FCOS Buyer Trader is resolved.'),
  };
}

function deriveStatus(live, stored, today = hongKongToday()) {
  const finals = live.invoices.filter(finalInvoice);
  const sourceChanged = Boolean(stored?.source_fingerprint && stored.source_fingerprint !== live.fingerprint);
  const confirmed = live.stem.Variable_Charges_Confirmed__c === true
    && stored?.confirmation_status === 'confirmed'
    && !sourceChanged;
  if (finals.length && (sourceChanged || stored?.workflow_status === 'post_invoice_change')) return 'post_invoice_changes';
  if (!live.hasVariableCharges) return 'completed';
  if (!live.stem.Delivery_Date__c || today <= live.stem.Delivery_Date__c) return 'awaiting_delivery';
  if ((live.supplierRequirements || []).some((row) => row.assignmentStatus !== 'resolved' || row.status !== 'Verified')) return 'needs_action';
  if (live.assignment?.status !== 'resolved') return 'needs_action';
  if (finals.length) return confirmed || stored?.post_invoice_resolution ? 'completed' : 'post_invoice_changes';
  if (confirmed) return 'ready_for_invoice';
  return 'needs_action';
}

function serializeLiveRow(row, kind) {
  const supplierId = kind === 'line_item' ? row.Original_Supplier__c : row.Supplier__c;
  const productId = kind === 'line_item' ? row.Product__c : row.Product2Id__c;
  const productName = kind === 'line_item' ? row.Product__r?.Name : row.Product2Id__r?.Name;
  return {
    id: row.Id, kind, supplierId, productId, productName: productName || null,
    description: kind === 'extra_cost' ? row.Description__c || null : null,
    quantity: row.Quantity__c ?? null, deliveredQuantity: row.Quantity_Delivered_Per_BDN__c ?? null,
    unitOfMeasure: row.Unit_of_Measure__c || null,
    cost: kind === 'line_item' ? row.Unit_Buy_At__c ?? null : row.Unit_Cost__c ?? null,
    price: kind === 'line_item' ? row.Unit_Sell_At__c ?? null : row.Unit_Price__c ?? null,
    fixedCost: row.Lumpsum_Cost__c ?? null, fixedPrice: row.Lumpsum_Price__c ?? null,
    lineCost: kind === 'line_item' ? row.Total_Cost__c ?? null : row.Line_Total_Buy__c ?? null,
    linePrice: kind === 'line_item' ? row.Total_Price__c ?? null : row.Line_Total__c ?? null,
    paymentTerm: row.Payment_Term__c || null, buyerInvoiceId: row.Buyer_Invoice__c || null,
    currency: row.CurrencyIsoCode || null, lastModifiedDate: row.LastModifiedDate || null,
    readOnly: kind === 'line_item', cancelled: row.Cancelled__c === true,
  };
}

function serializeCase(live, stored, profile, gm, dueDate) {
  const status = deriveStatus(live, stored);
  const assignee = effectiveAssignee(stored || {});
  const supplierAccounts = live.accounts.map((row) => ({
    id: row.Id,
    name: row.Name,
    paymentTerm: row.Supplier_Payment_Term__c || null,
  }));
  const assignedBuyerTrader = assignee.id ? assignee : {
    id: live.assignment?.profileId || null, name: live.assignment?.name || null, email: live.assignment?.email || null,
  };
  const supplierRequirements = (live.supplierRequirements || []).map((row) => ({
    ...row,
    canVerify: row.assignmentStatus === 'resolved'
      && row.assignedSupplierTrader?.id === profile?.id
      && !VIEW_ONLY_USER_TYPES.has(text(profile?.user_type, 100).toLowerCase()),
  }));
  const verifiedSupplierCount = supplierRequirements.filter((row) => row.status === 'Verified').length;
  const baseCapabilities = capabilitiesFor(stored || {
    assigned_buyer_user_id: live.assignment?.profileId,
    assigned_buyer_name: live.assignment?.name,
    assigned_buyer_email: live.assignment?.email,
  }, profile, gm);
  baseCapabilities.canSupplierVerify = supplierRequirements.some((row) => row.canVerify);
  baseCapabilities.canBuyerConfirm = baseCapabilities.canConfirm && verifiedSupplierCount === supplierRequirements.length;
  return {
    id: stored?.id || null, stemId: live.stem.Id,
    stemName: live.stem.KeyStem__c || live.stem.Name || live.stem.Id,
    createdDate: live.stem.CreatedDate || null,
    deliveryDate: live.stem.Delivery_Date__c || null, dueDate, status,
    salesforceStemLastModifiedAt: live.stem.LastModifiedDate || null,
    revision: Number(stored?.revision || 0), fingerprint: live.fingerprint,
    confirmed: live.stem.Variable_Charges_Confirmed__c === true,
    confirmedFingerprint: stored?.confirmation_status === 'confirmed' ? stored?.source_fingerprint || null : null,
    assignedBuyerTrader,
    assigneeProfileId: assignedBuyerTrader.id || null,
    assigneeName: assignedBuyerTrader.name || null,
    buyerTraderName: assignedBuyerTrader.name || null,
    assignmentStatus: live.assignment?.status || 'unresolved_profile',
    assignmentMessage: live.assignment?.message || null,
    supplierRequirements,
    supplierStageProgress: { verified: verifiedSupplierCount, required: supplierRequirements.length },
    supplierAccounts,
    variableChargeSupplierName: supplierAccounts.map((row) => row.name).filter(Boolean).join(', ') || null,
    shipAgentName: supplierAccounts.map((row) => row.name).filter(Boolean).join(', ') || null,
    shipAgentAccountId: supplierAccounts.length === 1 ? supplierAccounts[0].id : null,
    supplierPaymentTerm: supplierAccounts.length === 1 ? supplierAccounts[0].paymentTerm : null,
    lineItemCount: live.lineItems.length, extraCostCount: live.extraCosts.length,
    finalInvoiceCount: live.invoices.filter(finalInvoice).length,
    hasFinalInvoice: live.invoices.some(finalInvoice),
    postInvoiceResolution: stored?.post_invoice_resolution || null,
    postInvoiceReferencePresent: Boolean(stored?.post_invoice_reference),
    urgent: status === 'post_invoice_changes' || Boolean(dueDate && dueDate < hongKongToday()),
    capabilities: baseCapabilities,
  };
}

async function storedCases(client, stemIds = null) {
  let query = client.from('variable_charge_cases').select(CASE_SELECT);
  if (stemIds?.length) query = query.in('stem_id', stemIds);
  const { data, error } = await query;
  if (error) throw httpError('Variable Charges storage is unavailable. Apply the required Supabase migration.', 503, 'VARIABLE_CHARGE_STORAGE_UNAVAILABLE');
  return data || [];
}

async function serializeCases(client, liveCases, profile) {
  const stored = await storedCases(client, liveCases.map((entry) => entry.stem.Id));
  const storedMap = new Map(stored.map((row) => [row.stem_id, row]));
  const gm = await activeGeneralManager(client, profile?.id);
  const cases = [];
  for (const live of liveCases) {
    const dueDate = live.stem.Delivery_Date__c ? await dueDateForDelivery(live.stem.Delivery_Date__c) : null;
    cases.push(serializeCase(live, storedMap.get(live.stem.Id), profile, gm, dueDate));
  }
  return { cases, gm };
}

function viewCounts(cases) {
  const counts = { needs_action: 0, awaiting_delivery: 0, ready_for_invoice: 0, post_invoice_changes: 0, completed: 0 };
  for (const row of cases) if (Object.prototype.hasOwnProperty.call(counts, row.status)) counts[row.status] += 1;
  return counts;
}

export async function listVariableCharges(body, context) {
  const live = await loadLiveCases({ client: context.client, stemAccessCondition: context.stemAccessCondition || null });
  const serialized = await serializeCases(context.client, live, context.profile);
  const requestedView = text(body?.view, 60).toLowerCase().replaceAll('-', '_');
  return {
    cases: requestedView && requestedView !== 'all' ? serialized.cases.filter((row) => row.status === requestedView) : serialized.cases,
    counts: viewCounts(serialized.cases),
    capabilities: { canGmOverride: serialized.gm.isGeneralManager, generalManagerConfigured: serialized.gm.configured },
    retrievedAt: new Date().toISOString(),
  };
}

async function liveCaseForStem(stemId, context) {
  if (!SALESFORCE_ID.test(text(stemId, 18))) throw httpError('A valid Salesforce STEM is required.', 400, 'INVALID_STEM_ID');
  const rows = await loadLiveCases({ client: context.client, stemIds: [stemId] });
  if (!rows.length) throw httpError('No Variable Charges supplier is currently detected for this STEM.', 404, 'VARIABLE_CHARGE_CASE_NOT_FOUND');
  return rows[0];
}

async function linkedSalesforceFiles(live) {
  const entityIds = [live.stem.Id, ...live.lineItems.map((row) => row.Id), ...live.extraCosts.map((row) => row.Id)];
  const links = await queryAll(`SELECT ContentDocumentId, LinkedEntityId FROM ContentDocumentLink WHERE LinkedEntityId IN (${quotedIds(entityIds)})`);
  const documents = await queryIds('ContentDocument', 'Id, Title, FileType, ContentSize, LatestPublishedVersionId, LastModifiedDate', links.map((row) => row.ContentDocumentId));
  const linkMap = new Map();
  for (const link of links) {
    const ids = linkMap.get(link.ContentDocumentId) || [];
    ids.push(link.LinkedEntityId);
    linkMap.set(link.ContentDocumentId, ids);
  }
  return documents.map((row) => ({
    id: row.Id, title: row.Title, fileType: row.FileType, contentSize: row.ContentSize,
    latestVersionId: row.LatestPublishedVersionId, lastModifiedDate: row.LastModifiedDate,
    linkedEntityIds: linkMap.get(row.Id) || [],
  }));
}

async function activeProducts() {
  const rows = await queryAll("SELECT Id, Name, IsActive, LastModifiedDate FROM Product2 WHERE IsActive = true ORDER BY Name");
  return rows.map((row) => ({ id: row.Id, name: row.Name, lastModifiedDate: row.LastModifiedDate }));
}

export async function variableChargeOptions(_body, context) {
  const [products, profiles, recordTypes] = await Promise.all([
    activeProducts(),
    activeProfileDirectory(context.client),
    queryAll("SELECT Id, Name, DeveloperName FROM RecordType WHERE SObjectType = 'STEM_Extra_Cost__c' AND DeveloperName = 'STEM_Charge' LIMIT 1"),
  ]);
  if (recordTypes.length !== 1) throw httpError('The active Salesforce STEM Charge record type is required.', 503, 'STEM_CHARGE_RECORD_TYPE_UNAVAILABLE');
  return {
    products,
    assignees: profiles.filter((row) => !VIEW_ONLY_USER_TYPES.has(text(row.user_type).toLowerCase())).map((row) => ({ id: row.id, name: row.full_name || row.email, email: row.email })),
    pricingModes: [{ id: 'fixed', label: 'Fixed' }, { id: 'per_unit', label: 'Per unit' }],
    recordTypeId: recordTypes[0].Id,
  };
}

export async function getVariableChargeDetail(body, context) {
  const live = await liveCaseForStem(body?.stemId, context);
  const [{ cases }, files, options] = await Promise.all([
    serializeCases(context.client, [live], context.profile),
    linkedSalesforceFiles(live),
    variableChargeOptions({}, context),
  ]);
  return {
    case: cases[0],
    lineItems: live.lineItems.map((row) => serializeLiveRow(row, 'line_item')),
    extraCosts: live.extraCosts.map((row) => serializeLiveRow(row, 'extra_cost')),
    salesforceFiles: files,
    products: options.products,
    assignees: options.assignees,
    pricingModes: options.pricingModes,
    capabilities: cases[0].capabilities,
  };
}

function operationIdentity(body) {
  const operationId = text(body?.operationId, 64);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(operationId)) {
    throw httpError('A UUID operation identity is required.', 400, 'INVALID_OPERATION_ID');
  }
  return operationId.toLowerCase();
}

async function reserveOperation(client, { operationId, type, stemId, fingerprint, actorId }) {
  const { data, error } = await client.rpc('reserve_variable_charge_operation', {
    p_operation_id: operationId,
    p_operation_type: type,
    p_stem_id: stemId,
    p_request_fingerprint: fingerprint,
    p_actor_user_id: actorId,
  });
  if (error) {
    if (/fingerprint|different request|already used/i.test(error.message || '')) throw httpError(error.message, 409, 'IDEMPOTENCY_CONFLICT');
    throw error;
  }
  return data || {};
}

async function completeOperation(client, operationId, status, result) {
  const { error } = await client.rpc('complete_variable_charge_operation', {
    p_operation_id: operationId,
    p_status: status,
    p_result: result || {},
  });
  if (error) throw error;
}

function currentCaseRow(rows, stemId) {
  const row = rows.find((item) => item.stem_id === stemId);
  if (!row) throw httpError('The Variable Charges Charge case is not synchronized yet. Refresh Payment Collections.', 409, 'CASE_NOT_SYNCHRONIZED');
  return row;
}

async function requireCaseAuthority(context, stored, body, { allowGeneralManager = true } = {}) {
  const gm = await activeGeneralManager(context.client, context.profile.id);
  const assignee = effectiveAssignee(stored);
  const normal = assignee.id === context.profile.id && !VIEW_ONLY_USER_TYPES.has(text(context.profile.user_type).toLowerCase());
  if (normal) return { generalManagerOverride: false, reason: null };
  const reason = text(body?.gmOverrideReason || body?.reason, 1000);
  if (allowGeneralManager && gm.isGeneralManager && reason.length >= 5) return { generalManagerOverride: true, reason };
  if (gm.isGeneralManager) throw httpError('A General Manager override reason of at least 5 characters is required.', 400, 'GM_REASON_REQUIRED');
  throw httpError('Only the assigned Buyer Trader may change or confirm this case.', 403, 'ASSIGNED_TRADER_REQUIRED');
}

function numeric(value, label, { positive = false, nullable = true } = {}) {
  if (value === '' || value == null) {
    if (nullable) return null;
    throw httpError(`${label} is required.`, 400, 'INVALID_FINANCIAL_INPUT');
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || (positive && parsed <= 0)) throw httpError(`${label} is invalid.`, 400, 'INVALID_FINANCIAL_INPUT');
  return parsed;
}

function lastModifiedHeaders(value) {
  const parsed = new Date(value);
  if (!value || Number.isNaN(parsed.getTime())) {
    throw httpError('Salesforce LastModifiedDate is required for a conflict-safe write.', 409, 'LAST_MODIFIED_DATE_REQUIRED');
  }
  return { 'If-Unmodified-Since': parsed.toUTCString() };
}

function reviewEvidence(review) {
  const reference = text(review?.referenceOrNote || review?.reference || review?.note, 1000);
  const evidenceDocumentIds = [...new Set((review?.evidenceDocumentIds || []).map((value) => text(value, 18)).filter(Boolean))];
  return { reference, evidenceDocumentIds };
}

async function validateReviews(body, live, files) {
  const reviews = Array.isArray(body?.reviews) ? body.reviews : [];
  const existingIds = [...live.lineItems, ...live.extraCosts].map((row) => row.Id);
  const byId = new Map(reviews.map((review) => [text(review?.sourceId || review?.salesforceId || review?.id, 64), review]));
  for (const id of existingIds) {
    const review = byId.get(id);
    if (!review || review.reviewed !== true) throw httpError('Every current Variable Charges row must be reviewed individually.', 400, 'ROW_REVIEW_REQUIRED');
    if (!['include', 'exclude'].includes(review.buyerChargeDecision)) throw httpError('Every reviewed row needs an Include or Exclude buyer-charge decision.', 400, 'BUYER_CHARGE_DECISION_REQUIRED');
    const evidence = reviewEvidence(review);
    if (!evidence.reference && !evidence.evidenceDocumentIds.length) throw httpError('Every reviewed row needs a reference, note, or Salesforce File.', 400, 'ROW_EVIDENCE_REQUIRED');
  }
  const fileIds = new Set(files.map((row) => row.id));
  for (const review of reviews) {
    const evidence = reviewEvidence(review);
    if (evidence.evidenceDocumentIds.some((id) => !fileIds.has(id))) throw httpError('A selected Salesforce File is no longer linked to this STEM or charge row.', 409, 'EVIDENCE_CHANGED');
  }
  for (const addition of Array.isArray(body?.extraCostAdds) ? body.extraCostAdds : []) {
    const review = byId.get(text(addition?.reviewLocalId, 64));
    if (!review || review.reviewed !== true) throw httpError('Every new STEM Charge must be reviewed individually.', 400, 'ROW_REVIEW_REQUIRED');
    if (!['include', 'exclude'].includes(review.buyerChargeDecision)) throw httpError('Every new STEM Charge needs an Include or Exclude buyer-charge decision.', 400, 'BUYER_CHARGE_DECISION_REQUIRED');
    const evidence = reviewEvidence(review);
    if (!evidence.reference && !evidence.evidenceDocumentIds.length) throw httpError('Every new STEM Charge needs a reference, note, or Salesforce File.', 400, 'ROW_EVIDENCE_REQUIRED');
  }
  return reviews.map((review) => ({
    rowId: text(review.sourceId || review.salesforceId || review.id, 64),
    rowType: review.sourceType === 'line_item' || review.kind === 'line_item' ? 'line_item' : 'extra_cost',
    reviewed: review.reviewed === true,
    buyerChargeDecision: review.buyerChargeDecision,
    referencePresent: Boolean(reviewEvidence(review).reference),
    evidencePresent: reviewEvidence(review).evidenceDocumentIds.length > 0,
  }));
}

function expectedRevision(body, stored) {
  const expected = Number(body?.expectedRevision);
  if (!Number.isInteger(expected) || expected !== Number(stored.revision || 0)) {
    throw httpError('This Variable Charges Charge case changed after it was opened. Refresh and review it again.', 409, 'CASE_REVISION_CONFLICT', { current: { revision: Number(stored.revision || 0) } });
  }
  if (text(body?.expectedFingerprint, 128) !== text(stored.source_fingerprint || body?.expectedFingerprint, 128)) {
    throw httpError('Salesforce charge data changed after this case was opened. Refresh and review every row again.', 409, 'SALESFORCE_FINGERPRINT_CONFLICT');
  }
}

function findExtra(live, id, lastModifiedDate) {
  const row = live.extraCosts.find((item) => item.Id === id);
  if (!row) throw httpError('A Variable Charges extra-cost row changed or is no longer active.', 409, 'EXTRA_COST_CHANGED');
  if (!lastModifiedDate || row.LastModifiedDate !== lastModifiedDate) throw httpError('A Variable Charges extra-cost row changed after it was opened.', 409, 'EXTRA_COST_CONFLICT');
  return row;
}

async function salesforceChargeWrites(body, live) {
  const updates = Array.isArray(body?.extraCostUpdates) ? body.extraCostUpdates : [];
  const additions = Array.isArray(body?.extraCostAdds) ? body.extraCostAdds : [];
  const cancellations = Array.isArray(body?.cancellations) ? body.cancellations : [];
  if (additions.length || cancellations.length) {
    throw httpError('Supplier-side additions and cancellations must be completed by the assigned Supplier Trader before Buyer confirmation.', 409, 'SUPPLIER_STAGE_WRITE_REQUIRED');
  }
  const requests = [];
  const apiVersion = getApiVersion();
  let reference = 0;
  for (const update of updates) {
    const id = text(update?.extraCostId || update?.id, 18);
    const current = findExtra(live, id, text(update?.expectedLastModifiedDate || update?.lastModifiedDate, 80));
    const currentMode = current.Lumpsum_Cost__c != null || current.Lumpsum_Price__c != null ? 'fixed' : 'per_unit';
    const requestedMode = (update.pricingType || update.pricingMode) === 'per_unit' ? 'per_unit' : 'fixed';
    if (requestedMode !== currentMode) {
      throw httpError('The Buyer Trader cannot change supplier pricing basis, quantity, or UOM. Reverify the supplier stage first.', 409, 'SUPPLIER_PRICING_BASIS_LOCKED');
    }
    const patch = {};
    if (currentMode === 'fixed') {
      patch.Lumpsum_Price__c = numeric(update.buyerPrice ?? update.price ?? update.fixedAmount, 'Fixed buyer price');
    } else {
      patch.Unit_Price__c = numeric(update.buyerPrice ?? update.price ?? update.unitPrice, 'Unit buyer price');
    }
    requests.push({ method: 'PATCH', url: `/services/data/${apiVersion}/sobjects/STEM_Extra_Cost__c/${id}`, referenceId: `update${reference++}`, httpHeaders: lastModifiedHeaders(current.LastModifiedDate), body: patch });
  }
  if (!requests.length) return { changed: false, responses: [] };
  if (requests.length > 25) throw httpError('A maximum of 25 Salesforce charge changes may be confirmed in one atomic operation.', 400, 'COMPOSITE_LIMIT_EXCEEDED');
  requireExternalActionGate('salesforce_write');
  const result = await sfRequest('/composite', { method: 'POST', body: { allOrNone: true, compositeRequest: requests } });
  const responses = result?.compositeResponse || [];
  const failed = responses.find((row) => row.httpStatusCode < 200 || row.httpStatusCode >= 300);
  if (failed) throw httpError(failed.body?.[0]?.message || failed.body?.message || 'Salesforce rejected the atomic charge update.', 502, 'SALESFORCE_COMPOSITE_FAILED');
  return { changed: true, responses };
}

async function salesforceSupplierChargeWrites(body, live, supplierId) {
  const updates = Array.isArray(body?.extraCostUpdates) ? body.extraCostUpdates : [];
  const additions = Array.isArray(body?.extraCostAdds) ? body.extraCostAdds : [];
  const cancellations = Array.isArray(body?.cancellations) ? body.cancellations : [];
  const products = new Map((await activeProducts()).map((row) => [row.id, row]));
  const recordTypes = await queryAll("SELECT Id FROM RecordType WHERE SObjectType = 'STEM_Extra_Cost__c' AND DeveloperName = 'STEM_Charge' LIMIT 1");
  if (recordTypes.length !== 1) throw httpError('The Salesforce STEM Charge record type is unavailable.', 503, 'STEM_CHARGE_RECORD_TYPE_UNAVAILABLE');
  const requests = [];
  const apiVersion = getApiVersion();
  let reference = 0;
  for (const update of updates) {
    const id = text(update?.extraCostId || update?.id, 18);
    const current = findExtra(live, id, text(update?.expectedLastModifiedDate || update?.lastModifiedDate, 80));
    if (current.Supplier__c !== supplierId) throw httpError('A Supplier Trader may edit only their exact supplier rows.', 403, 'SUPPLIER_SCOPE_MISMATCH');
    const mode = (update.pricingType || update.pricingMode) === 'per_unit' ? 'per_unit' : 'fixed';
    const bodyPatch = { Description__c: text(update.description, 32_000) || null };
    if (mode === 'fixed') {
      bodyPatch.Lumpsum_Cost__c = numeric(update.supplierCost ?? update.cost ?? update.fixedAmount, 'Fixed supplier cost');
      bodyPatch.Unit_Cost__c = null;
    } else {
      bodyPatch.Quantity__c = numeric(update.quantity, 'Quantity', { positive: true, nullable: false });
      bodyPatch.Unit_of_Measure__c = text(update.unitOfMeasure || current.Unit_of_Measure__c, 40) || '1.';
      bodyPatch.Unit_Cost__c = numeric(update.supplierCost ?? update.cost ?? update.unitPrice, 'Supplier unit cost');
      bodyPatch.Lumpsum_Cost__c = null;
    }
    requests.push({ method: 'PATCH', url: `/services/data/${apiVersion}/sobjects/STEM_Extra_Cost__c/${id}`, referenceId: `supplierUpdate${reference++}`, httpHeaders: lastModifiedHeaders(current.LastModifiedDate), body: bodyPatch });
  }
  for (const cancel of cancellations) {
    const id = text(typeof cancel === 'string' ? cancel : cancel?.extraCostId || cancel?.id, 18);
    const current = findExtra(live, id, text(typeof cancel === 'string' ? '' : cancel?.expectedLastModifiedDate || cancel?.lastModifiedDate, 80));
    if (current.Supplier__c !== supplierId) throw httpError('A Supplier Trader may cancel only their exact supplier rows.', 403, 'SUPPLIER_SCOPE_MISMATCH');
    requests.push({ method: 'PATCH', url: `/services/data/${apiVersion}/sobjects/STEM_Extra_Cost__c/${id}`, referenceId: `supplierCancel${reference++}`, httpHeaders: lastModifiedHeaders(current.LastModifiedDate), body: { Cancelled__c: true } });
  }
  const supplier = live.accounts.find((row) => row.Id === supplierId);
  for (const addition of additions) {
    const productId = text(addition?.productId, 18);
    if (text(addition?.supplierAccountId || addition?.supplierId, 18) !== supplierId) throw httpError('New supplier charges must use the exact stage Supplier Account.', 403, 'SUPPLIER_SCOPE_MISMATCH');
    if (!products.has(productId)) throw httpError('New STEM Charges require an active Salesforce Product.', 409, 'PRODUCT_INACTIVE');
    const childTerms = [...new Set([...live.lineItems.filter((row) => row.Original_Supplier__c === supplierId), ...live.extraCosts.filter((row) => row.Supplier__c === supplierId)].map((row) => text(row.Payment_Term__c, 255)).filter(Boolean))];
    const paymentTerm = text(supplier?.Supplier_Payment_Term__c, 255) || (childTerms.length === 1 ? childTerms[0] : null);
    if (!paymentTerm) throw httpError('The supplier payment term is unavailable or ambiguous and cannot be guessed.', 409, 'PAYMENT_TERM_UNAVAILABLE');
    const mode = (addition.pricingType || addition.pricingMode) === 'per_unit' ? 'per_unit' : 'fixed';
    const create = { STEM__c: live.stem.Id, Supplier__c: supplierId, Product2Id__c: productId, RecordTypeId: recordTypes[0].Id, Payment_Term__c: paymentTerm, Cancelled__c: false, Description__c: text(addition.description, 32_000) || 'STEM Charge' };
    if (mode === 'fixed') {
      create.Lumpsum_Cost__c = numeric(addition.supplierCost ?? addition.cost ?? addition.fixedAmount, 'Fixed supplier cost');
      create.Quantity__c = numeric(addition.quantity ?? 1, 'Quantity', { positive: true, nullable: false });
      create.Unit_of_Measure__c = text(addition.unitOfMeasure, 40) || '1.';
    } else {
      create.Quantity__c = numeric(addition.quantity, 'Quantity', { positive: true, nullable: false });
      create.Unit_of_Measure__c = text(addition.unitOfMeasure, 40) || '1.';
      create.Unit_Cost__c = numeric(addition.supplierCost ?? addition.cost ?? addition.unitPrice, 'Supplier unit cost');
    }
    requests.push({ method: 'POST', url: `/services/data/${apiVersion}/sobjects/STEM_Extra_Cost__c`, referenceId: `supplierCreate${reference++}`, body: create });
  }
  if (!requests.length) return { changed: false, responses: [] };
  if (requests.length > 25) throw httpError('A maximum of 25 supplier charge changes may be verified atomically.', 400, 'COMPOSITE_LIMIT_EXCEEDED');
  requireExternalActionGate('salesforce_write');
  const result = await sfRequest('/composite', { method: 'POST', body: { allOrNone: true, compositeRequest: requests } });
  const responses = result?.compositeResponse || [];
  const failed = responses.find((row) => row.httpStatusCode < 200 || row.httpStatusCode >= 300);
  if (failed) throw httpError(failed.body?.[0]?.message || failed.body?.message || 'Salesforce rejected the atomic supplier charge update.', 502, 'SALESFORCE_COMPOSITE_FAILED');
  return { changed: true, responses };
}

async function setSalesforceConfirmed(stemId, confirmed, expectedLastModifiedDate) {
  requireExternalActionGate('salesforce_write');
  const result = await sfRequest('/composite', {
    method: 'POST',
    body: {
      allOrNone: true,
      compositeRequest: [{
        method: 'PATCH', url: `/services/data/${getApiVersion()}/sobjects/STEM__c/${stemId}`,
        referenceId: 'confirmStem', httpHeaders: lastModifiedHeaders(expectedLastModifiedDate),
        body: { Variable_Charges_Confirmed__c: confirmed === true },
      }],
    },
  });
  const response = result?.compositeResponse?.[0];
  if (!response || response.httpStatusCode < 200 || response.httpStatusCode >= 300) {
    throw httpError(response?.body?.[0]?.message || 'Salesforce could not record the Variable Charges confirmation.', 502, 'SALESFORCE_CONFIRMATION_FAILED');
  }
}

export async function saveAndConfirmVariableCharges(body, context) {
  const stemId = text(body?.stemId, 18);
  const operationId = operationIdentity(body);
  const liveBefore = await liveCaseForStem(stemId, context);
  const stored = currentCaseRow(await storedCases(context.client, [stemId]), stemId);
  const authority = await requireCaseAuthority(context, stored, body);
  const requestFingerprint = sha256({
    stemId,
    expectedRevision: body.expectedRevision,
    expectedFingerprint: body.expectedFingerprint,
    reviews: body.reviews || [],
    extraCostUpdates: body.extraCostUpdates || [],
    extraCostAdds: body.extraCostAdds || [],
    cancellations: body.cancellations || [],
    overrideReason: authority.reason,
  });
  const reservation = await reserveOperation(context.client, { operationId, type: 'confirm', stemId, fingerprint: requestFingerprint, actorId: context.profile.id });
  if (reservation?.status === 'succeeded') return reservation.result || reservation.result_payload || {};
  if (reservation?.status === 'uncertain') throw httpError('This operation has an uncertain Salesforce outcome. Refresh the live case before taking another action.', 409, 'OPERATION_UNCERTAIN');
  if (reservation?.status === 'failed') throw httpError('This operation already failed. Refresh the live case and submit a new confirmation.', 409, 'OPERATION_FAILED');
  if (!liveBefore.stem.Delivery_Date__c || hongKongToday() <= liveBefore.stem.Delivery_Date__c) throw httpError('Variable Charges charges become actionable after the Salesforce Delivery Date.', 409, 'DELIVERY_NOT_COMPLETE');
  let reviews;
  if (reservation?.status === 'salesforce_written') {
    const writtenFingerprint = text(reservation?.result?.sourceFingerprint, 128);
    if (!writtenFingerprint || writtenFingerprint !== liveBefore.fingerprint) {
      throw httpError('Salesforce data changed after the atomic charge write. Refresh before resuming this confirmation.', 409, 'POST_WRITE_LIVE_DATA_CONFLICT');
    }
    reviews = (Array.isArray(body?.reviews) ? body.reviews : []).map((review) => ({
      reviewed: review?.reviewed === true,
      buyerChargeDecision: review?.buyerChargeDecision,
      referencePresent: Boolean(reviewEvidence(review).reference),
      evidencePresent: reviewEvidence(review).evidenceDocumentIds.length > 0,
    }));
  } else {
    expectedRevision(body, stored);
    if (text(body?.expectedStemLastModifiedAt, 80) !== text(liveBefore.stem.LastModifiedDate, 80)) {
      throw httpError('The Salesforce STEM changed after it was opened. Refresh and review the current case.', 409, 'STEM_LAST_MODIFIED_CONFLICT');
    }
    if (text(body?.expectedFingerprint, 128) !== liveBefore.fingerprint) throw httpError('Salesforce data changed after this case was opened. Refresh and review every row again.', 409, 'LIVE_DATA_CONFLICT');
    const files = await linkedSalesforceFiles(liveBefore);
    reviews = await validateReviews(body, liveBefore, files);
  }
  let salesforceWriteAttempted = false;
  let salesforceWritten = reservation?.status === 'salesforce_written';
  let postWriteFingerprint = reservation?.status === 'salesforce_written'
    ? text(reservation?.result?.sourceFingerprint, 128)
    : null;
  let databaseConfirmed = false;
  try {
    if (reservation?.status !== 'salesforce_written') {
      salesforceWriteAttempted = true;
      await salesforceChargeWrites(body, liveBefore);
      const liveAfterWrite = await liveCaseForStem(stemId, context);
      postWriteFingerprint = liveAfterWrite.fingerprint;
      await completeOperation(context.client, operationId, 'salesforce_written', {
        stemId, sourceFingerprint: postWriteFingerprint,
      });
      salesforceWritten = true;
    }
    const liveAfter = await liveCaseForStem(stemId, context);
    if (!postWriteFingerprint || liveAfter.fingerprint !== postWriteFingerprint) {
      throw httpError('Salesforce data changed after the atomic charge write. Refresh before confirming it.', 409, 'POST_WRITE_LIVE_DATA_CONFLICT');
    }
    const included = reviews.filter((row) => row.buyerChargeDecision === 'include');
    const { data, error } = await context.client.rpc('confirm_variable_charge_case', {
      p_stem_id: stemId,
      p_expected_revision: Number(stored.revision || 0),
      p_expected_fingerprint: stored.source_fingerprint,
      p_confirmation: {
        chargeToBuyer: included.length > 0,
        rowByRowReviewed: reviews.length > 0 && reviews.every((row) => row.reviewed),
        reviewedSourceFingerprint: liveAfter.fingerprint,
        referenceOrNote: reviews.some((row) => row.referencePresent) ? 'Reference or review note recorded for every applicable row.' : null,
        evidencePresent: reviews.some((row) => row.evidencePresent),
      },
      p_event: {
        eventKey: `confirm:${operationId}`,
        summary: 'Variable Charges charges confirmed.',
        metadata: {
          caseState: 'ready_for_invoice',
          chargeToBuyer: included.length > 0,
          evidencePresent: reviews.some((row) => row.evidencePresent),
          reasonProvided: authority.generalManagerOverride,
        },
      },
      p_operation_id: operationId,
      p_request_fingerprint: requestFingerprint,
      p_actor_user_id: context.profile.id,
      p_actor_email: context.profile.email,
      p_override_reason: authority.reason,
    });
    if (error) {
      if (/changed after it was opened|revision|fingerprint/i.test(error.message || '')) throw httpError(error.message, 409, 'CASE_REVISION_CONFLICT');
      throw error;
    }
    databaseConfirmed = true;
    await setSalesforceConfirmed(stemId, true, liveAfter.stem.LastModifiedDate);
    const confirmedCase = data?.case || data;
    await completeOperation(context.client, operationId, 'succeeded', {
      caseId: confirmedCase?.id,
      stemId,
      revision: confirmedCase?.revision,
      status: confirmedCase?.workflow_status || 'ready_for_invoice',
      eventId: data?.event?.id,
      duplicate: data?.duplicate === true,
    });
    const result = { case: data?.case || data, confirmation: data?.confirmation || null, operationId };
    return result;
  } catch (error) {
    if (!databaseConfirmed && salesforceWriteAttempted && !salesforceWritten) {
      const operationStatus = error.code === 'SALESFORCE_COMPOSITE_FAILED' ? 'failed' : 'uncertain';
      await completeOperation(context.client, operationId, operationStatus, { stemId, errorCode: error.code || 'SALESFORCE_WRITE_UNCERTAIN' }).catch(() => {});
    }
    throw error;
  }
}

export async function verifyVariableChargeSupplier(body, context) {
  const stemId = text(body?.stemId, 18);
  const supplierId = text(body?.supplierId, 18);
  const operationId = operationIdentity(body);
  const live = await liveCaseForStem(stemId, context);
  const requirement = (live.supplierRequirements || []).find((row) => row.supplierId === supplierId);
  if (!requirement?.effectiveRequired) throw httpError('This exact supplier is not currently required in Variable Charges.', 409, 'SUPPLIER_STAGE_NOT_REQUIRED');
  const gm = await activeGeneralManager(context.client, context.profile.id);
  const assigned = requirement.assignedSupplierTrader?.id === context.profile.id
    && !VIEW_ONLY_USER_TYPES.has(text(context.profile?.user_type, 100).toLowerCase());
  const overrideReason = text(body?.gmOverrideReason || body?.reason, 1000);
  if (!assigned && !(gm.isGeneralManager && overrideReason.length >= 5)) {
    if (gm.isGeneralManager) throw httpError('A General Manager override reason of at least 5 characters is required.', 400, 'GM_REASON_REQUIRED');
    throw httpError('Only the assigned Supplier Trader may verify this supplier stage.', 403, 'ASSIGNED_SUPPLIER_TRADER_REQUIRED');
  }
  if (!live.stem.Delivery_Date__c || hongKongToday() <= live.stem.Delivery_Date__c) {
    throw httpError('Final supplier charges may be verified only after the Salesforce Delivery Date.', 409, 'DELIVERY_NOT_COMPLETE');
  }
  if (text(body?.expectedStemLastModifiedAt, 80) !== text(live.stem.LastModifiedDate, 80)) {
    throw httpError('The Salesforce STEM changed after this supplier stage was opened.', 409, 'STEM_LAST_MODIFIED_CONFLICT');
  }
  if (requirement.lastModifiedAt && text(body?.expectedStageLastModifiedAt, 80) !== text(requirement.lastModifiedAt, 80)) {
    throw httpError('This supplier stage changed after it was opened.', 409, 'SUPPLIER_STAGE_CONFLICT');
  }
  const supplierRows = [...live.lineItems, ...live.extraCosts].filter((row) => (row.Original_Supplier__c || row.Supplier__c) === supplierId);
  const reviews = Array.isArray(body?.reviews) ? body.reviews : [];
  const reviewById = new Map(reviews.map((row) => [text(row?.sourceId || row?.id, 64), row]));
  for (const row of supplierRows) {
    const review = reviewById.get(row.Id);
    const evidence = reviewEvidence(review);
    if (!review || review.reviewed !== true) throw httpError('Review every current row for this supplier before verifying.', 400, 'ROW_REVIEW_REQUIRED');
    if (!evidence.reference) throw httpError('Every reviewed supplier row needs a reference or note. Salesforce Files are optional evidence.', 400, 'ROW_REFERENCE_REQUIRED');
  }
  const requestFingerprint = sha256({ stemId, supplierId, expectedStageLastModifiedAt: body?.expectedStageLastModifiedAt, reviews, extraCostUpdates: body?.extraCostUpdates || [], extraCostAdds: body?.extraCostAdds || [], cancellations: body?.cancellations || [], overrideReason: gm.isGeneralManager ? overrideReason : null });
  const reservation = await reserveOperation(context.client, { operationId, type: 'supplier_verify', stemId, fingerprint: requestFingerprint, actorId: context.profile.id });
  if (reservation?.status === 'succeeded') return reservation.result || {};
  const foreignSupplierWrite = [...(body?.extraCostUpdates || []), ...(body?.extraCostAdds || []), ...(body?.cancellations || [])].some((row) => {
    const id = text(typeof row === 'string' ? row : row?.extraCostId || row?.id, 18);
    const current = id ? live.extraCosts.find((item) => item.Id === id) : null;
    const requestedSupplier = text(row?.supplierAccountId || row?.supplierId, 18);
    return current ? current.Supplier__c !== supplierId : requestedSupplier !== supplierId;
  });
  if (foreignSupplierWrite) throw httpError('A Supplier Trader may change only the exact supplier assigned to this stage.', 403, 'SUPPLIER_SCOPE_MISMATCH');
  let writeAttempted = false;
  try {
    writeAttempted = true;
    await salesforceSupplierChargeWrites(body, live, supplierId);
    const refreshed = await liveCaseForStem(stemId, context);
    const refreshedRequirement = (refreshed.supplierRequirements || []).find((row) => row.supplierId === supplierId);
    const readinessSnapshot = await sfRequest(`/apexrest/fcos/variable-charges/${encodeURIComponent(stemId)}/supplier/${encodeURIComponent(supplierId)}/fingerprint`, { readOnly: true });
    const result = await sfRequest(`/apexrest/fcos/variable-charges/${encodeURIComponent(stemId)}/supplier/${encodeURIComponent(supplierId)}/verify`, {
      method: 'POST',
      body: {
        stemId,
        supplierId,
        verifierEmail: context.profile.email,
        expectedFingerprint: readinessSnapshot?.fingerprint,
        expectedStemLastModifiedAt: refreshed.stem.LastModifiedDate,
        expectedStageLastModifiedAt: refreshedRequirement?.lastModifiedAt || null,
        gmOverrideReason: gm.isGeneralManager && !assigned ? overrideReason : null,
      },
    });
    const referencesRecorded = reviews.length > 0 && reviews.every((review) => Boolean(reviewEvidence(review).reference));
    const evidencePresent = reviews.some((review) => reviewEvidence(review).evidenceDocumentIds.length > 0);
    const { error: confirmationError } = await context.client.rpc('record_variable_charge_supplier_confirmation', {
      p_stem_id: stemId,
      p_supplier_account_id: supplierId,
      p_assigned_supplier_user_id: requirement.assignedSupplierTrader?.id || null,
      p_assignment_source: !assigned && gm.isGeneralManager
        ? 'manual_gm_override'
        : requirement.assignedSupplierTrader?.matchedBy === 'name' ? 'nomination_name' : 'nomination_email',
      p_requirement_source: requirement.isAgent ? 'is_agent' : 'manual',
      p_source_fingerprint: result?.fingerprint || readinessSnapshot?.fingerprint,
      p_salesforce_stage_last_modified_at: result?.lastModifiedAt || null,
      p_reference_recorded: referencesRecorded,
      p_evidence_present: evidencePresent,
      p_actor_user_id: context.profile.id,
      p_actor_email: context.profile.email,
      p_override_reason_recorded: !assigned && gm.isGeneralManager,
    });
    if (confirmationError) throw confirmationError;
    const completed = { stemId, supplierId, status: 'Verified', revision: result?.revision ?? null };
    await completeOperation(context.client, operationId, 'succeeded', completed);
    return { supplierStage: result, operationId };
  } catch (error) {
    await completeOperation(context.client, operationId, writeAttempted ? 'uncertain' : 'failed', { stemId, errorCode: error.code || 'SUPPLIER_VERIFY_FAILED' }).catch(() => {});
    throw error;
  }
}

export async function confirmVariableChargeBuyer(body, context) {
  const live = await liveCaseForStem(text(body?.stemId, 18), context);
  if ((live.supplierRequirements || []).some((row) => row.status !== 'Verified')) {
    throw httpError('Every required Supplier Trader must verify their supplier before Buyer Trader confirmation.', 409, 'SUPPLIER_STAGES_INCOMPLETE');
  }
  return saveAndConfirmVariableCharges(body, context);
}

export async function overrideVariableChargeAssignment(body, context) {
  const stemId = text(body?.stemId, 18);
  const operationId = operationIdentity(body);
  const reason = text(body?.reason, 1000);
  const assigneeProfileId = text(body?.assigneeProfileId, 64);
  if (reason.length < 5) throw httpError('A General Manager reason of at least 5 characters is required.', 400, 'GM_REASON_REQUIRED');
  const live = await liveCaseForStem(stemId, context);
  const gm = await activeGeneralManager(context.client, context.profile.id);
  if (!gm.isGeneralManager) throw httpError('Only the active General Manager may temporarily reassign a Variable Charges Charge case.', 403, 'GENERAL_MANAGER_REQUIRED');
  const stored = currentCaseRow(await storedCases(context.client, [stemId]), stemId);
  const profiles = await activeProfileDirectory(context.client);
  const assignee = profiles.find((row) => row.id === assigneeProfileId && !VIEW_ONLY_USER_TYPES.has(text(row.user_type).toLowerCase()));
  if (!assignee) throw httpError('Choose an active FCOS Buyer Trader profile.', 400, 'INVALID_ASSIGNEE');
  const requestFingerprint = sha256({ stemId, assigneeProfileId, reason, revision: body?.expectedRevision });
  const reservation = await reserveOperation(context.client, {
    operationId, type: 'gm_override', stemId, fingerprint: requestFingerprint, actorId: context.profile.id,
  });
  if (reservation?.status === 'succeeded') return reservation.result || {};
  if (reservation?.status === 'failed' || reservation?.status === 'uncertain') {
    throw httpError('This reassignment operation cannot be resumed safely. Refresh and use a new operation.', 409, 'OPERATION_NOT_RESUMABLE');
  }
  expectedRevision(body, stored);
  if (text(body?.expectedFingerprint, 128) !== live.fingerprint) throw httpError('Salesforce data changed after this case was opened. Refresh before reassigning it.', 409, 'LIVE_DATA_CONFLICT');
  if (reservation?.status !== 'salesforce_written') {
    await setSalesforceConfirmed(stemId, false, live.stem.LastModifiedDate);
    await completeOperation(context.client, operationId, 'salesforce_written', { stemId });
  }
  const { data, error } = await context.client.rpc('override_variable_charge_assignment', {
    p_stem_id: stemId, p_assignee_user_id: assigneeProfileId, p_reason: reason,
    p_expected_revision: Number(stored.revision || 0), p_operation_id: operationId,
    p_request_fingerprint: requestFingerprint, p_actor_user_id: context.profile.id,
    p_actor_email: context.profile.email,
  });
  if (error) {
    if (/changed after it was opened|revision|fingerprint/i.test(error.message || '')) throw httpError(error.message, 409, 'CASE_REVISION_CONFLICT');
    throw error;
  }
  return data;
}

export async function resolveVariableChargePostInvoiceChange(body, context) {
  const stemId = text(body?.stemId, 18);
  const operationId = operationIdentity(body);
  const resolution = text(body?.resolution, 40);
  const reference = text(body?.reference, 1000);
  const note = text(body?.note, 1000);
  if (!['no_adjustment', 'revised_invoice', 'credit_note'].includes(resolution)) throw httpError('Choose No adjustment, Revised invoice, or Credit note.', 400, 'INVALID_POST_INVOICE_RESOLUTION');
  if (!reference) throw httpError('A resolution reference is required.', 400, 'RESOLUTION_REFERENCE_REQUIRED');
  const live = await liveCaseForStem(stemId, context);
  const stored = currentCaseRow(await storedCases(context.client, [stemId]), stemId);
  if (text(body?.expectedFingerprint, 128) !== live.fingerprint) throw httpError('Salesforce data changed after this case was opened. Refresh before resolving it.', 409, 'LIVE_DATA_CONFLICT');
  await requireCaseAuthority(context, stored, body);
  if (!live.invoices.some(finalInvoice)) throw httpError('A final buyer invoice is required before post-invoice resolution.', 409, 'FINAL_INVOICE_REQUIRED');
  const requestFingerprint = sha256({ stemId, resolution, reference, note, revision: body?.expectedRevision, live: live.fingerprint });
  const { data, error } = await context.client.rpc('resolve_variable_charge_post_invoice_change', {
    p_stem_id: stemId, p_resolution: resolution, p_reference: reference, p_note: note,
    p_expected_revision: Number(stored.revision || 0), p_operation_id: operationId,
    p_request_fingerprint: requestFingerprint, p_actor_user_id: context.profile.id,
    p_actor_email: context.profile.email, p_override_reason: text(body?.reason, 1000) || null,
  });
  if (error) {
    if (/changed after it was opened|revision/i.test(error.message || '')) throw httpError(error.message, 409, 'CASE_REVISION_CONFLICT');
    throw error;
  }
  return data;
}

function syncPayload(live, stored, dueDate) {
  const status = deriveStatus(live, stored);
  return {
    stemId: live.stem.Id,
    stemName: live.stem.KeyStem__c || live.stem.Name || live.stem.Id,
    workflowStatus: status === 'post_invoice_changes' ? 'post_invoice_change' : status,
    deliveryDate: live.stem.Delivery_Date__c || null,
    dueDate,
    assignedBuyerUserId: live.assignment?.profileId || null,
    assignedBuyerName: live.assignment?.name || null,
    assignedBuyerEmail: live.assignment?.email || null,
    assignmentSource: live.assignment?.status === 'resolved'
      ? (live.assignment?.matchedBy === 'name' ? 'nomination_name' : 'nomination_email')
      : 'unresolved',
    sourceFingerprint: live.fingerprint,
    supplierFingerprint: sha256(live.accounts.map((row) => ({ id: row.Id, isAgent: row.Is_Agent__c === true, paymentTerm: row.Supplier_Payment_Term__c || null }))),
    salesforceStemLastModifiedAt: live.stem.LastModifiedDate || null,
    invoiceState: live.invoices.some(finalInvoice) ? 'invoiced' : 'not_invoiced',
    postInvoiceDetectedAt: live.invoices.some(finalInvoice) && stored?.source_fingerprint && stored.source_fingerprint !== live.fingerprint
      ? new Date().toISOString()
      : stored?.post_invoice_detected_at || null,
  };
}

export async function syncVariableCharges(context, { stemIds = null } = {}) {
  const existing = await storedCases(context.client, stemIds);
  const existingIds = existing.map((row) => row.stem_id);
  const requested = stemIds?.length ? stemIds : null;
  const detected = await loadLiveCases({ client: context.client, stemIds: requested, stemAccessCondition: context.stemAccessCondition || null });
  let live = detected;
  if (!requested) {
    const detectedIds = new Set(detected.map((row) => row.stem.Id));
    const missingExisting = existingIds.filter((id) => !detectedIds.has(id));
    if (missingExisting.length) live = [...detected, ...await loadLiveCases({ client: context.client, stemIds: missingExisting, stemAccessCondition: context.stemAccessCondition || null })];
  }
  const storedMap = new Map(existing.map((row) => [row.stem_id, row]));
  const results = [];
  for (const entry of live) {
    const dueDate = entry.stem.Delivery_Date__c ? await dueDateForDelivery(entry.stem.Delivery_Date__c) : null;
    const payload = syncPayload(entry, storedMap.get(entry.stem.Id), dueDate);
    if (context.profile?.id) {
      payload.actorUserId = context.profile.id;
      payload.actorEmail = context.profile.email || null;
    }
    const { data, error } = await context.client.rpc('sync_variable_charge_case', {
      p_case: payload,
      p_event: {
        eventType: 'synced',
        eventKey: `sync:${payload.stemId}:${payload.sourceFingerprint}:${payload.workflowStatus}`,
        summary: 'Variable Charges case synchronized from live Salesforce data.',
        metadata: {
          caseState: payload.workflowStatus,
          sourceChanged: Boolean(storedMap.get(entry.stem.Id)?.source_fingerprint && storedMap.get(entry.stem.Id).source_fingerprint !== payload.sourceFingerprint),
        },
      },
    });
    if (error) throw error;
    const { error: supplierStageError } = await context.client.rpc('sync_variable_charge_supplier_stages', {
      p_stem_id: entry.stem.Id,
      p_stages: (entry.supplierRequirements || []).map((row) => ({
        supplierAccountId: row.supplierId,
        assignedSupplierUserId: row.assignedSupplierTrader?.id || null,
        assignmentSource: row.assignmentStatus === 'resolved'
          ? row.assignedSupplierTrader?.matchedBy === 'name' ? 'nomination_name' : 'nomination_email'
          : 'unresolved',
        requirementSource: row.isAgent ? 'is_agent' : 'manual',
        status: text(row.status, 32).toLowerCase(),
        sourceFingerprint: row.status === 'Verified' && row.reviewedSourceFingerprint
          ? row.reviewedSourceFingerprint
          : row.sourceFingerprint,
        salesforceStageLastModifiedAt: row.lastModifiedAt || null,
      })),
    });
    if (supplierStageError) throw supplierStageError;
    results.push(data);
  }
  return {
    checked: live.length,
    needsAction: results.filter((row) => (row?.case || row)?.workflow_status === 'needs_action').length,
    readyForInvoice: results.filter((row) => (row?.case || row)?.workflow_status === 'ready_for_invoice').length,
    postInvoiceChanges: results.filter((row) => (row?.case || row)?.workflow_status === 'post_invoice_change').length,
    results,
  };
}

// Temporary rollback aliases. Remove only after 24 hours with no legacy traffic.
export const listShipAgentCharges = listVariableCharges;
export const getShipAgentChargeDetail = getVariableChargeDetail;
export const shipAgentChargeOptions = variableChargeOptions;
export const saveAndConfirmShipAgentCharges = saveAndConfirmVariableCharges;
export const overrideShipAgentChargeAssignment = overrideVariableChargeAssignment;
export const resolveShipAgentPostInvoiceChange = resolveVariableChargePostInvoiceChange;
export const syncShipAgentCharges = syncVariableCharges;

function isShipAgentAccount(account) {
  return isVariableChargeAccount(account);
}

export const variableChargeInternals = {
  deriveStatus,
  effectiveAssignee,
  finalInvoice,
  isShipAgentAccount,
  isVariableChargeAccount,
  liveFingerprint,
  normalizedEmail,
  normalizedName,
  nextHongKongBusinessDay,
  sha256,
  SHIP_AGENT_STEM_CREATED_FROM: VARIABLE_CHARGE_STEM_CREATED_FROM,
  VARIABLE_CHARGE_STEM_CREATED_FROM,
};

export const shipAgentChargeInternals = variableChargeInternals;
