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
    throw new Error(data.message || (Array.isArray(data) && data[0]?.message) || 'Query error');
  }
  return { records: data.records || [], totalSize: data.totalSize ?? 0 };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { where } = body;

    const { accessToken } = await base44.asServiceRole.connectors.getConnection("salesforce");

    // Describe stem__c to know available fields
    const describeRes = await fetch(`${SF_INSTANCE}/services/data/${SF_API_VERSION}/sobjects/stem__c/describe/`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const describeData = await describeRes.json();
    const fieldNames = (describeData.fields || []).map(f => f.name);

    const hasStatus = fieldNames.includes('Status__c');
    const hasType = fieldNames.includes('Type__c');
    const hasAmount = fieldNames.includes('Amount__c');
    const hasDispute = fieldNames.includes('Dispute__c');

    const whereClause = where ? `WHERE ${where}` : '';

    const usefulFields = ['Id', 'Name', 'CreatedDate'];
    if (fieldNames.includes('Stem_Date__c')) usefulFields.push('Stem_Date__c');
    if (fieldNames.includes('Office__c')) usefulFields.push('Office__c');
    if (hasStatus) usefulFields.push('Status__c');
    if (hasType) usefulFields.push('Type__c');
    if (hasAmount) usefulFields.push('Amount__c');
    if (hasDispute) usefulFields.push('Dispute__c');

    const results = await Promise.allSettled([
      sfQuery(accessToken, `SELECT COUNT(Id) total FROM stem__c ${whereClause}`),
      hasStatus ? sfQuery(accessToken, `SELECT Status__c val, COUNT(Id) total FROM stem__c ${whereClause} GROUP BY Status__c`) : Promise.resolve({ records: [] }),
      hasType ? sfQuery(accessToken, `SELECT Type__c val, COUNT(Id) total FROM stem__c ${whereClause} GROUP BY Type__c`) : Promise.resolve({ records: [] }),
      sfQuery(accessToken, `SELECT ${usefulFields.join(', ')} FROM stem__c ${whereClause} ORDER BY CreatedDate DESC LIMIT 50`),
      hasAmount ? sfQuery(accessToken, `SELECT SUM(Amount__c) total FROM stem__c ${whereClause}`) : Promise.resolve({ records: [] }),
      hasDispute ? sfQuery(accessToken, `SELECT COUNT(Id) total FROM stem__c WHERE Dispute__c = true ${where ? `AND (${where})` : ''}`) : Promise.resolve({ records: [] }),
    ]);

    const getValue = (r) => r.status === 'fulfilled' ? r.value : { records: [], totalSize: 0 };

    const totalRes = getValue(results[0]);
    const statusRes = getValue(results[1]);
    const typeRes = getValue(results[2]);
    const recentRes = getValue(results[3]);
    const amountRes = getValue(results[4]);
    const disputedRes = getValue(results[5]);

    const recentStems = (recentRes.records || []).map(({ attributes, ...rest }) => rest);

    return Response.json({
      stemTotal: totalRes.records?.[0]?.total ?? 0,
      totalAmount: amountRes.records?.[0]?.total ?? null,
      disputedCount: disputedRes.records?.[0]?.total ?? null,
      stemByStatus: (statusRes.records || []).map(r => ({ label: r.val || 'Unknown', value: r.total })),
      stemByType: (typeRes.records || []).map(r => ({ label: r.val || 'Unknown', value: r.total })),
      recentStems,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});