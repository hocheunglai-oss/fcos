import { waitUntil } from '@vercel/functions';
import { emailRouterWebhookHandler } from './_emailRouterHandlers.js';

async function body(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}

export default async function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const validationToken = url.searchParams.get('validationToken');
  if (validationToken) {
    res.statusCode = 200;
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    return res.end(validationToken);
  }
  if (req.method !== 'POST') {
    res.statusCode = 405;
    return res.end();
  }
  try {
    const result = await emailRouterWebhookHandler(req, await body(req), { defer: waitUntil });
    res.statusCode = 202;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    return res.end(JSON.stringify(result));
  } catch (error) {
    res.statusCode = error.status || error.statusCode || 500;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    return res.end(JSON.stringify({ error: error.message || 'Webhook request failed.' }));
  }
}
