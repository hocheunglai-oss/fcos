const SALESFORCE_ID_RE = /^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/;

export function isDisputeSalesforceId(value) {
  return typeof value === 'string' && SALESFORCE_ID_RE.test(value);
}

export function disputeSalesforceIdKey(value) {
  const id = String(value || '').trim();
  return isDisputeSalesforceId(id) ? id.slice(0, 15) : '';
}

function text(value) {
  return String(value || '').trim();
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function relatedName(record, relationshipName) {
  return text(relationshipName && record?.[relationshipName]?.Name);
}

function issue(code, message, recordIds = [], details = {}) {
  return { code, message, recordIds: unique(recordIds), details };
}

function validAccountLookup(field) {
  return field?.type === 'reference' && Array.isArray(field.referenceTo) && field.referenceTo.includes('Account');
}

export function resolveOriginalSupplierLookup(fields = []) {
  const field = fields.find((candidate) => candidate?.name === 'Original_Supplier__c');
  if (!field) {
    return {
      valid: false,
      field: null,
      fieldName: null,
      relationshipName: null,
      issue: issue(
        'original_supplier_lookup_missing',
        'Salesforce STEM_Line_Item__c.Original_Supplier__c is required for dispute supplier validation.'
      ),
    };
  }
  if (!validAccountLookup(field)) {
    return {
      valid: false,
      field,
      fieldName: field.name,
      relationshipName: field.relationshipName || null,
      issue: issue(
        'original_supplier_lookup_invalid',
        'Salesforce STEM_Line_Item__c.Original_Supplier__c must be a Lookup(Account).',
        [],
        { type: field.type || null, referenceTo: field.referenceTo || [] }
      ),
    };
  }
  return {
    valid: true,
    field,
    fieldName: field.name,
    relationshipName: field.relationshipName || 'Original_Supplier__r',
    issue: null,
  };
}

export function resolveExtraCostSupplierLookup(fields = []) {
  const exactNames = ['Original_Supplier__c', 'Supplier__c', 'Supplier_Account__c'];
  const exact = exactNames
    .map((name) => fields.find((field) => field?.name === name))
    .find(validAccountLookup);
  const matching = fields.filter((field) => validAccountLookup(field)
    && /supplier/i.test(`${field.name || ''} ${field.label || ''}`));
  const field = exact || (matching.length === 1 ? matching[0] : null);
  if (!field) {
    const ambiguous = matching.length > 1;
    return {
      valid: false,
      field: null,
      fieldName: null,
      relationshipName: null,
      issue: issue(
        ambiguous ? 'extra_cost_supplier_lookup_ambiguous' : 'extra_cost_supplier_lookup_missing',
        ambiguous
          ? 'Salesforce STEM_Extra_Cost__c has multiple supplier Account lookups. Configure one authoritative supplier lookup.'
          : 'Salesforce STEM_Extra_Cost__c requires a supplier Lookup(Account) for dispute party validation.',
        [],
        { candidates: matching.map((candidate) => candidate.name) }
      ),
    };
  }
  return {
    valid: true,
    field,
    fieldName: field.name,
    relationshipName: field.relationshipName || field.name.replace(/__c$/, '__r'),
    issue: null,
  };
}

function addCandidate(candidateMap, input) {
  const accountId = text(input.accountId);
  const accountKey = disputeSalesforceIdKey(accountId);
  if (!accountKey) return null;
  const existing = candidateMap.get(accountKey) || {
    accountId,
    accountKey,
    name: text(input.name) || accountId,
    roles: [],
    sourceTypes: [],
    sourceRecordIds: [],
    paymentTerms: [],
    products: [],
    supplierInvoiceIds: [],
    sourceCancellation: [],
  };
  existing.name = existing.name === existing.accountId && input.name ? text(input.name) : existing.name;
  existing.roles = unique([...existing.roles, input.role]);
  existing.sourceTypes = unique([...existing.sourceTypes, input.sourceType]);
  existing.sourceRecordIds = unique([...existing.sourceRecordIds, text(input.sourceRecordId)]);
  existing.paymentTerms = unique([...existing.paymentTerms, text(input.paymentTerm)]);
  existing.products = unique([...existing.products, text(input.product)]);
  existing.supplierInvoiceIds = unique([...existing.supplierInvoiceIds, text(input.supplierInvoiceId)]);
  existing.sourceCancellation.push(input.cancelled === true);
  candidateMap.set(accountKey, existing);
  return existing;
}

function labelCandidates(candidates) {
  const accountsByName = new Map();
  for (const candidate of candidates) {
    const nameKey = text(candidate.name).replace(/\s+/g, ' ').toLowerCase();
    const accountKeys = accountsByName.get(nameKey) || new Set();
    accountKeys.add(candidate.accountKey);
    accountsByName.set(nameKey, accountKeys);
  }
  const labelled = candidates.map((candidate) => {
    const nameKey = text(candidate.name).replace(/\s+/g, ' ').toLowerCase();
    const collision = (accountsByName.get(nameKey)?.size || 0) > 1;
    const roleLabel = candidate.roles.length > 1
      ? 'Buyer & Supplier'
      : collision
        ? candidate.roles[0] === 'buyer' ? 'Buyer' : 'Supplier'
        : null;
    const terms = candidate.roles.includes('supplier') ? candidate.paymentTerms.join(', ') : null;
    const products = collision && candidate.roles.includes('supplier') ? candidate.products.join(', ') : null;
    const baseLabel = [candidate.name || 'Account', roleLabel, terms, products].filter(Boolean).join(' | ');
    return {
      candidate,
      baseLabel,
    };
  });
  const labelCounts = new Map();
  for (const item of labelled) {
    const key = item.baseLabel.toLowerCase();
    labelCounts.set(key, (labelCounts.get(key) || 0) + 1);
  }
  const labelOccurrences = new Map();
  return labelled.map(({ candidate, baseLabel }) => {
    const labelKey = baseLabel.toLowerCase();
    const occurrence = (labelOccurrences.get(labelKey) || 0) + 1;
    labelOccurrences.set(labelKey, occurrence);
    const optionLabel = (labelCounts.get(labelKey) || 0) > 1
      ? `${candidate.roles.includes('supplier') ? 'Supplier' : 'Account'} option ${occurrence}`
      : null;
    return {
      ...candidate,
      partyKey: `account:${candidate.accountId}`,
      type: candidate.roles.length > 1 ? 'buyer_supplier' : candidate.roles[0],
      cancelledSourceOnly: candidate.roles.includes('buyer') ? false : candidate.sourceCancellation.length > 0 && candidate.sourceCancellation.every(Boolean),
      label: [baseLabel, optionLabel].filter(Boolean).join(' | '),
    };
  });
}

export function buildDisputePartyRegistry({
  stem = {},
  lineItems = [],
  extraCosts = [],
  originalSupplierRelationship = 'Original_Supplier__r',
  extraCostSupplierField = null,
  extraCostSupplierRelationship = null,
  schemaIssues = [],
} = {}) {
  const issues = schemaIssues.filter(Boolean);
  const candidateMap = new Map();
  const buyerAccountId = text(stem.Account__c);
  if (buyerAccountId) {
    if (disputeSalesforceIdKey(buyerAccountId)) {
      addCandidate(candidateMap, {
        accountId: buyerAccountId,
        name: text(stem.Account__r?.Name) || text(stem.Buyer_Name__c) || buyerAccountId,
        role: 'buyer',
        sourceType: 'stem_buyer',
        sourceRecordId: stem.Id,
        paymentTerm: stem.Payment_Term__c,
        cancelled: false,
      });
    } else {
      issues.push(issue('buyer_account_invalid', 'The disputed STEM buyer is not a valid Salesforce Account ID.', [stem.Id]));
    }
  }

  for (const lineItem of lineItems) {
    const supplierName = relatedName(lineItem, originalSupplierRelationship) || text(lineItem.Supplier_Name__c);
    const accountId = text(lineItem.Original_Supplier__c);
    if (!accountId && !supplierName) continue;
    if (!disputeSalesforceIdKey(accountId)) {
      issues.push(issue(
        'line_supplier_account_missing',
        `STEM line item ${text(lineItem.Id) || 'unknown'} has a supplier but no valid Original_Supplier__c Account.`,
        [lineItem.Id]
      ));
      continue;
    }
    addCandidate(candidateMap, {
      accountId,
      name: supplierName || accountId,
      role: 'supplier',
      sourceType: 'line_item',
      sourceRecordId: lineItem.Id,
      paymentTerm: lineItem.Payment_Term__c,
      product: lineItem.Product__r?.Name,
      supplierInvoiceId: lineItem.Supplier_Invoice__c,
      cancelled: lineItem.Cancelled__c === true,
    });
  }

  for (const extraCost of extraCosts) {
    const supplierName = relatedName(extraCost, extraCostSupplierRelationship) || text(extraCost.Supplier_Name__c);
    const accountId = extraCostSupplierField ? text(extraCost[extraCostSupplierField]) : '';
    if (!accountId && !supplierName) continue;
    if (!disputeSalesforceIdKey(accountId)) {
      issues.push(issue(
        'extra_cost_supplier_account_missing',
        `STEM extra cost ${text(extraCost.Id) || 'unknown'} has a supplier but no valid supplier Account lookup.`,
        [extraCost.Id]
      ));
      continue;
    }
    addCandidate(candidateMap, {
      accountId,
      name: supplierName || accountId,
      role: 'supplier',
      sourceType: 'extra_cost',
      sourceRecordId: extraCost.Id,
      paymentTerm: extraCost.Payment_Term__c,
      product: extraCost.Product2Id__r?.Name || extraCost.Product__r?.Name,
      supplierInvoiceId: extraCost.Supplier_Invoice__c,
      cancelled: extraCost.Cancelled__c === true,
    });
  }

  const candidates = labelCandidates([...candidateMap.values()]);
  if (!candidates.length) {
    issues.push(issue('no_eligible_accounts', 'The disputed STEM must have at least one eligible buyer or supplier Account.'));
  }
  const candidateSchemaValid = issues.length === 0;
  return {
    valid: candidateSchemaValid,
    candidateSchemaValid,
    selectionValid: false,
    candidates,
    selected: [],
    buyer: candidates.find((candidate) => candidate.roles.includes('buyer')) || null,
    suppliers: candidates.filter((candidate) => candidate.roles.includes('supplier')),
    issues,
  };
}

export function findDisputeParty(registry, partySide, accountId) {
  const accountKey = disputeSalesforceIdKey(accountId);
  if (!accountKey || !['buyer', 'supplier'].includes(partySide)) return null;
  return (registry?.candidates || []).find((candidate) => candidate.accountKey === accountKey && candidate.roles.includes(partySide)) || null;
}
