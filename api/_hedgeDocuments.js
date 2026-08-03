import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { jsPDF } from 'jspdf';
import { resolveGraphEmailSender, sendGraphPurposeMail } from './_graphEmail.js';
import { richTextPlainLength, sanitizeRichText } from './_richText.js';
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
  const ink = [28, 35, 42];
  const muted = [91, 102, 112];
  const border = [214, 220, 224];
  const soft = [246, 248, 249];
  const compactSinglePage = invoice.lineItems.length < 12;
  let y = 0;

  const drawBrandHeader = (continued = false) => {
    if (continued) return 18;
    if (LOGO_DATA_URL) doc.addImage(LOGO_DATA_URL, 'JPEG', 74, 12, 62, 24);
    doc.setTextColor(25, 31, 35);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text('FRATELLI COSULICH BUNKERS (HK) LTD', pageWidth / 2, 41, { align: 'center' });
    doc.setDrawColor(4, 50, 92);
    doc.setLineWidth(0.25);
    doc.line(margin, 44, right, 44);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.2);
    doc.text('UNITS 02-03, 23/F, PLAZA 228, 228 WAN CHAI ROAD, HONG KONG    T +852-25299138    GENERAL@COSULICH.COM.HK', pageWidth / 2, 48, { align: 'center' });
    doc.line(margin, 50, right, 50);
    doc.setFillColor(180, 30, 30);
    doc.rect(0, 54, pageWidth, 11, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text(invoice.isReceivable ? 'DEBIT NOTE - OTC SWAP SETTLEMENT' : 'CREDIT NOTE - OTC SWAP SETTLEMENT', pageWidth / 2, 61, { align: 'center' });
    return 70;
  };

  y = drawBrandHeader();
  doc.setTextColor(...ink);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text(`No.: ${invoice.invoiceNumber}`, margin, y);
  doc.setFont('helvetica', 'normal');
  doc.text(`Date: ${displayDate(invoice.invoiceDate)}`, right, y, { align: 'right' });
  y += 6;

  const leftCardWidth = 104;
  const cardGap = 5;
  const rightCardX = margin + leftCardWidth + cardGap;
  const rightCardWidth = right - rightCardX;
  const counterpartyLines = [
    invoice.counterparty.full_name || 'COUNTERPARTY',
    invoice.counterparty.address_line1,
    invoice.counterparty.address_line2,
    invoice.counterparty.address_line3,
    invoice.counterparty.attention ? `Attention: ${invoice.counterparty.attention}` : null,
  ].filter(Boolean).flatMap((line) => doc.splitTextToSize(String(line), leftCardWidth - 8));
  const cardHeight = Math.max(28, 11 + counterpartyLines.length * 3.5);
  doc.setFillColor(...soft);
  doc.setDrawColor(...border);
  doc.roundedRect(margin, y, leftCardWidth, cardHeight, 1.5, 1.5, 'FD');
  doc.roundedRect(rightCardX, y, rightCardWidth, cardHeight, 1.5, 1.5, 'FD');
  doc.setTextColor(...muted);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.5);
  doc.text('COUNTERPARTY', margin + 4, y + 6);
  doc.text('DOCUMENT DETAILS', rightCardX + 4, y + 6);
  doc.setTextColor(...ink);
  doc.setFontSize(7.8);
  counterpartyLines.forEach((line, index) => {
    doc.setFont('helvetica', index === 0 ? 'bold' : 'normal');
    doc.text(String(line), margin + 4, y + 11 + index * 3.5);
  });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.text('Currency', rightCardX + 4, y + 13);
  doc.text('USD', right - 4, y + 13, { align: 'right' });
  doc.text('Settlement month', rightCardX + 4, y + 19);
  doc.text(displayMonth(invoice.settlementMonth), right - 4, y + 19, { align: 'right' });
  doc.text('Document type', rightCardX + 4, y + 25);
  doc.text(invoice.paymentDirection.invoiceType, right - 4, y + 25, { align: 'right' });
  y += cardHeight + 4;

  const paymentHeight = 32;
  const paymentSummaryX = 128;
  doc.setFillColor(255, 246, 224);
  doc.setDrawColor(...border);
  doc.roundedRect(margin, y, right - margin, paymentHeight, 1.5, 1.5, 'FD');
  doc.setTextColor(...muted);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.5);
  doc.text('PAYMENT DIRECTION:', margin + 4, y + 5.5);
  doc.setTextColor(...ink);
  doc.setFontSize(7.7);
  doc.text(invoice.paymentDirection.payer.fullName, margin + 4, y + 12);
  doc.setFontSize(6.5);
  doc.text('PAYS', margin + 4, y + 18);
  doc.setFontSize(7.7);
  doc.text(invoice.paymentDirection.payee.fullName, margin + 4, y + 25);
  doc.setDrawColor(226, 207, 164);
  doc.setLineWidth(0.2);
  doc.line(paymentSummaryX - 4, y + 4, paymentSummaryX - 4, y + paymentHeight - 4);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.8);
  doc.setTextColor(...muted);
  doc.text('Counterparty MTM', paymentSummaryX, y + 8);
  doc.text(`USD ${signedMoney(invoice.totalMtm)}`, right - 4, y + 8, { align: 'right' });
  doc.text('Fee impact', paymentSummaryX, y + 14);
  doc.text(`USD ${signedMoney(invoice.totalHandling)}`, right - 4, y + 14, { align: 'right' });
  doc.line(paymentSummaryX, y + 18, right - 4, y + 18);
  doc.setTextColor(...ink);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.6);
  doc.text('SETTLEMENT TOTAL', paymentSummaryX, y + 25);
  doc.text(`USD ${money(invoice.netAmount)}`, right - 4, y + 25, { align: 'right' });
  y += paymentHeight + 4;

  const columns = [
    { label: 'Product', x: 16, width: 29, align: 'left' },
    { label: 'Side', x: 45, width: 16, align: 'left' },
    { label: 'Quantity', x: 61, width: 27, align: 'right' },
    { label: 'Price', x: 88, width: 24, align: 'right' },
    { label: 'MTM', x: 112, width: 25, align: 'right' },
    { label: 'Charges', x: 137, width: 24, align: 'right' },
    { label: 'Net', x: 161, width: 33, align: 'right' },
  ];
  const drawTableHeader = () => {
    doc.setFillColor(44, 53, 61);
    const headerHeight = compactSinglePage ? 7 : 8;
    doc.rect(margin, y, right - margin, headerHeight, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(compactSinglePage ? 6.4 : 6.8);
    for (const column of columns) {
      const x = column.align === 'right' ? column.x + column.width - 2 : column.x + 2;
      doc.text(column.label, x, y + (compactSinglePage ? 4.7 : 5.2), { align: column.align });
    }
    y += headerHeight;
  };
  drawTableHeader();

  invoice.lineItems.forEach((line, rowIndex) => {
    const productLines = doc.splitTextToSize(line.product || '-', columns[0].width - 4);
    const rowHeight = compactSinglePage ? Math.max(6.5, productLines.length * 2.5 + 2) : Math.max(9, productLines.length * 3.6 + 4);
    if (y + rowHeight > 263) {
      doc.addPage();
      y = drawBrandHeader(true);
      drawTableHeader();
    }
    if (rowIndex % 2 === 1) {
      doc.setFillColor(...soft);
      doc.rect(margin, y, right - margin, rowHeight, 'F');
    }
    doc.setTextColor(...ink);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(compactSinglePage ? 6.4 : 7.2);
    doc.text(productLines, columns[0].x + 2, y + (compactSinglePage ? 4.2 : 5));
    const values = [
      line.direction || '-',
      `${line.quantity.toLocaleString('en-US')} ${line.unit}`,
      `$${money(line.price)}`,
      signedMoney(line.mtmValue),
      signedMoney(line.handlingFee),
      signedMoney(line.netValue),
    ];
    columns.slice(1).forEach((column, index) => {
      const x = column.align === 'right' ? column.x + column.width - 2 : column.x + 2;
      doc.setFont('helvetica', index === values.length - 1 ? 'bold' : 'normal');
      doc.text(String(values[index]), x, y + (compactSinglePage ? 4.2 : 5), { align: column.align, maxWidth: column.width - 4 });
    });
    doc.setDrawColor(...border);
    doc.setLineWidth(0.2);
    doc.line(margin, y + rowHeight, right, y + rowHeight);
    y += rowHeight;
  });

  const beneficiaryHeight = invoice.paymentDirection.isReceivable ? 32 : 21;
  if (y + 5 + beneficiaryHeight > 278) {
    doc.addPage();
    y = drawBrandHeader(true);
  } else {
    y += 5;
  }
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(...border);
  doc.roundedRect(margin, y, right - margin, beneficiaryHeight, 1.5, 1.5, 'D');
  doc.setTextColor(...muted);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.5);
  doc.text('BENEFICIARY', margin + 4, y + 6);
  doc.setTextColor(...ink);
  doc.setFontSize(8);
  doc.text(invoice.paymentDirection.beneficiary.fullName, margin + 4, y + 12);
  if (invoice.paymentDirection.isReceivable) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.2);
    doc.text(`Bank: ${invoice.paymentDirection.beneficiary.bankName}`, margin + 4, y + 18);
    doc.text(`SWIFT: ${invoice.paymentDirection.beneficiary.bankSwift || '-'}  |  Account: ${invoice.paymentDirection.beneficiary.accountNumber}`, margin + 4, y + 23);
    if (invoice.paymentDirection.beneficiary.intermediaryBank) {
      doc.text(`Intermediary: ${invoice.paymentDirection.beneficiary.intermediaryBank}${invoice.paymentDirection.beneficiary.intermediarySwift ? `  |  SWIFT: ${invoice.paymentDirection.beneficiary.intermediarySwift}` : ''}`, margin + 4, y + 28);
    }
  } else {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.2);
    doc.text(`Settlement is payable by ${invoice.paymentDirection.payer.fullName} against the counterparty's invoice.`, margin + 4, y + 17);
  }

  const pageCount = doc.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page);
    doc.setDrawColor(...border);
    doc.setLineWidth(0.2);
    doc.line(margin, 281, right, 281);
    doc.setTextColor(...muted);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.text('Computer generated document.', pageWidth / 2, 286, { align: 'center' });
    doc.text(`${invoice.invoiceNumber}  |  Page ${page} of ${pageCount}`, right, 286, { align: 'right' });
  }

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
    .select('short_name,full_name,address_line1,address_line2,address_line3,attention')
    .eq('short_name', String(shortName))
    .maybeSingle();
  if (error) throw hedgeDocumentError(`Counterparty invoice details could not be loaded: ${error.message}`, 502);
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
  const sanitizedBody = sanitizeRichText(body.body || body.html || '', 32_768);
  if (!sanitizedBody || richTextPlainLength(sanitizedBody) === 0) throw hedgeDocumentError('The settlement email message is required.', 400, 'HEDGE_EMAIL_BODY_REQUIRED');
  const plainBody = sanitizedBody
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/p>|<\/li>|<\/h[34]>|<\/blockquote>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const message = {
    to: body.to,
    cc: body.cc,
    bcc: body.bcc,
    subject: String(body.subject || generated.invoice.invoiceNumber),
    html: sanitizedBody,
    text: String(body.text || plainBody),
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
  let existingOperation = existing.data;
  if (!existingOperation && body.invoiceId) {
    const prior = await client
      .from('hedge_integration_operations')
      .select('*')
      .eq('operation', 'hedge_invoice_email')
      .contains('response', { invoiceId: String(body.invoiceId) })
      .in('status', ['processing', 'uncertain', 'succeeded'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (prior.error) throw hedgeDocumentError(`Earlier email delivery could not be checked: ${prior.error.message}`, 502);
    existingOperation = prior.data;
  }
  if (existingOperation) {
    if (existingOperation.request_hash !== requestHash && existingOperation.status !== 'failed') throw hedgeDocumentError('This invoice already has a delivery attempt with different content. Review its delivery state before sending again.', 409);
    if (existingOperation.status === 'succeeded') return { ...existingOperation.response, idempotency_replayed: true };
    if (existingOperation.status === 'processing') throw hedgeDocumentError('This email delivery is already running.', 409);
    if (existingOperation.status === 'uncertain' && body.confirmUncertainResend !== true) {
      throw hedgeDocumentError('This email may already have been delivered. Confirm the uncertain resend before trying again.', 409);
    }
  }
  const mailboxSnapshot = existingOperation?.sender_mailbox_snapshot
    ? { id: existingOperation.sender_mailbox_id || null, emailAddress: existingOperation.sender_mailbox_snapshot }
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
    response: {
      ...(existingOperation?.response || {}),
      invoiceId: body.invoiceId ? String(body.invoiceId) : null,
      invoiceNumber: String(body.invoiceNumber || ''),
    },
  };
  const saved = existingOperation
    ? await client.from('hedge_integration_operations').update(reservation).eq('id', existingOperation.id).select('*').single()
    : await client.from('hedge_integration_operations').insert(reservation).select('*').single();
  if (saved.error) throw hedgeDocumentError(`Email delivery could not be reserved: ${saved.error.message}`, 502);
  try {
    const result = await sendHedgeInvoiceEmail(client, profile, body, { mailboxSnapshot });
    await client.from('hedge_integration_operations').update({ status: 'succeeded', response: { ...result, invoiceId: body.invoiceId ? String(body.invoiceId) : null, invoiceNumber: String(body.invoiceNumber || result.invoiceNumber || '') } }).eq('id', saved.data.id);
    return result;
  } catch (sendError) {
    const uncertain = sendError.mailDeliveryUncertain === true || sendError.code === 'MICROSOFT_GRAPH_SEND_UNCERTAIN';
    await client.from('hedge_integration_operations').update({ status: uncertain ? 'uncertain' : 'failed', error: String(sendError.code || sendError.message || 'Email failure').slice(0, 500) }).eq('id', saved.data.id);
    throw sendError;
  }
}
