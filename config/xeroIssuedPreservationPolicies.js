// Versioned documentary contracts. A new policy must never reinterpret a
// previously accepted link or fall through to an accounting mutation.
export const ISSUED_SUPPLIER_POLICY = 'issued_supplier_preserve_v1';
export const ISSUED_PETROLEUM_POLICY = 'issued_petroleum_preserve_v1';
export const ISSUED_PETROLEUM_V2_POLICY = 'issued_petroleum_preserve_v2';
export const ISSUED_PRESERVATION_POLICIES = Object.freeze([ISSUED_SUPPLIER_POLICY, ISSUED_PETROLEUM_POLICY, ISSUED_PETROLEUM_V2_POLICY]);
export const isIssuedPreservationPolicy = (value) => ISSUED_PRESERVATION_POLICIES.includes(value);
