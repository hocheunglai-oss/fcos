import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const SF_INSTANCE = "https://fratellicosulich.my.salesforce.com";
const SF_API_VERSION = "v59.0";

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { recordId, objectType } = body;

    const { accessToken } = await base44.asServiceRole.connectors.getConnection("salesforce");

    const res = await fetch(`${SF_INSTANCE}/services/data/${SF_API_VERSION}/sobjects/${objectType}/${recordId}`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const data = await res.json();

    return Response.json(data);
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});