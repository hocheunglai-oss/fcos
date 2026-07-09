export const DOCUMENT_SETTINGS_KEY = 'fcos:stem_document_settings';

export const DOCUMENT_SOURCE_GROUPS = [
  'Direct STEM',
  'Invoices to Buyer',
  'Invoices from Suppliers',
  'Contracts and Compliance',
  'Dispute / Support',
  'Product Line Attachments',
  'Extra Cost',
  'Broker',
  'Email',
  'Other Related',
];

export const DEFAULT_DOCUMENT_SETTINGS = {
  relevantSourceGroups: [
    'Direct STEM',
    'Invoices to Buyer',
    'Invoices from Suppliers',
    'Contracts and Compliance',
    'Dispute / Support',
    'Product Line Attachments',
    'Email',
  ],
  showOnlyRelevant: true,
};

const LEGACY_SOURCE_GROUPS = {
  'Buyer / Factoring Invoice': 'Invoices to Buyer',
  'Supplier Invoice': 'Invoices from Suppliers',
  Nomination: 'Contracts and Compliance',
  'Line Item': 'Product Line Attachments',
};

function normalizeSourceGroups(groups) {
  if (!Array.isArray(groups)) return DEFAULT_DOCUMENT_SETTINGS.relevantSourceGroups;
  const normalized = groups
    .map((group) => LEGACY_SOURCE_GROUPS[group] || group)
    .filter((group) => DOCUMENT_SOURCE_GROUPS.includes(group));
  return [...new Set(normalized)];
}

export function readDocumentSettings() {
  try {
    const raw = localStorage.getItem(DOCUMENT_SETTINGS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    const groups = normalizeSourceGroups(parsed.relevantSourceGroups);
    return {
      ...DEFAULT_DOCUMENT_SETTINGS,
      ...parsed,
      relevantSourceGroups: groups.length ? groups : DEFAULT_DOCUMENT_SETTINGS.relevantSourceGroups,
      showOnlyRelevant: parsed.showOnlyRelevant ?? DEFAULT_DOCUMENT_SETTINGS.showOnlyRelevant,
    };
  } catch {
    return DEFAULT_DOCUMENT_SETTINGS;
  }
}

export function saveDocumentSettings(settings) {
  const relevantSourceGroups = normalizeSourceGroups(settings?.relevantSourceGroups);
  localStorage.setItem(DOCUMENT_SETTINGS_KEY, JSON.stringify({
    relevantSourceGroups,
    showOnlyRelevant: settings?.showOnlyRelevant ?? DEFAULT_DOCUMENT_SETTINGS.showOnlyRelevant,
  }));
}
