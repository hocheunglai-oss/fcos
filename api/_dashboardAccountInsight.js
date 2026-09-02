import { dashboardLineItemVolume, resolveDashboardItemUom } from './_dashboardVolume.js';
import { SALESFORCE_CORPORATE_CURRENCY, decisionDashboardSupplierAmount } from './_decisionDashboard.js';
import { grossMarginPercent } from './_dashboardMetrics.js';
import { isFinalBuyerInvoice, resolveBuyerFinancialAmount } from './_buyerFinancialAmount.js';
import { earliestEtaDate, summarizeBuyerPaymentEvidence } from '../src/lib/paymentCollectionEvidence.js';
import { financialQuantityValue as financialQuantity, nativeFinancialQuantity } from './_financialQuantity.js';
import { LEGACY_PAYMENT_DATA_LABEL, paymentDataReliabilityMetadata, paymentDataReliabilityState } from '../src/lib/paymentDataReliability.js';

const DAY_MS = 86_400_000;
const ZERO_TOLERANCE = 0.005;
const CURRENCY_NOT_SET = SALESFORCE_CORPORATE_CURRENCY;

function hongKongToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function number(value) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function valueOrZero(value) {
  return number(value) ?? 0;
}

function text(value) {
  return String(value || '').trim();
}

function dateOnly(value) {
  const token = text(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(token) ? token : null;
}

function dateMs(value) {
  const token = dateOnly(value);
  return token ? Date.parse(`${token}T00:00:00Z`) : null;
}

function daysBetween(later, earlier) {
  const laterMs = dateMs(later);
  const earlierMs = dateMs(earlier);
  if (laterMs == null || earlierMs == null) return null;
  return Math.round((laterMs - earlierMs) / DAY_MS);
}

function inclusiveMonthCount(first, last) {
  const start = dateOnly(first);
  const end = dateOnly(last);
  if (!start || !end) return null;
  const [startYear, startMonth] = start.split('-').map(Number);
  const [endYear, endMonth] = end.split('-').map(Number);
  return Math.max(0, ((endYear - startYear) * 12) + endMonth - startMonth + 1);
}

function median(values) {
  const sorted = values.map(number).filter((value) => value != null).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const midpoint = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[midpoint] : (sorted[midpoint - 1] + sorted[midpoint]) / 2;
}

function standardDeviation(values) {
  const numeric = values.map(number).filter((value) => value != null);
  if (numeric.length < 2) return 0;
  const average = numeric.reduce((sum, value) => sum + value, 0) / numeric.length;
  return Math.sqrt(numeric.reduce((sum, value) => sum + ((value - average) ** 2), 0) / numeric.length);
}

function percentage(part, total) {
  const denominator = number(total);
  const numerator = number(part);
  if (numerator == null || denominator == null || denominator === 0) return null;
  return (numerator / denominator) * 100;
}

function unique(values) {
  return [...new Set(values.map(text).filter(Boolean))];
}

function salesforceIdKey(value) {
  const id = text(value);
  return /^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/.test(id) ? id.slice(0, 15) : '';
}

function currencyOf(record) {
  return text(record?.CurrencyIsoCode || record?.Currency__c) || CURRENCY_NOT_SET;
}

function firstNumber(...values) {
  for (const value of values) {
    const result = number(value);
    if (result != null) return result;
  }
  return null;
}

function lineSellAmount(item, stemHasDelivery) {
  if (stemHasDelivery) return valueOrZero(item.Total_Price__c);
  const unit = firstNumber(item.Price_Per_Unit__c, item.Unit_Sell_At__c, item.Offer_Line_Item__r?.UnitPrice);
  return unit == null ? valueOrZero(item.Total_Price__c) : unit * financialQuantity(item, false);
}

function lineBuyAmount(item, stemHasDelivery) {
  if (stemHasDelivery) return valueOrZero(item.Total_Cost__c);
  const unit = firstNumber(item.Cost_Per_Unit__c, item.Unit_Buy_At__c, item.Unit_Cost__c, item.Offer_Line_Item__r?.Supplier_Unit_Price__c);
  return unit == null ? valueOrZero(item.Total_Cost__c) : unit * financialQuantity(item, false);
}

function extraSellAmount(item, stemHasDelivery) {
  if (stemHasDelivery) return valueOrZero(item.Line_Total__c);
  const unit = firstNumber(item.Unit_Price__c);
  return unit == null ? valueOrZero(item.Line_Total__c) : unit * financialQuantity(item, false, 'Quantity_Range_Max__c');
}

function extraBuyAmount(item, stemHasDelivery) {
  if (stemHasDelivery) return valueOrZero(item.Line_Total_Buy__c);
  const unit = firstNumber(item.Unit_Cost__c);
  return unit == null ? valueOrZero(item.Line_Total_Buy__c) : unit * financialQuantity(item, false, 'Quantity_Range_Max__c');
}

function supplierBrokerCommission(item, stemHasDelivery) {
  return valueOrZero(item.Suppliers_Brokers_Commission_Per_Unit__c) * financialQuantity(item, stemHasDelivery);
}

function buyerBrokerCommission(item, stemHasDelivery) {
  const buyerPerUnit = number(item.Buyers_Brokers_Commission_Per_Unit__c);
  const supplierPerUnit = number(item.Suppliers_Brokers_Commission_Per_Unit__c);
  const calculated = valueOrZero(buyerPerUnit) * financialQuantity(item, stemHasDelivery);
  if (supplierPerUnit !== 0 || buyerPerUnit != null) return calculated;
  return number(item.Commission_Cost__c) ?? calculated;
}

function dashboardFamily(item) {
  const source = `${text(item.Product__r?.Family || item.Product2Id__r?.Family)} ${text(item.Product__r?.Name || item.Product2Id__r?.Name || item.Name || item.Description__c)}`.toUpperCase();
  if (/LSMGO|\bMGO\b|DIESEL|\bDMA\b|\bDMB\b/.test(source)) return 'LSMGO';
  if (source.includes('VLSFO')) return 'VLSFO';
  if (source.includes('HSFO')) return 'HSFO';
  return text(item.Product__r?.Family || item.Product2Id__r?.Family || item.Product__r?.Name || item.Product2Id__r?.Name || item.Name) || 'Other';
}

function productName(item) {
  return text(item.Product__r?.Name || item.Product2Id__r?.Name || item.Name || item.Description__c) || 'Product not set';
}

function addMapAmount(target, key, amount, missingLabel = 'Value not set') {
  const label = text(key) || missingLabel;
  target.set(label, valueOrZero(target.get(label)) + valueOrZero(amount));
}

function mapRows(rows = [], field = 'STEM__c') {
  const result = new Map();
  for (const row of rows) {
    const key = row?.[field];
    if (!key) continue;
    const values = result.get(key) || [];
    values.push(row);
    result.set(key, values);
  }
  return result;
}

function allocationWeights(entries) {
  const revenueTotal = entries.reduce((sum, entry) => sum + Math.abs(entry.directRevenue), 0);
  const costTotal = entries.reduce((sum, entry) => sum + Math.abs(entry.directCost), 0);
  const denominator = revenueTotal > ZERO_TOLERANCE ? revenueTotal : costTotal > ZERO_TOLERANCE ? costTotal : entries.length;
  return entries.map((entry) => ({
    ...entry,
    share: denominator === entries.length
      ? 1 / entries.length
      : (revenueTotal > ZERO_TOLERANCE ? Math.abs(entry.directRevenue) : Math.abs(entry.directCost)) / denominator,
  }));
}

export function allocateSupplierContribution({
  stem,
  lineItems = [],
  extraCosts = [],
  buyerAmount,
  supplierAmount,
  brokerCommissions,
  originalSupplierRelationship = 'Original_Supplier__r',
  extraCostSupplierField = null,
  extraCostSupplierRelationship = null,
}) {
  const stemHasDelivery = Boolean(stem?.Delivery_Date__c);
  const suppliers = new Map();
  const ensure = (accountId, name, clKey) => {
    const key = salesforceIdKey(accountId);
    if (!key) return null;
    const existing = suppliers.get(key) || { accountId, accountKey: key, name: text(name) || 'Supplier name unavailable', clKey: text(clKey), directRevenue: 0, directCost: 0 };
    suppliers.set(key, existing);
    return existing;
  };
  for (const item of lineItems) {
    if (item.Cancelled__c) continue;
    const related = item[originalSupplierRelationship] || {};
    const supplier = ensure(item.Original_Supplier__c, related.Name || item.Supplier_Name__c, related.Company_Code__c);
    if (!supplier) continue;
    supplier.directRevenue += lineSellAmount(item, stemHasDelivery);
    supplier.directCost += lineBuyAmount(item, stemHasDelivery);
  }
  for (const item of extraCosts) {
    if (item.Cancelled__c) continue;
    const related = extraCostSupplierRelationship ? item[extraCostSupplierRelationship] || {} : {};
    const supplier = ensure(extraCostSupplierField ? item[extraCostSupplierField] : null, related.Name || item.Supplier_Name__c, related.Company_Code__c);
    if (!supplier) continue;
    supplier.directRevenue += extraSellAmount(item, stemHasDelivery);
    supplier.directCost += extraBuyAmount(item, stemHasDelivery);
  }
  const weighted = allocationWeights([...suppliers.values()]);
  if (!weighted.length) return [];
  const directRevenueTotal = weighted.reduce((sum, entry) => sum + entry.directRevenue, 0);
  const directCostTotal = weighted.reduce((sum, entry) => sum + entry.directCost, 0);
  const revenueResidual = valueOrZero(buyerAmount) - directRevenueTotal;
  const costResidual = valueOrZero(supplierAmount) - directCostTotal;
  const expectedProfit = valueOrZero(buyerAmount) - valueOrZero(supplierAmount) - valueOrZero(brokerCommissions);
  let allocatedProfit = 0;
  return weighted.map((entry, index) => {
    const allocatedRevenue = entry.directRevenue + (revenueResidual * entry.share);
    const allocatedCost = entry.directCost + (costResidual * entry.share);
    const allocatedBrokerCommissions = valueOrZero(brokerCommissions) * entry.share;
    let grossProfit = allocatedRevenue - allocatedCost - allocatedBrokerCommissions;
    if (index === weighted.length - 1) grossProfit += expectedProfit - (allocatedProfit + grossProfit);
    allocatedProfit += grossProfit;
    return {
      ...entry,
      allocatedRevenue,
      allocatedCost,
      allocatedBrokerCommissions,
      grossProfit,
      grossMarginPct: grossMarginPercent(grossProfit, allocatedRevenue),
    };
  });
}

function stemStatus(stem) {
  return text(stem.Status__c) || (stem.Delivery_Date__c ? 'Delivered' : 'Pending');
}

function isCancelledStem(stem) {
  return /cancel/i.test(stemStatus(stem));
}

function isDisputedStem(stem) {
  const status = text(stem.Dispute_Status__c).toLowerCase();
  return Boolean(stem.Dispute__c === true || (status && !['no dispute', 'no disputes'].includes(status)));
}

function effectiveStemDate(stem) {
  return dateOnly(stem.Delivery_Date__c || stem.Expected_Delivery_Date__c || stem.CreatedDate);
}

function dueDate(stem) {
  return dateOnly(stem.Invoice_Due_Date__c || stem.Buyer_Pay_Term_Date__c || stem.Due_Date__c);
}

function paymentState(invoice) {
  const balance = number(invoice.payableBalance);
  const amount = number(invoice.invoiceAmount);
  if (balance == null || amount == null) return 'Unavailable';
  if (balance <= ZERO_TOLERANCE) return 'Paid';
  if (balance + ZERO_TOLERANCE < amount) return 'Partly paid';
  return 'Unpaid';
}

function topDistribution(entries, total, limit = 10) {
  return [...entries.entries()]
    .map(([label, value]) => ({ label, value, percentage: percentage(value, total) }))
    .sort((left, right) => right.value - left.value || left.label.localeCompare(right.label))
    .slice(0, limit);
}

function groupedMoney(rows, selectors) {
  const grouped = {};
  for (const row of rows) {
    const currency = row.currency || CURRENCY_NOT_SET;
    if (!grouped[currency]) grouped[currency] = Object.fromEntries(selectors.flatMap((selector) => [[selector.key, 0], [`${selector.key}__count`, 0]]));
    for (const selector of selectors) {
      const value = number(selector.value(row));
      if (value == null) continue;
      grouped[currency][selector.key] += value;
      grouped[currency][`${selector.key}__count`] += 1;
    }
  }
  return Object.entries(grouped).map(([currency, values]) => ({
    currency,
    ...Object.fromEntries(selectors.map((selector) => [selector.key, values[`${selector.key}__count`] ? values[selector.key] : null])),
  }));
}

function summarizeCollection(collectionByStem, stemRows, today) {
  const statusCounts = new Map();
  let needsAction = 0;
  let overdueFollowUps = 0;
  let remindersSent = 0;
  let openPromises = 0;
  let missedPromises = 0;
  let unverifiedAdvice = 0;
  let escalations = 0;
  let holds = 0;
  let reconciliationExceptions = 0;
  let lastContact = null;
  for (const row of stemRows) {
    const entry = collectionByStem?.[row.stemId] || {};
    const item = entry.item || null;
    const events = entry.events || [];
    const status = item?.status || 'To Contact';
    statusCounts.set(status, (statusCounts.get(status) || 0) + 1);
    if (status !== 'Paid / Closed') needsAction += 1;
    if (item?.nextFollowUpDate && item.nextFollowUpDate < today && status !== 'Paid / Closed') overdueFollowUps += 1;
    if (status === 'Promise to Pay') {
      openPromises += 1;
      if (item.promisedPaymentDate && item.promisedPaymentDate < today) missedPromises += 1;
    }
    if (status === 'Payment Advice Received' && item?.adviceVerificationDate && item.adviceVerificationDate <= today && row.receivableBalance > ZERO_TOLERANCE) unverifiedAdvice += 1;
    if (status === 'Escalated') escalations += 1;
    if (status === 'On Hold') holds += 1;
    if (item?.reconciliationState && !['not_checked', 'balanced', 'settled'].includes(item.reconciliationState)) reconciliationExceptions += 1;
    for (const event of events) {
      if (/reminder/i.test(event.eventType)) remindersSent += 1;
      if (/contact|reminder|call|note/i.test(event.eventType) && (!lastContact || String(event.createdAt) > lastContact)) lastContact = event.createdAt;
    }
  }
  return {
    statusDistribution: [...statusCounts.entries()].map(([label, value]) => ({ label, value })),
    needsAction,
    overdueFollowUps,
    remindersSent,
    lastContact,
    openPromises,
    missedPromises,
    unverifiedPaymentAdvice: unverifiedAdvice,
    escalations,
    holds,
    reconciliationExceptions,
  };
}

function summarizeDisputes(workflows = {}, stemRows = [], accountId, role, today) {
  const scopeIds = new Set(stemRows.map((row) => row.stemId));
  const accountKey = salesforceIdKey(accountId);
  const parties = (workflows.parties || []).filter((row) => scopeIds.has(row.stem_id));
  const partyIds = new Set(parties.filter((party) => {
    if (role === 'group') return true;
    return salesforceIdKey(party.account_id) === accountKey;
  }).map((party) => party.id));
  const relevantCaseIds = new Set(parties.filter((party) => role === 'group' || partyIds.has(party.id)).map((party) => party.case_id));
  const cases = (workflows.cases || []).filter((row) => scopeIds.has(row.stem_id) && (role === 'group' || relevantCaseIds.has(row.id)));
  const actions = (workflows.actions || []).filter((row) => scopeIds.has(row.stem_id) && (role === 'group' || partyIds.has(row.party_id)));
  const instructions = (workflows.instructions || []).filter((row) => scopeIds.has(row.stem_id) && (role === 'group' || partyIds.has(row.party_id)));
  const openCases = cases.filter((row) => !/closed|cancelled/i.test(text(row.workflow_status || row.stage || row.status)));
  const disputeAges = openCases.map((row) => daysBetween(today, row.submitted_at || row.created_at)).filter((value) => value != null);
  const outcomes = new Map();
  for (const action of actions) {
    const label = text(action.close_reason || action.action_label || action.action_type) || 'Closure reason not set';
    outcomes.set(label, (outcomes.get(label) || 0) + 1);
  }
  const instructionAmounts = groupedMoney(instructions.map((row) => ({
    ...row,
    currency: text(row.currency_iso_code) || CURRENCY_NOT_SET,
  })), [
    { key: 'holdAmount', value: (row) => row.instruction_type === 'withhold_unpaid' ? row.planned_amount : 0 },
    { key: 'getBackAmount', value: (row) => row.instruction_type === 'get_back_paid' ? row.planned_amount : 0 },
  ]);
  const stemCurrencies = new Map(stemRows.map((row) => [row.stemId, row.currency || CURRENCY_NOT_SET]));
  const actionAmounts = groupedMoney(actions.map((row) => ({ ...row, currency: stemCurrencies.get(row.stem_id) || CURRENCY_NOT_SET })), [
    { key: 'commercialAmount', value: (row) => row.amount },
    { key: 'settlementAmount', value: (row) => row.settlement_amount },
  ]);
  return {
    open: openCases.length,
    closed: Math.max(0, cases.length - openCases.length),
    commercialAmount: actionAmounts.length === 1 ? actionAmounts[0].commercialAmount : null,
    settlementAmount: actionAmounts.length === 1 ? actionAmounts[0].settlementAmount : null,
    actionAmounts,
    averageOpenAgeDays: disputeAges.length ? disputeAges.reduce((sum, value) => sum + value, 0) / disputeAges.length : null,
    accountingStages: [...new Set(actions.map((row) => text(row.execution_status)).filter(Boolean))],
    closureOutcomes: [...outcomes.entries()].map(([label, value]) => ({ label, value })),
    openInstructions: instructions.filter((row) => !['settled', 'not required', 'superseded'].includes(text(row.status).toLowerCase().replace(/_/g, ' '))).length,
    instructionAmounts,
    holdAmount: instructionAmounts.length === 1 ? instructionAmounts[0].holdAmount : null,
    getBackAmount: instructionAmounts.length === 1 ? instructionAmounts[0].getBackAmount : null,
  };
}

function summarizeCompensation(compensation = {}, accountIds = [], today) {
  const keys = new Set(accountIds.map(salesforceIdKey).filter(Boolean));
  const accounts = (compensation.accounts || compensation.rows || []).filter((row) => keys.has(salesforceIdKey(row.accountId || row.account_id || row.id)));
  const currencyRows = accounts.flatMap((account) => (account.currencyTotals || []).map((row) => ({
    currency: row.currencyIsoCode || CURRENCY_NOT_SET,
    agreedAmount: row.agreedAmount,
    recoveredAmount: row.recoveredAmount,
    outstandingAmount: row.outstandingAmount,
    overdueAmount: account.nextDeadline && account.nextDeadline < today ? row.outstandingAmount : 0,
    nextDeadline: account.nextDeadline || null,
  })));
  return groupedMoney(currencyRows.length ? currencyRows : accounts, [
    { key: 'agreed', value: (row) => row.agreedAmount ?? row.agreed_amount },
    { key: 'recovered', value: (row) => row.recoveredAmount ?? row.recovered_amount },
    { key: 'outstanding', value: (row) => row.outstandingAmount ?? row.outstanding_amount },
    { key: 'overdue', value: (row) => row.overdueAmount ?? ((row.nextDeadline || row.next_deadline) < today ? row.outstandingAmount ?? row.outstanding_amount : 0) },
  ]);
}

function trendKey(date, yearly) {
  const token = dateOnly(date);
  if (!token) return null;
  return yearly ? token.slice(0, 4) : token.slice(0, 7);
}

function summarizeRows(rows, { today, allHistory = false } = {}) {
  const financialRows = rows.filter((row) => !row.cancelled);
  const datedRows = rows.filter((row) => row.effectiveDate);
  const spanDays = datedRows.length ? daysBetween(datedRows.map((row) => row.effectiveDate).sort().at(-1), datedRows.map((row) => row.effectiveDate).sort()[0]) : 0;
  const yearly = allHistory && spanDays > 730;
  const trend = new Map();
  const currencyTrends = new Map();
  const products = new Map();
  const families = new Map();
  const ports = new Map();
  const countries = new Map();
  const vessels = new Map();
  const priceGroups = new Map();
  for (const row of financialRows) {
    const key = trendKey(row.effectiveDate, yearly);
    if (key) {
      const bucket = trend.get(key) || { period: key, stems: 0, volumeMt: 0, turnover: 0, spend: 0, grossProfit: 0 };
      bucket.stems += 1;
      bucket.volumeMt += valueOrZero(row.volumeMt);
      bucket.turnover += valueOrZero(row.turnover);
      bucket.spend += valueOrZero(row.spend);
      bucket.grossProfit += valueOrZero(row.grossProfit);
      trend.set(key, bucket);
      const currency = row.currency || CURRENCY_NOT_SET;
      const byPeriod = currencyTrends.get(currency) || new Map();
      const currencyBucket = byPeriod.get(key) || { period: key, stems: 0, volumeMt: 0, turnover: 0, spend: 0, grossProfit: 0 };
      currencyBucket.stems += 1;
      currencyBucket.volumeMt += valueOrZero(row.volumeMt);
      currencyBucket.turnover += valueOrZero(row.turnover);
      currencyBucket.spend += valueOrZero(row.spend);
      currencyBucket.grossProfit += valueOrZero(row.grossProfit);
      byPeriod.set(key, currencyBucket);
      currencyTrends.set(currency, byPeriod);
    }
    for (const item of row.products || []) addMapAmount(products, item.name, item.volumeMt);
    for (const item of row.products || []) addMapAmount(families, item.family, item.volumeMt);
    for (const item of row.products || []) {
      if (item.nativeQuantity <= 0 || (item.sellPrice == null && item.buyPrice == null)) continue;
      const period = row.effectiveDate?.slice(0, 7) || 'Date not set';
      const groupKey = [item.name, item.originalUom || 'UOM not set', row.currency, row.portName || 'Port not set', period].join('\u0000');
      const priceGroup = priceGroups.get(groupKey) || {
        product: item.name,
        unitOfMeasure: item.originalUom || 'UOM not set',
        currency: row.currency,
        port: row.portName || 'Port not set',
        period,
        quantity: 0,
        sellValue: 0,
        sellQuantity: 0,
        buyValue: 0,
        buyQuantity: 0,
      };
      priceGroup.quantity += item.nativeQuantity;
      if (item.sellPrice != null) {
        priceGroup.sellValue += item.sellPrice * item.nativeQuantity;
        priceGroup.sellQuantity += item.nativeQuantity;
      }
      if (item.buyPrice != null) {
        priceGroup.buyValue += item.buyPrice * item.nativeQuantity;
        priceGroup.buyQuantity += item.nativeQuantity;
      }
      priceGroups.set(groupKey, priceGroup);
    }
    if (row.portName) addMapAmount(ports, row.portName, row.volumeMt || 1);
    if (row.portCountry) addMapAmount(countries, row.portCountry, row.volumeMt || 1);
    if (row.vesselName) addMapAmount(vessels, row.vesselName, row.volumeMt || 1);
  }
  const totalVolume = financialRows.reduce((sum, row) => sum + valueOrZero(row.volumeMt), 0);
  const totalActivity = totalVolume || financialRows.length;
  const vesselCounts = new Map();
  for (const row of financialRows) if (row.vesselName) vesselCounts.set(row.vesselName, (vesselCounts.get(row.vesselName) || 0) + 1);
  const repeatedVesselRows = financialRows.filter((row) => row.vesselName && (vesselCounts.get(row.vesselName) || 0) > 1).length;
  const months = new Set(rows.map((row) => row.effectiveDate?.slice(0, 7)).filter(Boolean));
  const sortedDates = rows.map((row) => row.effectiveDate).filter(Boolean).sort();
  const calendarMonthCount = sortedDates.length ? inclusiveMonthCount(sortedDates[0], sortedDates.at(-1)) : null;
  const grossProfits = financialRows.map((row) => row.grossProfit).filter((value) => number(value) != null);
  const profitable = grossProfits.filter((value) => value > ZERO_TOLERANCE).length;
  const lossMaking = grossProfits.filter((value) => value < -ZERO_TOLERANCE).length;
  const breakeven = grossProfits.length - profitable - lossMaking;
  const moneyByCurrency = groupedMoney(financialRows, [
    { key: 'turnover', value: (row) => row.turnover },
    { key: 'supplierSpend', value: (row) => row.spend },
    { key: 'grossProfit', value: (row) => row.grossProfit },
    { key: 'totalLosses', value: (row) => number(row.grossProfit) < 0 ? row.grossProfit : 0 },
    { key: 'brokerCommissions', value: (row) => row.brokerCommissions },
    { key: 'extraCosts', value: (row) => row.extraCostAmount },
    { key: 'uninvoicedCost', value: (row) => row.uninvoicedCost },
    { key: 'invoicedTurnover', value: (row) => row.invoiceValueSource === 'invoiced' ? row.turnover : 0 },
    { key: 'estimatedTurnover', value: (row) => row.invoiceValueSource === 'estimated' ? row.turnover : 0 },
  ]).map((row) => ({ ...row, grossMarginPct: grossMarginPercent(row.grossProfit, row.turnover) }));
  const singleCurrency = moneyByCurrency.length === 1 ? moneyByCurrency[0] : null;
  const turnover = singleCurrency?.turnover ?? null;
  const spend = singleCurrency?.supplierSpend ?? null;
  const grossProfitTotal = singleCurrency?.grossProfit ?? null;
  const comparableTrend = moneyByCurrency.length <= 1 ? [...trend.values()] : [];
  const deliveredVolumeRows = financialRows.filter((row) => row.deliveryDate);
  const orderedVolumeMt = deliveredVolumeRows.reduce((sum, row) => sum + valueOrZero(row.orderedVolumeMt), 0);
  const deliveredVolumeMt = deliveredVolumeRows.reduce((sum, row) => sum + valueOrZero(row.deliveredVolumeMt), 0);
  const sortedTrend = [...trend.values()].sort((left, right) => left.period.localeCompare(right.period));
  const peakPeriod = [...sortedTrend].sort((left, right) => right.volumeMt - left.volumeMt || left.period.localeCompare(right.period))[0] || null;
  const topProducts = topDistribution(products, totalVolume);
  const topPorts = topDistribution(ports, totalActivity);
  return {
    stemCount: rows.length,
    deliveredStems: rows.filter((row) => row.deliveryDate && !row.cancelled).length,
    pendingStems: rows.filter((row) => !row.deliveryDate && !row.cancelled).length,
    cancelledStems: rows.filter((row) => row.cancelled).length,
    disputedStems: rows.filter((row) => row.disputed).length,
    cancellationRatePct: percentage(rows.filter((row) => row.cancelled).length, rows.length),
    disputeRatePct: percentage(rows.filter((row) => row.disputed).length, rows.length),
    firstStemDate: sortedDates[0] || null,
    lastStemDate: sortedDates.at(-1) || null,
    relationshipAgeDays: sortedDates.length ? daysBetween(today, sortedDates[0]) : null,
    daysSinceLastActivity: sortedDates.length ? daysBetween(today, sortedDates.at(-1)) : null,
    activeMonths: months.size,
    inactiveMonths: calendarMonthCount == null ? null : Math.max(0, calendarMonthCount - months.size),
    averageStemsPerActiveMonth: months.size ? rows.length / months.size : null,
    peakPeriod,
    totalVolumeMt: totalVolume,
    averageVolumeMt: financialRows.length ? totalVolume / financialRows.length : null,
    medianVolumeMt: median(financialRows.map((row) => row.volumeMt)),
    orderedVolumeMt,
    deliveredVolumeMt,
    quantityVarianceMt: deliveredVolumeMt - orderedVolumeMt,
    underDeliveryRatePct: percentage(deliveredVolumeRows.filter((row) => valueOrZero(row.deliveredVolumeMt) + ZERO_TOLERANCE < valueOrZero(row.orderedVolumeMt)).length, deliveredVolumeRows.length),
    turnover,
    supplierSpend: spend,
    moneyByCurrency,
    multipleCurrencies: moneyByCurrency.length > 1,
    averageStemValue: singleCurrency && financialRows.length ? (singleCurrency.turnover || singleCurrency.supplierSpend) / financialRows.length : null,
    medianStemValue: moneyByCurrency.length <= 1 ? median(financialRows.map((row) => row.turnover || row.spend)) : null,
    grossProfit: grossProfitTotal,
    grossMarginPct: singleCurrency?.grossMarginPct ?? null,
    brokerCommissionPct: singleCurrency ? percentage(singleCurrency.brokerCommissions, singleCurrency.turnover) : null,
    extraCostSharePct: singleCurrency ? percentage(singleCurrency.extraCosts, singleCurrency.turnover) : null,
    gpPerStem: grossProfitTotal != null && financialRows.length ? grossProfitTotal / financialRows.length : null,
    gpPerMt: grossProfitTotal != null && totalVolume ? grossProfitTotal / totalVolume : null,
    profitableStems: profitable,
    breakevenStems: breakeven,
    lossMakingStems: lossMaking,
    lossRatePct: percentage(lossMaking, grossProfits.length),
    totalLosses: moneyByCurrency.length <= 1 ? grossProfits.filter((value) => value < 0).reduce((sum, value) => sum + value, 0) : null,
    bestStem: moneyByCurrency.length <= 1 ? [...financialRows].sort((left, right) => valueOrZero(right.grossProfit) - valueOrZero(left.grossProfit))[0] || null : null,
    worstStem: moneyByCurrency.length <= 1 ? [...financialRows].sort((left, right) => valueOrZero(left.grossProfit) - valueOrZero(right.grossProfit))[0] || null : null,
    profitVolatility: moneyByCurrency.length <= 1 ? standardDeviation(comparableTrend.map((row) => row.grossProfit)) : null,
    negativePeriods: moneyByCurrency.length <= 1 ? comparableTrend.filter((row) => row.grossProfit < -ZERO_TOLERANCE).length : null,
    repeatVesselRatePct: percentage(repeatedVesselRows, financialRows.filter((row) => row.vesselName).length),
    distinctProducts: products.size,
    distinctProductFamilies: families.size,
    distinctPorts: ports.size,
    distinctCountries: countries.size,
    distinctVessels: vessels.size,
    distinctCurrencies: moneyByCurrency.length,
    distinctPaymentTerms: unique(rows.flatMap((row) => row.paymentTerms || [])).length,
    distinctTradingTypes: unique(rows.map((row) => row.tradingType)).length,
    distinctBrokers: unique(rows.flatMap((row) => row.brokerNames || [])).length,
    hedgedStems: financialRows.filter((row) => row.hedgeLinked).length,
    hedgeCoveragePct: percentage(financialRows.filter((row) => row.hedgeLinked).length, financialRows.length),
    topProducts,
    productMix: topDistribution(families, totalVolume),
    topPorts,
    topCountries: topDistribution(countries, totalActivity),
    topVessels: topDistribution(vessels, totalActivity),
    topOneProductConcentrationPct: topProducts[0]?.percentage ?? null,
    topThreeProductConcentrationPct: topProducts.slice(0, 3).reduce((sum, row) => sum + valueOrZero(row.percentage), 0) || null,
    topOnePortConcentrationPct: topPorts[0]?.percentage ?? null,
    topThreePortConcentrationPct: topPorts.slice(0, 3).reduce((sum, row) => sum + valueOrZero(row.percentage), 0) || null,
    averagePrices: [...priceGroups.values()].map((row) => ({
      product: row.product,
      unitOfMeasure: row.unitOfMeasure,
      currency: row.currency,
      port: row.port,
      period: row.period,
      quantity: row.quantity,
      averageSellPrice: row.sellQuantity ? row.sellValue / row.sellQuantity : null,
      averageBuyPrice: row.buyQuantity ? row.buyValue / row.buyQuantity : null,
    })).sort((left, right) => right.period.localeCompare(left.period) || left.product.localeCompare(right.product)).slice(0, 100),
    trend: sortedTrend.map((row) => ({
      ...row,
      grossProfit: moneyByCurrency.length <= 1 ? row.grossProfit : null,
      turnover: moneyByCurrency.length <= 1 ? row.turnover : null,
      spend: moneyByCurrency.length <= 1 ? row.spend : null,
      grossMarginPct: moneyByCurrency.length <= 1 ? grossMarginPercent(row.grossProfit, row.turnover) : null,
    })),
    currencyTrends: [...currencyTrends.entries()].map(([currency, byPeriod]) => ({
      currency,
      rows: [...byPeriod.values()].sort((left, right) => left.period.localeCompare(right.period)).map((row) => ({
        ...row,
        grossMarginPct: grossMarginPercent(row.grossProfit, row.turnover),
      })),
    })),
    trendGranularity: yearly ? 'year' : 'month',
  };
}

function buyerPaymentMetrics(stemRows, buyerPaymentsByStem = {}, today) {
  const delays = [];
  let weightedDsoDays = 0;
  let weightedDsoAmount = 0;
  let paymentCount = 0;
  let latestPayment = null;
  let onTimeCount = 0;
  let comparablePayments = 0;
  const cia = { fullCount: 0, partialCount: 0, partialPaymentCount: 0, fullPaymentCount: 0 };
  const ciaByCurrency = new Map();
  for (const row of stemRows) {
    const payments = buyerPaymentsByStem[row.stemId] || [];
    for (const payment of payments) {
      paymentCount += 1;
      if (!latestPayment || String(payment.paymentDate) > String(latestPayment.paymentDate)) latestPayment = payment;
      const delay = daysBetween(payment.paymentDate, row.dueDate);
      if (delay != null) {
        delays.push(delay);
        comparablePayments += 1;
        if (delay <= 0) onTimeCount += 1;
      }
      const dso = daysBetween(payment.paymentDate, row.invoiceDate);
      if (dso != null && dso >= 0) {
        weightedDsoDays += dso * Math.abs(valueOrZero(payment.amount));
        weightedDsoAmount += Math.abs(valueOrZero(payment.amount));
      }
    }
    const full = number(row.receivableBalance) != null && row.receivableBalance <= ZERO_TOLERANCE;
    const currencyCia = ciaByCurrency.get(row.currency) || { currency: row.currency, fullValue: 0, partialValue: 0, partialPaymentValue: 0 };
    const evidence = summarizeBuyerPaymentEvidence({
      payments,
      etaStartDate: row.etaStartDate,
      etaEndDate: row.etaEndDate,
      deliveryDate: row.actualDeliveryDate,
      isFullyPaid: full,
    });
    for (const payment of evidence.payments) {
      if (payment.evidence.code === 'full_cia') {
        cia.fullCount += 1;
        currencyCia.fullValue += valueOrZero(payment.amount);
      } else if (payment.evidence.code === 'partial_cia') {
        cia.partialCount += 1;
        currencyCia.partialValue += valueOrZero(payment.amount);
      } else if (payment.evidence.code === 'full_payment') {
        cia.fullPaymentCount += 1;
      } else {
        cia.partialPaymentCount += 1;
        currencyCia.partialPaymentValue += valueOrZero(payment.amount);
      }
    }
    ciaByCurrency.set(row.currency, currencyCia);
  }
  const receivableRows = stemRows.map((row) => ({
    ...row,
    overdueDays: row.dueDate && row.dueDate < today && row.receivableBalance > ZERO_TOLERANCE ? daysBetween(today, row.dueDate) : 0,
  }));
  const agingByCurrency = new Map();
  for (const row of receivableRows) {
    const aging = agingByCurrency.get(row.currency) || { currency: row.currency, days1to7: 0, days8to30: 0, days31to60: 0, days61to90: 0, over90: 0 };
    if (!(row.overdueDays > 0) || !(row.receivableBalance > ZERO_TOLERANCE)) {
      agingByCurrency.set(row.currency, aging);
      continue;
    }
    if (row.overdueDays <= 7) aging.days1to7 += row.receivableBalance;
    else if (row.overdueDays <= 30) aging.days8to30 += row.receivableBalance;
    else if (row.overdueDays <= 60) aging.days31to60 += row.receivableBalance;
    else if (row.overdueDays <= 90) aging.days61to90 += row.receivableBalance;
    else if (row.overdueDays > 90) aging.over90 += row.receivableBalance;
    agingByCurrency.set(row.currency, aging);
  }
  return {
    byCurrency: groupedMoney(stemRows, [
      { key: 'invoiceAmount', value: (row) => row.invoiceAmount },
      { key: 'paymentsReceived', value: (row) => (buyerPaymentsByStem[row.stemId] || []).reduce((sum, payment) => sum + valueOrZero(payment.amount), 0) },
      { key: 'receivable', value: (row) => row.receivableBalance },
      { key: 'overdue', value: (row) => (row.dueDate && row.dueDate < today ? Math.max(0, valueOrZero(row.receivableBalance)) : 0) },
      { key: 'notYetDue', value: (row) => (!row.dueDate || row.dueDate >= today ? Math.max(0, valueOrZero(row.receivableBalance)) : 0) },
      { key: 'dueToday', value: (row) => (row.dueDate === today ? Math.max(0, valueOrZero(row.receivableBalance)) : 0) },
      { key: 'dueWithin7Days', value: (row) => {
        const days = daysBetween(row.dueDate, today);
        return days != null && days >= 0 && days <= 7 ? Math.max(0, valueOrZero(row.receivableBalance)) : 0;
      } },
      { key: 'dueWithin30Days', value: (row) => {
        const days = daysBetween(row.dueDate, today);
        return days != null && days >= 0 && days <= 30 ? Math.max(0, valueOrZero(row.receivableBalance)) : 0;
      } },
    ]).map((row) => ({ ...row, collectionPercentagePct: percentage(valueOrZero(row.invoiceAmount) - valueOrZero(row.receivable), row.invoiceAmount) })),
    agingByCurrency: [...agingByCurrency.values()],
    paymentCount,
    latestPayment,
    weightedDso: weightedDsoAmount ? weightedDsoDays / weightedDsoAmount : null,
    averagePaymentDelayDays: delays.length ? delays.reduce((sum, value) => sum + value, 0) / delays.length : null,
    medianPaymentDelayDays: median(delays),
    maximumPaymentDelayDays: delays.length ? Math.max(...delays) : null,
    onTimePaymentRatePct: percentage(onTimeCount, comparablePayments),
    cia: { ...cia, byCurrency: [...ciaByCurrency.values()] },
  };
}

function supplierPaymentMetrics(invoices = [], today) {
  const rows = invoices.map((invoice) => ({
    ...invoice,
    currency: invoice.currency || CURRENCY_NOT_SET,
    paymentState: paymentState(invoice),
  }));
  const states = { unpaid: 0, partlyPaid: 0, paid: 0 };
  const paymentDelays = [];
  let onTimePayments = 0;
  let comparablePayments = 0;
  for (const row of rows) {
    if (row.paymentState === 'Paid') states.paid += 1;
    else if (row.paymentState === 'Partly paid') states.partlyPaid += 1;
    else if (row.paymentState === 'Unpaid') states.unpaid += 1;
    const latestInvoicePayment = [...(row.payments || [])].sort((left, right) => String(right.date || '').localeCompare(String(left.date || '')))[0];
    const delay = latestInvoicePayment ? daysBetween(latestInvoicePayment.date, row.dueDate) : null;
    if (delay != null) {
      paymentDelays.push(delay);
      comparablePayments += 1;
      if (delay <= 0) onTimePayments += 1;
    }
  }
  return {
    rows,
    states,
    byCurrency: groupedMoney(rows, [
      { key: 'invoiceAmount', value: (row) => row.invoiceAmount },
      { key: 'paidAmount', value: (row) => number(row.invoiceAmount) == null || number(row.payableBalance) == null ? null : Math.max(0, row.invoiceAmount - row.payableBalance) },
      { key: 'outstandingPayable', value: (row) => row.payableBalance },
      { key: 'overduePayable', value: (row) => (row.dueDate && row.dueDate < today ? Math.max(0, valueOrZero(row.payableBalance)) : 0) },
      { key: 'dueWithin7Days', value: (row) => {
        const days = daysBetween(row.dueDate, today);
        return days != null && days >= 0 && days <= 7 ? Math.max(0, valueOrZero(row.payableBalance)) : 0;
      } },
      { key: 'dueWithin30Days', value: (row) => {
        const days = daysBetween(row.dueDate, today);
        return days != null && days >= 0 && days <= 30 ? Math.max(0, valueOrZero(row.payableBalance)) : 0;
      } },
    ]).map((row) => ({ ...row, paymentCompletionPct: percentage(row.paidAmount, row.invoiceAmount) })),
    completionRatePct: percentage(states.paid, rows.length),
    latestPayment: rows.flatMap((row) => row.payments || []).sort((left, right) => String(right.date || '').localeCompare(String(left.date || '')))[0] || null,
    averagePaymentDelayDays: paymentDelays.length ? paymentDelays.reduce((sum, value) => sum + value, 0) / paymentDelays.length : null,
    onTimePaymentRatePct: percentage(onTimePayments, comparablePayments),
    paymentTerms: unique(rows.map((row) => row.paymentTerm)).map((label) => ({ label, value: rows.filter((row) => row.paymentTerm === label).length })),
  };
}

function buildStemFinancialRow(stem, context) {
  const lineItems = context.lineItemsByStem.get(stem.Id) || [];
  const extraCosts = context.extraCostsByStem.get(stem.Id) || [];
  const buyerBrokers = context.buyerBrokersByStem.get(stem.Id) || [];
  const stemHasDelivery = Boolean(stem.Delivery_Date__c);
  const activeLines = lineItems.filter((item) => !item.Cancelled__c);
  const activeExtraCosts = extraCosts.filter((item) => !item.Cancelled__c);
  const lineSell = activeLines.reduce((sum, item) => sum + lineSellAmount(item, stemHasDelivery), 0);
  const lineBuy = activeLines.reduce((sum, item) => sum + lineBuyAmount(item, stemHasDelivery), 0);
  const extraSell = activeExtraCosts.reduce((sum, item) => sum + extraSellAmount(item, stemHasDelivery), 0);
  const extraBuy = activeExtraCosts.reduce((sum, item) => sum + extraBuyAmount(item, stemHasDelivery), 0);
  const uninvoicedExtraBuy = activeExtraCosts.filter((item) => !item.Supplier_Invoice__c).reduce((sum, item) => sum + extraBuyAmount(item, stemHasDelivery), 0);
  const invoicedExtraBuy = activeExtraCosts.filter((item) => item.Supplier_Invoice__c).reduce((sum, item) => sum + extraBuyAmount(item, stemHasDelivery), 0);
  const sellOnlyUninvoicedExtra = activeExtraCosts.filter((item) => !item.Supplier_Invoice__c && Math.abs(extraBuyAmount(item, stemHasDelivery)) <= ZERO_TOLERANCE).reduce((sum, item) => sum + extraSellAmount(item, stemHasDelivery), 0);
  const salesforceBuyerAmount = number(stem.Total_Invoice_Amount__c);
  const estimatedBuyerAmount = lineSell + extraSell;
  const finalInvoiceIssued = context.buyerInvoiceStateKnown
    ? context.finalBuyerInvoiceStemIds.has(stem.Id)
    : salesforceBuyerAmount != null && Math.abs(salesforceBuyerAmount) > ZERO_TOLERANCE;
  const buyerResolution = resolveBuyerFinancialAmount({
    salesforceAmount: salesforceBuyerAmount,
    calculatedAmount: estimatedBuyerAmount,
    finalInvoiceIssued,
  });
  const buyer = buyerResolution.amount;
  const invoicedSupplier = number(stem.Total_Invoiced_Amount_From_Suppliers__c) ?? 0;
  const hasSupplierInvoice = activeLines.some((item) => item.Supplier_Invoice__c);
  const uninvoicedLineBuy = activeLines.filter((item) => !item.Supplier_Invoice__c).reduce((sum, item) => sum + lineBuyAmount(item, stemHasDelivery), 0);
  const qlikSupplierCost = stem.QLIK_STEM_Line_Item_Total_Cost__c != null || stem.QLIK_Costs_Total_Cost__c != null
    ? valueOrZero(stem.QLIK_STEM_Line_Item_Total_Cost__c) + valueOrZero(stem.QLIK_Costs_Total_Cost__c)
    : null;
  const supplier = decisionDashboardSupplierAmount({
    invoicedSupplierAmount: invoicedSupplier,
    lineBuyAmount: lineBuy,
    uninvoicedLineBuyAmount: uninvoicedLineBuy,
    hasSupplierInvoice,
    uninvoicedExtraBuyAmount: uninvoicedExtraBuy,
    invoicedExtraBuyAmount: invoicedExtraBuy,
    sellOnlyUninvoicedExtraSellAmount: sellOnlyUninvoicedExtra,
    qlikSupplierCost,
  });
  const brokerCommissions = activeLines.reduce((sum, item) => {
    return sum + buyerBrokerCommission(item, stemHasDelivery) + supplierBrokerCommission(item, stemHasDelivery);
  }, 0) + buyerBrokers.reduce((sum, item) => sum + valueOrZero(item._Commission_Amount), 0);
  const stemGrossProfit = buyer == null ? null : buyer - valueOrZero(supplier) - brokerCommissions;
  const allocations = allocateSupplierContribution({
    stem,
    lineItems,
    extraCosts,
    buyerAmount: buyer,
    supplierAmount: supplier,
    brokerCommissions,
    originalSupplierRelationship: context.originalSupplierRelationship,
    extraCostSupplierField: context.extraCostSupplierField,
    extraCostSupplierRelationship: context.extraCostSupplierRelationship,
  });
  const requestedAllocation = allocations.find((allocation) => allocation.accountKey === context.accountKey) || null;
  const role = context.role;
  const products = [];
  let volumeMt = 0;
  let orderedVolumeMt = 0;
  let deliveredVolumeMt = 0;
  let uninvoicedCost = 0;
  for (const item of activeLines) {
    const itemAccountKey = salesforceIdKey(item.Original_Supplier__c);
    if (role === 'supplier' && itemAccountKey !== context.accountKey) continue;
    const family = dashboardFamily(item);
    const volume = dashboardLineItemVolume(item, stemHasDelivery, {
      lineItemUomField: context.lineItemUomField,
      productUomField: context.productUomField,
      fallbackQuantity: financialQuantity(item, stemHasDelivery),
      productFamily: family,
    });
    volumeMt += valueOrZero(volume.quantity);
    const orderedVolume = dashboardLineItemVolume(item, false, {
      lineItemUomField: context.lineItemUomField,
      productUomField: context.productUomField,
      fallbackQuantity: financialQuantity(item, false),
      productFamily: family,
    });
    const deliveredVolume = item.Quantity_Delivered_Per_BDN__c == null ? null : dashboardLineItemVolume(item, true, {
      lineItemUomField: context.lineItemUomField,
      productUomField: context.productUomField,
      fallbackQuantity: item.Quantity_Delivered_Per_BDN__c,
      productFamily: family,
    });
    orderedVolumeMt += valueOrZero(orderedVolume.quantity);
    deliveredVolumeMt += valueOrZero(deliveredVolume?.quantity);
    if (!item.Supplier_Invoice__c) uninvoicedCost += lineBuyAmount(item, stemHasDelivery);
    products.push({
      name: productName(item),
      family,
      volumeMt: valueOrZero(volume.quantity),
      unitOfMeasure: volume.unitOfMeasure,
      originalUom: resolveDashboardItemUom(item, { lineItemUomField: context.lineItemUomField, productUomField: context.productUomField }) || 'UOM not set',
      nativeQuantity: financialQuantity(item, stemHasDelivery),
      sellPrice: firstNumber(item.Price_Per_Unit__c, item.Unit_Sell_At__c, item.Offer_Line_Item__r?.UnitPrice),
      buyPrice: firstNumber(item.Cost_Per_Unit__c, item.Unit_Buy_At__c, item.Unit_Cost__c, item.Offer_Line_Item__r?.Supplier_Unit_Price__c),
    });
  }
  const roleExtraCosts = activeExtraCosts.filter((item) => role !== 'supplier' || salesforceIdKey(context.extraCostSupplierField ? item[context.extraCostSupplierField] : null) === context.accountKey);
  for (const item of roleExtraCosts) if (!item.Supplier_Invoice__c) uninvoicedCost += extraBuyAmount(item, stemHasDelivery);
  const turnover = role === 'supplier' ? requestedAllocation?.allocatedRevenue ?? 0 : buyer;
  const spend = role === 'supplier' ? requestedAllocation?.allocatedCost ?? 0 : supplier;
  const grossProfit = role === 'supplier' ? requestedAllocation?.grossProfit ?? 0 : stemGrossProfit;
  const account = stem.Account__r || {};
  const port = stem.Port__r || {};
  const brokerNames = unique([
    ...activeLines.flatMap((item) => [item.Supplier_Broker__r?.Name, item.Buyers_Broker__r?.Name]),
    ...buyerBrokers.flatMap((item) => [item.Buyer_Broker__r?.Name, item._Buyer_Broker_Name]),
  ]);
  const paymentReliability = paymentDataReliabilityState(stem);
  return {
    stemId: stem.Id,
    stemName: stem.KeyStem__c || stem.Name,
    displayName: [stem.KeyStem__c || stem.Name, stem.Vessel__r?.Name, port.Name].filter(Boolean).join(' · '),
    buyerAccountId: stem.Account__c || null,
    buyerName: account.Name || stem.Buyer_Name__c || null,
    buyerClKey: account.Company_Code__c || null,
    buyerGroupName: account.Parent?.Name || account.Group_Name__c || null,
    buyerGroupClKey: account.Parent?.Company_Code__c || null,
    deliveryDate: dateOnly(stem.Delivery_Date__c),
    actualDeliveryDate: dateOnly(stem.Delivery_Date__c),
    expectedDeliveryDate: dateOnly(stem.Expected_Delivery_Date__c),
    etaStartDate: dateOnly(stem.ETA_Start_Date__c || stem.Expected_Delivery_Date__c),
    etaEndDate: dateOnly(stem.ETA_End_Date__c),
    earliestEtaDate: earliestEtaDate(stem.ETA_Start_Date__c || stem.Expected_Delivery_Date__c, stem.ETA_End_Date__c),
    effectiveDate: effectiveStemDate(stem),
    dueDate: dueDate(stem),
    invoiceDate: dateOnly(stem.Original_Invoice_Sent_Date__c),
    createdDate: dateOnly(stem.CreatedDate),
    paymentDataReliable: paymentReliability.reliable,
    paymentReliabilityDate: paymentReliability.effectiveDate,
    paymentReliabilityBasis: paymentReliability.dateBasis,
    paymentDataReliability: paymentReliability.reliable ? null : LEGACY_PAYMENT_DATA_LABEL,
    status: stemStatus(stem),
    cancelled: isCancelledStem(stem),
    disputed: isDisputedStem(stem),
    disputeStatus: text(stem.Dispute_Status__c) || null,
    currency: currencyOf(stem),
    tradingType: text(stem.Type__c) || null,
    paymentTerms: unique([stem.Payment_Term__c, ...activeLines.map((item) => item.Payment_Term__c)]),
    brokerNames,
    portName: port.Name || null,
    portCountry: port.Country__c || null,
    vesselName: stem.Vessel__r?.Name || null,
    products,
    extraCosts: activeExtraCosts.map((item) => productName(item)),
    volumeMt,
    orderedVolumeMt,
    deliveredVolumeMt,
    quantityVarianceMt: stemHasDelivery || deliveredVolumeMt > 0 ? deliveredVolumeMt - orderedVolumeMt : null,
    invoiceAmount: buyer,
    invoiceValueSource: buyerResolution.source === 'issued_invoice'
      ? 'invoiced'
      : buyerResolution.source === 'calculated_unissued'
        ? 'estimated'
        : 'unavailable',
    receivableBalance: number(stem.Receivable_Balance__c),
    turnover: number(turnover),
    spend: number(spend),
    buyerAmountSource: buyerResolution.source,
    buyerInvoiceIssued: finalInvoiceIssued,
    grossProfit: grossProfit == null ? null : grossProfit,
    grossMarginPct: grossMarginPercent(grossProfit, turnover),
    brokerCommissions,
    extraCostAmount: role === 'supplier' ? roleExtraCosts.reduce((sum, item) => sum + extraBuyAmount(item, stemHasDelivery), 0) : extraBuy,
    uninvoicedCost,
    supplierAllocation: requestedAllocation,
    supplierCount: allocations.length,
    cancelledLineCount: lineItems.filter((item) => item.Cancelled__c).length,
    cancelledExtraCostCount: extraCosts.filter((item) => item.Cancelled__c).length,
    totalLineCount: lineItems.length,
    totalExtraCostCount: extraCosts.length,
    hedgeLinked: Boolean(context.hedgeByStem?.[stem.Id]?.length),
    hedgeAllocations: context.hedgeByStem?.[stem.Id] || [],
  };
}

export function buildDashboardAccountInsight(dataset, {
  cursor = 0,
  pageSize = 50,
  today = hongKongToday(),
} = {}) {
  const role = dataset.role;
  const accountKey = salesforceIdKey(dataset.identity.accountId);
  const visibleScopeAccounts = dataset.scopeAccounts.filter((account) => !account.inactive);
  const visibleScopeAccountKeys = new Set(visibleScopeAccounts.map((account) => salesforceIdKey(account.accountId)).filter(Boolean));
  const lineItemsByStem = mapRows(dataset.lineItems);
  const extraCostsByStem = mapRows(dataset.extraCosts);
  const buyerBrokersByStem = mapRows(dataset.buyerBrokers);
  const buyerInvoiceStateKnown = Array.isArray(dataset.buyerInvoices);
  const finalBuyerInvoiceStemIds = new Set((dataset.buyerInvoices || [])
    .filter(isFinalBuyerInvoice)
    .map((invoice) => invoice.STEM__c)
    .filter(Boolean));
  const context = {
    role,
    accountKey,
    lineItemsByStem,
    extraCostsByStem,
    buyerBrokersByStem,
    buyerInvoiceStateKnown,
    finalBuyerInvoiceStemIds,
    originalSupplierRelationship: dataset.schema.originalSupplierRelationship,
    extraCostSupplierField: dataset.schema.extraCostSupplierField,
    extraCostSupplierRelationship: dataset.schema.extraCostSupplierRelationship,
    lineItemUomField: dataset.schema.lineItemUomField,
    extraCostUomField: dataset.schema.extraCostUomField,
    productUomField: dataset.schema.productUomField,
    hedgeByStem: dataset.hedgeByStem || {},
  };
  let rows = dataset.stems.map((stem) => buildStemFinancialRow(stem, context));
  if (role === 'supplier') {
    rows = rows.filter((row) => row.supplierAllocation || (lineItemsByStem.get(row.stemId) || []).some((item) => salesforceIdKey(item.Original_Supplier__c) === accountKey) || (extraCostsByStem.get(row.stemId) || []).some((item) => salesforceIdKey(dataset.schema.extraCostSupplierField ? item[dataset.schema.extraCostSupplierField] : null) === accountKey));
  } else if (role === 'group') {
    rows = rows.filter((row) => visibleScopeAccountKeys.has(salesforceIdKey(row.buyerAccountId)));
  }
  rows.sort((left, right) => String(right.effectiveDate || '').localeCompare(String(left.effectiveDate || '')) || String(right.stemName || '').localeCompare(String(left.stemName || '')));
  const previousRows = (dataset.previousStems || []).map((stem) => buildStemFinancialRow(stem, {
    ...context,
    lineItemsByStem: mapRows(dataset.previousLineItems),
    extraCostsByStem: mapRows(dataset.previousExtraCosts),
    buyerBrokersByStem: mapRows(dataset.previousBuyerBrokers),
  })).filter((row) => role === 'supplier' ? row.supplierAllocation : role !== 'group' || visibleScopeAccountKeys.has(salesforceIdKey(row.buyerAccountId)));
  const summary = summarizeRows(rows, { today, allHistory: dataset.period.mode === 'all_history' });
  const previous = summarizeRows(previousRows, { today });
  const comparisonCurrencyCompatible = summary.moneyByCurrency.length === 1
    && previous.moneyByCurrency.length === 1
    && summary.moneyByCurrency[0].currency === previous.moneyByCurrency[0].currency;
  const comparisons = previousRows.length ? {
    stemCountPct: percentage(summary.stemCount - previous.stemCount, previous.stemCount),
    volumePct: percentage(summary.totalVolumeMt - previous.totalVolumeMt, previous.totalVolumeMt),
    turnoverPct: comparisonCurrencyCompatible ? percentage(summary.turnover - previous.turnover, previous.turnover) : null,
    spendPct: comparisonCurrencyCompatible ? percentage(summary.supplierSpend - previous.supplierSpend, previous.supplierSpend) : null,
    grossProfitPct: comparisonCurrencyCompatible ? percentage(summary.grossProfit - previous.grossProfit, Math.abs(previous.grossProfit)) : null,
    grossMarginPointChange: comparisonCurrencyCompatible && summary.grossMarginPct != null && previous.grossMarginPct != null ? summary.grossMarginPct - previous.grossMarginPct : null,
    financialComparisonCurrency: comparisonCurrencyCompatible ? summary.moneyByCurrency[0].currency : null,
  } : null;
  const activeRows = rows.filter((row) => !row.cancelled);
  const reliablePaymentRows = activeRows.filter((row) => row.paymentDataReliable);
  const reliablePaymentStemIds = new Set(reliablePaymentRows.map((row) => row.stemId));
  const excludedLegacyRecordCount = activeRows.length - reliablePaymentRows.length;
  const buyerPayments = role === 'supplier' ? null : buyerPaymentMetrics(reliablePaymentRows, dataset.buyerPaymentsByStem, today);
  const supplierPayments = role === 'supplier' ? supplierPaymentMetrics((dataset.supplierInvoices || []).filter((invoice) => reliablePaymentStemIds.has(invoice.stemId)), today) : null;
  const collection = role === 'supplier' ? null : summarizeCollection(dataset.collectionByStem, reliablePaymentRows, today);
  const dispute = summarizeDisputes(dataset.workflows, rows, dataset.identity.accountId, role, today);
  const compensationAccountIds = role === 'group' ? visibleScopeAccounts.map((account) => account.accountId) : [dataset.identity.accountId];
  const compensation = summarizeCompensation(dataset.compensation, compensationAccountIds, today);
  const cancelledChildRecords = rows.reduce((sum, row) => sum + row.cancelledLineCount + row.cancelledExtraCostCount, 0);
  const totalChildRecords = rows.reduce((sum, row) => sum + row.totalLineCount + row.totalExtraCostCount, 0);
  const enrichedRows = rows.map((row) => {
    const reliable = row.paymentDataReliable;
    const collectionState = reliable ? dataset.collectionByStem?.[row.stemId]?.item || null : null;
    const stemBuyerPayments = reliable ? dataset.buyerPaymentsByStem?.[row.stemId] || [] : [];
    const stemSupplierInvoices = reliable ? (dataset.supplierInvoices || []).filter((invoice) => invoice.stemId === row.stemId) : [];
    const supplierInvoiceAmount = stemSupplierInvoices.some((invoice) => number(invoice.invoiceAmount) != null) ? stemSupplierInvoices.reduce((sum, invoice) => sum + valueOrZero(invoice.invoiceAmount), 0) : null;
    const supplierPayable = stemSupplierInvoices.some((invoice) => number(invoice.payableBalance) != null) ? stemSupplierInvoices.reduce((sum, invoice) => sum + valueOrZero(invoice.payableBalance), 0) : null;
    const supplierPaymentDates = stemSupplierInvoices.flatMap((invoice) => invoice.payments || []).map((payment) => payment.date).filter(Boolean).sort();
    return {
      ...row,
      collectionStatus: collectionState?.status || null,
      reconciliationState: collectionState?.reconciliationState || null,
      receivableBalance: reliable ? row.receivableBalance : null,
      buyerPaymentCount: reliable ? stemBuyerPayments.length : null,
      buyerPaymentsReceived: reliable ? stemBuyerPayments.reduce((sum, payment) => sum + valueOrZero(payment.amount), 0) : null,
      latestBuyerPaymentDate: reliable ? stemBuyerPayments.map((payment) => payment.paymentDate).filter(Boolean).sort().at(-1) || null : null,
      supplierInvoiceCount: reliable ? stemSupplierInvoices.length : null,
      supplierInvoiceAmount: reliable ? supplierInvoiceAmount : null,
      supplierPaidAmount: reliable && supplierInvoiceAmount != null && supplierPayable != null ? Math.max(0, supplierInvoiceAmount - supplierPayable) : null,
      supplierPayable: reliable ? supplierPayable : null,
      latestSupplierPaymentDate: reliable ? supplierPaymentDates.at(-1) || null : null,
    };
  });
  const offset = Math.max(0, Number(cursor) || 0);
  const limit = Math.max(10, Math.min(Number(pageSize) || 50, 100));
  const paginatedRows = enrichedRows.slice(offset, offset + limit);
  const childSummaries = role === 'group' ? visibleScopeAccounts.filter((account) => !account.root).map((account) => {
    const childRows = rows.filter((row) => salesforceIdKey(row.buyerAccountId) === salesforceIdKey(account.accountId));
    const childSummary = summarizeRows(childRows, { today });
    return {
      ...account,
      stemCount: childSummary.stemCount,
      turnover: childSummary.turnover,
      volumeMt: childSummary.totalVolumeMt,
      grossProfit: childSummary.grossProfit,
      moneyByCurrency: childSummary.moneyByCurrency,
      volumeContributionPct: percentage(childSummary.totalVolumeMt, summary.totalVolumeMt),
      turnoverContributionPct: childSummary.moneyByCurrency.length === 1 && summary.moneyByCurrency.length === 1 && childSummary.moneyByCurrency[0].currency === summary.moneyByCurrency[0].currency
        ? percentage(childSummary.turnover, summary.turnover)
        : null,
      receivable: childRows.some((row) => row.paymentDataReliable && number(row.receivableBalance) != null) ? childRows.filter((row) => row.paymentDataReliable).reduce((sum, row) => sum + valueOrZero(row.receivableBalance), 0) : null,
      lastActivityDate: childSummary.lastStemDate,
    };
  }).sort((left, right) => right.volumeMt - left.volumeMt || right.stemCount - left.stemCount || left.name.localeCompare(right.name)) : [];
  const tradingChildren = childSummaries.filter((row) => row.stemCount > 0);
  const topTurnoverChild = [...childSummaries].sort((left, right) => valueOrZero(right.turnover) - valueOrZero(left.turnover))[0] || null;
  const deliveryByStem = new Map((dataset.stems || []).map((stem) => [stem.Id, Boolean(stem.Delivery_Date__c)]));
  const missingLineItemUomCount = (dataset.lineItems || []).filter((item) => {
    if (item.Cancelled__c === true) return false;
    const quantity = nativeFinancialQuantity(item, {
      stemHasDelivery: deliveryByStem.get(item.STEM__c) === true,
      maxField: 'Quantity_Max__c',
      lineItemUomField: dataset.schema?.lineItemUomField,
      productUomField: dataset.schema?.productUomField,
    });
    return quantity.quantity !== 0 && Boolean(quantity.warning);
  }).length;
  const missingExtraCostUomCount = (dataset.extraCosts || []).filter((item) => {
    if (item.Cancelled__c === true || deliveryByStem.get(item.STEM__c) === true) return false;
    const usesPerUnitPricing = number(item.Unit_Price__c) != null || number(item.Unit_Cost__c) != null;
    if (!usesPerUnitPricing) return false;
    const quantity = nativeFinancialQuantity(item, {
      stemHasDelivery: false,
      maxField: 'Quantity_Range_Max__c',
      lineItemUomField: dataset.schema?.extraCostUomField,
      productUomField: dataset.schema?.productUomField,
    });
    return quantity.quantity !== 0 && Boolean(quantity.warning);
  }).length;
  const missingFinancialUomCount = missingLineItemUomCount + missingExtraCostUomCount;
  const warnings = unique([
    ...(dataset.warnings || []),
    ...(!dataset.identity.clKey ? ['CL Key is not set for this Salesforce Account.'] : []),
    ...(summary.multipleCurrencies ? ['Financial totals and profitability comparisons are separated by currency. FCOS does not net currencies without an authoritative exchange rate.'] : []),
    ...(role !== 'supplier' && reliablePaymentRows.some((row) => row.receivableBalance == null) ? ['One or more Salesforce receivable balances are unavailable and are not treated as zero.'] : []),
    ...(activeRows.length > 0 && !reliablePaymentRows.length ? ['No reliable payment data in this period. Earlier obligations are confirmed settled, but payment details are incomplete.'] : []),
    ...(rows.some((row) => row.invoiceValueSource === 'unavailable') ? ['One or more STEM values are unavailable because neither an invoiced nor estimated amount could be derived.'] : []),
    ...(dataset.truncated ? ['Salesforce returned more records than the Account Insight safety limit. Refine the period for complete totals.'] : []),
    ...(missingFinancialUomCount ? [`${missingFinancialUomCount} quantity-based financial line${missingFinancialUomCount === 1 ? '' : 's'} have no Salesforce UOM. FCOS preserved native quantities and did not infer a unit.`] : []),
    ...(!rows.length ? ['No STEM activity matched this Account, role, and period.'] : []),
  ]);
  return {
    identity: dataset.identity,
    availableRoles: dataset.availableRoles,
    activeRole: role,
    period: dataset.period,
    scope: {
      accountCount: visibleScopeAccounts.length,
      accounts: visibleScopeAccounts,
      includeInactiveHistory: false,
    },
    relationship: {
      accountManagers: dataset.accountManagers || [],
      accountNote: dataset.accountNote || null,
      managerCoverage: dataset.accountManagers?.length || 0,
      childCount: role === 'group' ? childSummaries.length : 0,
      activeChildCount: role === 'group' ? childSummaries.length : 0,
      inactiveChildCount: 0,
      tradingChildCount: role === 'group' ? tradingChildren.length : 0,
      topChildConcentrationPct: role === 'group' && summary.turnover ? percentage(topTurnoverChild?.turnover, summary.turnover) : null,
      childrenWithoutManagers: role === 'group' ? childSummaries.filter((row) => !row.managerCount).length : 0,
    },
    kpis: {
      ...summary,
      cancelledChildRecords,
      cancelledChildRatePct: percentage(cancelledChildRecords, totalChildRecords),
    },
    comparisons,
    payments: { buyer: buyerPayments, supplier: supplierPayments },
    paymentDataReliability: paymentDataReliabilityMetadata(excludedLegacyRecordCount, reliablePaymentRows.length),
    collection: collection ? { ...collection, reminderPolicy: dataset.reminderPolicy || null } : null,
    risk: {
      dispute,
      compensation,
      exceptions: dataset.exceptions || { count: 0, overdue: 0, reasons: [] },
      qlik: dataset.qlik || { discrepancies: null },
      specialTerms: dataset.specialTerms || { count: 0, terms: [] },
      unavailableKpis: [
        'Portfolio rank and company contribution require a complete company-wide comparison snapshot.',
        'Trader counts and fixed/floating-price mix require authoritative Salesforce fields that are not available in this Account scope.',
        'Cross-book supplier price premium requires a company-wide comparable-trade benchmark.',
        'Qlik discrepancy totals are unavailable without an Account-ID-based Qlik relationship.',
      ],
      dataQualityWarnings: warnings,
    },
    children: childSummaries,
    stems: {
      rows: paginatedRows,
      total: dataset.matchedStemCount ?? rows.length,
      analyzed: rows.length,
      truncated: dataset.truncated === true,
      cursor: offset + paginatedRows.length < enrichedRows.length ? String(offset + paginatedRows.length) : null,
      pageSize: limit,
    },
    exportRows: enrichedRows,
    warnings,
    meta: dataset.meta,
  };
}

export const dashboardAccountInsightInternals = {
  median,
  percentage,
  summarizeRows,
  salesforceIdKey,
};
