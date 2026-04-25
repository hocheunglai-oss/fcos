import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const SF_INSTANCE = "https://fratellicosulich.my.salesforce.com";
const SF_API_VERSION = "v59.0";

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { stemId, updates } = body;

    if (!stemId) return Response.json({ error: 'stemId required' }, { status: 400 });

    const { accessToken } = await base44.asServiceRole.connectors.getConnection("salesforce");

    // If updates provided, PATCH the record
    if (updates && Object.keys(updates).length > 0) {
      const patchRes = await fetch(
        `${SF_INSTANCE}/services/data/${SF_API_VERSION}/sobjects/stem__c/${stemId}`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(updates),
        }
      );
      if (!patchRes.ok) {
        const err = await patchRes.json();
        return Response.json({ error: err[0]?.message || 'Update failed' }, { status: 400 });
      }
    }

    // Fetch full record
    const res = await fetch(
      `${SF_INSTANCE}/services/data/${SF_API_VERSION}/sobjects/stem__c/${stemId}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const record = await res.json();

    if (record.errorCode) {
      return Response.json({ error: record.message }, { status: 404 });
    }

    // Remove internal SF metadata
    delete record.attributes;

    return Response.json({ record });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});