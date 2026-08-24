import { createHash, randomUUID } from 'node:crypto';
import { calculateMasterContractDonPrice, masterContractDonWindow, masterContractLiveVariances, masterContractPreflight, masterContractQuantitySummary } from '../src/lib/masterContracts.js';
import { sfCompositeQueries, sfQuery, sfRequest } from './_salesforce.js';

const EVIDENCE_BUCKET = 'master-contract-evidence';
const SALESFORCE_ID_RE = /^[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_EVIDENCE_BYTES = 20 * 1024 * 1024;

function error(message, status = 400, code = 'MASTER_CONTRACT_INVALID') {
  const next = new Error(message);
  next.status = status;
  next.code = code;
  next.expose = true;
  return next;
}

function text(value, max = 4_000) {
  return String(value ?? '').trim().slice(0, max);
}

function soql(value) {
  return String(value ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

function sha256(value) {
  return createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(stable(value))).digest('hex');
}

function validUuid(value, label = 'identifier') {
  const normalized = text(value, 80);
  if (!UUID_RE.test(normalized)) throw error(`A valid ${label} is required.`);
  return normalized;
}

function validSalesforceId(value, label = 'Salesforce identity') {
  const normalized = text(value, 18);
  if (!SALESFORCE_ID_RE.test(normalized)) throw error(`A valid ${label} is required.`);
  return normalized;
}

function isAdministrative(profile) {
  return ['administrator', 'general_manager'].includes(profile?.user_type);
}

function canOwnContract(profile, contract) {
  return isAdministrative(profile) || contract?.owner_user_id === profile?.id;
}

function assertOwner(profile, contract, action = 'change this Master Contract') {
  if (!canOwnContract(profile, contract)) throw error(`Only the assigned contract owner or an Administrator may ${action}.`, 403, 'MASTER_CONTRACT_OWNER_REQUIRED');
}

function normalizedSnapshot(input = {}) {
  const snapshot = stable(input && typeof input === 'object' && !Array.isArray(input) ? input : {});
  snapshot.parties ||= {};
  snapshot.parties.buyer ||= {};
  snapshot.parties.supplier ||= {};
  snapshot.terms ||= {};
  snapshot.terms.don ||= {};
  snapshot.terms.variableCharges ||= {};
  snapshot.products = Array.isArray(snapshot.products) ? snapshot.products : [];
  snapshot.deliveries = Array.isArray(snapshot.deliveries) ? snapshot.deliveries : [];
  snapshot.chargeRules = Array.isArray(snapshot.chargeRules) ? snapshot.chargeRules : [];
  return snapshot;
}

function selectedDeliveryKeys(body = {}) {
  return [...new Set((Array.isArray(body.deliveryKeys) ? body.deliveryKeys : []).map((value) => text(value, 120)).filter(Boolean))];
}

async function single(client, table, id, select = '*') {
  const { data, error: queryError } = await client.from(table).select(select).eq('id', id).maybeSingle();
  if (queryError) throw queryError;
  if (!data) throw error('The Master Contract is unavailable.', 404, 'MASTER_CONTRACT_NOT_FOUND');
  return data;
}

async function setting(client) {
  const { data, error: queryError } = await client.from('master_contract_settings').select('feature_enabled,revision,updated_at').eq('id', 'company').maybeSingle();
  if (queryError) throw queryError;
  return { featureEnabled: data?.feature_enabled === true, revision: Number(data?.revision || 1), updatedAt: data?.updated_at || null };
}

function rowPermissions(profile, contract) {
  const owner = canOwnContract(profile, contract);
  return {
    canEdit: owner,
    canSubmit: owner,
    canRecordSupplierEvidence: owner,
    canApproveOwner: owner,
    canCreateSalesforce: owner,
    canApplyPrices: owner,
    canOverride: isAdministrative(profile),
  };
}

function contractSummary(row, profile) {
  return {
    id: row.id,
    contractKey: row.contract_key,
    title: row.title,
    status: row.status,
    buyer: { accountId: row.buyer_account_id, name: row.buyer_account_name, clKey: row.buyer_cl_key },
    supplier: { accountId: row.supplier_account_id, name: row.supplier_account_name, clKey: row.supplier_cl_key, confirmed: row.supplier_identity_confirmed === true },
    ownerUserId: row.owner_user_id,
    currentRevision: Number(row.current_revision || 0),
    approvedRevision: row.approved_revision == null ? null : Number(row.approved_revision),
    updatedAt: row.updated_at,
    permissions: rowPermissions(profile, row),
  };
}

async function loadContractRelations(client, contractId) {
  const queries = await Promise.all([
    client.from('master_contract_product_terms').select('*').eq('contract_id', contractId).eq('active', true).order('sort_order'),
    client.from('master_contract_deliveries').select('*').eq('contract_id', contractId).eq('active', true).order('preliminary_eta').order('sequence'),
    client.from('master_contract_charge_rules').select('*').eq('contract_id', contractId).eq('active', true).order('charge_key'),
    client.from('master_contract_revisions').select('id,revision,revision_kind,snapshot_hash,supplier_approved_at,supplier_evidence_id,owner_approved_at,reason_recorded,actor_email,created_at').eq('contract_id', contractId).order('revision', { ascending: false }).limit(100),
    client.from('master_contract_supplier_evidence').select('id,revision,evidence_kind,content_hash,reference_label,recorded_at').eq('contract_id', contractId).order('recorded_at', { ascending: false }).limit(100),
    client.from('master_contract_salesforce_links').select('*').eq('contract_id', contractId).order('created_at'),
    client.from('master_contract_variances').select('*').eq('contract_id', contractId).order('detected_at', { ascending: false }).limit(250),
    client.from('master_contract_sync_jobs').select('id,job_type,status,redacted_result,attempt_count,created_at,updated_at,completed_at').eq('contract_id', contractId).order('created_at', { ascending: false }).limit(50),
  ]);
  for (const result of queries) if (result.error) throw result.error;
  const [products, deliveries, charges, revisions, evidence, links, variances, jobs] = queries.map((result) => result.data || []);
  const deliveryIds = deliveries.map((row) => row.id);
  const deliveryProducts = deliveryIds.length
    ? await client.from('master_contract_delivery_products').select('*').in('delivery_id', deliveryIds).eq('active', true)
    : { data: [], error: null };
  if (deliveryProducts.error) throw deliveryProducts.error;
  const priceRows = (deliveryProducts.data || []).map((row) => row.id);
  const prices = priceRows.length
    ? await client.from('master_contract_price_resolutions').select('*').in('delivery_product_id', priceRows).order('created_at', { ascending: false })
    : { data: [], error: null };
  if (prices.error) throw prices.error;
  return { products, deliveries, deliveryProducts: deliveryProducts.data || [], charges, revisions, evidence, links, variances, jobs, prices: prices.data || [] };
}

function enrichSnapshot(contract, relations) {
  const snapshot = normalizedSnapshot(contract.current_snapshot);
  const productByKey = new Map(relations.products.map((row) => [row.product_key, row]));
  const deliveryByKey = new Map(relations.deliveries.map((row) => [row.delivery_key, row]));
  const productRowsByDelivery = new Map();
  for (const row of relations.deliveryProducts) {
    const list = productRowsByDelivery.get(row.delivery_id) || [];
    list.push(row);
    productRowsByDelivery.set(row.delivery_id, list);
  }
  snapshot.products = snapshot.products.map((item) => ({ ...item, id: productByKey.get(item.productKey)?.id || item.id || null }));
  snapshot.deliveries = snapshot.deliveries.map((item) => {
    const row = deliveryByKey.get(item.deliveryKey);
    const normalized = row ? {
      ...item,
      id: row.id,
      status: row.status,
      lastLiveRefreshAt: row.last_live_refresh_at,
    } : item;
    const deliveryProducts = new Map((productRowsByDelivery.get(row?.id) || []).map((product) => [product.contract_line_key, product]));
    normalized.products = (item.products || []).map((product) => ({
      ...product,
      id: deliveryProducts.get(product.contractLineKey)?.id || product.id || null,
      priceStatus: deliveryProducts.get(product.contractLineKey)?.price_status || product.priceStatus || 'unresolved',
    }));
    return normalized;
  });
  return snapshot;
}

async function loadLiveState(contractKey) {
  try {
    return await sfRequest(`/apexrest/fcos/master-contracts/v1/status?contractKey=${encodeURIComponent(contractKey)}`, { readOnly: true });
  } catch (liveError) {
    if ([404, 405].includes(Number(liveError?.status))) return { available: false, warning: 'Salesforce Master Contract synchronization is not deployed yet.', deliveries: [] };
    return { available: false, warning: liveError.message || 'Live Salesforce state could not be loaded.', deliveries: [] };
  }
}

export async function listMasterContracts(body, context) {
  const { client, profile } = context;
  const includeClosed = body?.includeClosed === true;
  let query = client.from('master_contracts').select('id,contract_key,title,status,buyer_account_id,buyer_account_name,buyer_cl_key,supplier_account_id,supplier_account_name,supplier_cl_key,supplier_identity_confirmed,owner_user_id,current_revision,approved_revision,updated_at').order('updated_at', { ascending: false }).limit(200);
  if (!includeClosed) query = query.not('status', 'in', '(completed,cancelled)');
  const { data, error: queryError } = await query;
  if (queryError) throw queryError;
  return { setting: { ...(await setting(client)), canManage: isAdministrative(profile) }, contracts: (data || []).map((row) => contractSummary(row, profile)) };
}

export async function getMasterContract(body, context) {
  const contractId = validUuid(body?.contractId, 'Master Contract');
  const contract = await single(context.client, 'master_contracts', contractId);
  const [relations, feature, live] = await Promise.all([
    loadContractRelations(context.client, contractId),
    setting(context.client),
    body?.includeLive === false ? Promise.resolve(null) : loadLiveState(contract.contract_key),
  ]);
  const snapshot = enrichSnapshot(contract, relations);
  const productKeyByLine = new Map(snapshot.deliveries.flatMap((delivery) => (delivery.products || []).map((product) => [product.contractLineKey, product.productKey])));
  const liveActuals = {};
  for (const delivery of live?.deliveries || []) {
    for (const product of delivery?.products || []) {
      const productKey = productKeyByLine.get(product.Master_Contract_Line_Key__c);
      if (!productKey) continue;
      liveActuals[productKey] ||= { deliveredQty: 0 };
      const delivered = Number(product.Quantity_Delivered_Per_BDN__c || 0);
      if (Number.isFinite(delivered) && delivered > 0) liveActuals[productKey].deliveredQty += delivered;
    }
  }
  const quantityByProduct = masterContractQuantitySummary(snapshot, liveActuals);
  const detectedVariances = live?.available === false ? [] : masterContractLiveVariances(snapshot, live || {});
  return {
    contract: { ...contractSummary(contract, context.profile), snapshot },
    quantitySummary: Object.entries(quantityByProduct).map(([productKey, values]) => ({
      productKey,
      productName: snapshot.products.find((product) => product.productKey === productKey)?.productName || productKey,
      contractedMinQty: values.contractedMin,
      contractedMaxQty: values.contractedMax,
      allocatedMinQty: values.allocatedMin,
      allocatedMaxQty: values.allocatedMax,
      deliveredQty: values.delivered,
      unallocatedMinQty: values.unallocatedMin,
      unallocatedMaxQty: values.unallocatedMax,
      remainingMinQty: values.remainingMin,
      remainingMaxQty: values.remainingMax,
      overAllocated: values.overAllocated > 0,
      overDelivered: values.overDelivered > 0,
    })),
    relations,
    setting: { ...feature, canManage: isAdministrative(context.profile) },
    live,
    detectedVariances,
  };
}

export async function saveMasterContract(body, context) {
  const snapshot = normalizedSnapshot(body?.snapshot);
  const contractId = body?.contractId ? validUuid(body.contractId, 'Master Contract') : null;
  let existing = null;
  if (contractId) {
    existing = await single(context.client, 'master_contracts', contractId);
    assertOwner(context.profile, existing, 'edit this Master Contract');
  } else if (!isAdministrative(context.profile) && snapshot.ownerUserId !== context.profile.id) {
    throw error('A new Master Contract must be assigned to its creating trader.', 403, 'MASTER_CONTRACT_OWNER_REQUIRED');
  }
  if (existing?.status && !['draft', 'approved', 'active'].includes(existing.status)) {
    throw error('This Master Contract cannot be edited while an approval is pending.', 409, 'MASTER_CONTRACT_APPROVAL_PENDING');
  }
  const contractKey = text(body?.contractKey || existing?.contract_key, 80).toUpperCase();
  const title = text(body?.title || existing?.title, 300);
  if (!/^[A-Z0-9][A-Z0-9_-]{5,79}$/.test(contractKey) || !title) throw error('Contract key and title are required.');
  const request = { contractId, contractKey, title, expectedRevision: body?.expectedRevision ?? null, snapshot };
  const requestHash = sha256(request);
  const { data, error: rpcError } = await context.client.rpc('save_master_contract_snapshot', {
    p_contract_id: contractId,
    p_contract_key: contractKey,
    p_title: title,
    p_expected_revision: body?.expectedRevision ?? null,
    p_snapshot: snapshot,
    p_snapshot_hash: sha256(snapshot),
    p_actor_user_id: context.profile.id,
    p_actor_email: context.profile.email || null,
    p_idempotency_key: text(body?.idempotencyKey || `master-contract-save:${randomUUID()}`, 200),
    p_request_hash: requestHash,
    p_operation: body?.operation === 'import_draft' ? 'import_draft' : 'save',
  });
  if (rpcError) throw rpcError;
  return { ...data, detail: await getMasterContract({ contractId: data.contractId, includeLive: false }, context) };
}

export async function decideMasterContract(body, context) {
  const contractId = validUuid(body?.contractId, 'Master Contract');
  const contract = await single(context.client, 'master_contracts', contractId);
  assertOwner(context.profile, contract, 'approve this Master Contract');
  const action = text(body?.action, 40);
  if (action === 'gm_override' && !isAdministrative(context.profile)) throw error('Only a General Manager or Administrator may override approvals.', 403, 'MASTER_CONTRACT_OVERRIDE_REQUIRED');
  const request = { contractId, expectedRevision: Number(body?.expectedRevision), action, evidenceId: body?.supplierEvidenceId || null, reason: text(body?.reason, 2_000) };
  const { data, error: rpcError } = await context.client.rpc('decide_master_contract_revision', {
    p_contract_id: contractId,
    p_expected_revision: request.expectedRevision,
    p_action: action,
    p_supplier_evidence_id: body?.supplierEvidenceId ? validUuid(body.supplierEvidenceId, 'supplier evidence') : null,
    p_actor_user_id: context.profile.id,
    p_actor_email: context.profile.email || null,
    p_reason: request.reason || null,
    p_idempotency_key: text(body?.idempotencyKey || `master-contract-decision:${randomUUID()}`, 200),
    p_request_hash: sha256(request),
  });
  if (rpcError) throw rpcError;
  return { ...data, detail: await getMasterContract({ contractId, includeLive: false }, context) };
}

function safeFilename(value) {
  const normalized = text(value || 'evidence', 120).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return normalized || 'evidence';
}

export async function prepareMasterContractEvidence(body, context) {
  const contractId = validUuid(body?.contractId, 'Master Contract');
  const contract = await single(context.client, 'master_contracts', contractId);
  assertOwner(context.profile, contract, 'record supplier evidence for this Master Contract');
  if (Number(body?.expectedRevision) !== Number(contract.current_revision)) throw error('The Master Contract changed after it was opened.', 409, 'MASTER_CONTRACT_STALE_REVISION');
  const size = Number(body?.size || 0);
  if (!Number.isFinite(size) || size <= 0 || size > MAX_EVIDENCE_BYTES) throw error('Supplier evidence must be a file no larger than 20 MB.');
  const mimeType = text(body?.mimeType, 120).toLowerCase();
  if (!['application/pdf', 'image/png', 'image/jpeg', 'message/rfc822', 'text/plain'].includes(mimeType)) throw error('Use PDF, PNG, JPEG, email, or text supplier evidence.');
  const storagePath = `${contractId}/${contract.current_revision}/${randomUUID()}-${safeFilename(body?.filename)}`;
  const { data, error: uploadError } = await context.client.storage.from(EVIDENCE_BUCKET).createSignedUploadUrl(storagePath);
  if (uploadError) throw uploadError;
  return { storagePath, token: data.token, signedUrl: data.signedUrl, expiresIn: 120 };
}

export async function completeMasterContractEvidence(body, context) {
  const contractId = validUuid(body?.contractId, 'Master Contract');
  const contract = await single(context.client, 'master_contracts', contractId);
  assertOwner(context.profile, contract, 'record supplier evidence for this Master Contract');
  const expectedRevision = Number(body?.expectedRevision);
  if (expectedRevision !== Number(contract.current_revision)) throw error('The Master Contract changed after it was opened.', 409, 'MASTER_CONTRACT_STALE_REVISION');
  const evidenceKind = body?.evidenceKind === 'reference_note' ? 'reference_note' : 'file';
  let storagePath = null;
  let contentHash = null;
  if (evidenceKind === 'file') {
    storagePath = text(body?.storagePath, 800);
    if (!storagePath.startsWith(`${contractId}/${expectedRevision}/`) || storagePath.includes('..')) throw error('Supplier evidence path is invalid.');
    const { data: file, error: downloadError } = await context.client.storage.from(EVIDENCE_BUCKET).download(storagePath);
    if (downloadError) throw downloadError;
    const buffer = Buffer.from(await file.arrayBuffer());
    if (!buffer.length || buffer.length > MAX_EVIDENCE_BYTES) throw error('Supplier evidence file is unavailable or too large.');
    contentHash = sha256(buffer);
    if (body?.contentHash && text(body.contentHash, 64).toLowerCase() !== contentHash) throw error('Supplier evidence hash does not match the uploaded file.', 409, 'MASTER_CONTRACT_EVIDENCE_HASH_MISMATCH');
  }
  const request = { contractId, expectedRevision, evidenceKind, storagePath, contentHash, referenceLabel: text(body?.referenceLabel, 500) };
  const { data, error: rpcError } = await context.client.rpc('record_master_contract_supplier_evidence', {
    p_contract_id: contractId,
    p_expected_revision: expectedRevision,
    p_evidence_kind: evidenceKind,
    p_storage_path: storagePath,
    p_content_hash: contentHash,
    p_reference_label: request.referenceLabel,
    p_actor_user_id: context.profile.id,
    p_actor_email: context.profile.email || null,
    p_idempotency_key: text(body?.idempotencyKey || `master-contract-evidence:${randomUUID()}`, 200),
    p_request_hash: sha256(request),
  });
  if (rpcError) throw rpcError;
  return data;
}

export async function getMasterContractEvidenceUrl(body, context) {
  const contractId = validUuid(body?.contractId, 'Master Contract');
  await single(context.client, 'master_contracts', contractId);
  const evidenceId = validUuid(body?.evidenceId, 'supplier evidence');
  const { data: evidence, error: queryError } = await context.client.from('master_contract_supplier_evidence').select('storage_path,evidence_kind').eq('id', evidenceId).eq('contract_id', contractId).maybeSingle();
  if (queryError) throw queryError;
  if (!evidence || evidence.evidence_kind !== 'file' || !evidence.storage_path) throw error('Supplier evidence file is unavailable.', 404, 'MASTER_CONTRACT_EVIDENCE_NOT_FOUND');
  const { data, error: signedError } = await context.client.storage.from(EVIDENCE_BUCKET).createSignedUrl(evidence.storage_path, 120);
  if (signedError) throw signedError;
  return { url: data.signedUrl, expiresIn: 120 };
}

export async function masterContractOptions(body, context) {
  const query = text(body?.query, 100);
  const like = query ? `%${soql(query)}%` : '%';
  const [salesforce, owners] = await Promise.all([
    sfCompositeQueries([
      { soql: `SELECT Id,Name,Company_Code__c,Buyer_Payment_Term__c,Supplier_Payment_Term__c,Is_Agent__c FROM Account WHERE Inactive_Suspended__c = false AND (Name LIKE '${like}' OR Company_Code__c LIKE '${like}') ORDER BY Name LIMIT 80`, clean: true, softFail: false, limit: 80 },
      { soql: `SELECT Id,Name,ProductCode,Family FROM Product2 WHERE IsActive = true AND Name LIKE '${like}' ORDER BY Name LIMIT 80`, clean: true, softFail: false, limit: 80 },
      { soql: `SELECT Id,Name,Country__c,Offshore__c FROM Port__c WHERE Name LIKE '${like}' ORDER BY Name LIMIT 80`, clean: true, softFail: false, limit: 80 },
      { soql: `SELECT Id,Name,IMO__c FROM Vessel__c WHERE Inactive__c = false AND (Name LIKE '${like}' OR IMO__c LIKE '${like}') ORDER BY Name LIMIT 80`, clean: true, softFail: false, limit: 80 },
    ]),
    context.client.from('user_profiles').select('id,email,full_name,user_type').eq('active', true).in('user_type', ['manager', 'administrator', 'general_manager']).order('full_name'),
  ]);
  if (owners.error) throw owners.error;
  const [accounts, products, ports, vessels] = salesforce.map((result) => result.records || []);
  return {
    accounts: accounts.map((row) => ({ id: row.Id, name: row.Name, clKey: row.Company_Code__c || null, buyerPaymentTerm: row.Buyer_Payment_Term__c || null, supplierPaymentTerm: row.Supplier_Payment_Term__c || null, isAgent: row.Is_Agent__c === true, role: row.Buyer_Payment_Term__c && row.Supplier_Payment_Term__c ? 'buyer_supplier' : row.Buyer_Payment_Term__c ? 'buyer' : row.Supplier_Payment_Term__c ? 'supplier' : 'unclassified' })),
    products: products.map((row) => ({ id: row.Id, name: row.Name, code: row.ProductCode || null, family: row.Family || null })),
    ports: ports.map((row) => ({ id: row.Id, name: row.Name, country: row.Country__c || null, offshore: row.Offshore__c === true })),
    vessels: vessels.map((row) => ({ id: row.Id, name: row.Name, imo: row.IMO__c || null })),
    owners: (owners.data || []).map((row) => ({ id: row.id, name: row.full_name || row.email, email: row.email, userType: row.user_type })),
  };
}

export async function createMasterContractVessel(body, context) {
  const contract = await single(context.client, 'master_contracts', validUuid(body?.contractId, 'Master Contract'));
  assertOwner(context.profile, contract, 'create a Vessel for this Master Contract');
  const name = text(body?.name, 300);
  const imo = text(body?.imo, 40).replace(/\s+/g, '');
  if (!name || !imo) throw error('Vessel name and IMO are required.');
  const duplicates = await sfQuery(`SELECT Id,Name,IMO__c,Inactive__c FROM Vessel__c WHERE Name = '${soql(name)}' OR IMO__c = '${soql(imo)}' LIMIT 20`, { clean: true, limit: 20 });
  if (duplicates.records.length) throw error('A Vessel with this name or IMO already exists. Select the existing exact record.', 409, 'MASTER_CONTRACT_VESSEL_DUPLICATE');
  const created = await sfRequest('/sobjects/Vessel__c', { method: 'POST', body: { Name: name, IMO__c: imo, Inactive__c: false } });
  return { id: created.id, name, imo };
}

function creationPayload(contract, snapshot, deliveryKeys, ownerEmail = null) {
  const selected = new Set(deliveryKeys);
  return {
    contractKey: contract.contract_key,
    contractTitle: contract.title,
    buyerAccountId: snapshot.parties?.buyer?.accountId,
    supplierAccountId: snapshot.parties?.supplier?.accountId,
    ownerEmail: ownerEmail || null,
    buyerPic: snapshot.parties?.buyer?.pic || null,
    products: snapshot.products,
    chargeRules: snapshot.chargeRules,
    variableCharges: snapshot.terms?.variableCharges,
    deliveries: snapshot.deliveries.filter((delivery) => selected.has(delivery.deliveryKey)),
  };
}

function assertCompleteCreationEvidence(payload, links) {
  if (!Array.isArray(links) || !links.length) throw error('Salesforce returned no Master Contract creation evidence.', 502, 'MASTER_CONTRACT_SALESFORCE_INCOMPLETE');
  const deliveryKeys = new Set((payload.deliveries || []).map((delivery) => delivery.deliveryKey));
  const evidence = new Set();
  for (const link of links) {
    if (!deliveryKeys.has(link.deliveryKey) || !['opportunity', 'stem', 'line_item', 'charge', 'nomination', 'buyer_confirmation'].includes(link.entityType) || !text(link.externalKey, 160) || !SALESFORCE_ID_RE.test(text(link.salesforceId, 18))) {
      throw error('Salesforce returned invalid or cross-delivery Master Contract evidence.', 502, 'MASTER_CONTRACT_SALESFORCE_INCOMPLETE');
    }
    evidence.add(`${link.deliveryKey}:${link.entityType}:${link.externalKey}`);
  }
  for (const delivery of payload.deliveries || []) {
    for (const entityType of ['opportunity', 'stem']) {
      if (!evidence.has(`${delivery.deliveryKey}:${entityType}:${delivery.deliveryKey}`)) throw error(`${delivery.deliveryKey}: Salesforce did not return the required ${entityType} evidence.`, 502, 'MASTER_CONTRACT_SALESFORCE_INCOMPLETE');
    }
    if (!links.some((link) => link.deliveryKey === delivery.deliveryKey && link.entityType === 'buyer_confirmation')) throw error(`${delivery.deliveryKey}: Salesforce did not return Buyer Confirmation evidence.`, 502, 'MASTER_CONTRACT_SALESFORCE_INCOMPLETE');
    if (!links.some((link) => link.deliveryKey === delivery.deliveryKey && link.entityType === 'nomination')) throw error(`${delivery.deliveryKey}: Salesforce did not return Supplier Nomination evidence.`, 502, 'MASTER_CONTRACT_SALESFORCE_INCOMPLETE');
    for (const product of delivery.products || []) {
      if (!evidence.has(`${delivery.deliveryKey}:line_item:${product.contractLineKey}`)) throw error(`${delivery.deliveryKey}: Salesforce did not return ${product.contractLineKey} product-line evidence.`, 502, 'MASTER_CONTRACT_SALESFORCE_INCOMPLETE');
    }
    for (const rule of payload.chargeRules || []) {
      const applies = rule.appliesWhen === 'every_delivery'
        || (rule.appliesWhen === 'berth' && delivery.supplyLocation === 'Berth')
        || (rule.appliesWhen === 'anchorage' && delivery.supplyLocation === 'Anchorage');
      if (applies && !evidence.has(`${delivery.deliveryKey}:charge:${delivery.deliveryKey}:${rule.chargeKey}`)) throw error(`${delivery.deliveryKey}: Salesforce did not return ${rule.chargeName || rule.chargeKey} charge evidence.`, 502, 'MASTER_CONTRACT_SALESFORCE_INCOMPLETE');
    }
  }
}

export async function preflightMasterContract(body, context) {
  const detail = await getMasterContract({ contractId: body?.contractId, includeLive: true }, context);
  const contract = await single(context.client, 'master_contracts', detail.contract.id);
  assertOwner(context.profile, contract, 'create Salesforce records for this Master Contract');
  const deliveryKeys = selectedDeliveryKeys(body);
  const preflight = masterContractPreflight(detail.contract.snapshot, { selectedDeliveryIds: deliveryKeys, featureEnabled: detail.setting.featureEnabled });
  const blockers = [...preflight.blockers];
  if (!['approved', 'active'].includes(contract.status)) blockers.unshift({ code: 'CONTRACT_NOT_APPROVED', message: 'The supplier and assigned owner must approve the current contract revision.' });
  const existingKeys = new Set((detail.relations.links || []).filter((link) => link.entity_type === 'stem').map((link) => link.external_key));
  for (const key of deliveryKeys) if (existingKeys.has(key)) blockers.push({ code: 'DELIVERY_ALREADY_CREATED', deliveryKey: key, message: `${key}: Salesforce records already exist.` });
  const eligibleDeliveryKeys = detail.contract.snapshot.deliveries.filter((delivery) => delivery.status !== 'cancelled' && !existingKeys.has(delivery.deliveryKey)).map((delivery) => delivery.deliveryKey);
  return { ready: blockers.length === 0, blockers, eligibleDeliveryKeys, selectedDeliveryKeys: deliveryKeys, live: detail.live };
}

export async function createMasterContractBatch(body, context) {
  const contractId = validUuid(body?.contractId, 'Master Contract');
  const contract = await single(context.client, 'master_contracts', contractId);
  assertOwner(context.profile, contract, 'create Salesforce records for this Master Contract');
  const deliveryKeys = selectedDeliveryKeys(body);
  const preflight = await preflightMasterContract({ contractId, deliveryKeys }, context);
  if (!preflight.ready) throw error('Master Contract preflight is blocked.', 409, 'MASTER_CONTRACT_PREFLIGHT_BLOCKED');
  const detail = await getMasterContract({ contractId, includeLive: false }, context);
  const { data: ownerProfile, error: ownerError } = await context.client.from('user_profiles').select('email,active').eq('id', contract.owner_user_id).maybeSingle();
  if (ownerError) throw ownerError;
  if (!ownerProfile?.active || !ownerProfile.email) throw error('The assigned contract owner is inactive or has no email identity.', 409, 'MASTER_CONTRACT_OWNER_UNAVAILABLE');
  const payload = creationPayload(contract, detail.contract.snapshot, deliveryKeys, ownerProfile.email);
  const idempotencyKey = text(body?.idempotencyKey, 200);
  if (idempotencyKey.length < 16) throw error('A stable idempotency key is required for batch creation.');
  const requestHash = sha256(payload);
  const { data: queued, error: queueError } = await context.client.rpc('enqueue_master_contract_sync', {
    p_contract_id: contractId,
    p_job_type: 'create_batch',
    p_payload: { deliveryKeys, sourceFingerprint: requestHash },
    p_actor_user_id: context.profile.id,
    p_actor_email: context.profile.email || null,
    p_idempotency_key: idempotencyKey,
    p_request_hash: requestHash,
  });
  if (queueError) throw queueError;
  if (queued?.status === 'succeeded') return { replay: true, jobId: queued.jobId, detail: await getMasterContract({ contractId }, context) };
  try {
    const response = await sfRequest('/apexrest/fcos/master-contracts/v1/create', { method: 'POST', body: { idempotencyKey, requestHash, ...payload } });
    if (!response?.committed || !Array.isArray(response.links)) throw error('Salesforce did not return a committed Master Contract batch.', 502, 'MASTER_CONTRACT_SALESFORCE_INCOMPLETE');
    assertCompleteCreationEvidence(payload, response.links);
    const deliveryIdByKey = new Map(detail.contract.snapshot.deliveries.map((delivery) => [delivery.deliveryKey, delivery.id]));
    const links = response.links.map((link) => ({ ...link, deliveryId: deliveryIdByKey.get(link.deliveryKey) || null }));
    const { data: finalized, error: finalizeError } = await context.client.rpc('finalize_master_contract_salesforce_batch', {
      p_job_id: queued.jobId,
      p_links: links,
      p_source_fingerprint: response.sourceFingerprint || requestHash,
    });
    if (finalizeError) throw finalizeError;
    return { ...finalized, committed: true, detail: await getMasterContract({ contractId }, context) };
  } catch (writeError) {
    const uncertain = !writeError?.status || Number(writeError.status) >= 500;
    await context.client.rpc('complete_master_contract_sync', {
      p_job_id: queued.jobId,
      p_status: uncertain ? 'uncertain' : 'failed',
      p_redacted_result: { contractId, jobId: queued.jobId, errorCode: writeError.code || 'MASTER_CONTRACT_SALESFORCE_WRITE_FAILED', deliveryKeys },
    }).catch(() => {});
    throw writeError;
  }
}

async function deliveryProductContext(client, contractId, deliveryProductId) {
  const contract = await single(client, 'master_contracts', contractId);
  const relations = await loadContractRelations(client, contractId);
  const product = relations.deliveryProducts.find((row) => row.id === deliveryProductId);
  const delivery = relations.deliveries.find((row) => row.id === product?.delivery_id);
  const term = relations.products.find((row) => row.id === product?.product_term_id);
  if (!product || !delivery || !term) throw error('The delivery product is unavailable.', 404, 'MASTER_CONTRACT_PRODUCT_NOT_FOUND');
  return { contract, product, delivery, term, relations };
}

export async function resolveMasterContractPrice(body, context) {
  const contractId = validUuid(body?.contractId, 'Master Contract');
  const deliveryProductId = validUuid(body?.deliveryProductId, 'delivery product');
  const row = await deliveryProductContext(context.client, contractId, deliveryProductId);
  assertOwner(context.profile, row.contract, 'resolve DON pricing for this Master Contract');
  const donWindow = masterContractDonWindow(row.delivery.preliminary_eta, row.contract.don_min_days, row.contract.don_max_days);
  const requestedDate = text(body?.benchmarkDate || row.delivery.don_date, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) throw error('Record a valid Date of Nomination before resolving prices.');
  const alternate = donWindow && (requestedDate < donWindow.earliest || requestedDate > donWindow.latest);
  if (alternate && text(body?.alternatePublicationReason, 2_000).length < 8) throw error('A reason is required when the agreed publication date is outside the DON window.');
  const { data: publication, error: marketError } = await context.client.from('hedge_market_prices').select('id,price_date,s380,sgo,is_estimate,source,revision').eq('price_date', requestedDate).eq('is_estimate', false).maybeSingle();
  if (marketError) throw marketError;
  if (!publication) throw error('No complete official MOPS publication exists for the selected DON date.', 409, 'MASTER_CONTRACT_MOPS_UNAVAILABLE');
  const productKey = row.term.product_key;
  const benchmarkValue = productKey === 'hsfo' ? publication.s380 : productKey === 'mgo' ? publication.sgo : null;
  const calculation = calculateMasterContractDonPrice({ productKey, benchmarkValue, conversionFactor: row.term.conversion_factor, buyPremium: row.term.buy_premium, sellPremium: row.term.sell_premium });
  if (!calculation) throw error('The DON pricing formula cannot be calculated from the official publication.', 409, 'MASTER_CONTRACT_PRICE_INCOMPLETE');
  const evidence = {
    publicationId: publication.id,
    benchmarkDate: requestedDate,
    benchmarkCode: row.term.benchmark_code,
    benchmarkUnit: row.term.benchmark_unit,
    benchmarkValue: calculation.benchmarkValue,
    conversionFactor: calculation.conversionFactor,
    buyPremium: Number(row.term.buy_premium),
    sellPremium: Number(row.term.sell_premium),
    buyUnrounded: calculation.buyUnrounded,
    sellUnrounded: calculation.sellUnrounded,
    buyRounded: calculation.buyRounded,
    sellRounded: calculation.sellRounded,
  };
  if (body?.confirm !== true) return { status: 'preview', donWindow, alternate, evidence, evidenceHash: sha256(evidence) };
  const request = { contractId, deliveryProductId, expectedRevision: Number(body?.expectedRevision), evidence, alternatePublicationReason: text(body?.alternatePublicationReason, 2_000) };
  const { data, error: rpcError } = await context.client.rpc('save_master_contract_price_resolution', {
    p_contract_id: contractId,
    p_expected_revision: request.expectedRevision,
    p_delivery_product_id: deliveryProductId,
    p_benchmark_date: requestedDate,
    p_benchmark_code: row.term.benchmark_code,
    p_benchmark_unit: row.term.benchmark_unit,
    p_benchmark_value: calculation.benchmarkValue,
    p_conversion_factor: calculation.conversionFactor,
    p_buy_unrounded: calculation.buyUnrounded,
    p_sell_unrounded: calculation.sellUnrounded,
    p_buy_rounded: calculation.buyRounded,
    p_sell_rounded: calculation.sellRounded,
    p_evidence_hash: sha256(evidence),
    p_official_observation_id: publication.id,
    p_alternate_publication_reason: request.alternatePublicationReason,
    p_status: 'reviewed',
    p_actor_user_id: context.profile.id,
    p_actor_email: context.profile.email || null,
    p_idempotency_key: text(body?.idempotencyKey || `master-contract-price:${randomUUID()}`, 200),
    p_request_hash: sha256(request),
  });
  if (rpcError) throw rpcError;
  return { ...data, donWindow, alternate, evidence, evidenceHash: sha256(evidence) };
}

export async function applyMasterContractPrice(body, context) {
  const contractId = validUuid(body?.contractId, 'Master Contract');
  const deliveryProductId = validUuid(body?.deliveryProductId, 'delivery product');
  const row = await deliveryProductContext(context.client, contractId, deliveryProductId);
  assertOwner(context.profile, row.contract, 'apply DON pricing for this Master Contract');
  const reviewed = row.relations.prices.find((price) => price.delivery_product_id === deliveryProductId && price.status === 'reviewed');
  if (!reviewed) throw error('Review the exact DON price before applying it.', 409, 'MASTER_CONTRACT_PRICE_NOT_REVIEWED');
  const lineLink = row.relations.links.find((link) => link.entity_type === 'line_item' && link.external_key === row.product.contract_line_key);
  if (!lineLink) throw error('Create the Salesforce delivery before applying its DON price.', 409, 'MASTER_CONTRACT_LINE_NOT_CREATED');
  const payload = {
    lineItemId: lineLink.salesforce_id,
    contractLineKey: row.product.contract_line_key,
    buyPrice: Number(reviewed.buy_rounded),
    sellPrice: Number(reviewed.sell_rounded),
    benchmarkDate: reviewed.benchmark_date,
    benchmarkCode: reviewed.benchmark_code,
    benchmarkValue: Number(reviewed.benchmark_value),
    buyUnrounded: Number(reviewed.buy_unrounded),
    sellUnrounded: Number(reviewed.sell_unrounded),
    evidenceHash: reviewed.evidence_hash,
  };
  const idempotencyKey = text(body?.idempotencyKey, 200);
  if (idempotencyKey.length < 16) throw error('A stable idempotency key is required to apply prices.');
  const requestHash = sha256(payload);
  const { data: queued, error: queueError } = await context.client.rpc('enqueue_master_contract_sync', {
    p_contract_id: contractId,
    p_job_type: 'apply_prices',
    p_payload: { deliveryProductId, sourceFingerprint: requestHash },
    p_actor_user_id: context.profile.id,
    p_actor_email: context.profile.email || null,
    p_idempotency_key: idempotencyKey,
    p_request_hash: requestHash,
  });
  if (queueError) throw queueError;
  if (queued?.status === 'succeeded') return { replay: true, jobId: queued.jobId, applied: true };
  try {
    const salesforce = await sfRequest('/apexrest/fcos/master-contracts/v1/prices', { method: 'POST', body: { idempotencyKey, requestHash, ...payload } });
    if (salesforce?.applied !== true) throw error('Salesforce did not confirm the DON price update.', 502, 'MASTER_CONTRACT_PRICE_SALESFORCE_INCOMPLETE');
  } catch (writeError) {
    const uncertain = !writeError?.status || Number(writeError.status) >= 500;
    await context.client.rpc('complete_master_contract_sync', {
      p_job_id: queued.jobId,
      p_status: uncertain ? 'uncertain' : 'failed',
      p_redacted_result: {
        contractId,
        jobId: queued.jobId,
        errorCode: writeError.code || 'MASTER_CONTRACT_PRICE_SALESFORCE_WRITE_FAILED',
        sourceFingerprint: requestHash,
      },
    }).catch(() => {});
    throw writeError;
  }
  const evidence = {
    benchmarkDate: reviewed.benchmark_date, benchmarkCode: reviewed.benchmark_code,
    benchmarkUnit: reviewed.benchmark_unit, benchmarkValue: Number(reviewed.benchmark_value),
    conversionFactor: Number(reviewed.conversion_factor), buyUnrounded: Number(reviewed.buy_unrounded),
    sellUnrounded: Number(reviewed.sell_unrounded), buyRounded: Number(reviewed.buy_rounded), sellRounded: Number(reviewed.sell_rounded),
  };
  const request = { contractId, deliveryProductId, expectedRevision: Number(body?.expectedRevision), evidence, appliedLineId: lineLink.salesforce_id };
  const { data, error: rpcError } = await context.client.rpc('save_master_contract_price_resolution', {
    p_contract_id: contractId,
    p_expected_revision: request.expectedRevision,
    p_delivery_product_id: deliveryProductId,
    p_benchmark_date: reviewed.benchmark_date,
    p_benchmark_code: reviewed.benchmark_code,
    p_benchmark_unit: reviewed.benchmark_unit,
    p_benchmark_value: reviewed.benchmark_value,
    p_conversion_factor: reviewed.conversion_factor,
    p_buy_unrounded: reviewed.buy_unrounded,
    p_sell_unrounded: reviewed.sell_unrounded,
    p_buy_rounded: reviewed.buy_rounded,
    p_sell_rounded: reviewed.sell_rounded,
    p_evidence_hash: reviewed.evidence_hash,
    p_official_observation_id: reviewed.official_observation_id,
    p_alternate_publication_reason: reviewed.alternate_publication_reason,
    p_status: 'applied',
    p_actor_user_id: context.profile.id,
    p_actor_email: context.profile.email || null,
    p_idempotency_key: `${idempotencyKey}:ledger`,
    p_request_hash: sha256(request),
  });
  if (rpcError) {
    await context.client.rpc('complete_master_contract_sync', { p_job_id: queued.jobId, p_status: 'salesforce_committed', p_redacted_result: { contractId, jobId: queued.jobId, errorCode: 'MASTER_CONTRACT_LEDGER_FINALIZE_REQUIRED', sourceFingerprint: requestHash } }).catch(() => {});
    throw rpcError;
  }
  await context.client.rpc('complete_master_contract_sync', { p_job_id: queued.jobId, p_status: 'succeeded', p_redacted_result: { contractId, jobId: queued.jobId, createdCount: 0, sourceFingerprint: requestHash } });
  return { ...data, applied: true };
}

export async function saveMasterContractFeature(body, context) {
  if (!isAdministrative(context.profile)) throw error('Only a General Manager or Administrator may enable Master Contracts.', 403, 'MASTER_CONTRACT_ADMIN_REQUIRED');
  const reason = text(body?.reason, 2_000);
  const request = { enabled: body?.enabled === true, expectedRevision: Number(body?.expectedRevision), reason };
  const { data, error: rpcError } = await context.client.rpc('set_master_contract_feature', {
    p_enabled: request.enabled,
    p_expected_revision: request.expectedRevision,
    p_actor_user_id: context.profile.id,
    p_actor_email: context.profile.email || null,
    p_reason: reason,
    p_idempotency_key: text(body?.idempotencyKey || `master-contract-feature:${randomUUID()}`, 200),
    p_request_hash: sha256(request),
  });
  if (rpcError) throw rpcError;
  return data;
}

export async function reconcileMasterContracts(_body, context) {
  const { data: contracts, error: queryError } = await context.client.from('master_contracts').select('id,contract_key,current_snapshot,approved_revision,status').in('status', ['approved', 'active']).limit(100);
  if (queryError) throw queryError;
  const results = [];
  for (const contract of contracts || []) {
    const live = await loadLiveState(contract.contract_key);
    if (live?.available === false) {
      results.push({ contractId: contract.id, contractKey: contract.contract_key, available: false, deliveryCount: 0, warning: live?.warning || null });
      continue;
    }
    const relations = await loadContractRelations(context.client, contract.id);
    const snapshot = enrichSnapshot({ ...contract, current_snapshot: contract.current_snapshot }, relations);
    const deliveryIdByKey = new Map(snapshot.deliveries.map((delivery) => [delivery.deliveryKey, delivery.id]));
    const deliveryKeyById = new Map(snapshot.deliveries.map((delivery) => [delivery.id, delivery.deliveryKey]));
    const links = (live.links || []).map((link) => ({
      entityType: link.entityType,
      externalKey: link.externalKey,
      salesforceId: link.salesforceId,
      lastModifiedAt: link.lastModifiedAt || null,
      deliveryId: deliveryIdByKey.get(link.deliveryKey) || null,
    })).filter((link) => link.deliveryId);
    const rawVariances = masterContractLiveVariances(snapshot, live);
    const liveDeliveryKeys = new Set((live.deliveries || []).map((delivery) => delivery.deliveryKey));
    for (const stemLink of relations.links.filter((link) => link.entity_type === 'stem')) {
      const deliveryKey = deliveryKeyById.get(stemLink.delivery_id);
      if (!deliveryKey || liveDeliveryKeys.has(deliveryKey)) continue;
      rawVariances.push({
        deliveryId: stemLink.delivery_id,
        deliveryKey,
        varianceKey: `${deliveryKey}:salesforceStem.present`,
        fieldPath: 'salesforceStem.present',
        approvedValue: true,
        liveValue: false,
        consequentialFinancialRecord: true,
      });
    }
    const variances = rawVariances.map((variance) => ({
      ...variance,
      sourceFingerprint: sha256({
        varianceKey: variance.varianceKey,
        approvedValue: variance.approvedValue,
        liveValue: variance.liveValue,
      }),
    }));
    const { data: reconciliation, error: reconcileError } = await context.client.rpc('reconcile_master_contract_live_state', {
      p_contract_id: contract.id,
      p_links: links,
      p_variances: variances,
      p_actor_user_id: context.profile?.id || null,
      p_actor_email: context.profile?.email || null,
    });
    if (reconcileError) throw reconcileError;

    const { data: recoverable, error: jobsError } = await context.client.from('master_contract_sync_jobs')
      .select('id,job_type,status,payload')
      .eq('contract_id', contract.id)
      .eq('job_type', 'create_batch')
      .in('status', ['uncertain', 'salesforce_committed'])
      .limit(20);
    if (jobsError) throw jobsError;
    let recoveredJobs = 0;
    const liveStemKeys = new Set((live.links || []).filter((link) => link.entityType === 'stem').map((link) => link.deliveryKey));
    for (const job of recoverable || []) {
      const requested = Array.isArray(job.payload?.deliveryKeys) ? job.payload.deliveryKeys : [];
      if (!requested.length || !requested.every((key) => liveStemKeys.has(key))) continue;
      const jobLinks = links.filter((link) => requested.includes(deliveryKeyById.get(link.deliveryId)));
      const { error: finalizeError } = await context.client.rpc('finalize_master_contract_salesforce_batch', {
        p_job_id: job.id,
        p_links: jobLinks,
        p_source_fingerprint: job.payload?.sourceFingerprint,
      });
      if (finalizeError) throw finalizeError;
      recoveredJobs += 1;
    }
    results.push({
      contractId: contract.id,
      contractKey: contract.contract_key,
      available: true,
      deliveryCount: live?.deliveries?.length || 0,
      openVarianceCount: variances.length,
      recoveredJobCount: recoveredJobs,
      reconciledLinkCount: reconciliation?.linkCount || 0,
      warning: null,
    });
  }
  return { checked: results.length, results };
}

export const masterContractInternals = Object.freeze({
  sha256,
  normalizedSnapshot,
  creationPayload,
  assertCompleteCreationEvidence,
  enrichSnapshot,
  contractSummary,
  canOwnContract,
});
