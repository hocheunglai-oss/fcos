import { digest, requireCondition } from './contract.mjs';
import { salesSupportRepairFields } from './trading-fx-sales-support-repair.mjs';

const fingerprint = 'c13101bbdc7796ec98e22b0b0848c25c03bbace805c33d4c139e7871645314c3';
export const tradingFxSalesSupportPath = 'profiles/Sales Support.profile-meta.xml';
const profileExpected = { sha256: '6721634e64a272df62c18f19f6adc8ee268c728213fcbfb150ed81ab46c82825', size: 104168 };
const profileObserved = { sha256: '52635af25b7503a8d46820008650f6ed305ed4504f64be3c3e41012c76442dd7', size: 108267 };
const recordTypes = {
  'objects/STEM_Extra_Cost__c/recordTypes/Product_Charge.recordType-meta.xml': {
    expected: { sha256: '93d9b29f81954807861730ecc710c945f92142fa96714ebf611fbce1d677354c', size: 3308 },
    observed: { sha256: '288f3a137a09da032a950be179efced6247cf29bbf8bdeafe898cccb91951485', size: 3919 },
  },
  'objects/STEM_Extra_Cost__c/recordTypes/STEM_Charge.recordType-meta.xml': {
    expected: { sha256: 'c63ce8f9c9d2e7a106220218dd10eba03d53ec189fb4980288ccd71e77b27bc4', size: 3302 },
    observed: { sha256: 'bb26b8c9e192248e3a40ce6a57cfa4328b1563c912fafe99cd0c605c603f3823', size: 3913 },
  },
  'objects/STEM__c/recordTypes/Historical.recordType-meta.xml': {
    expected: { sha256: '409f4c656089bb926f5e52258ba925f63ccb35d726dfc040fb6da9ddceca9fde', size: 7231 },
    observed: { sha256: '3830846de29847210a15604bc4ca39eeb637bd09129b0ac41449dc240ef7e9aa', size: 7537 },
  },
  'objects/STEM__c/recordTypes/Originated.recordType-meta.xml': {
    expected: { sha256: '72f63a3504a9f22f2ce2071259f3c05f77a270fb73bdffebedcce81baf8f1efb', size: 7346 },
    observed: { sha256: '00da4924a578719e8f59326c11357f33d7e63aae6c33700b686dfd120ac929ab', size: 7652 },
  },
};

const same = (left, right) => left?.sha256 === right.sha256 && left?.size === right.size;

export function tradingFxProductionInventoryScope(environmentKey, reviewedFingerprint, mode) {
  return environmentKey === 'production' && reviewedFingerprint === fingerprint
    && ['before-correction', 'after-correction'].includes(mode);
}

export function matchesTradingFxProductionProjection({ name, observed, pinned, environmentKey, fingerprint, mode }) {
  if (!tradingFxProductionInventoryScope(environmentKey, fingerprint, mode)) return false;
  if (name === tradingFxSalesSupportPath) {
    return mode === 'before-correction' && same(pinned, profileExpected) && same(observed, profileObserved);
  }
  const pair = Object.hasOwn(recordTypes, name) ? recordTypes[name] : undefined;
  return Boolean(pair && same(pinned, pair.expected) && same(observed, pair.observed));
}

// Native metadata retrieval can serialize denied field entries explicitly. Remove only
// the reviewed false/false entries, and require the complete pinned original profile.
export function normalizeTradingFxDeniedProfile(bytes, pinned) {
  if (!same(pinned, profileExpected)) return null;
  const xml = bytes.toString('utf8');
  const reviewed = new Set(salesSupportRepairFields);
  const captured = new Set();
  const normalized = Buffer.from(xml.replace(
    /^    <fieldPermissions>\n        <editable>false<\/editable>\n        <field>([^<>]+)<\/field>\n        <readable>false<\/readable>\n    <\/fieldPermissions>\n/gmu,
    (entry, field) => {
      if (!reviewed.has(field)) return entry;
      requireCondition(!captured.has(field), 'TRADING_FX_SALES_SUPPORT_DUPLICATE_DENIAL');
      captured.add(field);
      return '';
    },
  ));
  return captured.size > 0 && same({ sha256: digest(normalized), size: normalized.length }, pinned)
    ? pinned : null;
}
