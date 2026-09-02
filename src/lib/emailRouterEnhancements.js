const METRIC_STORAGE_KEY = 'fcos:email-router-session-metrics';
const TRUSTED_DOMAIN_STORAGE_KEY = 'fcos:email-router-trusted-sender-domains';
const MAX_METRICS = 120;

export const DEFAULT_TRUSTED_EMAIL_IMAGE_DOMAINS = Object.freeze([
  'cosulich.com.hk',
  'cosulich.mc',
]);

function safeStorage(storage = globalThis.sessionStorage) {
  try {
    if (!storage) return null;
    storage.getItem(METRIC_STORAGE_KEY);
    return storage;
  } catch {
    return null;
  }
}
export function senderDomain(message) {
  const address = String(message?.from?.email || message?.from?.address || '').trim().toLowerCase();
  const separator = address.lastIndexOf('@');
  return separator > 0 ? address.slice(separator + 1).replace(/^www\./, '') : '';
}

export function trustedEmailImageDomains(storage = globalThis.localStorage) {
  let stored = [];
  try {
    const parsed = JSON.parse(storage?.getItem(TRUSTED_DOMAIN_STORAGE_KEY) || '[]');
    if (Array.isArray(parsed)) stored = parsed;
  } catch { /* Invalid per-user preference falls back to the corporate defaults. */ }
  return [...new Set([...DEFAULT_TRUSTED_EMAIL_IMAGE_DOMAINS, ...stored]
    .map((value) => String(value || '').trim().toLowerCase())
    .filter((value) => /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(value)))];
}

export function trustEmailImageDomain(domain, storage = globalThis.localStorage) {
  const normalized = String(domain || '').trim().toLowerCase();
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(normalized)) return trustedEmailImageDomains(storage);
  const next = [...new Set([...trustedEmailImageDomains(storage), normalized])];
  try { storage?.setItem(TRUSTED_DOMAIN_STORAGE_KEY, JSON.stringify(next.filter((value) => !DEFAULT_TRUSTED_EMAIL_IMAGE_DOMAINS.includes(value)))); } catch { /* Preference remains session-only when storage is unavailable. */ }
  return next;
}

