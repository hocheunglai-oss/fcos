import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const SF_INSTANCE = "https://fratellicosulich.my.salesforce.com";
const SF_API_VERSION = "v59.0";

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { accessToken } = await base44.asServiceRole.connectors.getConnection("salesforce");

    const res = await fetch(`${SF_INSTANCE}/services/data/${SF_API_VERSION}/sobjects/`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const data = await res.json();

    const objects = (data.sobjects || [])
      .filter(o => o.queryable)
      .map(o => ({
        name: o.name,
        label: o.label,
        queryable: o.queryable,
        custom: o.custom
      }));

    return Response.json({ objects });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});