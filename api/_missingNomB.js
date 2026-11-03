import { createHash, randomUUID } from 'node:crypto';
import { fcosSalesforceEnvironment } from '../config/fcosConnections.js';
import { NOM_B_TRADER_LOGIN_EMAILS } from '../config/nomBTraderIdentities.js';
import { NOM_B_EXTENSIONS, NOM_B_MAX_BYTES } from '../shared/missingNomB.js';
import { getApiVersion, sfRequest } from './_salesforce.js';
import { isExternalActionEnabled, requireExternalActionGate } from './_externalActionGates.js';
import { sendOperationalMail } from './_operationalMail.js';
import { resolveGraphEmailSender } from './_graphEmail.js';
import { activeNomBConfirmation, isNomBFile, resolveNomBTrader, NOM_B_CREDIT_FIELDS, NOM_B_FROM, nomBDelivery } from './_dashboardNomBPolicy.js';
import { isIssuedFinalBuyerInvoice } from './_buyerInvoiceApproval.js';
import { isBuyerCreditNote } from './_buyerFinancialAmount.js';

const ID = /^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PURPOSE = 'missing_nom_b_reminders';
const LIST_POLICY = 'dated-delivery-v1';
const LINK = 'https://fcos.fcuno.com/missing-nom-b';
const NOM_FIELDS = 'Id,Name,IsDeleted,File__c,PDF__c,STEM__c,Account__r.Name,Buyer_Supplier_Trader__c,BT_ST_Email_Address__c,Received__c,Deprecated__c,Replaced__c,RecordType.DeveloperName,RefCode__c,LastModifiedDate';
const STEM_FIELDS = 'Id,Name,IsDeleted,RefCode__c,Account__r.Name,Vessel__r.Name,Vessel__r.IMO__c,Port__r.Name,Delivery_Date__c,Expected_Delivery_Date__c,Invoice_Status__c,LastModifiedDate';
const INVOICE_FIELDS = ['Id','Name','Invoice_Date__c','STEM__c','CreatedDate','SystemModstamp','Proforma__c','Deprecated__c','File__c'];
const READ_ONLY_TYPES = new Set(['viewer','interoffice']);
const txt = (value) => String(value ?? '').trim();
const email = (value) => txt(value).toLowerCase();
const quote = (value) => `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const unique = (values) => [...new Set(values.filter(Boolean))];
const hash = (value, algorithm = 'sha256') => createHash(algorithm).update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
const groups = (values, size = 150) => Array.from({ length: Math.ceil(values.length / size) }, (_, i) => values.slice(i * size, (i + 1) * size));
function failure(code, message, status = 409) {
  return Object.assign(new Error(message), { code, status, statusCode: status, expose: status < 500 });
}
function validId(value) { if (!ID.test(txt(value))) throw failure('MISSING_NOM_B_ID_INVALID', 'A valid confirmation is required.', 400); return txt(value); }
function validDate(value) { const n = Date.parse(value); if (!Number.isFinite(n)) throw failure('MISSING_NOM_B_DATE_INVALID', 'Invalid scan timestamp.', 500); return new Date(n).toISOString(); }
// PostgreSQL retains microseconds; Salesforce datetime predicates have millisecond
// boundaries. Keep the original instant for checkpoints and round query bounds inward.
function preciseDate(value) {
  const raw = txt(value);
  const parts = raw.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}(?::?\d{2})?)$/);
  const invalid = () => failure('MISSING_NOM_B_DATE_INVALID', 'Invalid scan timestamp.', 500);
  if (!parts) throw invalid();
  const zone = parts[3] === 'Z' ? 'Z' : `${parts[3].slice(0,3)}:${parts[3].replace(':','').slice(3) || '00'}`;
  const local = Date.parse(`${parts[1]}.000Z`);
  const seconds = Date.parse(`${parts[1]}.000${zone}`);
  if (!Number.isFinite(seconds) || !Number.isFinite(local) || new Date(local).toISOString().slice(0,19) !== parts[1]) throw invalid();
  const fraction = (parts[2] || '').padEnd(9,'0');
  const milliseconds = seconds + Number(fraction.slice(0,3));
  return { raw, exact: BigInt(seconds) * 1000000n + BigInt(fraction),
    floor: new Date(milliseconds).toISOString(), ceil: new Date(milliseconds + (Number(fraction.slice(3)) > 0 ? 1 : 0)).toISOString() };
}
function enabled(env) { return env.VERCEL_ENV === 'production' && txt(env.FCOS_ENABLE_MISSING_NOM_B_REMINDERS).toLowerCase() === 'true' && isExternalActionEnabled('email_delivery', env); }

async function rpc(client, key, args) {
  const { data, error } = await client.rpc(key, args);
  if (error) {
    const code = String(error.message || '').match(/MISSING_NOM_B_[A-Z_]+/)?.[0];
    if (code) throw failure(code, 'The operation state changed. Refresh to verify its current status.');
    throw error;
  }
  return data;
}
async function profiles(client) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client.from('user_profiles').select('id,email,full_name,user_type,active').order('id').range(from, from + 999);
    if (error) throw error;
    rows.push(...(data || []));
    if ((data || []).length < 1000) return rows;
  }
}
async function userContext(context) {
  if (!context?.client || !context?.profile?.id) throw failure('AUTH_REQUIRED', 'Sign in to FCOS.', 401);
  const { data, error } = await context.client.from('user_profiles').select('id,email,full_name,user_type,active').eq('id', context.profile.id).maybeSingle();
  if (error) throw error;
  if (!data?.active) throw failure('ACCESS_DENIED', 'An active FCOS profile is required.', 403);
  return data;
}

// Every workflow starts by checking the runtime connection against the canonical Production pin.
// Query pagination is explicit: neither Salesforce's 2,000-row default nor a local soft limit drops rows.
export function createMissingNomBGateway(deps = {}) {
  const request = deps.sfRequest || sfRequest;
  async function query(soql) {
    if (deps.query) return deps.query(soql);
    const rows = [];
    let path = `/query/?q=${encodeURIComponent(soql)}`;
    const seen = new Set();
    while (path) {
      if (seen.has(path)) throw failure('MISSING_NOM_B_PAGINATION_LOOP', 'Salesforce pagination did not advance.', 502);
      seen.add(path);
      const data = await request(path);
      if (!Array.isArray(data?.records)) throw failure('MISSING_NOM_B_QUERY_INVALID', 'Salesforce returned an incomplete query.', 502);
      rows.push(...data.records);
      if (data.done === false && !data.nextRecordsUrl) throw failure('MISSING_NOM_B_QUERY_INCOMPLETE', 'Salesforce pagination is incomplete.', 502);
      path = data.nextRecordsUrl ? String(data.nextRecordsUrl).replace(/^\/services\/data\/v\d+\.\d+/, '') : null;
      if (path && !/^\/query\/[a-zA-Z0-9-]+$/.test(path)) throw failure('MISSING_NOM_B_CURSOR_INVALID', 'Salesforce returned an invalid cursor.', 502);
    }
    return rows;
  }
  async function verify() {
    const expected = fcosSalesforceEnvironment('production');
    const orgs = await query('SELECT Id, IsSandbox FROM Organization LIMIT 2');
    if (orgs.length !== 1 || orgs[0].Id !== expected.orgId || orgs[0].IsSandbox !== expected.isSandbox) {
      throw failure('MISSING_NOM_B_ORG_MISMATCH', 'The Salesforce connection does not match the approved Production source.', 503);
    }
    return expected.orgId;
  }
  let invoiceSchemaPromise;
  async function invoiceSchema() {
    if (!invoiceSchemaPromise) invoiceSchemaPromise = (async () => {
      const description = await request('/sobjects/Invoice__c/describe/', { readOnly: true });
      const fields = new Map((description?.fields || []).map((field) => [field.name,field]));
      if (INVOICE_FIELDS.some((field) => !fields.has(field))) throw failure('MISSING_NOM_B_INVOICE_SCHEMA_UNAVAILABLE','Salesforce invoice eligibility fields are unavailable.',503);
      const creditFields = NOM_B_CREDIT_FIELDS.filter((field) => fields.get(field)?.type === 'boolean');
      const selected = [...INVOICE_FIELDS,...['IsDeleted','Amount__c'].filter((field) => fields.has(field)),...creditFields];
      return { select: selected.join(','),creditFields,amountAvailable: fields.has('Amount__c') };
    })();
    return invoiceSchemaPromise;
  }
  async function invoiceSelect() { return (await invoiceSchema()).select; }
  async function nominations(stemIds) {
    const rows = [];
    for (const ids of groups(unique(stemIds))) rows.push(...await query(`SELECT ${NOM_FIELDS} FROM Nomination__c WHERE STEM__c IN (${ids.map(validId).map(quote).join(',')}) AND Deprecated__c = false AND RecordType.DeveloperName = 'Buyer'`));
    return rows;
  }
  async function byIds(object, fields, ids) {
    const rows = [];
    for (const group of groups(unique(ids))) rows.push(...await query(`SELECT ${fields} FROM ${object} WHERE Id IN (${group.map(validId).map(quote).join(',')})`));
    return rows;
  }
  async function links(ids) {
    const rows = [];
    for (const group of groups(unique(ids))) rows.push(...await query(`SELECT LinkedEntityId,ContentDocumentId,ContentDocument.Id,ContentDocument.IsDeleted,ContentDocument.ContentSize,ContentDocument.Title,ContentDocument.FileExtension,ContentDocument.LatestPublishedVersionId FROM ContentDocumentLink WHERE LinkedEntityId IN (${group.map(validId).map(quote).join(',')})`));
    return rows;
  }
  async function users(traders) {
    const rows = [];
    // Include inactive users to avoid matching a deactivated Salesforce identity to a different FCOS user.
    for (const group of groups(unique(traders.map(txt)), 75)) rows.push(...await query(`SELECT Id,Name,Email,IsActive FROM User WHERE Name IN (${group.map(quote).join(',')})`));
    return rows;
  }
  async function facts(stemIds, client) {
    const [stems, noms, directory] = await Promise.all([byIds('STEM__c', STEM_FIELDS, stemIds), nominations(stemIds), profiles(client)]);
    const [files, sfUsers] = await Promise.all([links(noms.map((n) => n.Id)), users(noms.map((n) => n.Buyer_Supplier_Trader__c))]);
    return stems.map((stem) => {
      const active = noms.filter((n) => n.STEM__c === stem.Id && activeNomBConfirmation(n));
      const nomination = active.length === 1 ? active[0] : null;
      const assignment = nomination ? resolveMissingNomBOwner(nomination, directory, sfUsers) : { status: active.length ? 'AMBIGUOUS_CONFIRMATION' : 'MISSING_CONFIRMATION' };
      const documents = nomination ? files.filter((f) => isNomBDocument(f,nomination,stem)) : [];
      const fingerprint = hash({ stemId: stem.Id, stemName: stem.Name, nominationId: nomination?.Id, modified: nomination?.LastModifiedDate,
        replaced: nomination?.Replaced__c, generatedFile: nomination?.File__c,generatedPdf: nomination?.PDF__c,stemReference: stem.RefCode__c,trader: nomination?.Buyer_Supplier_Trader__c, formula: nomination?.BT_ST_Email_Address__c, owner: assignment.profile?.id });
      return { stem, nomination, assignment, documents, fingerprint };
    });
  }
  async function readback(nominationId, marker, expected) {
    const documents = await links([nominationId]);
    if (!documents.length) return null;
    const versions = [];
    for (const group of groups(unique(documents.map((d) => d.ContentDocumentId)))) {
      // Description is not filterable in SOQL. Restrict by linked document IDs and compare it locally.
      versions.push(...await query(`SELECT Id,ContentDocumentId,Description,Title,PathOnClient,Checksum,ContentSize FROM ContentVersion WHERE ContentDocumentId IN (${group.map(validId).map(quote).join(',')})`));
    }
    const matches = versions.filter((v) => v.Description === marker);
    if (matches.length !== 1) return null;
    const version = matches[0];
    const link = documents.find((d) => d.ContentDocumentId === version.ContentDocumentId);
    const [nomination] = await byIds('Nomination__c', NOM_FIELDS, [nominationId]);
    if (!nomination?.STEM__c || !activeNomBConfirmation(nomination)) return null;
    const [stem] = await byIds('STEM__c',STEM_FIELDS,[nomination.STEM__c]);
    if (!stem || !isNomBDocument(link,nomination,stem)) return null;
    if (link?.ContentDocument?.LatestPublishedVersionId !== version.Id || version.Title !== expected.title || link?.ContentDocument?.Title !== expected.title || version.Checksum?.toLowerCase() !== expected.md5 || Number(version.ContentSize) !== expected.size || nomination?.Received__c !== '🟢') return null;
    return { stemId: nomination.STEM__c, nominationId, contentDocumentId: version.ContentDocumentId, contentVersionId: version.Id, receivedStatus: nomination.Received__c, verified: true };
  }
  async function verifyInvoicePdfs(invoices) {
    const [files,schema] = await Promise.all([links(invoices.map((i) => i.Id)),invoiceSchema()]);
    return invoices.map((invoice) => {
      const documentId = txt(invoice.File__c).match(/(?:^|\/)(069[a-zA-Z0-9]{12}(?:[a-zA-Z0-9]{3})?)(?:$|[?#])/i)?.[1];
      const file = files.find((f) => f.LinkedEntityId === invoice.Id && f.ContentDocumentId === documentId);
      return { ...invoice,_nomBCreditFields: schema.creditFields,_nomBAmountAvailable: schema.amountAvailable,pdfSaved: Boolean(file && file.ContentDocument?.Id === documentId && file.ContentDocument?.IsDeleted === false && Number(file.ContentDocument?.ContentSize) > 0 && txt(file.ContentDocument?.FileExtension).toLowerCase() === 'pdf' && ID.test(txt(file.ContentDocument?.LatestPublishedVersionId))) };
    });
  }
  async function invoicesForStems(ids, activation) {
    const rows = [];
    for (const group of groups(unique(ids))) rows.push(...await query(`SELECT ${await invoiceSelect()} FROM Invoice__c WHERE STEM__c IN (${group.map(validId).map(quote).join(',')}) AND CreatedDate >= ${preciseDate(activation).ceil} ORDER BY CreatedDate,Id`));
    return verifyInvoicePdfs(rows);
  }
  return { query, request, verify, facts, byIds, readback, nominations, invoicesForStems, verifyInvoicePdfs, invoiceSelect };
}

export function resolveMissingNomBOwner(nomination, directory, sfUsers = []) {
  const normalizedName = (value) => txt(value).replace(/\s+/g,' ').toLowerCase();
  const traderName = normalizedName(nomination.Buyer_Supplier_Trader__c);
  const hasConfirmedOverride = Object.hasOwn(NOM_B_TRADER_LOGIN_EMAILS,traderName) && typeof NOM_B_TRADER_LOGIN_EMAILS[traderName] === 'string';
  if (!hasConfirmedOverride) {
    // A formula email must not resurrect an explicitly inactive or ambiguous User identity.
    const matches = sfUsers.filter((user) => normalizedName(user.Name) === traderName);
    if (matches.length > 1 || (matches.length === 1 && matches[0].IsActive !== true)) return { status: 'UNRESOLVED_TRADER' };
  }
  // Share Production's confirmed trader-login overrides and correspondence-mailbox exclusion.
  const trader = resolveNomBTrader(nomination,directory,sfUsers);
  if (!trader.resolved) return { status: 'UNRESOLVED_TRADER' };
  const matches = directory.filter((profile) => profile.active === true && profile.id === trader.id && email(profile.email) === email(trader.email));
  if (matches.length !== 1) return { status: 'UNRESOLVED_TRADER' };
  return { status: 'resolved',profile: matches[0] };
}
export function isNomBDocument(link, confirmation, stem) {
  return Boolean(confirmation && stem && isNomBFile(link,confirmation,stem));
}
export function isCancelledStem(stem) {
  return stem?.IsDeleted === true || /cancelled|canceled/i.test(txt(stem?.Invoice_Status__c)) || /cancelled|canceled/i.test(txt(stem?.Status__c)) || stem?.Cancelled__c === true;
}
function validNonnegativeInvoiceAmount(value) {
  const amount = txt(value);
  return /^-?\d+(?:\.\d+)?$/.test(amount) && !(amount.startsWith('-') && /[1-9]/.test(amount));
}
export function isMissingNomBInvoiceCandidate(invoice, activatedAt) {
  if (!invoice || invoice.IsDeleted === true || isBuyerCreditNote(invoice)
    || /(?:^|[\s_-])(?:CREDIT[\s_-]*NOTE|CN)(?:$|[\s_-]|\d)/i.test(txt(invoice.Name))) return false;
  const creditFields = unique([...NOM_B_CREDIT_FIELDS.filter((field) => Object.hasOwn(invoice,field)),...(invoice._nomBCreditFields || [])]);
  if (creditFields.some((field) => invoice[field] !== false)) return false;
  // Initial invoice creation can precede PDF generation, which fills Amount__c.
  // Retain that prospective candidate; missing monetary evidence still blocks sending.
  if (invoice.Amount__c != null && txt(invoice.Amount__c) && !validNonnegativeInvoiceAmount(invoice.Amount__c)) return false;
  let prospective;
  try { prospective = preciseDate(invoice.CreatedDate).exact >= preciseDate(activatedAt).exact; } catch { return false; }
  return Boolean(ID.test(txt(invoice.Id)) && ID.test(txt(invoice.STEM__c)) &&
    prospective &&
    invoice.Proforma__c === false && invoice.Deprecated__c === false);
}
export function qualifiesMissingNomBInvoice(invoice, activatedAt) {
  if (!isMissingNomBInvoiceCandidate(invoice,activatedAt)) return false;
  if ((invoice._nomBAmountAvailable === true || Object.hasOwn(invoice,'Amount__c')) && !validNonnegativeInvoiceAmount(invoice.Amount__c)) return false;
  return isIssuedFinalBuyerInvoice(invoice) && invoice.pdfSaved === true && Boolean(txt(invoice.File__c));
}
const stemReference = (stem) => txt(stem.RefCode__c) || txt(stem.Name).split(' - ')[0];
function deliveryExclusion(stem) {
  // Undated records belong to the existing policy follow-up, not regular filing.
  // nomBDelivery also refuses to replace an invalid actual date with an expected date.
  const { date } = nomBDelivery(stem);
  if (!date) return { status: 'Blocked', code: 'DATE_UNVERIFIED', uploadCode: 'MISSING_NOM_B_DELIVERY_UNVERIFIED', message: 'A valid delivery or expected delivery date is required before filing Nom B.' };
  if (date < NOM_B_FROM) return { status: 'Suppressed', code: 'DATE_OUT_OF_SCOPE', uploadCode: 'MISSING_NOM_B_DELIVERY_BEFORE_CUTOFF', message: `Nom B filing applies to delivery dates from ${NOM_B_FROM}.` };
  return null;
}
function assertDeliveryEligible(stem) {
  const excluded = deliveryExclusion(stem);
  if (excluded) throw failure(excluded.uploadCode, excluded.message);
}
function rowOf(fact, user) {
  const n = fact.nomination; const s = fact.stem;
  return { nominationId: n.Id, stemId: s.Id, stemName: s.Name, stemReference: stemReference(s), buyerName: n.Account__r?.Name || s.Account__r?.Name || '',
    vesselName: s.Vessel__r?.Name || '', imo: s.Vessel__r?.IMO__c || '', portName: s.Port__r?.Name || '',
    deliveryDate: s.Delivery_Date__c || null, expectedDeliveryDate: s.Expected_Delivery_Date__c || null,
    confirmationReference: n.RefCode__c || n.Name || '', traderName: fact.assignment.profile.full_name || n.Buyer_Supplier_Trader__c,
    receivedStatus: n.Received__c || null, canUpload: !READ_ONLY_TYPES.has(user.user_type) };
}

export async function missingNomBList(body = {}, context, deps = {}) {
  const user = await userContext(context);
  const gateway = deps.gateway || createMissingNomBGateway(deps);
  await gateway.verify();
  const search = txt(body.search).slice(0, 200).toLowerCase();
  const pageSize = Math.min(Math.max(Number.parseInt(body.pageSize, 10) || 50, 1), 100);
  let last = '';
  if (body.cursor) {
    try {
      const cursor = JSON.parse(Buffer.from(String(body.cursor), 'base64url').toString('utf8'));
      if (cursor.policy !== LIST_POLICY || cursor.from !== NOM_B_FROM || cursor.user !== user.id || cursor.search !== hash(search) || !ID.test(cursor.last)) throw new Error();
      last = cursor.last;
    } catch { throw failure('MISSING_NOM_B_CURSOR_INVALID', 'Refresh the list to restart pagination.', 400); }
  }
  const rows = [];
  let more = false;
  // Bounded work per HTTP request, with a continuation even when the page contains no matching rows.
  for (let batch = 0; batch < 10 && rows.length < pageSize; batch += 1) {
    const nominations = await gateway.query(`SELECT Id,STEM__c FROM Nomination__c WHERE Deprecated__c = false AND RecordType.DeveloperName = 'Buyer' AND (STEM__r.Delivery_Date__c >= ${NOM_B_FROM} OR (STEM__r.Delivery_Date__c = null AND STEM__r.Expected_Delivery_Date__c >= ${NOM_B_FROM}))${last ? ` AND Id > ${quote(last)}` : ''} ORDER BY Id LIMIT 200`);
    if (!nominations.length) { more = false; break; }
    const facts = await gateway.facts(unique(nominations.map((n) => n.STEM__c)), context.client);
    const byNomination = new Map(facts.filter((f) => f.nomination).map((f) => [f.nomination.Id, f]));
    for (let i = 0; i < nominations.length; i += 1) {
      last = nominations[i].Id;
      const f = byNomination.get(last);
      if (f && !deliveryExclusion(f.stem) && !isCancelledStem(f.stem) && !f.documents.length && f.assignment.profile?.id === user.id) {
        const row = rowOf(f, user);
        if (!search || [row.stemName,row.stemReference,row.buyerName,row.vesselName,row.imo,row.portName,row.confirmationReference].some((v) => String(v).toLowerCase().includes(search))) rows.push(row);
      }
      more = i < nominations.length - 1 || nominations.length === 200;
      if (rows.length >= pageSize) break;
    }
    if (!more) break;
  }
  return { rows, nextCursor: more ? Buffer.from(JSON.stringify({ policy: LIST_POLICY, from: NOM_B_FROM, last, user: user.id, search: hash(search) })).toString('base64url') : null, asOf: new Date().toISOString() };
}

export function validateNomBUpload(body) {
  const nominationId = validId(body?.nominationId);
  const operationId = txt(body?.operationId);
  if (!UUID.test(operationId)) throw failure('MISSING_NOM_B_OPERATION_INVALID', 'A valid upload operation ID is required.', 400);
  const filename = txt(body?.filename);
  if (!filename || filename.length > 200 || /[\\/\u0000-\u001f\u007f]/.test(filename)) throw failure('MISSING_NOM_B_FILENAME_INVALID', 'Choose a valid filename.', 400);
  const ext = filename.split('.').pop().toLowerCase();
  if (!NOM_B_EXTENSIONS.includes(ext) || !filename.includes('.')) throw failure('MISSING_NOM_B_FILE_TYPE', 'Upload a PDF, JPG, JPEG, PNG, DOC or DOCX file.', 400);
  const base64 = body?.contentBase64;
  if (typeof base64 !== 'string' || !base64.length || base64.length > Math.ceil(NOM_B_MAX_BYTES / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) throw failure('MISSING_NOM_B_FILE_INVALID', 'The file is invalid or exceeds 3 MiB.', 400);
  const bytes = Buffer.from(base64, 'base64');
  if (!bytes.length || bytes.length > NOM_B_MAX_BYTES || bytes.toString('base64') !== base64) throw failure('MISSING_NOM_B_FILE_INVALID', 'The file is invalid or exceeds 3 MiB.', 400);
  const signature = ext === 'pdf' ? bytes.subarray(0,5).toString() === '%PDF-'
    : ext === 'png' ? bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))
      : ['jpg','jpeg'].includes(ext) ? bytes.subarray(0,3).equals(Buffer.from('ffd8ff','hex'))
        : ext === 'doc' ? bytes.subarray(0,8).equals(Buffer.from('d0cf11e0a1b11e1','hex'))
          : bytes.subarray(0,4).equals(Buffer.from('504b0304','hex'));
  if (!signature) throw failure('MISSING_NOM_B_CONTENT_TYPE', 'The file contents do not match its extension.', 400);
  return { nominationId, operationId, filename, ext, base64, size: bytes.length, sha256: hash(bytes), md5: hash(bytes, 'md5') };
}
function assertOwned(fact, nominationId, user) {
  if (!fact?.nomination || fact.nomination.Id !== nominationId || isCancelledStem(fact.stem)) throw failure('MISSING_NOM_B_CONFIRMATION_STALE', 'This Buyer Confirmation is no longer the unique active confirmation. Refresh the list.');
  if (fact.assignment.profile?.id !== user.id) throw failure('MISSING_NOM_B_NOT_OWNER', 'Only the assigned Buyer Trader can file this Nom B.', 403);
}
async function changeUpload(client, org, operation, token, status, result = null, code = null) {
  const ok = await rpc(client, 'missing_nom_b_upload_transition', { p_org: org,p_operation: operation,p_token: token,p_status: status,p_result: result,p_code: code });
  if (!ok) throw failure('MISSING_NOM_B_UPLOAD_CLAIM_LOST', 'The upload reservation changed. Refresh to reconcile it.');
}
export async function missingNomBUpload(body, context, deps = {}) {
  const file = validateNomBUpload(body);
  const user = await userContext(context);
  if (READ_ONLY_TYPES.has(user.user_type)) throw failure('MISSING_NOM_B_UPLOAD_FORBIDDEN', 'This profile cannot upload Nom B files.', 403);
  const env = deps.env || process.env;
  if (env.VERCEL_ENV === 'preview') throw failure('MISSING_NOM_B_PREVIEW_WRITE_DISABLED', 'Salesforce uploads are disabled in Preview.', 403);
  requireExternalActionGate('salesforce_write', env);
  const gateway = deps.gateway || createMissingNomBGateway(deps);
  const org = await gateway.verify();
  const [nomination] = await gateway.byIds('Nomination__c', NOM_FIELDS, [file.nominationId]);
  if (!nomination?.STEM__c) throw failure('MISSING_NOM_B_NOT_FOUND', 'The confirmation was not found.', 404);
  const [fact] = await gateway.facts([nomination.STEM__c], context.client);
  assertOwned(fact, file.nominationId, user);
  const requestHash = hash({ userId: user.id, nominationId: file.nominationId, filename: file.filename, sha256: file.sha256 });
  const token = randomUUID();
  const reservation = await rpc(context.client, 'missing_nom_b_reserve_upload', { p_org: org,p_operation: file.operationId,p_user: user.id,p_stem: fact.stem.Id,p_nomination: file.nominationId,p_hash: requestHash,p_fingerprint: fact.fingerprint,p_token: token });
  const title = `${stemReference(fact.stem)} - NOM B`;
  const marker = `FCOS_MISSING_NOM_B:${file.operationId}:${requestHash}`;
  const expected = { title, md5: file.md5, size: file.size };
  if (reservation.status === 'Completed') return reservation.result;
  if (!reservation.acquired) {
    if (['Posting','Uncertain'].includes(reservation.status)) {
      const verified = await gateway.readback(file.nominationId, marker, expected);
      if (verified) {
        const [reconciled] = await gateway.facts([fact.stem.Id],context.client);
        assertOwned(reconciled,file.nominationId,user);
        if (reconciled.documents.length !== 1 || reconciled.documents[0].ContentDocumentId !== verified.contentDocumentId) throw failure('MISSING_NOM_B_UPLOAD_UNCERTAIN','The linked Nom B files require review before this operation can be confirmed.');
        // Reconcile only the same exact durable operation, never repeat a POST after an ambiguous response.
        await changeUpload(context.client,org,file.operationId,reservation.claim_token,'Completed',verified);
        return verified;
      }
      throw failure('MISSING_NOM_B_UPLOAD_UNCERTAIN', 'The earlier upload may still be completing. Its outcome is held for verification; do not start another upload.');
    }
    throw failure('MISSING_NOM_B_UPLOAD_IN_FLIGHT', 'This upload is already in progress.');
  }
  let posting = false;
  try {
    // Only new writes are date-gated. Exact Completed/Posting/Uncertain operations
    // above must remain recoverable even if the STEM delivery date later changes.
    assertDeliveryEligible(fact.stem);
    const [fresh] = await gateway.facts([fact.stem.Id], context.client);
    assertOwned(fresh, file.nominationId, user);
    assertDeliveryEligible(fresh.stem);
    if (fresh.fingerprint !== fact.fingerprint) throw failure('MISSING_NOM_B_SOURCE_CHANGED', 'The confirmation changed. Refresh before uploading.');
    if (fresh.documents.length) throw failure('MISSING_NOM_B_ALREADY_FILED', 'A Nom B file has already been filed for this confirmation.');
    const modifiedSince = new Date(validDate(fresh.nomination.LastModifiedDate)).toUTCString();
    await changeUpload(context.client,org,file.operationId,token,'Posting');
    posting = true;
    const response = await gateway.request('/composite', { method: 'POST', retryOnExpiredSession: false, body: { allOrNone: true, collateSubrequests: false, compositeRequest: [
      { method: 'POST',url: `/services/data/${getApiVersion()}/sobjects/ContentVersion`,referenceId: 'nomBFile',body: { Title: title,PathOnClient: `${title}.${file.ext}`,VersionData: file.base64,FirstPublishLocationId: file.nominationId,Description: marker } },
      { method: 'PATCH',url: `/services/data/${getApiVersion()}/sobjects/Nomination__c/${file.nominationId}`,referenceId: 'nomBReceived',httpHeaders: { 'If-Unmodified-Since': modifiedSince },body: { Received__c: '🟢' } },
    ] } });
    const outcomes = response?.compositeResponse;
    if (Array.isArray(outcomes) && outcomes.length === 2 && outcomes.some((o) => o.httpStatusCode >= 400)) {
      // Salesforce's allOrNone response proves rollback; this is the only safe automatic POST retry boundary.
      await changeUpload(context.client,org,file.operationId,token,'Rejected',null,'COMPOSITE_ROLLED_BACK');
      posting = false;
      throw failure('MISSING_NOM_B_COMPOSITE_ROLLED_BACK', 'Salesforce rejected the upload and rolled back both file and status changes.', 502);
    }
    const result = await gateway.readback(file.nominationId, marker, expected);
    if (!result) throw failure('MISSING_NOM_B_UPLOAD_UNCERTAIN', 'Salesforce has not yet verified the file and received status.');
    const [verifiedFact] = await gateway.facts([fact.stem.Id], context.client);
    assertOwned(verifiedFact, file.nominationId, user);
    if (verifiedFact.documents.length !== 1 || verifiedFact.documents[0].ContentDocumentId !== result.contentDocumentId) throw failure('MISSING_NOM_B_CONCURRENT_FILING', 'Concurrent Nom B filing requires verification.');
    await changeUpload(context.client,org,file.operationId,token,'Completed',result);
    return result;
  } catch (error) {
    if (posting) {
      await changeUpload(context.client,org,file.operationId,token,'Uncertain',null,txt(error.code) || 'UPLOAD_OUTCOME_UNKNOWN').catch(() => {});
      throw failure('MISSING_NOM_B_UPLOAD_UNCERTAIN', 'The upload outcome is held for verification. Retry this same operation to check it safely.');
    }
    if (error.code !== 'MISSING_NOM_B_COMPOSITE_ROLLED_BACK') await changeUpload(context.client,org,file.operationId,token,'Rejected',null,txt(error.code) || 'UPLOAD_REJECTED').catch(() => {});
    throw error;
  }
}

export function missingNomBEmail(fact, invoice) {
  const row = rowOf(fact, fact.assignment.profile);
  const subject = `Action required: missing Nom B — ${row.stemReference}`;
  const invoiceDate = invoice.Invoice_Date__c ? `Invoice date: ${invoice.Invoice_Date__c}` : `Invoice created: ${invoice.CreatedDate}`;
  const text = `Dear ${row.traderName},\n\nPlease file the missing Nom B as soon as possible.\n\nSTEM: ${row.stemReference}\nBuyer: ${row.buyerName}\nVessel: ${row.vesselName}\nIMO: ${row.imo}\nPort: ${row.portName}\nDelivery date: ${row.deliveryDate || 'Not recorded'}\nExpected delivery: ${row.expectedDeliveryDate || 'Not recorded'}\nBuyer Confirmation: ${row.confirmationReference}\nTriggering invoice: ${invoice.Name}\n${invoiceDate}\n\nView and file all my missing Nom B\n${LINK}\nSign in to FCOS to view your assigned confirmations.`;
  return { to: email(fact.assignment.profile.email), subject, text };
}
const DEFINITELY_UNSENT_CODES = new Set(['GRAPH_EMAIL_CONFIG_MISSING','EMAIL_DELIVERY_DISABLED','EMAIL_PURPOSE_DISABLED','EMAIL_SENDER_NOT_ASSIGNED','EMAIL_PURPOSE_INVALID','MICROSOFT_GRAPH_MAIL_CONFIG_MISSING','VERCEL_OIDC_TOKEN_MISSING','MICROSOFT_GRAPH_TOKEN_FAILED','MICROSOFT_GRAPH_TOKEN_MISSING']);
function safeToRetryMail(error) { return error?.mailDeliveryUncertain === false || DEFINITELY_UNSENT_CODES.has(error?.code); }
async function finishReminder(client, row, status, code = null) {
  const ok = await rpc(client,'missing_nom_b_finish_reminder',{ p_id: row.id,p_token: row.claim_token,p_status: status,p_code: code,p_delay_seconds: status === 'Failed' ? Math.min(86400,300 * 2 ** Math.min(row.attempts || 0,8)) : 300 });
  if (!ok) throw failure('MISSING_NOM_B_REMINDER_CLAIM_LOST', 'Reminder claim changed.', 503);
}
async function finishExcludedDelivery(client, row, fact, stats) {
  const excluded = fact && deliveryExclusion(fact.stem);
  if (!excluded) return false;
  await finishReminder(client,row,excluded.status,excluded.code);
  stats[excluded.status === 'Suppressed' ? 'suppressed' : 'blocked'] += 1;
  return true;
}

export async function runMissingNomBReminders({ client, env = process.env, ...deps }) {
  if (!enabled(env)) return { enabled: false, status: 'disabled', scanned: 0, discovered: 0, sent: 0 };
  // Readiness precedes prospective activation; missing sender/configuration never advances the activation boundary.
  const sender = await (deps.resolveSender || resolveGraphEmailSender)(client,PURPOSE,{ env });
  const gateway = deps.gateway || createMissingNomBGateway(deps);
  const org = await gateway.verify();
  const token = randomUUID();
  let state = await rpc(client,'missing_nom_b_claim_scan',{ p_org: org,p_token: token });
  const stats = { enabled: true,status: 'ok',scanned: 0,discovered: 0,sent: 0,blocked: 0,suppressed: 0,uncertain: 0,failed: 0 };
  if (state) {
    for (let page = 0; page < (deps.maxScanPages || 5); page += 1) {
      const at = preciseDate(state.cursor_at); const until = preciseDate(state.scan_until); const activation = preciseDate(state.activated_at);
      // A fractional lower bound has no equal Salesforce timestamp; an exact
      // millisecond page cursor must retain its Id tie-breaker on resume.
      const continuation = state.cursor_id && at.floor === at.ceil ? `(SystemModstamp > ${at.floor} OR (SystemModstamp = ${at.floor} AND Id > ${quote(validId(state.cursor_id))}))` : `SystemModstamp >= ${at.ceil}`;
      const invoices = await gateway.query(`SELECT ${await gateway.invoiceSelect()} FROM Invoice__c WHERE CreatedDate >= ${activation.ceil} AND SystemModstamp <= ${until.floor} AND ${continuation} ORDER BY SystemModstamp,Id LIMIT 200`);
      // Persist potential final invoices even before a PDF exists. The durable worker below
      // rechecks their linked file without relying on another invoice SystemModstamp change.
      const discoveries = invoices.filter((i) => isMissingNomBInvoiceCandidate(i,activation.raw)).map((i) => ({ stemId: i.STEM__c,invoiceId: i.Id,invoice: { Id: i.Id,Name: i.Name,Invoice_Date__c: i.Invoice_Date__c || null,CreatedDate: i.CreatedDate,SystemModstamp: i.SystemModstamp } }));
      stats.scanned += invoices.length; stats.discovered += discoveries.length;
      const last = invoices.at(-1); const done = invoices.length < 200;
      state = await rpc(client,'missing_nom_b_checkpoint',{ p_org: org,p_token: token,p_discoveries: discoveries,p_cursor_at: done ? until.raw : preciseDate(last.SystemModstamp).raw,p_cursor_id: done ? '' : last.Id,p_done: done });
      if (done) break;
    }
  }
  const rows = await rpc(client,'missing_nom_b_claim_reminders',{ p_org: org,p_token: randomUUID(),p_limit: 20 }) || [];
  if (!rows.length) return stats;
  const activation = state?.activated_at || (await client.from('missing_nom_b_scan_state').select('activated_at').eq('source_org_id',org).single()).data?.activated_at;
  if (!activation) throw failure('MISSING_NOM_B_ACTIVATION_MISSING', 'Reminder activation state is unavailable.', 503);
  // One bulk invoice read for the claimed batch; each send also rechecks its exact invoice and live assignment.
  const invoices = await gateway.invoicesForStems(rows.map((r) => r.stem_id),activation);
  const batchFacts = new Map((await gateway.facts(rows.map((r) => r.stem_id),client)).map((f) => [f.stem.Id,f]));
  for (const row of rows) {
    let sending = false;
    try {
      const fact = batchFacts.get(row.stem_id);
      const potential = invoices.filter((i) => i.STEM__c === row.stem_id && isMissingNomBInvoiceCandidate(i,activation));
      if (!potential.length) {
        await finishReminder(client,row,'Suppressed','NO_LONGER_ELIGIBLE'); stats.suppressed += 1; continue;
      }
      if (await finishExcludedDelivery(client,row,fact,stats)) continue;
      if (!potential.some((i) => qualifiesMissingNomBInvoice(i,activation))) { await finishReminder(client,row,'Blocked','PDF_PENDING'); stats.blocked += 1; continue; }
      if (!fact || isCancelledStem(fact.stem) || fact.documents.length) { await finishReminder(client,row,'Suppressed','NO_LONGER_ELIGIBLE'); stats.suppressed += 1; continue; }
      if (fact.assignment.status !== 'resolved') { await finishReminder(client,row,'Blocked',fact.assignment.status); stats.blocked += 1; continue; }
      const [[fresh], currentInvoices] = await Promise.all([gateway.facts([row.stem_id],client),gateway.invoicesForStems([row.stem_id],activation)]);
      const invoice = currentInvoices.find((i) => qualifiesMissingNomBInvoice(i,activation));
      if (!currentInvoices.some((i) => isMissingNomBInvoiceCandidate(i,activation))) { await finishReminder(client,row,'Suppressed','NO_LONGER_ELIGIBLE'); stats.suppressed += 1; continue; }
      if (await finishExcludedDelivery(client,row,fresh,stats)) continue;
      if (!invoice) { await finishReminder(client,row,'Blocked','PDF_PENDING'); stats.blocked += 1; continue; }
      if (!fresh || isCancelledStem(fresh.stem) || fresh.documents.length) { await finishReminder(client,row,'Suppressed','NO_LONGER_ELIGIBLE'); stats.suppressed += 1; continue; }
      if (fresh.assignment.status !== 'resolved') { await finishReminder(client,row,'Blocked',fresh.assignment.status); stats.blocked += 1; continue; }
      const started = await rpc(client,'missing_nom_b_begin_send',{ p_id: row.id,p_token: row.claim_token,p_nomination: fresh.nomination.Id,p_user: fresh.assignment.profile.id,p_email: email(fresh.assignment.profile.email),p_fingerprint: fresh.fingerprint,p_invoice: { Id: invoice.Id,Name: invoice.Name,Invoice_Date__c: invoice.Invoice_Date__c || null,CreatedDate: invoice.CreatedDate,SystemModstamp: invoice.SystemModstamp } });
      if (!started) { await finishReminder(client,row,'Blocked','UPLOAD_OR_CLAIM_IN_FLIGHT'); stats.blocked += 1; continue; }
      // Sending holds the shared STEM lock against FCOS uploads. Re-read after acquiring it:
      // an upload could have completed between the previous Salesforce read and begin_send.
      const [[lockedFact], lockedInvoices] = await Promise.all([gateway.facts([row.stem_id],client),gateway.invoicesForStems([row.stem_id],activation)]);
      const lockedInvoice = lockedInvoices.find((i) => qualifiesMissingNomBInvoice(i,activation));
      if (!lockedInvoices.some((i) => isMissingNomBInvoiceCandidate(i,activation))) { await finishReminder(client,row,'Suppressed','NO_LONGER_ELIGIBLE'); stats.suppressed += 1; continue; }
      if (await finishExcludedDelivery(client,row,lockedFact,stats)) continue;
      if (!lockedInvoice) { await finishReminder(client,row,'Blocked','PDF_PENDING'); stats.blocked += 1; continue; }
      if (!lockedFact || isCancelledStem(lockedFact.stem) || lockedFact.documents.length) { await finishReminder(client,row,'Suppressed','NO_LONGER_ELIGIBLE'); stats.suppressed += 1; continue; }
      if (lockedInvoice.Id !== invoice.Id || lockedInvoice.SystemModstamp !== invoice.SystemModstamp || lockedInvoice.Name !== invoice.Name || lockedInvoice.CreatedDate !== invoice.CreatedDate || (lockedInvoice.Invoice_Date__c || null) !== (invoice.Invoice_Date__c || null)) { await finishReminder(client,row,'Blocked','INVOICE_CHANGED'); stats.blocked += 1; continue; }
      if (lockedFact.assignment.status !== 'resolved' || lockedFact.fingerprint !== fresh.fingerprint || lockedFact.assignment.profile?.id !== fresh.assignment.profile.id) { await finishReminder(client,row,'Blocked','ASSIGNMENT_CHANGED'); stats.blocked += 1; continue; }
      sending = true;
      await (deps.sendMail || sendOperationalMail)(missingNomBEmail(lockedFact,lockedInvoice), { client,env,purposeKey: PURPOSE,mailboxSnapshot: { id: sender.mailboxId,emailAddress: sender.emailAddress } });
      await finishReminder(client,row,'Sent');
      stats.sent += 1;
    } catch (error) {
      const uncertain = sending && !safeToRetryMail(error);
      const status = uncertain ? 'Uncertain' : 'Failed';
      await finishReminder(client,row,status,txt(error.code) || (uncertain ? 'MAIL_OUTCOME_UNKNOWN' : 'REMINDER_FAILED')).catch(() => {});
      stats[uncertain ? 'uncertain' : 'failed'] += 1;
    }
  }
  return stats;
}

export async function missingNomBStatus({ client, env = process.env, now = new Date() }) {
  const org = fcosSalesforceEnvironment('production').orgId;
  const stateResult = await client.from('missing_nom_b_scan_state').select('activated_at,last_success_at,completed_through').eq('source_org_id',org).maybeSingle();
  if (stateResult.error) throw stateResult.error;
  const counts = {};
  for (const status of ['Blocked','Failed','Uncertain']) {
    const result = await client.from('missing_nom_b_reminders').select('id',{ count: 'exact',head: true }).eq('source_org_id',org).eq('status',status);
    if (result.error) throw result.error;
    counts[status.toLowerCase()] = result.count || 0;
  }
  const uploads = await client.from('missing_nom_b_upload_operations').select('operation_id',{ count:'exact',head:true }).eq('source_org_id',org).in('status',['Posting','Uncertain']);
  if (uploads.error) throw uploads.error;
  counts.uncertainUploads = uploads.count || 0;
  const stalled = await client.from('missing_nom_b_reminders').select('id',{ count:'exact',head:true })
    .eq('source_org_id',org).eq('status','Sending').lt('claim_until',new Date(now).toISOString());
  if (stalled.error) throw stalled.error;
  counts.stalledDeliveries = stalled.count || 0;
  const outcomes = await client.from('missing_nom_b_reminders').select('status,last_error_code,updated_at')
    .eq('source_org_id',org).in('status',['Blocked','Failed','Uncertain'])
    .order('updated_at',{ ascending:false }).limit(10);
  if (outcomes.error) throw outcomes.error;
  const uploadOutcomes = await client.from('missing_nom_b_upload_operations').select('status,last_error_code,updated_at')
    .eq('source_org_id',org).in('status',['Rejected','Posting','Uncertain'])
    .order('updated_at',{ ascending:false }).limit(10);
  if (uploadOutcomes.error) throw uploadOutcomes.error;
  const state = stateResult.data;
  const scanLagSeconds = state?.completed_through ? Math.max(0, Math.floor((new Date(now).getTime()-Date.parse(state.completed_through))/1000)) : null;
  const active = enabled(env);
  const healthStatus = counts.uncertain || counts.uncertainUploads || counts.stalledDeliveries || counts.failed || counts.blocked || (active && (!state || scanLagSeconds > 900)) ? 'warning' : active ? 'online' : 'disabled';
  return { status: active ? 'enabled' : 'disabled',healthStatus,enabled: active,activatedAt: state?.activated_at || null,lastScanAt: state?.last_success_at || null,scanLagSeconds,...counts,
    recentOutcomes: (outcomes.data || []).map((row) => ({status:row.status,code:row.last_error_code,at:row.updated_at})),
    recentUploadOutcomes: (uploadOutcomes.data || []).map((row) => ({status:row.status,code:row.last_error_code,at:row.updated_at})) };
}
