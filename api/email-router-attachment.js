import { Readable } from 'node:stream';
import { emailRouterAttachmentStreamHandler } from './_emailRouterHandlers.js';

function json(res, status, error) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({ error }));
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return json(res, 405, 'Method not allowed.');
  const startedAt = Date.now();
  try {
    const url = new URL(req.url, 'http://localhost');
    const token = url.searchParams.get('token');
    const attachment = await emailRouterAttachmentStreamHandler(req, { token });
    res.statusCode = 200;
    res.setHeader('content-type', attachment.contentType);
    res.setHeader('cache-control', 'private, no-store, max-age=0');
    res.setHeader('server-timing', `fcos-attachment-setup;dur=${Date.now() - startedAt}`);
    res.setHeader('x-content-type-options', 'nosniff');
    if (attachment.contentLength) res.setHeader('content-length', attachment.contentLength);
    if (!attachment.body) return res.end();
    return Readable.fromWeb(attachment.body).pipe(res);
  } catch (error) {
    return json(res, error.status || error.statusCode || 500, error.message || 'Attachment download is unavailable.');
  }
}
