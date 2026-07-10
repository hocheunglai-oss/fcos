export function disputeWorkflowFileExtension(fileName) {
  const match = String(fileName || '').match(/\.([a-zA-Z0-9]{1,10})$/);
  return match ? match[1].toLowerCase() : '';
}

export function disputeWorkflowHongKongDateToken(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}${value.month}${value.day}`;
}

export function disputeWorkflowDirectionLabel(direction) {
  return {
    from_supplier: 'From Supplier',
    to_supplier: 'To Supplier',
    from_buyer: 'From Buyer',
    to_buyer: 'To Buyer',
  }[direction] || '';
}

export function disputeWorkflowEditableFilename(value, fallback) {
  const normalized = String(value || '')
    .normalize('NFKC')
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '')
    .slice(0, 120)
    .trim();
  return normalized || fallback;
}

export function disputeWorkflowSuggestedBaseName(direction, date = new Date()) {
  return `${disputeWorkflowHongKongDateToken(date)} ${disputeWorkflowDirectionLabel(direction)}`;
}

export function disputeWorkflowAvailableFileName(baseName, extension, existingNames = []) {
  const existing = new Set(existingNames.map((name) => String(name || '').toLowerCase()));
  for (let suffix = 0; suffix < 1000; suffix += 1) {
    const candidate = `${baseName}${suffix ? `-${suffix}` : ''}.${extension}`;
    if (!existing.has(candidate.toLowerCase())) return candidate;
  }
  return null;
}
