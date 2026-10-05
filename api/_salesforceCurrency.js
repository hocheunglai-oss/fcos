import { parseDocument } from 'htmlparser2';
import { fcosSalesforceEnvironment } from '../config/fcosConnections.js';

function evidenceError(code = 'SALESFORCE_CURRENCY_EVIDENCE_INVALID') {
  return Object.assign(new Error('Salesforce company currency evidence is unavailable or invalid.'), { code });
}

export function parseSalesforceCurrencyEvidence(xml) {
  if (typeof xml !== 'string' || xml.length > 100000 || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw evidenceError();
  const values = new Map();
  const visit = (node) => {
    const name = node.name?.split(':').at(-1);
    if (['organizationId', 'organizationMultiCurrency', 'orgDefaultCurrencyIsoCode'].includes(name)) {
      if (values.has(name) || node.children?.some((child) => child.type !== 'text')) throw evidenceError();
      values.set(name, (node.children || []).map((child) => child.data || '').join('').trim());
    }
    if (name === 'Fault') throw evidenceError();
    for (const child of node.children || []) visit(child);
  };
  visit(parseDocument(xml, { xmlMode: true, decodeEntities: true }));
  const organizationId = values.get('organizationId');
  const expected = fcosSalesforceEnvironment('production').orgId;
  if (![expected, expected.slice(0, 15)].includes(organizationId)) throw evidenceError('SALESFORCE_ORG_MISMATCH');
  const multiCurrency = values.get('organizationMultiCurrency');
  if (!['true', 'false'].includes(multiCurrency)) throw evidenceError();
  const corporateCurrency = values.get('orgDefaultCurrencyIsoCode') || null;
  if (corporateCurrency && !/^[A-Z]{3}$/.test(corporateCurrency)) throw evidenceError();
  if (multiCurrency === 'false' && !corporateCurrency) throw evidenceError();
  return { organizationId: expected, singleCurrency: multiCurrency === 'false', corporateCurrency };
}

export function salesforceUserInfoEnvelope(token) {
  const escaped = String(token).replace(/[<>&"']/g, (value) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[value]);
  return `<?xml version="1.0" encoding="UTF-8"?><env:Envelope xmlns:env="http://schemas.xmlsoap.org/soap/envelope/" xmlns:urn="urn:partner.soap.sforce.com"><env:Header><urn:SessionHeader><urn:sessionId>${escaped}</urn:sessionId></urn:SessionHeader></env:Header><env:Body><urn:getUserInfo/></env:Body></env:Envelope>`;
}
