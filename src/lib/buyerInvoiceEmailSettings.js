export const BUYER_INVOICE_EMAIL_SETTING_KEYS = Object.freeze([
  'enabled',
  'from',
  'to',
  'cc',
  'daysAhead',
  'subject',
  'intro',
  'includeSummary',
  'includeTable',
  'buyerTraders',
  'weekdays',
  'sendTimes',
  'appUrl',
  'paymentReminderRecipientFieldPath',
  'paymentReminderCc',
  'paymentReminderBcc',
  'paymentReminderSubject',
  'paymentReminderBody',
]);

const KNOWN_EMAIL_CORRECTIONS = Object.freeze({
  'lousia@cosulich.com.hk': 'louisa@cosulich.com.hk',
});

export function canonicalizeBuyerInvoiceEmail(value) {
  const email = String(value || '').trim();
  return KNOWN_EMAIL_CORRECTIONS[email.toLowerCase()] || email;
}

export function canonicalizeBuyerInvoiceEmailValue(value) {
  if (Array.isArray(value)) return value.map(canonicalizeBuyerInvoiceEmailValue);
  if (typeof value !== 'string') return value;
  return value.replace(
    /\blousia@cosulich\.com\.hk\b/gi,
    'louisa@cosulich.com.hk',
  );
}

export function buyerInvoiceEmailSettingsPatch(input = {}) {
  const patch = {};
  for (const key of BUYER_INVOICE_EMAIL_SETTING_KEYS) {
    if (Object.prototype.hasOwnProperty.call(input, key)) {
      patch[key] = canonicalizeBuyerInvoiceEmailValue(input[key]);
    }
  }
  return patch;
}
