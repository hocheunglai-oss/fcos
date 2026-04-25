import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const SF_INSTANCE = "https://fratellicosulich.my.salesforce.com";
const SF_API_VERSION = "v59.0";

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { soql } = body;

    if (!soql) return Response.json({ error: 'soql query required' }, { status: 400 });

    const { accessToken } = await base44.asServiceRole.connectors.getConnection("salesforce");

    const encodedQuery = encodeURIComponent(soql);
    const res = await fetch(`${SF_INSTANCE}/services/data/${SF_API_VERSION}/query/?q=${encodedQuery}`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const data = await res.json();

    if (data.errorCode) {
      return Response.json({ error: data.message || data.errorCode }, { status: 400 });
    }

    // Fetch all pages
    let records = data.records || [];
    let nextUrl = data.nextRecordsUrl;
    let totalSize = data.totalSize;

    // Limit to 2000 records max for performance
    while (nextUrl && records.length < 2000) {
      const nextRes = await fetch(`${SF_INSTANCE}${nextUrl}`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      const nextData = await nextRes.json();
      records = [...records, ...(nextData.records || [])];
      nextUrl = nextData.nextRecordsUrl;
    }

    // Remove Salesforce internal attributes
    const cleanRecords = records.map(r => {
      const { attributes, ...rest } = r;
      return rest;
    });

    return Response.json({ records: cleanRecords, totalSize, fetched: cleanRecords.length });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});