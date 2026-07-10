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

function accountSuffix(accountId) {
  return text(accountId).slice(-6);
}

function supplierLabel(name, paymentTerms, accountId) {
  return [name || 'Supplier', paymentTerms.join(', '), accountSuffix(accountId)].filter(Boolean).join(' | ');
}

function issue(code, message, disputeIds = [], details = {}) {
  return {
    code,
    message,
    disputeIds: unique(disputeIds),
    details,
  };
}

export function resolveOriginalSupplierLookup(fields = []) {
  const field = fields.find((candidate) => candidate?.name === 'Original_Supplier__c');
  if (!field) {
    return {
      valid: false,
      field: null,
      relationshipName: null,
      issue: issue(
        'original_supplier_lookup_missing',
        'Salesforce STEM_Line_Item__c.Original_Supplier__c is required for dispute supplier validation.'
      ),
    };
  }

  const referenceTo = Array.isArray(field.referenceTo) ? field.referenceTo : [];
  if (field.type !== 'reference' || !referenceTo.includes('Account')) {
    return {
      valid: false,
      field,
      relationshipName: field.relationshipName || null,
      issue: issue(
        'original_supplier_lookup_invalid',
        'Salesforce STEM_Line_Item__c.Original_Supplier__c must be a Lookup(Account).',
        [],
        { type: field.type || null, referenceTo }
      ),
    };
  }

  return {
    valid: true,
    field,
    relationshipName: field.relationshipName || 'Original_Supplier__r',
    issue: null,
  };
}

