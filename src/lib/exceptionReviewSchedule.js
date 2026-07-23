export const EXCEPTION_REVIEW_DATE_BASIS = 'exception_schedule';
export const HONG_KONG_TIME_ZONE = 'Asia/Hong_Kong';

export const EXCEPTION_SCHEDULE_FIELDS = [
  'CreatedDate',
  'Delivery_Date__c',
  'ETA_ETB__c',
  'ETA_Start_Date__c',
  'ETA_End_Date__c',
  'ETB_Start_Date__c',
  'ETB_End_Date__c',
];

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 24 * 60 * 60 * 1000;
const SCHEDULE_TYPES = new Set(['ETA', 'ETB', 'PROMPT']);

function validDateOnly(value) {
  const match = String(value || '').match(DATE_ONLY_PATTERN);
  if (!match) return null;
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (
    date.getUTCFullYear() !== Number(year)
    || date.getUTCMonth() + 1 !== Number(month)
    || date.getUTCDate() !== Number(day)
  ) return null;
  return `${year}-${month}-${day}`;
}

export function hongKongDateOnly(value) {
  const dateOnly = validDateOnly(value);
  if (dateOnly) return dateOnly;

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: HONG_KONG_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return validDateOnly(`${values.year}-${values.month}-${values.day}`);
}

function dateOnlyEpoch(value) {
  const dateOnly = validDateOnly(value);
  if (!dateOnly) return null;
  return Date.parse(`${dateOnly}T00:00:00Z`);
}