export function emailImageSourceSummary(value) {
  const html = String(value || '');
  const images = html.match(/<img\b[^>]*>/gi) || [];
  let remote = 0;
  let tracking = 0;
  for (const image of images) {
    const source = image.match(/\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const src = String(source?.[1] || source?.[2] || source?.[3] || '').trim();
    if (/^https?:/i.test(src)) remote += 1;
    const width = Number(image.match(/\bwidth\s*=\s*["']?(\d+)/i)?.[1]);
    const height = Number(image.match(/\bheight\s*=\s*["']?(\d+)/i)?.[1]);
    const hiddenStyle = /\b(?:display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?:\D|$))/i.test(image);
    if ((width > 0 && width <= 2 && height > 0 && height <= 2) || hiddenStyle) tracking += 1;
  }
  return { total: images.length, remote, tracking };
}

export function attachmentIntelligence(attachments = []) {
  const duplicateKeys = new Map();
  for (const attachment of attachments) {
    const name = String(attachment?.name || attachment?.fileName || '').trim().toLowerCase();
    const key = `${name}:${Number(attachment?.size || 0)}`;
    duplicateKeys.set(key, (duplicateKeys.get(key) || 0) + 1);
  }
  return attachments.map((attachment) => {
    const name = String(attachment?.name || attachment?.fileName || 'Attachment');
    const extension = name.includes('.') ? name.split('.').at(-1).toLowerCase() : '';
    const contentType = String(attachment?.contentType || attachment?.content_type || '').toLowerCase();
    const dangerous = ['exe', 'msi', 'bat', 'cmd', 'com', 'js', 'jse', 'vbs', 'vbe', 'ps1', 'scr', 'jar', 'hta'].includes(extension);
    const macroEnabled = ['docm', 'xlsm', 'pptm'].includes(extension);
    const expected = ({ pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', txt: 'text/plain' })[extension];
    const mismatch = Boolean(expected && contentType && !contentType.startsWith(expected));
    const duplicate = (duplicateKeys.get(`${name.trim().toLowerCase()}:${Number(attachment?.size || 0)}`) || 0) > 1;
    const warnings = [
      dangerous ? 'Potentially unsafe file type' : null,
      macroEnabled ? 'Macro-enabled Office file' : null,
      mismatch ? 'Filename and content type do not match' : null,
      duplicate ? 'Duplicate filename and size' : null,
    ].filter(Boolean);
    return { dangerous, macroEnabled, mismatch, duplicate, warnings };
  });
}

export function recordEmailRouterClientMetric(metric, storage = safeStorage()) {
  if (!storage || !metric?.operation) return;
  let rows = [];
  try {
    const parsed = JSON.parse(storage.getItem(METRIC_STORAGE_KEY) || '[]');
    if (Array.isArray(parsed)) rows = parsed;
  } catch { /* Start a fresh redacted session metric list. */ }
  rows.push({
    operation: String(metric.operation).replace(/[^a-z0-9_.-]/gi, '_').slice(0, 80),
    durationMs: Number.isFinite(Number(metric.durationMs)) ? Math.max(0, Math.round(Number(metric.durationMs))) : null,
    outcome: String(metric.outcome || 'observed').replace(/[^a-z0-9_.-]/gi, '_').slice(0, 40),
    at: new Date().toISOString(),
  });
  try { storage.setItem(METRIC_STORAGE_KEY, JSON.stringify(rows.slice(-MAX_METRICS))); } catch { /* Metrics are best effort and content-free. */ }
}

export function emailRouterClientMetrics(storage = safeStorage()) {
  try {
    const parsed = JSON.parse(storage?.getItem(METRIC_STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.slice(-MAX_METRICS) : [];
  } catch {
    return [];
  }
}

export function summarizeEmailRouterMetrics(rows = []) {
  const grouped = {};
  for (const row of rows) {
    const key = String(row?.operation || 'unknown');
    if (!grouped[key]) grouped[key] = { operation: key, count: 0, failures: 0, durations: [] };
    grouped[key].count += 1;
    if (row?.outcome === 'failed' || row?.outcome === 'uncertain' || row?.outcome === 'blocked') grouped[key].failures += 1;
    if (Number.isFinite(Number(row?.durationMs))) grouped[key].durations.push(Number(row.durationMs));
  }
  return Object.values(grouped).map((group) => {
    const sorted = group.durations.sort((a, b) => a - b);
    const averageMs = sorted.length ? Math.round(sorted.reduce((sum, value) => sum + value, 0) / sorted.length) : null;
    const p95Ms = sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] : null;
    return { operation: group.operation, count: group.count, failures: group.failures, averageMs, p95Ms };
  }).sort((left, right) => right.count - left.count || left.operation.localeCompare(right.operation));
}

export function emailRouterShortcut(event, { hasMessage = false } = {}) {
  if (event?.metaKey || event?.ctrlKey || event?.altKey) return null;
  const target = event?.target;
  if (target?.closest?.('input, textarea, select, [contenteditable="true"], [role="dialog"]')) return null;
  const key = String(event?.key || '').toLowerCase();
  if (key === '/' || key === 's') return 'focus_search';
  if (key === '?' ) return 'show_shortcuts';
  if (key === 'j' || key === 'arrowdown') return 'next_message';
  if (key === 'k' || key === 'arrowup') return 'previous_message';
  if (!hasMessage) return null;
  if (key === 'e') return 'archive';
  if (key === 'm') return 'market_report';
  if (key === 'delete' || key === '#') return 'trash';
  if (key === 'r') return 'focus_route';
  return null;
}
