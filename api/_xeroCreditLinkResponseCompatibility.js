import { isDeepStrictEqual } from 'node:util';
import { xeroReviewFingerprint } from './_xeroFinancialSync.js';

const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function noValidationErrors(value) {
  return object(value)
    && ['HasErrors', 'HasValidationErrors'].every((key) => !Object.hasOwn(value, key) || value[key] === false)
    && (!Object.hasOwn(value, 'StatusAttributeString') || value.StatusAttributeString === 'OK')
    && (!Object.hasOwn(value, 'ValidationErrors') || Array.isArray(value.ValidationErrors) && value.ValidationErrors.length === 0);
}

// Do not round here: even a sub-cent discount makes the percent-mode flag material.
function noDiscount(value) {
  return ['DiscountRate', 'DiscountAmount', 'TotalDiscount'].every((key) => !Object.hasOwn(value, key)
    || typeof value[key] === 'number' && value[key] === 0
    || typeof value[key] === 'string' && /^-?0(?:\.0{1,12})?$/.test(value[key]));
}

// Only the approved link executor may use this response compatibility. Neither
// normalization nor saved approval/evidence fingerprints are changed.
export function creditLinkReviewCompatibility({ category, saved, current, rawTarget }) {
  if (!saved || !current) return null;
  const reviewFingerprint = xeroReviewFingerprint(saved);
  const currentReviewFingerprint = xeroReviewFingerprint(current);
  if (currentReviewFingerprint === reviewFingerprint) {
    return { reviewFingerprint, currentReviewFingerprint, removedFields: [] };
  }
  if (category !== 'link_only' || saved.xeroCollection !== 'CreditNotes' || current.xeroCollection !== 'CreditNotes'
    || saved.xero?.collection !== 'CreditNotes' || current.xero?.collection !== 'CreditNotes'
    || !['link', 'protected_legacy'].includes(saved.action) || current.action !== saved.action
    || !object(rawTarget) || rawTarget.CreditNoteID !== current.xero.id || rawTarget.Type !== current.xero.type
    || !noValidationErrors(rawTarget) || !noDiscount(rawTarget)
    || ['IsDiscounted', 'HasDiscount', 'HasDiscounts'].some((key) => Object.hasOwn(rawTarget, key) && rawTarget[key] !== false)) return null;

  const originalLines = saved.xero.lineItems;
  const currentLines = current.xero.lineItems;
  if (!Array.isArray(originalLines) || !originalLines.length || !Array.isArray(currentLines)
    || originalLines.length !== currentLines.length || !Array.isArray(rawTarget.LineItems)
    || !isDeepStrictEqual(rawTarget.LineItems, currentLines)
    || new Set(originalLines.map((line) => line?.LineItemID)).size !== originalLines.length) return null;

  const removedFields = [];
  const lineItems = [];
  for (let index = 0; index < originalLines.length; index += 1) {
    const original = originalLines[index]; const fresh = currentLines[index];
    if (!object(original) || !object(fresh) || typeof original.LineItemID !== 'string' || !original.LineItemID.trim()
      || original.LineItemID !== fresh.LineItemID || !noValidationErrors(original) || !noValidationErrors(fresh)
      || !noDiscount(original) || !noDiscount(fresh)) return null;
    const line = { ...fresh };
    if (!Object.hasOwn(original, 'ValidationErrors') && Object.hasOwn(line, 'ValidationErrors')) {
      delete line.ValidationErrors;
      removedFields.push(`xero.lineItems.${index}.ValidationErrors`);
    }
    if (!Object.hasOwn(original, 'DiscountEnteredAsPercent') && Object.hasOwn(line, 'DiscountEnteredAsPercent')) {
      if (line.DiscountEnteredAsPercent !== true) return null;
      delete line.DiscountEnteredAsPercent;
      removedFields.push(`xero.lineItems.${index}.DiscountEnteredAsPercent`);
    }
    lineItems.push(line);
  }
  if (!removedFields.length || xeroReviewFingerprint({ ...current, xero: { ...current.xero, lineItems } }) !== reviewFingerprint) return null;
  return { reviewFingerprint, currentReviewFingerprint, removedFields };
}
