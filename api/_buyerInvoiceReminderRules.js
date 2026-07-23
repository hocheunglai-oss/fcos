export const BUYER_REMINDER_POLICIES = Object.freeze({
  STANDARD: 'standard',
  OVERDUE_ONLY: 'overdue_only',
});

const SALESFORCE_ID_PATTERN = /^[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?$/;

export function canonicalSalesforceAccountId(value) {
  const accountId = String(value || '').trim();
  return SALESFORCE_ID_PATTERN.test(accountId) ? accountId.slice(0, 15) : '';
}

export function buyerReminderAccountType(account = {}) {
  if (account.Is_Broker__c === true || account.isBroker === true) return null;
  const recordTypeName = String(account.RecordType?.Name || account.recordTypeName || '').trim().toLowerCase();
  if (recordTypeName === 'group') return 'group';
  const hasBuyerTerms = account.Buyer_Payment_Term__c != null
    && String(account.Buyer_Payment_Term__c).trim() !== '';
  const hasSupplierTerms = account.Supplier_Payment_Term__c != null
    && String(account.Supplier_Payment_Term__c).trim() !== '';
  if (hasBuyerTerms && hasSupplierTerms) return 'buyer_supplier';
  if (hasBuyerTerms) return 'buyer';
  return null;
}

function normalizedRule(row = {}) {
  const accountId = canonicalSalesforceAccountId(
    row.salesforce_account_id || row.salesforceAccountId || row.accountId,
  );
  if (!accountId) return null;
  return {
    accountId,
    accountName: row.account_name || row.accountName || '',
    accountType: row.account_type || row.accountType || '',
    parentAccountId: canonicalSalesforceAccountId(
      row.parent_salesforce_account_id || row.parentSalesforceAccountId,
    ) || null,
    policy: row.policy === BUYER_REMINDER_POLICIES.OVERDUE_ONLY
      ? BUYER_REMINDER_POLICIES.OVERDUE_ONLY
      : BUYER_REMINDER_POLICIES.STANDARD,
    note: String(row.note || ''),
    inheritToChildren: row.inherit_to_children === true || row.inheritToChildren === true,
    revision: Number(row.revision || 0),
    updatedAt: row.updated_at || row.updatedAt || null,
    updatedByEmail: row.updated_by_email || row.updatedByEmail || null,
  };
}

export function buyerReminderRuleMap(rows = []) {
  return new Map(rows
    .map(normalizedRule)
    .filter(Boolean)
    .map((rule) => [rule.accountId, rule]));
}

export function resolveBuyerReminderRule(row = {}, rules = []) {
  const map = rules instanceof Map ? rules : buyerReminderRuleMap(rules);
  const buyerAccountId = canonicalSalesforceAccountId(row.buyerAccountId);
  const parentAccountId = canonicalSalesforceAccountId(row.buyerParentAccountId);
  const direct = map.get(buyerAccountId);
  if (direct) {
    return {
      ...direct,
      source: 'direct',
      sourceAccountId: direct.accountId,
      sourceAccountName: direct.accountName || row.buyerName || '',
    };
  }

  const parent = map.get(parentAccountId);
  if (parent?.inheritToChildren) {
    return {
      ...parent,
      source: 'group',
      sourceAccountId: parent.accountId,
      sourceAccountName: parent.accountName || row.buyerGroupName || '',
    };
  }

  return {
    accountId: buyerAccountId || null,
    accountName: row.buyerName || '',
    accountType: '',
    parentAccountId: parentAccountId || null,
    policy: BUYER_REMINDER_POLICIES.STANDARD,
    note: '',
    inheritToChildren: false,
    revision: 0,
    updatedAt: null,
    updatedByEmail: null,
    source: 'default',
    sourceAccountId: null,
    sourceAccountName: '',
  };
}

export function buyerReminderEligibility(row = {}, rule = {}, rulesAvailable = true) {
  if (!rulesAvailable) {
    return {
      eligible: false,
      blockingReason: 'Reminder rules are temporarily unavailable. External payment reminders are disabled.',
      ruleApplied: false,
    };
  }

  if ((row.buyerBrokerRoutingMode || 'buyer_only') === 'broker_only') {
    return {
      eligible: true,
      blockingReason: null,
      ruleApplied: false,
    };
  }

  if (!canonicalSalesforceAccountId(row.buyerAccountId)) {
    return {
      eligible: false,
      blockingReason: 'The Salesforce Buyer Account ID is unavailable. External payment reminders are disabled for this invoice.',
      ruleApplied: false,
    };
  }

  const daysUntilDue = Number(row.daysUntilDue);
  const isOverdue = Number.isFinite(daysUntilDue) && daysUntilDue < 0;
  if (rule.policy === BUYER_REMINDER_POLICIES.OVERDUE_ONLY && !isOverdue) {
    return {
      eligible: false,
      blockingReason: 'This buyer accepts payment reminders only after the invoice becomes overdue.',
      ruleApplied: true,
    };
  }

  return {
    eligible: true,
    blockingReason: null,
    ruleApplied: rule.policy === BUYER_REMINDER_POLICIES.OVERDUE_ONLY,
  };
}

export function applyBuyerReminderRules(rows = [], rules = [], rulesAvailable = true) {
  const map = rules instanceof Map ? rules : buyerReminderRuleMap(rules);
  return rows.map((row) => {
    const rule = resolveBuyerReminderRule(row, map);
    const eligibility = buyerReminderEligibility(row, rule, rulesAvailable);
    return {
      ...row,
      effectiveReminderPolicy: rule.policy,
      reminderRuleSource: rule.source,
      reminderRuleSourceAccountId: rule.sourceAccountId,
      reminderRuleSourceAccountName: rule.sourceAccountName,
      reminderRuleNote: rule.note,
      paymentReminderEligible: eligibility.eligible,
      paymentReminderBlockingReason: eligibility.blockingReason,
      paymentReminderRuleApplied: eligibility.ruleApplied,
    };
  });
}

export function evaluateBuyerReminderSelection(candidates = [], requestedStemIds = []) {
  const requested = [...new Set((requestedStemIds || [])
    .map((stemId) => String(stemId || '').trim())
    .filter(Boolean))];
  const candidateById = new Map(candidates.map((row) => [String(row.stemId || '').trim(), row]));
  const unknownStemIds = requested.filter((stemId) => !candidateById.has(stemId));
  const rows = requested.map((stemId) => candidateById.get(stemId)).filter(Boolean);
  const restrictedRows = rows.filter((row) => row.paymentReminderEligible !== true);
  return { requestedStemIds: requested, rows, unknownStemIds, restrictedRows };
}
