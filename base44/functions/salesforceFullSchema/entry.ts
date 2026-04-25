import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const SF_INSTANCE = "https://fratellicosulich.my.salesforce.com";
const SF_API_VERSION = "v59.0";

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { accessToken } = await base44.asServiceRole.connectors.getConnection("salesforce");

    // Get list of all queryable objects
    const listRes = await fetch(`${SF_INSTANCE}/services/data/${SF_API_VERSION}/sobjects/`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const listData = await listRes.json();

    const allObjects = (listData.sobjects || []).filter(o => o.queryable);

    // Focus on custom objects + key standard objects to keep it manageable
    const KEY_STANDARD = ['Account', 'Contact', 'Opportunity', 'Lead', 'Case', 'Task', 'User', 'Product2', 'Pricebook2', 'Contract', 'Order'];
    const objects = allObjects.filter(o => o.custom || KEY_STANDARD.includes(o.name));

    // Describe each object in parallel (batched to avoid rate limits)
    const BATCH = 10;
    const described = [];
    for (let i = 0; i < objects.length; i += BATCH) {
      const batch = objects.slice(i, i + BATCH);
      const results = await Promise.allSettled(
        batch.map(o =>
          fetch(`${SF_INSTANCE}/services/data/${SF_API_VERSION}/sobjects/${o.name}/describe/`, {
            headers: { Authorization: `Bearer ${accessToken}` }
          }).then(r => r.json())
        )
      );
      results.forEach((r, idx) => {
        if (r.status === 'fulfilled' && !r.value.errorCode) {
          const d = r.value;
          described.push({
            name: d.name,
            label: d.label,
            custom: d.custom,
            fields: (d.fields || []).map(f => ({
              name: f.name,
              label: f.label,
              type: f.type,
              referenceTo: f.referenceTo || [],
              relationshipName: f.relationshipName || null,
            })),
          });
        }
      });
    }

    // Build relationship edges
    const objectNames = new Set(described.map(o => o.name));
    const edges = [];
    described.forEach(obj => {
      obj.fields.forEach(f => {
        if (f.type === 'reference') {
          f.referenceTo.forEach(target => {
            if (objectNames.has(target)) {
              edges.push({
                from: obj.name,
                to: target,
                field: f.name,
                label: f.label,
              });
            }
          });
        }
      });
    });

    return Response.json({ objects: described, edges });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});