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
    const hasDispute = fieldNames.includes('Dispute__c');

    // Detect account field
    const accountField = fieldNames.includes('Account__c') ? 'Account__c'
      : fieldNames.includes('AccountId') ? 'AccountId'
      : null;

    // Detect buyer invoice amount field
    const buyerAmountCandidates = [
      'Buyer_Invoice_Amount__c', 'Invoice_Amount_Buyer__c', 'Total_Invoice_Amount_Buyer__c',
      'Buyer_Amount__c', 'Invoice_Buyer__c', 'Amount_Buyer__c'
    ];
    const buyerAmountField = buyerAmountCandidates.find(f => fieldNames.includes(f)) || null;

    // Detect supplier invoice amount field
    const supplierAmountCandidates = [
      'Supplier_Invoice_Amount__c', 'Invoice_Amount_Supplier__c', 'Total_Invoice_Amount_Supplier__c',
      'Supplier_Amount__c', 'Invoice_Supplier__c', 'Amount_Supplier__c'
    ];
    const supplierAmountField = supplierAmountCandidates.find(f => fieldNames.includes(f)) || null;

    const whereClause = where ? `WHERE ${where}` : '';

    const usefulFields = ['Id', 'Name', 'CreatedDate'];
    if (fieldNames.includes('Stem_Date__c')) usefulFields.push('Stem_Date__c');
    if (fieldNames.includes('Office__c')) usefulFields.push('Office__c');
    if (hasStatus) usefulFields.push('Status__c');
    if (hasType) usefulFields.push('Type__c');
    if (buyerAmountField) usefulFields.push(buyerAmountField);
    if (supplierAmountField) usefulFields.push(supplierAmountField);
    if (hasDispute) usefulFields.push('Dispute__c');
    if (accountField) usefulFields.push(accountField);

    const queries = [
      // 0: total stem count
      sfQuery(accessToken, `SELECT COUNT(Id) total FROM stem__c ${whereClause}`),
      // 1: by status
      hasStatus
        ? sfQuery(accessToken, `SELECT Status__c val, COUNT(Id) total FROM stem__c ${whereClause} GROUP BY Status__c`)
        : Promise.resolve({ records: [] }),
      // 2: by type
      hasType
        ? sfQuery(accessToken, `SELECT Type__c val, COUNT(Id) total FROM stem__c ${whereClause} GROUP BY Type__c`)
        : Promise.resolve({ records: [] }),
      // 3: recent records (with P&L fields)
      sfQuery(accessToken, `SELECT ${usefulFields.join(', ')} FROM stem__c ${whereClause} ORDER BY CreatedDate DESC LIMIT 50`),
      // 4: disputed count
      hasDispute
        ? sfQuery(accessToken, `SELECT COUNT(Id) total FROM stem__c WHERE Dispute__c = true ${where ? `AND (${where})` : ''}`)
        : Promise.resolve({ records: [] }),
      // 5: count distinct accounts (via GROUP BY)
      accountField
        ? sfQuery(accessToken, `SELECT ${accountField} acct, COUNT(Id) cnt FROM stem__c ${whereClause} GROUP BY ${accountField}`)
        : Promise.resolve({ records: [] }),
      // 6: sum buyer invoices
      buyerAmountField
        ? sfQuery(accessToken, `SELECT SUM(${buyerAmountField}) total FROM stem__c ${whereClause}`)
        : Promise.resolve({ records: [] }),
      // 7: sum supplier invoices
      supplierAmountField
        ? sfQuery(accessToken, `SELECT SUM(${supplierAmountField}) total FROM stem__c ${whereClause}`)
        : Promise.resolve({ records: [] }),
    ];

    const results = await Promise.allSettled(queries);
    const getValue = (r) => r.status === 'fulfilled' ? r.value : { records: [], totalSize: 0 };

    const totalRes      = getValue(results[0]);
    const statusRes     = getValue(results[1]);
    const typeRes       = getValue(results[2]);
    const recentRes     = getValue(results[3]);
    const disputedRes   = getValue(results[4]);
    const accountsRes   = getValue(results[5]);
    const buyerRes      = getValue(results[6]);
    const supplierRes   = getValue(results[7]);

    const recentStems = (recentRes.records || []).map(({ attributes, ...rest }) => rest);

    // Total profit = SUM(buyer invoice) - SUM(supplier invoice)
    const totalBuyer = buyerRes.records?.[0]?.total ?? null;
    const totalSupplier = supplierRes.records?.[0]?.total ?? null;
    const totalProfit = (totalBuyer != null && totalSupplier != null)
      ? totalBuyer - totalSupplier
      : null;

    // Count distinct non-null accounts
    const accountCount = accountsRes.records
      ? accountsRes.records.filter(r => r.acct != null).length
      : null;

    return Response.json({
      stemTotal: totalRes.records?.[0]?.total ?? 0,
      accountCount,
      totalBuyer,
      totalSupplier,
      totalProfit,
      disputedCount: disputedRes.records?.[0]?.total ?? null,
      stemByStatus: (statusRes.records || []).map(r => ({ label: r.val || 'Unknown', value: r.total })),
      stemByType: (typeRes.records || []).map(r => ({ label: r.val || 'Unknown', value: r.total })),
      recentStems,
      // debug info
      buyerAmountField,
      supplierAmountField,
      accountField,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});