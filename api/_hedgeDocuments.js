import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { jsPDF } from 'jspdf';
import { resolveGraphEmailSender, sendGraphPurposeMail } from './_graphEmail.js';
import { hedgeSettlementPaymentDirection } from '../src/hedge/lib/domain.js';

const BUCKET = 'hedge-documents';
const MAX_PDF_BYTES = 3 * 1024 * 1024;
const LOGO_DATA_URL = (() => {
  try {
    return `data:image/jpeg;base64,${readFileSync(new URL('./assets/hedge-letterhead-logo.jpg', import.meta.url)).toString('base64')}`;
  } catch {
    return null;
  }
})();

function hedgeDocumentError(message, statusCode = 400, code = null) {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) error.code = code;
  return error;
}

function number(value, fallback = 0) {
  const result = Number(value);
  return Number.isFinite(result) ? result : fallback;
}

function money(value) {
  return Math.abs(number(value)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function signedMoney(value) {
  const amount = number(value);
  if (Math.abs(amount) < 0.005) return '0.00';
  return `${amount > 0 ? '+' : '-'}${money(amount)}`;
}

function displayDate(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : String(value || '-');
}

function displayMonth(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{1,2})$/);
  if (!match) return String(value || '-');
  return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(match[2]) - 1]}-${match[1]}`;
}

export function normalizeHedgeInvoice(input = {}) {
  const invoice = input.invoice || input;
  const lines = Array.isArray(invoice.lineItems) ? invoice.lineItems : Array.isArray(invoice.line_items) ? invoice.line_items : [];
  const lineItems = lines.map((line) => {
    const mtmValue = number(line.mtmValue ?? line.mtm_value);
    const handlingFee = number(line.handlingFee ?? line.handling_fee);
    return {
      product: String(line.product || ''),
      direction: String(line.direction || ''),
      quantity: number(line.quantity),
      unit: String(line.unit || 'MT'),
      price: number(line.price),
      mtmValue,
      handlingFee,
      netValue: number(line.netValue ?? line.net_value, mtmValue - handlingFee),
    };
  });
  const netAmount = invoice.netAmount ?? invoice.subtotal;
  const counterparty = typeof invoice.counterparty === 'object' && invoice.counterparty
    ? invoice.counterparty
    : { full_name: String(invoice.counterparty || 'COUNTERPARTY') };
  const paymentDirection = hedgeSettlementPaymentDirection(number(netAmount, lineItems.reduce((sum, line) => sum + line.netValue, 0)), counterparty);
  return {
    invoiceNumber: String(invoice.invoiceNumber || invoice.invoice_number || 'FCBHK Invoice').slice(0, 100),
    invoiceDate: invoice.invoiceDate || invoice.issue_date || '',
    settlementMonth: invoice.settlementMonth || invoice.settlement_month || '',
    lineItems,
    totalMtm: number(invoice.totalMtm ?? invoice.total_mtm, lineItems.reduce((sum, line) => sum + line.mtmValue, 0)),
    totalHandling: number(invoice.totalHandling ?? invoice.total_handling, lineItems.reduce((sum, line) => sum + line.handlingFee, 0)),
    netAmount: paymentDirection.signedAmount,
    isReceivable: paymentDirection.isReceivable,
    paymentDirection,
    counterparty,
  };
}

export function generateHedgeInvoicePdf(input = {}) {
  const invoice = normalizeHedgeInvoice(input);
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const margin = 16;
  const pageWidth = 210;
  const right = pageWidth - margin;
  let y = 12;

  if (LOGO_DATA_URL) doc.addImage(LOGO_DATA_URL, 'JPEG', 74, y, 62, 24);
  y += 29;
  doc.setTextColor(25, 31, 35);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('FRATELLI COSULICH BUNKERS (HK) LTD', pageWidth / 2, y, { align: 'center' });
  y += 5;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.text('UNITS 02-03, 23/F, PLAZA 228, 228 WAN CHAI ROAD, HONG KONG', pageWidth / 2, y, { align: 'center' });
  y += 8;
  doc.setFillColor(180, 30, 30);
  doc.rect(0, y, pageWidth, 11, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text(invoice.isReceivable ? 'DEBIT NOTE - OTC SWAP SETTLEMENT' : 'CREDIT NOTE - OTC SWAP SETTLEMENT', pageWidth / 2, y + 7, { align: 'center' });
  y += 19;

  doc.setTextColor(30, 30, 35);
  doc.setFontSize(9);
  doc.text(`No.: ${invoice.invoiceNumber}`, margin, y);
  doc.text(`Date: ${displayDate(invoice.invoiceDate)}`, right, y, { align: 'right' });
  y += 6;
  doc.text(`Settlement: ${displayMonth(invoice.settlementMonth)}`, right, y, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.text(String(invoice.counterparty.full_name || 'COUNTERPARTY'), margin, y);
  y += 5;
  for (const address of [invoice.counterparty.address_line1, invoice.counterparty.address_line2, invoice.counterparty.address_line3].filter(Boolean)) {
    doc.text(String(address), margin, y);
    y += 4;
  }
  if (invoice.counterparty.attention) {
    doc.text(`Attn: ${invoice.counterparty.attention}`, margin, y);
    y += 5;
  }
  y += 2;
  doc.setFillColor(invoice.isReceivable ? 230 : 255, invoice.isReceivable ? 245 : 244, invoice.isReceivable ? 238 : 220);
  doc.rect(margin, y, right - margin, 14, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text(`PAYMENT DIRECTION: ${invoice.paymentDirection.payer.shortName} PAYS ${invoice.paymentDirection.payee.shortName}`, margin + 3, y + 5);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.text(`Beneficiary: ${invoice.paymentDirection.beneficiary.fullName}`, margin + 3, y + 10);
  y += 19;

  const headers = ['Product', 'Side', 'Quantity', 'Price', 'MTM', 'Charges', 'Net'];
  const widths = [29, 18, 27, 24, 27, 25, 28];
  const starts = widths.reduce((result, width, index) => [...result, index ? result[index - 1] + widths[index - 1] : margin], []);
  const drawHeader = () => {
    doc.setFillColor(238, 242, 240);
    doc.rect(margin, y, right - margin, 7, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    headers.forEach((header, index) => doc.text(header, starts[index] + 1, y + 4.7));
    y += 7;
  };
  drawHeader();
  doc.setFont('helvetica', 'normal');
  for (const line of invoice.lineItems) {
    if (y > 260) {
      doc.addPage();
      y = 18;
      drawHeader();
    }
    const cells = [line.product, line.direction, `${line.quantity.toLocaleString('en-US')} ${line.unit}`, `$${money(line.price)}`, signedMoney(line.mtmValue), signedMoney(line.handlingFee), signedMoney(line.netValue)];
    cells.forEach((cell, index) => doc.text(String(cell), starts[index] + 1, y + 4.8, { maxWidth: widths[index] - 2 }));
    doc.setDrawColor(220, 224, 222);
    doc.line(margin, y + 7, right, y + 7);
    y += 8;
  }
  y += 5;
  doc.setFont('helvetica', 'bold');
  doc.text(`Counterparty MTM: USD ${signedMoney(invoice.totalMtm)}`, right, y, { align: 'right' });
  y += 5;
  doc.text(`Fee impact: USD ${signedMoney(invoice.totalHandling)}`, right, y, { align: 'right' });
  y += 6;
  doc.setFontSize(11);
  doc.text(`${invoice.paymentDirection.payer.shortName} pays ${invoice.paymentDirection.payee.shortName}: USD ${money(invoice.netAmount)}`, right, y, { align: 'right' });
  y += 14;
  doc.setFontSize(8);
  doc.text(`Beneficiary: ${invoice.paymentDirection.beneficiary.fullName}`, margin, y);
  y += 5;
  doc.setFont('helvetica', 'normal');
  if (invoice.paymentDirection.beneficiaryBankConfigured) {
    doc.text(`Bank: ${invoice.paymentDirection.beneficiary.bankName} | SWIFT: ${invoice.paymentDirection.beneficiary.bankSwift || 'Not provided'}`, margin, y);
    y += 5;
    doc.text(`Account: ${invoice.paymentDirection.beneficiary.accountNumber}`, margin, y);
    if (invoice.paymentDirection.beneficiary.intermediaryBank) {
      y += 5;
      doc.text(`Intermediary: ${invoice.paymentDirection.beneficiary.intermediaryBank}${invoice.paymentDirection.beneficiary.intermediarySwift ? ` | SWIFT: ${invoice.paymentDirection.beneficiary.intermediarySwift}` : ''}`, margin, y);
    }
  } else {
    doc.text('Payment instructions: Obtain directly from the beneficiary; banking details are not configured in FCOS.', margin, y);
  }
  doc.setFontSize(7);
  doc.setTextColor(100, 100, 105);
  doc.text('Computer generated document. Registered in Hong Kong.', pageWidth / 2, 288, { align: 'center' });

  const buffer = Buffer.from(doc.output('arraybuffer'));
  if (buffer.length > MAX_PDF_BYTES) throw hedgeDocumentError('The generated Hedge Desk invoice exceeds the 3 MB email limit.', 400);
  return { buffer, invoice, filename: `${invoice.invoiceNumber.replace(/[^a-z0-9._-]+/gi, '_')}.pdf` };
}

async function invoiceRecord(client, invoiceId) {
  const { data, error } = await client.from('hedge_invoices').select('*').eq('id', String(invoiceId || '')).maybeSingle();
  if (error) throw hedgeDocumentError(`Invoice could not be loaded: ${error.message}`, 502);
  if (!data) throw hedgeDocumentError('Invoice was not found.', 404);
  return data;
}

async function invoiceCounterparty(client, shortName) {
  if (!shortName) return null;
  const { data, error } = await client
    .from('hedge_counterparties')
    .select('short_name,full_name,address_line1,address_line2,address_line3,attention,bank_name,bank_swift,intermediary_bank,intermediary_swift,account_number')
    .eq('short_name', String(shortName))
    .maybeSingle();
  if (error) throw hedgeDocumentError(`Counterparty payment details could not be loaded: ${error.message}`, 502);
  return data || null;
}

async function authoritativeInvoicePayload(client, invoice, requestedPayload = null) {
  if (!invoice) return requestedPayload || {};
  const storedPayload = invoice.pdf_payload || requestedPayload || {};
  const counterparty = await invoiceCounterparty(client, invoice.counterparty);
  return {
    ...storedPayload,
    invoiceNumber: invoice.invoice_number,
    invoiceDate: invoice.issue_date,
    settlementMonth: invoice.settlement_month,
    lineItems: storedPayload.lineItems || invoice.line_items || [],
    netAmount: invoice.subtotal,
    counterparty: counterparty
      ? { ...(storedPayload.counterparty || {}), ...counterparty }
      : storedPayload.counterparty || { short_name: invoice.counterparty, full_name: invoice.counterparty },
  };
}

export async function saveHedgeInvoicePdf(client, profile, body = {}) {
  const action = String(body.action || 'save_invoice_pdf');
  if (action === 'get_invoice_pdf') {
    const storagePath = String(body.storagePath || '').replace(/^supabase:\/\/hedge-documents\//, '');
    if (!storagePath || storagePath.includes('..')) throw hedgeDocumentError('The invoice document path is invalid.', 400);
    const { data, error } = await client.storage.from(BUCKET).createSignedUrl(storagePath, 300);
    if (error) throw hedgeDocumentError(`Invoice preview could not be prepared: ${error.message}`, 502);
    return { ok: true, url: data.signedUrl, expiresIn: 300 };
  }

  const invoice = await invoiceRecord(client, body.invoiceId);
  const encoded = String(body.pdfBase64 || '').replace(/^data:application\/pdf;base64,/, '');
  const buffer = Buffer.from(encoded, 'base64');
  if (!buffer.length || buffer.subarray(0, 4).toString() !== '%PDF') throw hedgeDocumentError('The invoice PDF is invalid.', 400);
  if (buffer.length > MAX_PDF_BYTES) throw hedgeDocumentError('The invoice PDF exceeds the 3 MB limit.', 400);
  const storagePath = `invoices/${invoice.id}/${randomUUID()}.pdf`;
  const upload = await client.storage.from(BUCKET).upload(storagePath, buffer, { contentType: 'application/pdf', upsert: false });
  if (upload.error) throw hedgeDocumentError(`Invoice PDF could not be stored: ${upload.error.message}`, 502);
  const displayName = `${invoice.invoice_number || 'Hedge-invoice'}.pdf`;
  const document = await client.from('hedge_documents').insert({
    invoice_id: invoice.id,
    storage_path: storagePath,
    display_name: displayName,
    mime_type: 'application/pdf',
    size_bytes: buffer.length,
    sha256: createHash('sha256').update(buffer).digest('hex'),
    created_by: profile.id,
    created_by_email: profile.email,
  }).select('*').single();
  if (document.error) {
    await client.storage.from(BUCKET).remove([storagePath]);
    throw hedgeDocumentError(`Invoice document metadata could not be saved: ${document.error.message}`, 502);
  }
  const reference = `supabase://${BUCKET}/${storagePath}`;
  const update = await client.from('hedge_invoices').update({ pdf_data_url: reference, updated_by_id: profile.id }).eq('id', invoice.id).eq('revision', invoice.revision).select('revision').maybeSingle();
  if (update.error || !update.data) throw hedgeDocumentError('The invoice changed before its PDF could be linked. Refresh and try again.', 409);
  return { ok: true, storagePath: reference, documentId: document.data.id, fileName: displayName };
}

