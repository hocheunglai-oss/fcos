import { ISSUED_PETROLEUM_POLICY } from '../config/xeroIssuedPreservationPolicies.js';
import { issuedSupplierSfId as sf, issuedSupplierCents as cents, issuedSupplierHash as hash } from './_xeroIssuedSupplierPreservation.js';
import { issuedPetroleumDecimal as decimal } from './_xeroIssuedPetroleumPreservation.js';

const MISSING_FILE = 'Supplier invoice has no verified issued source file.';
const uuid = (value) => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value)
  && value !== '00000000-0000-0000-0000-000000000000' ? value.toLowerCase() : null;
const sameSf = (left, right) => Boolean(sf(left) && sf(left) === sf(right));
const words = (value) => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
const one = (rows, key, expected) => Array.isArray(rows) && rows.length === 1 && sameSf(key(rows[0]), expected);
const positiveCents = (value, expected) => cents(value) !== null && cents(value) > 0n && cents(value).toString() === expected;
const positiveDecimal = (value, expected) => Boolean(decimal(value)?.value > 0n && decimal(value).text === expected);
const onlyMissingFile = (rows) => Array.isArray(rows) && rows.every((value) => value === MISSING_FILE);

// Existing petroleum acceptances keep their original documentary review. This
// supplementary current-facts check covers fields deliberately excluded from
// legacy document fingerprints; it never grants posting readiness or a new link.
export function currentIssuedPetroleumMatches(source, context, proof) {
  try {
    const evidence = proof?.evidence;
    const accounting = evidence?.accounting;
    const accepted = accounting?.source;
    const delivery = accounting?.deliveryIdentity;
    const current = context?.issuedPetroleumCurrent;
    if (!source || proof?.policyVersion !== ISSUED_PETROLEUM_POLICY || evidence?.policyVersion !== ISSUED_PETROLEUM_POLICY
      || proof.fingerprint !== hash({ policyVersion: ISSUED_PETROLEUM_POLICY, accounting })
      || proof.evidenceFingerprint !== hash(evidence) || !accepted || !delivery || context?.complete !== true
      || !(context.accountsById instanceof Map) || !(context.members instanceof Map) || typeof context.matchesFor !== 'function'
      || !current || !['suppliers', 'lines', 'extras', 'products'].every((key) => Array.isArray(current[key]))
      || !Array.isArray(context.stored?.productMappings) || !uuid(context.tenantId) || uuid(context.tenantId) !== uuid(accounting.tenantId)
      || context.organisation?.baseCurrency !== 'USD' || accounting.baseCurrency !== 'USD'
      || source.salesforceObject !== 'Supplier_Invoice__c' || accepted.salesforceObject !== 'Supplier_Invoice__c'
      || !sameSf(source.salesforceId, accepted.salesforceId) || !sameSf(source.accountId, accepted.accountId)
      || !sameSf(source.stemId, accepted.stemId) || !uuid(source.contactId) || uuid(source.contactId) !== uuid(accepted.contactId)
      || source.xeroType !== 'ACCPAY' || source.xeroCollection !== 'Invoices' || source.currency !== 'USD'
      || source.sourceFingerprint !== accepted.sourceFingerprint || source.financialFingerprint !== accepted.financialFingerprint
      || !onlyMissingFile(source.blockers) || !onlyMissingFile(source.readiness?.blockers)
      || !Array.isArray(accepted.lines) || accepted.lines.length !== 1 || !Array.isArray(source.lines) || source.lines.length !== 1
      || source.groupedAccounting?.policy !== 'fcos_notax_accounting_v1' || !Array.isArray(source.groupedAccounting.lines)
      || source.groupedAccounting.lines.length !== 1) return false;

    const parents = current.suppliers.filter((row) => sameSf(row?.Id, source.salesforceId));
    const children = current.lines.filter((row) => sameSf(row?.Supplier_Invoice__c, source.salesforceId));
    if (parents.length !== 1 || children.length !== 1 || current.extras.some((row) => sameSf(row?.Supplier_Invoice__c, source.salesforceId))) return false;
    const parent = parents[0]; const child = children[0]; const line = accepted.lines[0]; const rawLine = source.groupedAccounting.lines[0];
    // The normal provider query excludes deleted rows. Explicit deletion evidence
    // is still rejected, while Cancelled__c must be retrieved and explicitly false.
    if (parent.IsDeleted === true || child.IsDeleted === true || child.Cancelled__c !== false
      || !sameSf(parent.Id, delivery.parentId) || !sameSf(parent.Supplier__c, accepted.accountId)
      || !sameSf(parent.Supplier__c, delivery.supplierId) || !sameSf(parent.STEM__c, accepted.stemId)
      || !sameSf(parent.STEM__c, delivery.stemId) || !sameSf(child.Id, delivery.childId) || !sameSf(child.Id, line.id)
      || !sameSf(child.STEM__c, parent.STEM__c) || !sameSf(child.Original_Supplier__c, parent.Supplier__c)
      || !sameSf(parent.STEM__r?.Vessel__c, delivery.vesselId) || !words(parent.STEM__r?.Vessel__r?.Name)
      || words(parent.STEM__r.Vessel__r.Name) !== delivery.vessel || delivery.vessel !== accepted.vessel
      || parent.STEM__r?.KeyStem__c !== delivery.stemKey || source.stemKey !== delivery.stemKey
      || parent.STEM__r?.Delivery_Date__c !== delivery.deliveryDate || source.deliveryDate !== delivery.deliveryDate
      || parent.Name !== accepted.documentNumber || source.documentNumber !== accepted.documentNumber
      || parent.Invoice_Date__c !== accepted.invoiceDate || source.invoiceDate !== accepted.invoiceDate
      || parent.Invoice_Due_Date__c !== accepted.dueDate || source.dueDate !== accepted.dueDate || source.reference !== accepted.reference
      || !positiveCents(parent.Invoice_Amount__c, accepted.totalCents) || !positiveCents(source.groupedAccounting.total, accepted.totalCents)
      || accepted.subtotalCents !== accepted.totalCents || accepted.signedTotalCents !== accepted.totalCents
      || (parent.CurrencyIsoCode != null && parent.CurrencyIsoCode !== 'USD') || (child.CurrencyIsoCode != null && child.CurrencyIsoCode !== 'USD')
      || !one(source.readiness.linkedChildren, (id) => id, child.Id)
      || !sameSf(source.lines[0].sourceId, child.Id) || !sameSf(source.lines[0].productId, child.Product__c)
      || !sameSf(rawLine.id, child.Id) || !sameSf(rawLine.productId, child.Product__c) || rawLine.currency !== 'USD'
      || rawLine.discountProduct !== false || child.Unit_of_Measure__c !== 'MT' || delivery.unit !== 'MT'
      || !positiveDecimal(child.Quantity_Delivered_Per_BDN__c, delivery.quantity) || delivery.quantity !== line.quantity
      || !positiveDecimal(rawLine.quantity, line.quantity) || !positiveDecimal(child.Unit_Buy_At__c, delivery.unitAmount)
      || delivery.unitAmount !== line.unitAmount || !positiveDecimal(rawLine.unitAmount, line.unitAmount)
      || !positiveCents(child.Total_Cost__c, delivery.lineAmountCents) || delivery.lineAmountCents !== line.lineAmountCents
      || !positiveCents(rawLine.lineAmount, line.lineAmountCents) || line.lineAmountCents !== accepted.totalCents
      || rawLine.description !== line.description || rawLine.accountCode !== '51100' || rawLine.taxType !== 'NONE'
      || decimal(rawLine.taxAmount)?.text !== '0' || decimal(rawLine.discountRate)?.text !== '0' || decimal(rawLine.discountAmount)?.text !== '0'
      || !Array.isArray(rawLine.tracking) || rawLine.tracking.length || rawLine.itemCode !== '') return false;
    const products = current.products.filter((row) => sameSf(row?.Id, child.Product__c));
    if (products.length !== 1 || !sameSf(child.Product__c, delivery.productId) || !sameSf(child.Product__c, line.productId)
      || products[0].RecordType?.DeveloperName !== 'Petroleum_Product' || delivery.productRecordType !== 'Petroleum_Product'
      || products[0].Name !== delivery.productName || child.Product__r?.Name !== delivery.productName
      || source.lines[0].productName !== delivery.productName) return false;

    const account = context.accountsById.get(sf(source.accountId));
    const matches = account ? context.matchesFor(account) : [];
    const members = context.members.get(uuid(source.contactId));
    const counterparties = accounting.issuedFile?.review?.counterparties;
    if (!account || account.inactiveSuspended !== false || !sameSf(account.id, source.accountId)
      || account.name !== source.accountName || parent.Supplier__r?.Name !== account.name || counterparties?.sourceName !== account.name
      || account.companyCode !== (source.companyCode || '') || parent.Supplier__r?.Company_Code__c !== account.companyCode
      || counterparties.companyCode !== account.companyCode || !sameSf(counterparties.accountId, account.id)
      || uuid(counterparties.contactId) !== uuid(source.contactId) || uuid(counterparties.tenantId) !== uuid(context.tenantId)
      || !Array.isArray(matches) || matches.length !== 1 || matches[0].status !== 'ACTIVE' || uuid(matches[0].id) !== uuid(source.contactId)
      || !one(members, (row) => row.id, account.id) || members[0].inactiveSuspended !== false
      || accounting.contactIdentity?.evidenceFingerprint !== hash({ policy: 'fcos_contact_name_v1', account, contact: matches[0] })) return false;

    const mappings = context.stored.productMappings.filter((row) => row?.direction === 'supplier' && sameSf(row.salesforce_product_id, child.Product__c));
    if (mappings.length !== 1 || !Array.isArray(accounting.productMappings) || accounting.productMappings.length !== 1) return false;
    const mapping = mappings[0]; const approved = accounting.productMappings[0];
    return Boolean(uuid(mapping.id) && uuid(mapping.id) === uuid(approved.id) && mapping.enabled === true && approved.enabled === true
      && approved.direction === 'supplier' && sameSf(mapping.salesforce_product_id, approved.salesforceProductId)
      && mapping.xero_account_code === '51100' && approved.xeroAccountCode === '51100'
      && mapping.xero_tax_type === 'NONE' && approved.xeroTaxType === 'NONE'
      && Number.isSafeInteger(mapping.revision) && mapping.revision > 0 && mapping.revision === approved.revision
      && uuid(mapping.approved_by) && uuid(mapping.approved_by) === uuid(approved.approvedBy)
      && typeof mapping.approved_by_email === 'string' && mapping.approved_by_email.trim()
      && mapping.approved_by_email === approved.approvedByEmail && typeof mapping.approved_at === 'string'
      && Number.isFinite(Date.parse(mapping.approved_at)) && mapping.approved_at === approved.approvedAt);
  } catch {
    return false;
  }
}
