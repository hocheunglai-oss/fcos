import { appClient } from '@/api/appClient';
import { safeEmailImageSource, sanitizeEmailInlineStyle, stripEmailPresentationComments } from './emailContentSafety';

const ACTION_LABELS = {
  redirect: 'Redirect',
  reply: 'Reply',
  forward: 'Forward',
  archive: 'Archive',
  move: 'Move to Market Report',
  delete: 'Delete',
  undo: 'Undo',
  retry: 'Retry uncertain send',
};

const ALLOWED_TAGS = new Set([
  'a', 'b', 'blockquote', 'br', 'code', 'div', 'em', 'h1', 'h2', 'h3', 'h4', 'hr',
  'i', 'img', 'li', 'ol', 'p', 'pre', 'span', 'strong', 'table', 'tbody', 'td', 'th',
  'thead', 'tr', 'u', 'ul',
]);

const ALLOWED_ATTRIBUTES = new Set([
  'align', 'alt', 'bgcolor', 'border', 'cellpadding', 'cellspacing', 'colspan', 'height',
  'role', 'rowspan', 'style', 'title', 'valign', 'width',
]);

function stringValue(value, fallback = '') {
  if (value == null) return fallback;
  return String(value);
}

function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}

function firstValue(source, keys, fallback = '') {
  for (const key of keys) {
    if (source?.[key] != null && source[key] !== '') return source[key];
  }
  return fallback;
}

function normaliseAddress(value) {
  if (typeof value === 'string') return { email: value, name: value };
  const emailAddress = value?.emailAddress || {};
  return {
    email: stringValue(firstValue(value, ['email', 'address', 'value'], firstValue(emailAddress, ['address']))),
    name: stringValue(firstValue(value, ['name', 'displayName', 'email', 'address'], firstValue(emailAddress, ['name', 'address']))),
  };
}

export function normaliseAddresses(value) {
  if (!value) return [];
  const values = Array.isArray(value)
    ? value
    : typeof value === 'object'
      ? [value]
      : String(value).split(/[;,]/);
  return values.map(normaliseAddress).filter((address) => address.email);
}

export function formatAddresses(value) {
  return normaliseAddresses(value)
    .map((address) => address.name && address.name !== address.email ? `${address.name} <${address.email}>` : address.email)
    .join(', ');
}

export function formatEmailDate(value) {
  if (!value) return 'No date';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return stringValue(value);
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(date);
}

export function normaliseMessage(raw = {}) {
  const flags = raw.flags || {};
  const body = raw.body || {};
  const bodyContent = stripEmailPresentationComments(typeof body === 'object' ? body.content : body);
  const bodyType = String(body?.contentType || '').toLowerCase();
  const recoveredHtml = bodyType !== 'html' && /<(?:!doctype|html|head|body|div|p|br|table|tbody|thead|tr|td|th|ul|ol|li|span|blockquote)\b/i.test(bodyContent);
  return {
    id: stringValue(firstValue(raw, ['id', 'messageId', 'emailId', 'provider_message_id'])),
    threadId: stringValue(firstValue(raw, ['threadId', 'conversationId', 'conversation_id'])),
    subject: stringValue(firstValue(raw, ['subject', 'title']), '(No subject)'),
    preview: stringValue(firstValue(raw, ['preview', 'snippet', 'bodyPreview'])),
    from: normaliseAddress(firstValue(raw, ['from', 'sender'], {})),
    to: normaliseAddresses(firstValue(raw, ['to', 'recipients', 'toRecipients'], [])),
    cc: normaliseAddresses(raw.cc || raw.ccRecipients),
    bcc: normaliseAddresses(raw.bcc || raw.bccRecipients),
    sentAt: firstValue(raw, ['sentAt', 'sentDateTime', 'receivedAt', 'receivedDateTime', 'date', 'createdAt', 'received_at', 'sent_at'], null),
    folder: stringValue(firstValue(raw, ['folder', 'mailbox', 'scope'], 'inbox')).toLowerCase(),
    isRead: Boolean(firstValue(raw, ['isRead', 'read', 'is_read'], flags.read ?? false)),
    isFlagged: Boolean(firstValue(raw, ['isFlagged', 'flagged'], flags.flagged ?? false)),
    hasAttachments: Boolean(firstValue(raw, ['hasAttachments', 'has_attachments'], false)) || arrayValue(raw.attachments).length > 0,
    attachments: arrayValue(raw.attachments),
    bodyHtml: bodyType === 'html' || recoveredHtml ? stringValue(bodyContent) : stripEmailPresentationComments(firstValue(raw, ['bodyHtml', 'html', 'contentHtml'])),
    bodyText: bodyType && bodyType !== 'html' && !recoveredHtml ? stringValue(bodyContent) : stripEmailPresentationComments(firstValue(raw, ['bodyText', 'text', 'contentText'])),
    actionHistory: arrayValue(firstValue(raw, ['actionHistory', 'history', 'actions'], [])),
    detailWarnings: arrayValue(raw.detailWarnings).map((warning) => stringValue(warning)).filter(Boolean),
    raw,
  };
}

