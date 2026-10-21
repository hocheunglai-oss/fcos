// Date compatibility belongs only to the unreleased aggregate v3 proof. The
// provider row is never normalised or rewritten: hashes retain its raw fields.
const CALENDAR = /^(\d{4})-(\d{2})-(\d{2})$/;
const MICROSOFT = /^\/Date\((-?(?:0|[1-9]\d*))(?:([+-]0000))?\)\/$/;
const MIDNIGHT = /^(\d{4}-\d{2}-\d{2})T00:00:00$/;
const MIN_MILLIS = -62135596800000; // 0001-01-01T00:00:00.000Z
const MAX_MILLIS = 253402300799999; // 9999-12-31T23:59:59.999Z

function calendar(value) {
  if (typeof value !== 'string') return null;
  const match = CALENDAR.exec(value);
  if (!match || match[0] !== value) return null;
  const [year, month, day] = match.slice(1).map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1] ? value : null;
}

function rawCalendar(value) {
  const iso = calendar(value);
  if (iso) return iso;
  if (typeof value !== 'string') return null;
  const match = MICROSOFT.exec(value);
  if (!match || match[0] !== value) return null;
  const millis = Number(match[1]);
  if (!Number.isSafeInteger(millis) || millis < MIN_MILLIS || millis > MAX_MILLIS) return null;
  return calendar(new Date(millis).toISOString().slice(0, 10));
}

// Accepted raw forms are a real YYYY-MM-DD or /Date(integer)/ with optional
// +0000/-0000 only. Nonzero offsets are held until their semantics are verified.
// An explicitly present companion is authoritative agreement evidence: accept
// exactly YYYY-MM-DDT00:00:00, with no zone/fraction/whitespace or time rollover.
// It must agree with a valid raw field; it cannot replace missing/invalid raw
// evidence, nor can any source/STEM/buyer date supply that evidence.
export function aggregateSupplierCalendarDate(row, field) {
  if (row === null || typeof row !== 'object' || Array.isArray(row) || !['Date', 'DueDate'].includes(field)) return null;
  const raw = Object.getOwnPropertyDescriptor(row, field);
  if (!raw || !Object.hasOwn(raw, 'value')) return null;
  const projected = rawCalendar(raw.value);
  if (projected === null) return null;
  const companion = Object.getOwnPropertyDescriptor(row, `${field}String`);
  if (!companion) return projected;
  if (!Object.hasOwn(companion, 'value') || typeof companion.value !== 'string') return null;
  const match = MIDNIGHT.exec(companion.value);
  return match && match[0] === companion.value && calendar(match[1]) === projected ? projected : null;
}