export async function sendHedgeInvoiceEmail(client, profile, body = {}, { mailboxSnapshot = null } = {}) {
  const invoice = body.invoiceId ? await invoiceRecord(client, body.invoiceId) : null;
  const documentPayload = await authoritativeInvoicePayload(client, invoice, body.pdfPayload || null);
  const generated = generateHedgeInvoicePdf(invoice ? documentPayload : body);
  const message = {
    to: body.to,
    cc: body.cc,
    bcc: body.bcc,
    subject: String(body.subject || generated.invoice.invoiceNumber),
    html: String(body.body || body.html || ''),
    text: String(body.text || ''),
    attachments: [{ filename: generated.filename, contentType: 'application/pdf', contentBase64: generated.buffer.toString('base64') }],
  };
  const result = await sendGraphPurposeMail({ client, purposeKey: 'hedge_settlement', message, mailboxSnapshot });
  if (invoice) {
    const sentAt = new Date().toISOString();
    const update = await client.from('hedge_invoices').update({
      status: 'Sent',
      email_sent_at: sentAt,
      email_sent_to: String(body.to || ''),
      email_sent_cc: String(body.cc || ''),
      sender_mailbox_snapshot: result.senderAddress,
      updated_by_id: profile.id,
    }).eq('id', invoice.id).eq('revision', invoice.revision).select('revision').maybeSingle();
    if (update.error || !update.data) {
      const error = hedgeDocumentError('The email was accepted by Microsoft Graph, but FCOS could not confirm the invoice status. Review before retrying.', 502, 'HEDGE_EMAIL_CONFIRMATION_UNCERTAIN');
      error.mailDeliveryUncertain = true;
      throw error;
    }
  }
  return { ok: true, ...result, invoiceNumber: generated.invoice.invoiceNumber };
}