export function normaliseListResponse(data = {}) {
  const collection = arrayValue(data.messages || data.items || data.records || data.results).map(normaliseMessage);
  return {
    messages: collection.filter((message) => message.id),
    nextCursor: firstValue(data, ['nextCursor', 'cursorNext', 'next'], null),
    total: Number(firstValue(data, ['total', 'totalCount'], collection.length)),
  };
}

export function normaliseDetailResponse(data = {}) {
  const source = data.message || data.item || data.record || data;
  return normaliseMessage(source);
}

export function actionLabel(action) {
  return ACTION_LABELS[action] || stringValue(action || 'Action');
}

export function newOperationId() {
  return globalThis.crypto?.randomUUID?.() || `email-router-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function isLikelyUncertain(error) {
  return /network|timeout|timed out|unavailable|connection|fetch/i.test(stringValue(error));
}

export function normaliseActionResult(data = {}, fallbackAction) {
  const serverStatus = stringValue(firstValue(data, ['status', 'outcome', 'state'], '')).toLowerCase();
  const error = stringValue(firstValue(data, ['error', 'message'], ''));
  const action = firstValue(data, ['action', 'actionType'], fallbackAction);
  const status = serverStatus === 'confirmed' || serverStatus === 'success' || serverStatus === 'completed'
    ? 'confirmed'
    : ['queued', 'prepared', 'reserved', 'draft_created'].includes(serverStatus)
      ? 'draft_created'
      : serverStatus === 'submitted'
        ? 'submitted'
      : ['uncertain', 'submission_unknown'].includes(serverStatus) || isLikelyUncertain(error)
        ? 'uncertain'
        : error || serverStatus === 'failed' || serverStatus === 'error'
          ? 'failed'
          : 'submitted';
  return {
    status,
    action,
    tracking: data?.tracking === true,
    deliveryConfirmed: data?.deliveryConfirmed === true,
    filingNeedsReview: data?.filingNeedsReview === true,
    filingRetryAllowed: data?.filingRetryAllowed === true,
    filingState: data?.filingState || null,
    filingDestination: data?.filingDestination || null,
    message: error || stringValue(firstValue(data, ['detail', 'description'], status === 'confirmed'
      ? action === 'archive'
        ? 'Microsoft 365 moved the message to Archive.'
        : action === 'delete'
          ? 'Microsoft 365 moved the message to Deleted Items.'
          : action === 'move'
            ? 'Microsoft 365 moved the message to Market Report.'
            : 'Microsoft 365 confirmed the message in Sent Items.'
      : status === 'draft_created'
        ? 'The draft is secured and FCOS is submitting it to Microsoft 365.'
        : status === 'submitted'
          ? 'Microsoft 365 accepted the message. FCOS is confirming it in Sent Items.'
          : data?.tracking === true
            ? 'FCOS is checking Microsoft 365 before allowing any retry.'
            : 'The action outcome could not be confirmed.')),
    undoToken: firstValue(data, ['undoToken', 'undoId', 'reversalToken'], null),
    actionId: firstValue(data, ['actionId', 'id', 'operationId'], null),
    raw: data,
  };
}

function safeHref(value) {
  try {
    const url = new URL(value, window.location.origin);
    return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

function fallbackSanitize(value) {
  return stripEmailPresentationComments(value)
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, '')
    .replace(/<iframe[\s\S]*?>[\s\S]*?<\/iframe>/gi, '')
    .replace(/<img\b[^>]*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*(['"]).*?\1/gi, '')
    .replace(/\s(href|src)\s*=\s*(['"])\s*(?:javascript|data):.*?\2/gi, '');
}

export function sanitizeEmailHtml(value) {
  const html = stripEmailPresentationComments(value);
  if (!html || typeof DOMParser === 'undefined') return fallbackSanitize(html);

  const document = new DOMParser().parseFromString(html, 'text/html');
  const clean = (element) => {
    for (const child of [...element.childNodes]) {
      if (child.nodeType === Node.COMMENT_NODE) {
        child.remove();
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      const tag = child.tagName.toLowerCase();
      if (!ALLOWED_TAGS.has(tag)) {
        child.replaceWith(...child.childNodes);
        clean(element);
        continue;
      }
      for (const attribute of [...child.attributes]) {
        const name = attribute.name.toLowerCase();
        if (tag === 'a' && name === 'href') {
          const href = safeHref(attribute.value);
          if (href) child.setAttribute('href', href);
          else child.removeAttribute(attribute.name);
          continue;
        }
        if (tag === 'img' && name === 'src') {
          const source = safeEmailImageSource(attribute.value);
          if (source) child.setAttribute('src', source);
          else child.removeAttribute(attribute.name);
          continue;
        }
        if (name === 'style') {
          const style = sanitizeEmailInlineStyle(attribute.value);
          if (style) child.setAttribute('style', style);
          else child.removeAttribute(attribute.name);
          continue;
        }
        if (!ALLOWED_ATTRIBUTES.has(name)) child.removeAttribute(attribute.name);
      }
      if (tag === 'a') {
        child.setAttribute('target', '_blank');
        child.setAttribute('rel', 'noreferrer noopener');
      }
      if (tag === 'img') {
        child.setAttribute('loading', 'lazy');
        child.setAttribute('referrerpolicy', 'no-referrer');
      }
      clean(child);
    }
  };
  clean(document.body);
  return document.body.innerHTML;
}

export function plainTextToHtml(value) {
  const escaped = stripEmailPresentationComments(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
  return escaped.split(/\n{2,}/).filter(Boolean).map((paragraph) => `<p>${paragraph.replaceAll('\n', '<br>')}</p>`).join('');
}

async function invoke(name, payload, options = {}) {
  const response = await appClient.functions.invoke(name, payload, options);
  return { data: response?.data || {}, meta: response?.meta || {} };
}

export const emailRouter = {
  async backgroundSync(payload = {}, options) { return invoke('emailRouterBackgroundSync', payload, options); },
  async list(payload, options) {
    const folder = payload?.folder === 'sent' ? 'sentitems' : payload?.folder;
    return invoke('emailRouterList', { ...payload, folder }, options);
  },
  async detail(payload, options) { return invoke('emailRouterDetail', payload, options); },
  async directory(payload = {}, options) { return invoke('emailRouterDirectory', payload, options); },
  async presets(payload = {}, options) { return invoke('emailRouterPresets', payload, options); },
  async leave(payload = {}, options) { return invoke('emailRouterLeave', payload, options); },
  async saveLeave(payload = {}, options) { return invoke('emailRouterLeaveSave', payload, options); },
  async action(payload, options) {
    const directoryIds = payload?.destinationId ? [payload.destinationId] : [];
    const recipients = payload?.recipientAddress ? [{ kind: 'to', address: payload.recipientAddress }] : [];
    return invoke('emailRouterAction', {
      ...payload,
      actionType: payload?.action,
      idempotencyKey: payload?.operationId,
      directoryIds,
      recipients,
      comment: payload?.body,
    }, options);
  },
  async actionStatus(payload, options) { return invoke('emailRouterActionStatus', payload, options); },
  async undo(payload, options) { return invoke('emailRouterUndo', payload, options); },
  async retry(payload, options) { return invoke('emailRouterRetry', payload, options); },
  async retryFiling(payload, options) { return invoke('emailRouterFilingRetry', payload, options); },
  async attachmentUrl(payload, options) { return invoke('emailRouterAttachmentUrl', payload, options); },
  async advisor(payload, options) { return invoke('emailRouterAdvisor', payload, options); },
};
