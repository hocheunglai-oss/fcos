import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const SF_INSTANCE = "https://fratellicosulich.my.salesforce.com";
const SF_API_VERSION = "v59.0";

async function sfGet(accessToken, path) {
  const res = await fetch(`${SF_INSTANCE}/services/data/${SF_API_VERSION}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  return res.json();
}

async function resolveId(accessToken, id, fields = ['Name']) {
  if (!id) return null;
  // Determine object type from ID prefix (first 3 chars)
  try {
    const res = await sfGet(accessToken, `/sobjects/${id.substring(0, 3)}/${id}?fields=${fields.join(',')}`);
    if (res.errorCode) return null;
    return fields.length === 1 ? res[fields[0]] : res;
  } catch {
    return null;
  }
}

// Resolve using relationship query for reliability
async function resolveViaQuery(accessToken, objectType, id, nameField = 'Name') {
  if (!id) return null;
  try {
    const encoded = encodeURIComponent(`SELECT ${nameField} FROM ${objectType} WHERE Id = '${id}' LIMIT 1`);
    const res = await sfGet(accessToken, `/query/?q=${encoded}`);
    return res.records?.[0]?.[nameField] ?? null;
  } catch {
    return null;
  }
}

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
    const res = await sfGet(accessToken, `/sobjects/stem__c/${stemId}`);

    if (res.errorCode) {
      return Response.json({ error: res.message }, { status: 404 });
    }

    delete res.attributes;

    // Resolve related IDs to names in parallel
    const [vesselName, portName, agentName, accountName, buyerBrokerName, factoringInvoiceName] = await Promise.all([
      res.Vessel__c ? resolveViaQuery(accessToken, 'Vessel__c', res.Vessel__c, 'Name') : Promise.resolve(null),
      res.Port__c ? resolveViaQuery(accessToken, 'Port__c', res.Port__c, 'Name') : Promise.resolve(null),
      res.Agent__c ? resolveViaQuery(accessToken, 'Account', res.Agent__c, 'Name') : Promise.resolve(null),
      res.Account__c ? resolveViaQuery(accessToken, 'Account', res.Account__c, 'Name') : Promise.resolve(null),
      res.Buyer_Broker__c ? resolveViaQuery(accessToken, 'Account', res.Buyer_Broker__c, 'Name') : Promise.resolve(null),
      res.Factoring_Invoice__c ? resolveViaQuery(accessToken, 'Invoice__c', res.Factoring_Invoice__c, 'Name') : Promise.resolve(null),
    ]);

    // Attach resolved names alongside raw IDs
    const record = {
      ...res,
      _Vessel_Name: vesselName,
      _Port_Name: portName,
      _Agent_Name: agentName,
      _Account_Name: accountName,
      _Buyer_Broker_Name: buyerBrokerName,
      _Factoring_Invoice_Name: factoringInvoiceName,
    };

    return Response.json({ record });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});