export function buildDisputePartyRegistry({
  stem = {},
  lineItems = [],
  disputeRecords = [],
  originalSupplierRelationship = 'Original_Supplier__r',
  disputeBuyerRelationship = 'Buyer__r',
  disputeSupplierRelationship = 'Supplier__r',
  schemaIssue = null,
} = {}) {
  const issues = schemaIssue ? [schemaIssue] : [];
  const eligibleByKey = new Map();

  for (const lineItem of lineItems) {
    if (lineItem?.Cancelled__c === true) continue;
    const accountId = text(lineItem?.Original_Supplier__c);
    const accountKey = disputeSalesforceIdKey(accountId);
    if (!accountKey) continue;
    const existing = eligibleByKey.get(accountKey) || {
      accountId,
      accountKey,
      name: relatedName(lineItem, originalSupplierRelationship) || text(lineItem?.Supplier_Name__c) || accountId,
      paymentTerms: [],
      lineItemIds: [],
      products: [],
      supplierInvoiceIds: [],
    };
    existing.paymentTerms = unique([...existing.paymentTerms, text(lineItem?.Payment_Term__c)]);
    existing.lineItemIds = unique([...existing.lineItemIds, text(lineItem?.Id)]);
    existing.products = unique([...existing.products, text(lineItem?.Product__r?.Name)]);
    existing.supplierInvoiceIds = unique([...existing.supplierInvoiceIds, text(lineItem?.Supplier_Invoice__c)]);
    eligibleByKey.set(accountKey, existing);
  }

  const validDisputeRecords = disputeRecords.filter((record) => isDisputeSalesforceId(text(record?.Id)));
  const supplierRecordsByKey = new Map();
  const buyerOnlyRecords = [];
  const buyerRecords = [];

  for (const record of validDisputeRecords) {
    const disputeId = text(record.Id);
    const buyerId = text(record.Buyer__c);
    const supplierId = text(record.Supplier__c);
    const buyerKey = disputeSalesforceIdKey(buyerId);
    const supplierKey = disputeSalesforceIdKey(supplierId);

    if (!buyerKey && !supplierKey) {
      issues.push(issue('empty_dispute_party', `Dispute ${disputeId} has neither Buyer__c nor Supplier__c.`, [disputeId]));
      continue;
    }

    if (buyerKey) buyerRecords.push({ record, disputeId, accountId: buyerId, accountKey: buyerKey });
    if (!supplierKey) {
      if (buyerKey) buyerOnlyRecords.push({ record, disputeId });
      continue;
    }

    const supplierRows = supplierRecordsByKey.get(supplierKey) || [];
    supplierRows.push({ record, disputeId, accountId: supplierId, accountKey: supplierKey });
    supplierRecordsByKey.set(supplierKey, supplierRows);
  }

  const supplierRecordCount = [...supplierRecordsByKey.values()].reduce((sum, records) => sum + records.length, 0);
  if (supplierRecordCount === 0 && buyerRecords.length === 0) {
    issues.push(issue(
      'no_dispute_parties',
      'At least one Salesforce Dispute__c record must identify a buyer or an eligible stem-line supplier.'
    ));
  }
  if (supplierRecordCount > 0 && buyerOnlyRecords.length > 0) {
    issues.push(issue(
      'buyer_only_record_with_suppliers',
      'Buyer-only Dispute__c records are not allowed when supplier dispute records exist for the stem.',
      buyerOnlyRecords.map((row) => row.disputeId)
    ));
  }

  const buyerKeys = unique(buyerRecords.map((row) => row.accountKey));
  if (buyerKeys.length > 1) {
    issues.push(issue(
      'mixed_buyer_accounts',
      'All buyer-bearing Dispute__c records for the stem must use the same Buyer__c account.',
      buyerRecords.map((row) => row.disputeId),
      { buyerAccountIds: unique(buyerRecords.map((row) => row.accountId)) }
    ));
  }

  const expectedBuyerId = text(stem.Account__c);
  const expectedBuyerKey = disputeSalesforceIdKey(expectedBuyerId);
  if (expectedBuyerKey && buyerKeys.length === 1 && buyerKeys[0] !== expectedBuyerKey) {
    issues.push(issue(
      'buyer_account_mismatch',
      'Dispute__c.Buyer__c does not match the buyer Account on the stem.',
      buyerRecords.map((row) => row.disputeId),
      { expectedBuyerAccountId: expectedBuyerId, actualBuyerAccountId: buyerRecords[0]?.accountId || null }
    ));
  }

  if (supplierRecordCount > 0 && buyerRecords.length > 0) {
    const supplierRecordsWithoutBuyer = [...supplierRecordsByKey.values()].flat().filter((row) => !disputeSalesforceIdKey(row.record.Buyer__c));
    if (supplierRecordsWithoutBuyer.length > 0) {
      issues.push(issue(
        'buyer_not_repeated_on_supplier_records',
        'When the buyer is disputed, the same Buyer__c must be populated on every supplier Dispute__c record.',
        supplierRecordsWithoutBuyer.map((row) => row.disputeId)
      ));
    }
  }

  const suppliers = [];
  for (const [supplierKey, rows] of supplierRecordsByKey.entries()) {
    if (rows.length > 1) {
      issues.push(issue(
        'duplicate_supplier_dispute',
        `Supplier account ${rows[0].accountId} has more than one Dispute__c record for the stem.`,
        rows.map((row) => row.disputeId),
        { supplierAccountId: rows[0].accountId }
      ));
    }

    const eligible = eligibleByKey.get(supplierKey);
    if (!eligible) {
      issues.push(issue(
        'supplier_without_stem_line_item',
        `Supplier account ${rows[0].accountId} is disputed but has no non-cancelled stem line item using Original_Supplier__c.`,
        rows.map((row) => row.disputeId),
        { supplierAccountId: rows[0].accountId }
      ));
    }

    const row = rows[0];
    const name = relatedName(row.record, disputeSupplierRelationship) || eligible?.name || row.accountId;
    const paymentTerms = eligible?.paymentTerms || [];
    suppliers.push({
      partyKey: `supplier:${row.accountId}`,
      type: 'supplier',
      accountId: row.accountId,
      accountKey: supplierKey,
      name,
      label: supplierLabel(name, paymentTerms, row.accountId),
      paymentTerms,
      lineItemIds: eligible?.lineItemIds || [],
      products: eligible?.products || [],
      supplierInvoiceIds: eligible?.supplierInvoiceIds || [],
      disputeIds: rows.map((item) => item.disputeId),
      status: text(row.record.Status_Supplier__c || row.record.Dispute_Status__c) || null,
      description: text(row.record.Description_Supplier__c) || null,
      deductionAmount: row.record.Deduction_Amount_Supplier__c ?? null,
    });
  }

  const buyerAccountId = buyerKeys.length === 1 ? buyerRecords[0]?.accountId : null;
  const buyer = buyerAccountId ? {
    partyKey: `buyer:${buyerAccountId}`,
    type: 'buyer',
    accountId: buyerAccountId,
    accountKey: buyerKeys[0],
    name: relatedName(buyerRecords[0]?.record, disputeBuyerRelationship)
      || text(stem.Account__r?.Name)
      || text(stem.Buyer_Name__c)
      || buyerAccountId,
    disputeIds: unique(buyerRecords.map((row) => row.disputeId)),
    statuses: unique(buyerRecords.map((row) => text(row.record.Status_Buyer__c || row.record.Dispute_Status__c))),
    descriptions: unique(buyerRecords.map((row) => text(row.record.Description_Buyer__c))),
  } : null;
  if (buyer) {
    buyer.status = buyer.statuses.join(' / ') || null;
    buyer.description = buyer.descriptions.join('\n') || null;
    buyer.label = `${buyer.name} | ${accountSuffix(buyer.accountId)}`;
  }

  const eligibleSuppliers = [...eligibleByKey.values()].map((supplier) => ({
    ...supplier,
    label: supplierLabel(supplier.name, supplier.paymentTerms, supplier.accountId),
  }));

  return {
    valid: issues.length === 0,
    buyer,
    suppliers,
    eligibleSuppliers,
    issues,
  };
}

export function findDisputeParty(registry, partyType, accountId) {
  const accountKey = disputeSalesforceIdKey(accountId);
  if (!accountKey) return null;
  if (partyType === 'buyer') return registry?.buyer?.accountKey === accountKey ? registry.buyer : null;
  return (registry?.suppliers || []).find((supplier) => supplier.accountKey === accountKey) || null;
}
