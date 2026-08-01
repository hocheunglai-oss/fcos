const ZERO_TOLERANCE = 0.005;
const STATUS_MANAGER_USER_TYPES = new Set(['administrator', 'finance', 'general_manager']);

export function canManageUnofficialCompensationStatus(userType) {
  return STATUS_MANAGER_USER_TYPES.has(String(userType || '').trim());
}

function numberValue(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function textValue(value) {
  return String(value || '').trim();
}

function dateOnly(value) {
  const raw = textValue(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

export function isSalesforceRecordId(value) {
  return /^[a-zA-Z0-9]{15}([a-zA-Z0-9]{3})?$/.test(textValue(value));
}

export function unofficialCompensationAmount({ fixed, lumpSumPrice, quantity, deliveredQuantity, unitPrice }) {
  if (fixed === true) return -Math.abs(numberValue(lumpSumPrice));
  const delivered = numberValue(deliveredQuantity);
  const baseQuantity = Math.abs(delivered) >= ZERO_TOLERANCE ? delivered : numberValue(quantity);
  return -Math.abs(baseQuantity * numberValue(unitPrice));
}

function currencyOf(record, account) {
  return textValue(record?.CurrencyIsoCode || account?.CurrencyIsoCode || 'USD').toUpperCase();
}

function contactOf(record) {
  return {
    id: textValue(record?.Contact__c) || null,
    name: textValue(record?.Contact__r?.Name) || 'No Contact',
  };
}

function claimRow(record, account) {
  const contact = contactOf(record);
  return {
    id: textValue(record.Id),
    name: textValue(record.Name),
    accountId: textValue(record.Account__c),
    contactId: contact.id,
    contactName: contact.name,
    amount: numberValue(record.Amount__c),
    currencyIsoCode: currencyOf(record, account),
    deadlineDate: dateOnly(record.Deadline_Date__c),
    status: textValue(record.Status__c) || 'Opened',
    pic: textValue(record.Buyer_Supplier_Trader__c),
    description: textValue(record.Description__c),
    createdAt: record.CreatedDate || null,
    lastModifiedAt: record.LastModifiedDate || null,
  };
}

function recoveryRow(record, account) {
  const contact = contactOf(record);
  const amount = numberValue(record.Amount__c);
  return {
    id: textValue(record.Id),
    name: textValue(record.Name),
    accountId: textValue(record.Account__c),
    contactId: contact.id,
    contactName: contact.name,
    stemId: textValue(record.STEM__c) || null,
    stemName: textValue(record.STEM__r?.Name),
    stemLineItemId: textValue(record.STEM_Line_Item__c) || null,
    productId: textValue(record.Product__c) || null,
    productName: textValue(record.Product__r?.Name),
    amount,
    recoveredAmount: Math.max(0, -amount),
    currencyIsoCode: currencyOf(record, account),
    fixed: record.Fixed__c === true,
    quantity: record.Quantity__c == null ? null : numberValue(record.Quantity__c),
    deliveredQuantity: record.Quantity_Delivered_Per_BDN__c == null ? null : numberValue(record.Quantity_Delivered_Per_BDN__c),
    unitOfMeasure: textValue(record.Unit_of_Measure__c),
    unitPrice: record.Unit_Price__c == null ? null : numberValue(record.Unit_Price__c),
    lumpSumPrice: record.Lumpsum_Price__c == null ? null : numberValue(record.Lumpsum_Price__c),
    pic: textValue(record.Buyer_Supplier_Trader__c),
    createdAt: record.CreatedDate || null,
    lastModifiedAt: record.LastModifiedDate || null,
  };
}

function groupKey(record, account) {
  const contact = contactOf(record);
  return `${contact.id || 'none'}:${currencyOf(record, account)}`;
}

function daysBetween(fromDate, toDate) {
  if (!fromDate || !toDate) return null;
  const from = Date.parse(`${fromDate}T00:00:00Z`);
  const to = Date.parse(`${toDate}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return Math.round((to - from) / 86_400_000);
}

function statusForBalance(value) {
  if (value > ZERO_TOLERANCE) return 'outstanding';
  if (value < -ZERO_TOLERANCE) return 'over_recovered';
  return 'settled';
}

export function buildUnofficialCompensationWorkspace({ accounts = [], claims = [], recoveries = [], today }) {
  const todayDate = dateOnly(today) || new Date().toISOString().slice(0, 10);
  const accountMap = new Map(accounts.map((account) => [textValue(account.Id), account]));
  for (const record of [...claims, ...recoveries]) {
    const accountId = textValue(record.Account__c);
    if (accountId && !accountMap.has(accountId)) accountMap.set(accountId, { Id: accountId, ...(record.Account__r || {}), Name: record.Account__r?.Name || '' });
  }

  const output = [];
  for (const [accountId, account] of accountMap.entries()) {
    const accountClaims = claims.filter((record) => textValue(record.Account__c) === accountId);
    const accountRecoveries = recoveries.filter((record) => textValue(record.Account__c) === accountId);
    if (!accountClaims.length && !accountRecoveries.length) continue;

    const grouped = new Map();
    for (const record of [...accountClaims, ...accountRecoveries]) {
      const key = groupKey(record, account);
      if (!grouped.has(key)) {
        const contact = contactOf(record);
        grouped.set(key, { key, contactId: contact.id, contactName: contact.name, currencyIsoCode: currencyOf(record, account), claims: [], recoveries: [] });
      }
    }
    for (const record of accountClaims) grouped.get(groupKey(record, account)).claims.push(claimRow(record, account));
    for (const record of accountRecoveries) grouped.get(groupKey(record, account)).recoveries.push(recoveryRow(record, account));

    const groups = [...grouped.values()].map((group) => {
      const agreedAmount = group.claims.reduce((sum, row) => sum + row.amount, 0);
      const recoveryAmount = group.recoveries.reduce((sum, row) => sum + row.amount, 0);
      const outstandingAmount = agreedAmount + recoveryAmount;
      const openClaims = group.claims.filter((row) => row.status.toLowerCase() === 'opened');
      const deadlines = openClaims.map((row) => row.deadlineDate).filter(Boolean).sort();
      const nextDeadline = deadlines[0] || null;
      const overdueDays = nextDeadline && nextDeadline < todayDate ? Math.abs(daysBetween(todayDate, nextDeadline)) : 0;
      const issues = [];
      if (openClaims.some((row) => !row.deadlineDate)) issues.push('Open claim deadline is missing.');
      if (openClaims.some((row) => !row.pic)) issues.push('Open claim PIC is missing.');
      if (group.recoveries.some((row) => row.amount > ZERO_TOLERANCE)) issues.push('A UOC recovery has an unexpected positive amount.');
      if (openClaims.length && outstandingAmount <= ZERO_TOLERANCE) issues.push('Claims are Opened although the calculated balance is settled or over-recovered.');
      if (!openClaims.length && outstandingAmount > ZERO_TOLERANCE) issues.push('The calculated balance is positive although no claim is Opened.');
      return {
        ...group,
        agreedAmount,
        recoveryAmount,
        recoveredAmount: Math.max(0, -recoveryAmount),
        outstandingAmount,
        balanceState: statusForBalance(outstandingAmount),
        openClaimCount: openClaims.length,
        nextDeadline,
        overdueDays,
        dueInDays: nextDeadline ? daysBetween(todayDate, nextDeadline) : null,
        pics: unique([...group.claims, ...group.recoveries].map((row) => row.pic)),
        latestRecoveryAt: group.recoveries.map((row) => row.createdAt).filter(Boolean).sort().at(-1) || null,
        issues,
      };
    });

    const currencies = unique(groups.map((group) => group.currencyIsoCode));
    const currencyTotals = currencies.map((currencyIsoCode) => {
      const rows = groups.filter((group) => group.currencyIsoCode === currencyIsoCode);
      return {
        currencyIsoCode,
        agreedAmount: rows.reduce((sum, row) => sum + row.agreedAmount, 0),
        recoveredAmount: rows.reduce((sum, row) => sum + row.recoveredAmount, 0),
        outstandingAmount: rows.reduce((sum, row) => sum + Math.max(0, row.outstandingAmount), 0),
        netAmount: rows.reduce((sum, row) => sum + row.outstandingAmount, 0),
      };
    }).sort((left, right) => left.currencyIsoCode.localeCompare(right.currencyIsoCode));
    const issues = unique(groups.flatMap((group) => group.issues));
    const hasOpenGroup = groups.some((group) => group.openClaimCount > 0);
    const salesforceStatus = textValue(account.Compensation_Status__c);
    if (salesforceStatus && (salesforceStatus === 'Opened') !== hasOpenGroup) issues.push('Account compensation status does not match its claim statuses.');
    if (currencies.length === 1) {
      const directTotal = currencyTotals[0].netAmount;
      const rollupTotal = numberValue(account.Agreed_Compensation_Total__c) + numberValue(account.Unofficial_Compensation_Total__c);
      if (Math.abs(directTotal - rollupTotal) >= ZERO_TOLERANCE) issues.push('Account roll-up totals do not match the underlying compensation records.');
    }

    const outstanding = groups.some((row) => row.outstandingAmount > ZERO_TOLERANCE);
    const overRecovered = groups.some((row) => row.outstandingAmount < -ZERO_TOLERANCE);
    const deadlines = groups.map((group) => group.nextDeadline).filter(Boolean).sort();
    output.push({
      accountId,
      accountName: textValue(account.Name) || 'Unnamed Account',
      clKey: textValue(account.Company_Code__c),
      accountType: textValue(account.RecordType?.Name),
      active: account.Inactive_Suspended__c !== true,
      salesforceStatus: salesforceStatus || 'Not set',
      currencyTotals,
      groups,
      pics: unique(groups.flatMap((group) => group.pics)),
      nextDeadline: deadlines[0] || null,
      overdueDays: Math.max(0, ...groups.map((group) => group.overdueDays || 0)),
      latestRecoveryAt: groups.map((group) => group.latestRecoveryAt).filter(Boolean).sort().at(-1) || null,
      balanceState: outstanding ? 'outstanding' : overRecovered ? 'over_recovered' : 'settled',
      issues: unique(issues),
    });
  }

  output.sort((left, right) => {
    const leftOverdue = left.overdueDays > 0 ? 1 : 0;
    const rightOverdue = right.overdueDays > 0 ? 1 : 0;
    if (leftOverdue !== rightOverdue) return rightOverdue - leftOverdue;
    if ((left.nextDeadline || '9999') !== (right.nextDeadline || '9999')) return String(left.nextDeadline || '9999').localeCompare(String(right.nextDeadline || '9999'));
    const leftAmount = Math.max(0, ...left.currencyTotals.map((row) => row.outstandingAmount));
    const rightAmount = Math.max(0, ...right.currencyTotals.map((row) => row.outstandingAmount));
    return rightAmount - leftAmount || left.accountName.localeCompare(right.accountName);
  });

  const totals = new Map();
  for (const account of output) {
    for (const row of account.currencyTotals) {
      if (!totals.has(row.currencyIsoCode)) totals.set(row.currencyIsoCode, { currencyIsoCode: row.currencyIsoCode, agreedAmount: 0, recoveredAmount: 0, outstandingAmount: 0 });
      const total = totals.get(row.currencyIsoCode);
      total.agreedAmount += row.agreedAmount;
      total.recoveredAmount += row.recoveredAmount;
      total.outstandingAmount += row.outstandingAmount;
    }
  }

  return {
    accounts: output,
    summary: {
      accountCount: output.length,
      outstandingAccountCount: output.filter((row) => row.balanceState === 'outstanding').length,
      overdueAccountCount: output.filter((row) => row.balanceState === 'outstanding' && row.overdueDays > 0).length,
      dueWithinSevenDaysCount: output.filter((row) => row.balanceState === 'outstanding' && row.groups.some((group) => group.dueInDays != null && group.dueInDays >= 0 && group.dueInDays <= 7)).length,
      dataIssueCount: output.filter((row) => row.issues.length > 0).length,
      currencyTotals: [...totals.values()].sort((left, right) => left.currencyIsoCode.localeCompare(right.currencyIsoCode)),
    },
  };
}

export { ZERO_TOLERANCE as UNOFFICIAL_COMPENSATION_ZERO_TOLERANCE };
