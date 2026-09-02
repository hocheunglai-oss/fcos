export const STANDARD_INVOICE_PARTY_SUFFIX = '& OWNERS, CHARTERERS, MANAGERS &';

const LEGACY_STANDARD_PARTY_SUFFIX = /\s*&\s*OWNER,\s*CHARTERER\s*&\s*$/iu;
const CURRENT_STANDARD_PARTY_SUFFIX = /\s*&\s*OWNERS,\s*CHARTERERS,\s*MANAGERS\s*&\s*$/iu;

export function buildInvoiceVesselText(vesselName, imo) {
    return `M/V ${vesselName} (IMO: ${imo}) ${STANDARD_INVOICE_PARTY_SUFFIX}`;
}

export function normalizeInvoiceVesselText(value) {
    const text = String(value ?? '').trim();
    if (!text) return text;
    if (CURRENT_STANDARD_PARTY_SUFFIX.test(text)) {
        return text.replace(CURRENT_STANDARD_PARTY_SUFFIX, ` ${STANDARD_INVOICE_PARTY_SUFFIX}`);
    }
    if (LEGACY_STANDARD_PARTY_SUFFIX.test(text)) {
        return text.replace(LEGACY_STANDARD_PARTY_SUFFIX, ` ${STANDARD_INVOICE_PARTY_SUFFIX}`);
    }
    return text;
}
