import { requireExternalActionGate } from './_externalActionGates.js';

function smtpConfig(smtp = {}) {
  const host = smtp.host || process.env.SMTP_HOST;
  const port = Number(smtp.port || process.env.SMTP_PORT || 587);
  const user = smtp.user || process.env.SMTP_USER;
  const pass = smtp.password || smtp.pass || process.env.SMTP_PASSWORD;
  const secure = smtp.secure != null
    ? smtp.secure === true || smtp.secure === 'true'
    : process.env.SMTP_SECURE != null
      ? process.env.SMTP_SECURE === 'true'
      : port === 465;
  return { host, port, user, pass, secure: Boolean(secure) };
}

export async function createSmtpTransport(smtp = {}, options = {}) {
  requireExternalActionGate('email_delivery');
  const config = smtpConfig(smtp);
  if (!config.host || !config.user || !config.pass) {
    throw new Error('Missing SMTP credentials. Configure SMTP_HOST, SMTP_USER, and SMTP_PASSWORD in Vercel.');
  }
  const nodemailer = await import('nodemailer');
  const createTransport = nodemailer.createTransport || nodemailer.default?.createTransport;
  if (!createTransport) throw new Error('SMTP email library failed to load.');
  return createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.pass },
    ...(options.pool ? {
      pool: true,
      maxConnections: Math.max(1, Math.min(Number(options.maxConnections) || 3, 10)),
      maxMessages: Math.max(1, Math.min(Number(options.maxMessages) || 100, 500)),
    } : {}),
  });
}

export async function sendWithSmtp({
  smtp = {},
  transporter = null,
  from,
  to,
  cc,
  bcc,
  subject,
  html,
  text,
}) {
  requireExternalActionGate('email_delivery');
  const ownedTransporter = transporter || await createSmtpTransport(smtp);
  try {
    const result = await ownedTransporter.sendMail({ from, to, cc, bcc, subject, html, text });
    return { id: result.messageId, accepted: result.accepted, rejected: result.rejected };
  } finally {
    if (!transporter && typeof ownedTransporter.close === 'function') ownedTransporter.close();
  }
}

export function smtpAddressParts(value) {
  const raw = String(value || '').trim();
  if (!raw) return { name: '', email: '' };
  const email = raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || '';
  const name = email ? raw.replace(email, '').replace(/[<>()"]/g, '').trim() : '';
  return { name, email };
}

export function smtpAuthenticatedFromAddress(smtp = {}, requestedFrom = '') {
  const authenticatedEmail = smtpAddressParts(smtp.user || process.env.SMTP_USER).email;
  if (!authenticatedEmail) return '';
  const requested = smtpAddressParts(requestedFrom);
  return requested.name ? `${requested.name} <${authenticatedEmail}>` : authenticatedEmail;
}

export function isSmtpSendAsDenied(error) {
  return /SendAsDenied|MapiExceptionSendAsDenied|not allowed to send as/i.test(String(error?.message || error || ''));
}

export function smtpSendAsDeniedError(smtp = {}, requestedFrom = '') {
  const authenticatedEmail = smtpAddressParts(smtp.user || process.env.SMTP_USER).email || 'the authenticated SMTP mailbox';
  const requestedEmail = smtpAddressParts(requestedFrom).email || 'the configured From address';
  const error = new Error(`Microsoft 365 rejected ${requestedEmail} as the sender. Use ${authenticatedEmail} as From Email or grant that mailbox Send As permission.`);
  error.status = 400;
  return error;
}

export async function sendWithSmtpSendAsFallback(options) {
  try {
    return { result: await sendWithSmtp(options), from: options.from, sendAsFallback: false };
  } catch (error) {
    if (!isSmtpSendAsDenied(error)) throw error;
    const authenticatedFrom = smtpAuthenticatedFromAddress(options.smtp, options.from);
    const requestedEmail = smtpAddressParts(options.from).email.toLowerCase();
    const authenticatedEmail = smtpAddressParts(authenticatedFrom).email.toLowerCase();
    if (!authenticatedFrom || !authenticatedEmail || requestedEmail === authenticatedEmail) {
      throw smtpSendAsDeniedError(options.smtp, options.from);
    }
    try {
      return {
        result: await sendWithSmtp({ ...options, from: authenticatedFrom }),
        from: authenticatedFrom,
        sendAsFallback: true,
      };
    } catch (retryError) {
      if (isSmtpSendAsDenied(retryError)) throw smtpSendAsDeniedError(options.smtp, authenticatedFrom);
      throw retryError;
    }
  }
}