function dateParts(value) {
  const dateOnly = validDateOnly(value);
  if (!dateOnly) return null;
  const [year, month, day] = dateOnly.split('-').map(Number);
  return { year, month, day };
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatExceptionScheduleRange(startDate, endDate) {
  const start = dateParts(startDate);
  const end = dateParts(endDate);
  if (!start || !end) return '';
  if (startDate === endDate) return `${start.day} ${MONTH_LABELS[start.month - 1]} ${start.year}`;
  if (start.year === end.year && start.month === end.month) {
    return `${start.day}-${end.day} ${MONTH_LABELS[start.month - 1]} ${start.year}`;
  }
  if (start.year === end.year) {
    return `${start.day} ${MONTH_LABELS[start.month - 1]}-${end.day} ${MONTH_LABELS[end.month - 1]} ${start.year}`;
  }
  return `${start.day} ${MONTH_LABELS[start.month - 1]} ${start.year}-${end.day} ${MONTH_LABELS[end.month - 1]} ${end.year}`;
}

function normalizedScheduleType(value) {
  const type = String(value || '').trim().toUpperCase();
  return SCHEDULE_TYPES.has(type) ? type : 'MISSING';
}

function selectedScheduleDates(row, type) {
  if (type === 'ETA') return [validDateOnly(row?.ETA_Start_Date__c), validDateOnly(row?.ETA_End_Date__c)];
  if (type === 'ETB') return [validDateOnly(row?.ETB_Start_Date__c), validDateOnly(row?.ETB_End_Date__c)];
  return [null, null];
}

function normalizeDateRange(startDate, endDate) {
  if (!startDate && !endDate) return [null, null];
  if (!startDate) return [endDate, endDate];
  if (!endDate) return [startDate, startDate];
  return startDate <= endDate ? [startDate, endDate] : [endDate, startDate];
}

export function normalizeExceptionSchedule(row) {
  const type = normalizedScheduleType(row?.ETA_ETB__c);
  const selectedDates = selectedScheduleDates(row, type);
  const [scheduleStart, scheduleEnd] = normalizeDateRange(...selectedDates);

  if (scheduleStart && scheduleEnd) {
    return {
      type,
      startDate: scheduleStart,
      endDate: scheduleEnd,
      source: 'schedule',
      displayLabel: `${type} · ${formatExceptionScheduleRange(scheduleStart, scheduleEnd)}`,
    };
  }

  const createdDate = hongKongDateOnly(row?.CreatedDate);
  const prefix = type === 'PROMPT' ? 'PROMPT' : 'Schedule not set';
  return {
    type,
    startDate: createdDate,
    endDate: createdDate,
    source: 'created',
    displayLabel: createdDate
      ? `${prefix} · Created ${formatExceptionScheduleRange(createdDate, createdDate)}`
      : `${prefix} · Created date unavailable`,
  };
}

export function exceptionScheduleDaysSinceEnd(schedule, today = new Date()) {
  const endEpoch = dateOnlyEpoch(schedule?.endDate);
  const todayEpoch = dateOnlyEpoch(hongKongDateOnly(today));
  if (endEpoch == null || todayEpoch == null) return null;
  return Math.floor((todayEpoch - endEpoch) / DAY_MS);
}

export function hasUncancelledStemLineProductItem(row) {
  if (typeof row?._Has_Uncancelled_Line_Product_Item === 'boolean') {
    return row._Has_Uncancelled_Line_Product_Item;
  }
  return Array.isArray(row?._Product_Quantity_List) && row._Product_Quantity_List.length > 0;
}

export function isExceptionPotentialDelay(row, today = new Date()) {
  if (row?.Delivery_Date__c || !hasUncancelledStemLineProductItem(row)) return false;
  const schedule = row?._Exception_Schedule || normalizeExceptionSchedule(row);
  const daysSinceEnd = exceptionScheduleDaysSinceEnd(schedule, today);
  return daysSinceEnd != null && daysSinceEnd >= 3;
}

export function buildExceptionReviewDateWindows(years, months) {
  const normalizedYears = [...new Set((years || []).map(Number).filter(Number.isInteger))].sort((a, b) => a - b);
  const normalizedMonths = [...new Set((months || []).map(Number).filter((month) => Number.isInteger(month) && month >= 1 && month <= 12))].sort((a, b) => a - b);
  const useFullYear = normalizedMonths.length === 0 || normalizedMonths.length === 12;
  const windows = [];

  for (const year of normalizedYears) {
    if (useFullYear) {
      windows.push({ startDate: `${year}-01-01`, endDate: `${year}-12-31` });
      continue;
    }
    for (const month of normalizedMonths) {
      const monthToken = String(month).padStart(2, '0');
      const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
      windows.push({
        startDate: `${year}-${monthToken}-01`,
        endDate: `${year}-${monthToken}-${String(lastDay).padStart(2, '0')}`,
      });
    }
  }
  return windows;
}

export function normalizeExceptionReviewDateWindows(dateWindows) {
  if (!Array.isArray(dateWindows) || dateWindows.length === 0 || dateWindows.length > 36) {
    throw new Error('Exception Review date windows must contain between 1 and 36 periods.');
  }
  return dateWindows.map((window) => {
    const startDate = validDateOnly(window?.startDate);
    const endDate = validDateOnly(window?.endDate);
    if (!startDate || !endDate || startDate > endDate) {
      throw new Error('Exception Review date windows must use valid ordered YYYY-MM-DD dates.');
    }
    return { startDate, endDate };
  });
}

function addDateOnlyDays(value, days) {
  const epoch = dateOnlyEpoch(value);
  if (epoch == null) return null;
  return new Date(epoch + days * DAY_MS).toISOString().slice(0, 10);
}

function hongKongBoundaryUtc(value) {
  const dateOnly = validDateOnly(value);
  if (!dateOnly) return null;
  return new Date(`${dateOnly}T00:00:00+08:00`).toISOString().replace('.000Z', 'Z');
}

function scheduleOverlapCondition(type, startField, endField, startDate, endDate) {
  const bothDates = `(${startField} != null AND ${endField} != null AND ((${startField} <= ${endDate} AND ${endField} >= ${startDate}) OR (${endField} <= ${endDate} AND ${startField} >= ${startDate})))`;
  const startOnly = `(${startField} != null AND ${endField} = null AND ${startField} >= ${startDate} AND ${startField} <= ${endDate})`;
  const endOnly = `(${startField} = null AND ${endField} != null AND ${endField} >= ${startDate} AND ${endField} <= ${endDate})`;
  return `(ETA_ETB__c = '${type}' AND (${bothDates} OR ${startOnly} OR ${endOnly}))`;
}

function missingSelectedScheduleCondition() {
  return [
    "ETA_ETB__c = 'PROMPT'",
    'ETA_ETB__c = null',
    "(ETA_ETB__c != 'ETA' AND ETA_ETB__c != 'ETB' AND ETA_ETB__c != 'PROMPT')",
    "(ETA_ETB__c = 'ETA' AND ETA_Start_Date__c = null AND ETA_End_Date__c = null)",
    "(ETA_ETB__c = 'ETB' AND ETB_Start_Date__c = null AND ETB_End_Date__c = null)",
  ].join(' OR ');
}

export function buildExceptionReviewScheduleWhere(dateWindows) {
  const windows = normalizeExceptionReviewDateWindows(dateWindows);
  return windows.map(({ startDate, endDate }) => {
    const createdStart = hongKongBoundaryUtc(startDate);
    const createdEndExclusive = hongKongBoundaryUtc(addDateOnlyDays(endDate, 1));
    const createdFallback = `((${missingSelectedScheduleCondition()}) AND CreatedDate >= ${createdStart} AND CreatedDate < ${createdEndExclusive})`;
    const scheduleConditions = [
      scheduleOverlapCondition('ETA', 'ETA_Start_Date__c', 'ETA_End_Date__c', startDate, endDate),
      scheduleOverlapCondition('ETB', 'ETB_Start_Date__c', 'ETB_End_Date__c', startDate, endDate),
      createdFallback,
    ].join(' OR ');
    return `((Delivery_Date__c >= ${startDate} AND Delivery_Date__c <= ${endDate}) OR (Delivery_Date__c = null AND (${scheduleConditions})))`;
  }).join(' OR ');
}

export function exceptionScheduleSchemaIssues(fieldNames) {
  const available = new Set(fieldNames || []);
  return EXCEPTION_SCHEDULE_FIELDS.filter((field) => !available.has(field));
}