export async function sendHedgeInvoiceEmailIdempotent(client, profile, body = {}) {
  const idempotencyKey = String(body.idempotencyKey || body.idempotency_key || '').trim();
  if (!idempotencyKey) throw hedgeDocumentError('An idempotency key is required for Hedge Desk email delivery.', 400);
  const requestHash = createHash('sha256').update(JSON.stringify({
    invoiceId: body.invoiceId || null,
    to: body.to || '',
    cc: body.cc || '',
    bcc: body.bcc || '',
    subject: body.subject || '',
    body: body.body || body.html || '',
  })).digest('hex');
  const existing = await client.from('hedge_integration_operations').select('*').eq('idempotency_key', idempotencyKey).maybeSingle();
  if (existing.error) throw hedgeDocumentError(`Email reservation could not be checked: ${existing.error.message}`, 502);
  if (existing.data) {
    if (existing.data.request_hash !== requestHash) throw hedgeDocumentError('This email delivery key was already used for different content.', 409);
    if (existing.data.status === 'succeeded') return { ...existing.data.response, idempotency_replayed: true };
    if (existing.data.status === 'processing') throw hedgeDocumentError('This email delivery is already running.', 409);
    if (existing.data.status === 'uncertain' && body.confirmUncertainResend !== true) {
      throw hedgeDocumentError('This email may already have been delivered. Confirm the uncertain resend before trying again.', 409);
    }
  }
  const mailboxSnapshot = existing.data?.sender_mailbox_snapshot
    ? { id: existing.data.sender_mailbox_id || null, emailAddress: existing.data.sender_mailbox_snapshot }
    : await resolveGraphEmailSender(client, 'hedge_settlement').then((sender) => ({
        id: sender.mailboxId,
        emailAddress: sender.emailAddress,
      }));
  const reservation = {
    idempotency_key: idempotencyKey,
    operation: 'hedge_invoice_email',
    actor_user_id: profile.id,
    actor_email: profile.email,
    request_hash: requestHash,
    sender_mailbox_id: mailboxSnapshot.id,
    sender_mailbox_snapshot: mailboxSnapshot.emailAddress,
    status: 'processing',
    error: null,
  };
  const saved = existing.data
    ? await client.from('hedge_integration_operations').update(reservation).eq('id', existing.data.id).select('*').single()
    : await client.from('hedge_integration_operations').insert(reservation).select('*').single();
  if (saved.error) throw hedgeDocumentError(`Email delivery could not be reserved: ${saved.error.message}`, 502);
  try {
    const result = await sendHedgeInvoiceEmail(client, profile, body, { mailboxSnapshot });
    await client.from('hedge_integration_operations').update({ status: 'succeeded', response: result }).eq('id', saved.data.id);
    return result;
  } catch (sendError) {
    const uncertain = sendError.mailDeliveryUncertain === true || sendError.code === 'MICROSOFT_GRAPH_SEND_UNCERTAIN';
    await client.from('hedge_integration_operations').update({ status: uncertain ? 'uncertain' : 'failed', error: String(sendError.code || sendError.message || 'Email failure').slice(0, 500) }).eq('id', saved.data.id);
    throw sendError;
  }
}
