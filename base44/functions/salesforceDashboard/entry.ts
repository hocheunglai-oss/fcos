import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const SF_INSTANCE = "https://fratellicosulich.my.salesforce.com";
const SF_API_VERSION = "v59.0";

async function sfQuery(accessToken, soql) {
  const encoded = encodeURIComponent(soql);
  const res = await fetch(`${SF_INSTANCE}/services/data/${SF_API_VERSION}/query/?q=${encoded}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const data = await res.json();
  if (data.errorCode || (Array.isArray(data) && data[0]?.errorCode)) {
    const msg = data.message || (Array.isArray(data) && data[0]?.message) || 'Query error';
    throw new Error(msg);
  }
  return { records: data.records || [], totalSize: data.totalSize ?? 0 };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { accessToken } = await base44.asServiceRole.connectors.getConnection("salesforce");

    // Get stem fields first to know what's available
    const describeRes = await fetch(`${SF_INSTANCE}/services/data/${SF_API_VERSION}/sobjects/stem__c/describe/`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const describeData = await describeRes.json();
    const fieldNames = (describeData.fields || []).map(f => f.name);

    // Check which useful fields exist
    const hasStatus = fieldNames.includes('Status__c');
    const hasType = fieldNames.includes('Type__c');
    const hasAmount = fieldNames.includes('Amount__c');
    const hasOwner = fieldNames.includes('OwnerId');
    const hasAccount = fieldNames.includes('Account__c') || fieldNames.includes('AccountId');
    const accountField = fieldNames.includes('Account__c') ? 'Account__c' : 'AccountId';

    // Select most useful fields for recent records
    const usefulFields = ['Id', 'Name', 'CreatedDate'];
    if (hasStatus) usefulFields.push('Status__c');
    if (hasType) usefulFields.push('Type__c');
    if (hasAmount) usefulFields.push('Amount__c');
    if (hasOwner) usefulFields.push('OwnerId');

    const results = await Promise.allSettled([
      sfQuery(accessToken, `SELECT COUNT(Id) total FROM stem__c`),
      hasStatus ? sfQuery(accessToken, `SELECT Status__c val, COUNT(Id) total FROM stem__c GROUP BY Status__c`) : Promise.resolve({ records: [] }),
      hasType ? sfQuery(accessToken, `SELECT Type__c val, COUNT(Id) total FROM stem__c GROUP BY Type__c`) : Promise.resolve({ records: [] }),
      sfQuery(accessToken, `SELECT ${usefulFields.join(', ')} FROM stem__c ORDER BY CreatedDate DESC LIMIT 20`),
      sfQuery(accessToken, `SELECT COUNT(Id) total FROM Account`),
      hasAmount ? sfQuery(accessToken, `SELECT SUM(Amount__c) total FROM stem__c`) : Promise.resolve({ records: [] }),
    ]);

    const getValue = (r) => r.status === 'fulfilled' ? r.value : { records: [], totalSize: 0 };

    const totalRes = getValue(results[0]);
    const statusRes = getValue(results[1]);
    const typeRes = getValue(results[2]);
    const recentRes = getValue(results[3]);
    const accountRes = getValue(results[4]);
    const amountRes = getValue(results[5]);

    const stemTotal = totalRes.records?.[0]?.total ?? totalRes.totalSize ?? 0;
    const accountTotal = accountRes.records?.[0]?.total ?? 0;
    const totalAmount = amountRes.records?.[0]?.total ?? null;

    // Clean records
    const recentStems = (recentRes.records || []).map(r => {
      const { attributes, ...rest } = r;
      return rest;
    });

    return Response.json({
      stemTotal,
      accountTotal,
      totalAmount,
      stemByStatus: (statusRes.records || []).map(r => ({ label: r.val || 'Unknown', value: r.total })),
      stemByType: (typeRes.records || []).map(r => ({ label: r.val || 'Unknown', value: r.total })),
      recentStems,
      availableFields: fieldNames,
      hasStatus,
      hasType,
      hasAmount
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});