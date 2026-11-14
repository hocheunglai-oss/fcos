import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const legacyDocuments = [
  ['fcbBuyerConfirmationForm', 'NominationController', 'nomination'],
  ['fcbSupplierNominationForm', 'NominationController', 'nomination'],
  ['fcbInvoiceForm', 'InvoiceController', 'preview'],
  ['fcbSupplierInvoices', 'VariableChargeInvoiceReadinessService', 'preview'],
];

export function assertLegacySalesforceDocumentAdmission(cwd, reviewed, metadataRoot) {
  const root = join(cwd, metadataRoot);
  const components = new Set(reviewed.review.components.map(({ id }) => id));
  for (const [bundle, incumbent, action] of legacyDocuments) {
    if (!components.has('LightningComponentBundle:' + bundle)) continue;
    const entry = join(root, 'lwc', bundle, bundle + '.js');
    if (!existsSync(entry)) continue;
    const source = readFileSync(entry, 'utf8');
    const direct = new RegExp('@salesforce/apex/FcosTradeDocumentService\\.' + action + '[\'"]', 'u');
    if (direct.test(source)) {
      throw Object.assign(new Error(`${bundle} must load document reads through its established ${incumbent} Apex entrypoint.`),
        { code: 'SALESFORCE_LEGACY_DOCUMENT_APEX_ACCESS_REQUIRED' });
    }
  }
}
