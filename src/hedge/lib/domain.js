export const APP_VERSION = "v2.1.1";
export const APP_VERSION_STORAGE_KEY = "fc_hedge_seen_version";
export const APP_VERSION_POLL_MS = 5 * 60 * 1000;

export const APP_CHANGELOG = [
  {
    version: APP_VERSION,
    date: "2026-07-30",
    title: "Reliable SFS report delivery",
    changes: [
      "Changed SFS report delivery to the Microsoft Graph sendMail action supported by the configured Mail.Send permission.",
      "Kept explicit delivery failures safely retryable without requesting broader mailbox-write access.",
      "Prevented automatic retries when a network interruption leaves the Microsoft Graph outcome uncertain.",
      "Improved delivery correlation and preserved PDF and CSV attachment auditing.",
    ],
  },
  {
    version: "v2.1.0",
    date: "2026-07-30",
    title: "SFS monthly realised P&L",
    changes: [
      "Added contract-month realised swap P&L with strict final MOPS controls and separate spread-leg allocation.",
      "Added immutable report revisions, methodology, delivery history, and reconciled PDF and CSV downloads.",
      "Added automatic first-report delivery to Accounts, approval for corrections, safe retry, and System Health monitoring.",
      "Excluded broker commission, third-party settlement, physical trades, accumulated balances, and clearing-ledger postings.",
    ],
  },
  {
    version: "v2.0.1",
    date: "2026-07-17",
    title: "Complete clearing ledger",
    changes: [
      "Restored access to every clearing cash record with searchable filters, running balances, and CSV export.",
      "Excluded broker commissions and trader settlements from clearing cash while retaining legacy records as archived history.",
      "Added automatic SFS, ICE exchange, ICE clearing, and month-end ICE settlement cost posting without broker commission.",
    ],
  },
  {
    version: "v2.0.0",
    date: "2026-07-17",
    title: "Stable production release",
    changes: [
      "Promoted the workflow-first trading workspace to the production application.",
      "Removed the previous interface, route, version manifest, and associated application code.",
      "Renamed active modules, styles, tests, and version infrastructure to stable production naming.",
    ],
  },
  {
    version: "v2.0.0-beta.13",
    date: "2026-07-17",
    title: "Least-privilege deep health checks",
    changes: [
      "Changed the Microsoft app-only deep test to validate Mail.Send and the configured mailbox without requiring unrelated directory-read permission.",
      "Updated the AI Gateway completion probe to meet the active model's minimum output-token requirement.",
      "Reverified Supabase anonymous-access denial, Salesforce identity and schema access, and ICE refresh status in production.",
    ],
  },
  {
    version: "v2.0.0-beta.12",
    date: "2026-07-17",
    title: "Connection directory and runtime hardening",
    changes: [
      "Added a complete, secret-safe directory of external providers, APIs, accounts, authorization modes, endpoints, permissions, and token lifecycles to System Health.",
      "Documented production connections, credential boundaries, live verification, and failure impact for Vercel, GitHub, Google, Supabase, Microsoft, AI Gateway, Salesforce, ICE, and Platts.",
      "Corrected Supabase and AI Gateway diagnostics and enriched Microsoft and Salesforce identity and token metadata.",
      "Reduced each desk refresh from seven API requests to one server snapshot, cached repeated health self-tests, and fixed invoice attachment limits, HTML template substitution, backup credentials, rate-limit cleanup, and invoice-number matching.",
    ],
  },
  {
    version: "v2.0.0-beta.11",
    date: "2026-07-16",
    title: "Database advisor hardening",
    changes: [
      "Removed legacy anonymous and browser-authenticated access to the data snapshot table while preserving protected server access and existing records.",
      "Fixed the shared update-timestamp trigger function to use a locked database lookup path.",
      "Cleared the remaining Supabase security warnings and reverified live integration health.",
    ],
  },
  {
    version: "v2.0.0-beta.10",
    date: "2026-07-16",
    title: "Precise database health diagnostics",
    changes: [
      "Separated private storage readiness from the legacy anonymous table-access check.",
      "Made token notes report the verified database permission state instead of assuming the migration is complete.",
      "Preserved healthy integration results when an individual deep test is run.",
    ],
  },
  {
    version: "v2.0.0-beta.9",
    date: "2026-07-16",
    title: "Production access and ICE source repair",
    changes: [
      "Registered the production domain with the managed Google OAuth client and restored server-verified sign-in for approved accounts.",
      "Updated the ICE margin parser for the compact row layout emitted by current official PDFs.",
      "Corrected the S380 full-size source from the options product to the SYS futures contract.",
      "Reconciled the ICE M2 margin baseline and added regression coverage for compact and spaced source rows.",
    ],
  },
  {
    version: "v2.0.0-beta.8",
    date: "2026-07-16",
    title: "Secure integrations and monitored health",
    changes: [
      "Moved app data access behind authenticated server APIs and replaced browser-stored identity with a signed, HttpOnly session.",
      "Added persistent quick and deep connection checks with latency, last-success, and last-failure timestamps.",
      "Combined access, connections, service health, and token lifecycle notes into one Integrations workspace.",
      "Added idempotent email and Salesforce operations, stricter rate limits, scheduled health monitoring, and restricted database policies.",
    ],
  },
  {
    version: "v2.0.0-beta.7",
    date: "2026-07-16",
    title: "MOPS workflow restoration",
    changes: [
      "Restored projected monthly averages that carry the latest available price through remaining Platts publication days.",
      "Integrated the S&P Global Platts publication calendar into a month-and-year filtered price ledger.",
      "Added a separate market-indication capture flow for estimated spot prices and forward adjustments.",
      "Added forward curve status, adjustment update time, and methodology dialogs across every workspace.",
    ],
  },
  {
    version: "v2.0.0-beta.6",
    date: "2026-07-16",
    title: "MOC forward adjustment capture",
    changes: [
      "Extended the MOPS parser to extract the nearest future month from the MOC curve.",
      "Calculated S380, S0.5, and SGO forward adjustments against the parsed spot prices.",
      "Added an editable forward-adjustment suggestion to the MOPS entry drawer.",
      "Applied suggested adjustments only when the MOPS entry is saved and the confirmation remains selected.",
    ],
  },
  {
    version: "v2.0.0-beta.5",
    date: "2026-07-16",
    title: "Resilient MOPS bulletin parsing",
    changes: [
      "Added support for multiline MOPS bulletins with month-and-day headings and an inferred report year.",
      "Mapped 380, 0.5%, and 10ppm gas labels to the saved MOPS fields.",
      "Isolated the MOPS section so MOC and MOPJ values cannot replace missing MOPS prices.",
      "Expanded the live parser health check and regression coverage for the bulletin format.",
    ],
  },
  {
    version: "v2.0.0-beta.4",
    date: "2026-07-11",
    title: "Live Salesforce connection",
    changes: [
      "Replaced the placeholder Salesforce sync with a live client-credentials connection.",
      "Mapped ICE and FCBS amounts to separate STEM Extra Cost records with the correct SWAPS product and supplier.",
      "Added live run-as identity, permission, and object-schema checks to System Health.",
      "Kept legacy Salesforce record IDs compatible while storing new venue-specific ID mappings.",
    ],
  },
  {
    version: "v2.0.0-beta.3",
    date: "2026-07-10",
    title: "Runtime health cleanup",
    changes: [
      "Moved server functions to the Node.js 22 LTS runtime to remove a platform deprecation warning from otherwise successful health and PDF requests.",
    ],
  },
  {
    version: "v2.0.0-beta.2",
    date: "2026-07-10",
    title: "Live services and durable invoices",
    changes: [
      "Replaced configuration-only health labels with live service checks.",
      "Added private, durable invoice PDF storage and secure previews.",
      "Enabled the trading assistant through Vercel AI Gateway.",
      "Repaired MOPS date and price parsing in the live entry flow.",
      "Made Connections reflect live results and marked optional Salesforce sync as disabled until activated.",
    ],
  },
  {
    version: "v2.0.0-beta.1",
    date: "2026-07-10",
    title: "Trading workstation beta",
    changes: [
      "Introduced a redesigned, workflow-first trading workstation as the default app.",
      "Added focused workspaces for positions, physical trades, hedges, MOPS, settlement, counterparties, settings, health, and audit history.",
      "Added responsive navigation, quick entry drawers, stronger filtering, safer confirmations, and a unified activity model.",
    ],
  },
  {
    version: "v1.0.1",
    date: "2026-07-10",
    title: "System health and version awareness",
    changes: [
      "Added System Health in Settings for server-side APIs, browser-local flows, external tools, and token expiry notes.",
      "Added app version tracking with a top update banner.",
      "Added an Update App action that refreshes the browser to load the latest deployed build.",
      "Added a version modal with release notes for each app version.",
    ],
  },
];

export const DEFAULT_RATES = {
  broker_mt: 0.05,
  broker_bbl: 0.05,
  ice_contract_mt: 0.02175,
  ice_contract_bbl: 0.00375,
  ice_clearing_mt: 0.011,
  ice_clearing_bbl: 0.00134,
  ice_settlement_mt: 0.001,
  ice_settlement_bbl: 0.00009,
  fcbs_venue_mt: 0.5,
  fcbs_venue_bbl: 0.067114,
  fcbs_cp_recv_mt: 0.5,
  fcbs_cp_recv_bbl: 0.03,
  sfs_commission_mt: 0.05,
  sfs_commission_bbl: 0.036,
};

export const DEFAULT_GENERAL = {
  sgo_bbl_per_mt: 7.45,
  ice_usable_ratio: 0.8,
  company_name: "Fratelli Cosulich Bunkers (HK) Ltd",
  invoice_prefix: "FCBHK_INV_OTC",
};

export const DEFAULT_LISTS = {
  products: ["S380", "S0.5", "SGO"],
  brokers: ["Ginga", "FIS"],
  venues: ["ICE", "FCBS"],
  counterparts: ["COSGE", "FCBS", "HSIN MING", "FCBHK"],
};

export const DEFAULT_GOOGLE_AUTH = {
  client_id: "",
  allowed_emails: "",
  auto_login: false,
};

export const DEFAULT_EMAIL_SETTINGS = {
  email_to: "",
  email_cc: "",
  email_bcc: "",
  email_subject: "{invoiceNumber} - {invoiceType} for {settlementMonth} Swap Settlement",
  email_body: "<p>Dear <strong>{counterparty}</strong>,</p><p>Please find attached our <strong>{invoiceType}</strong> No. <strong>{invoiceNumber}</strong> in respect of the swap settlement for <strong>{settlementMonth}</strong>.</p><p><strong>Payment direction: {payer} pays {payee}.</strong><br>Beneficiary: {beneficiary}<br>Net amount: <strong>USD {netAmount}</strong></p><p>Kindly acknowledge receipt and revert with any queries.</p><p>Best regards,<br>Fratelli Cosulich Bunkers (HK) Ltd</p>",
};

export const ICE_IM_FALLBACK = {
  S05_FULL: { im: 64765, lotSize: 1000, unit: "mt", label: "VLSFO Full (1000mt)", code: "MF4" },
  S05_MINI: { im: 6477, lotSize: 100, unit: "mt", label: "VLSFO Mini (100mt)", code: "MFZ" },
  S05_MICRO: { im: 648, lotSize: 10, unit: "mt", label: "VLSFO Micro (10mt)", code: "GNU" },
  S380_FULL: { im: 60520, lotSize: 1000, unit: "mt", label: "FO380 Full (1000mt)", code: "SYS" },
  S380_MINI: { im: 6052, lotSize: 100, unit: "mt", label: "FO380 Mini (100mt)", code: "SYY" },
  S380_MICRO: { im: 605, lotSize: 10, unit: "mt", label: "FO380 Micro (10mt)", code: "GNX" },
  SGO_FULL: { im: 16728, lotSize: 1000, unit: "bbl", label: "Gasoil Full (1000bbl)", code: "GST" },
  SGO_MINI: { im: 1673, lotSize: 100, unit: "bbl", label: "Gasoil Mini (100bbl)", code: "GSR" },
};

export const BROKER_EXCHANGE = ["Ginga", "FIS"];
export const INTERNAL_HEDGE_COUNTERPARTY = Object.freeze({
  shortName: "FCBHK",
  fullName: "FRATELLI COSULICH BUNKERS (HK) LTD",
  settlementMode: "internal_no_invoice",
  isSystemManaged: true,
});

export function normalizeHedgeCounterpartyName(value) {
  const candidate = value && typeof value === "object"
    ? value.short_name ?? value.shortName ?? value.full_name ?? value.fullName
    : value;
  return String(candidate ?? "").normalize("NFKC").trim().replace(/\s+/g, " ").toUpperCase();
}

export function isInternalHedgeCounterparty(value) {
  if (value && typeof value === "object") {
    const mode = String(value.settlement_mode ?? value.settlementMode ?? "").trim().toLowerCase();
    if (mode === INTERNAL_HEDGE_COUNTERPARTY.settlementMode) return true;
  }
  return normalizeHedgeCounterpartyName(value) === INTERNAL_HEDGE_COUNTERPARTY.shortName;
}
export const PRODUCT_COLORS = {
  S380: "#d6532f",
  "S0.5": "#087f8c",
  SGO: "#7152a5",
};

const PLATTS_HOLIDAYS_BY_YEAR = {
  "2026": new Set([
    "2026-01-01", "2026-02-17", "2026-02-18", "2026-04-03",
    "2026-05-01", "2026-05-27", "2026-06-01", "2026-08-10",
    "2026-11-09", "2026-12-25",
  ]),
};

export const PLATTS_PUBLICATION_SOURCE = {
  label: "S&P Global Platts Singapore publication calendar",
  url: "https://www.spglobal.com/energy/en/pricing-benchmarks/our-methodology/holiday",
};

export const roundMoney = (value) => {
  const amount = Number(value) || 0;
  const absolute = Math.abs(amount);
  const rounded = Math.round((absolute + Number.EPSILON * Math.max(1, absolute)) * 100) / 100;
  return amount < 0 ? -rounded : rounded;
};
export const asNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export function hktDate(offsetDays = 0) {
  const now = Date.now() + 8 * 60 * 60 * 1000 + offsetDays * 86400 * 1000;
  return new Date(now).toISOString().slice(0, 10);
}

export const hktToday = () => hktDate(0);
export const hktThisMonth = () => hktToday().slice(0, 7);

export function formatDate(value) {
  if (!value) return "-";
  const parts = String(value).slice(0, 10).split("-");
  return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : value;
}

export function formatMonth(value) {
  if (!value) return "-";
  const [year, month] = String(value).slice(0, 7).split("-");
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${names[Math.max(0, Number(month) - 1)]}-${year}`;
}

export function formatDateTime(value) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not recorded";
  return date.toLocaleString("en-GB", {
    timeZone: "Asia/Hong_Kong",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function formatMoney(value, { signed = false, digits = 0 } = {}) {
  if (value == null || !Number.isFinite(Number(value))) return "-";
  const number = Number(value);
  const prefix = signed && number > 0 ? "+" : number < 0 ? "-" : "";
  return `${prefix}$${Math.abs(number).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

export function formatQuantity(value, unit) {
  return `${asNumber(value).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${String(unit || "").toUpperCase()}`.trim();
}

export function compareVersions(leftValue, rightValue) {
  const parse = (value) => {
    const clean = String(value || "").replace(/^v/i, "");
    const [core, prerelease = ""] = clean.split("-");
    return { core: core.split(".").map((part) => Number(part) || 0), prerelease };
  };
  const left = parse(leftValue);
  const right = parse(rightValue);
  const length = Math.max(left.core.length, right.core.length, 3);
  for (let index = 0; index < length; index += 1) {
    const difference = (left.core[index] || 0) - (right.core[index] || 0);
    if (difference) return difference;
  }
  if (left.prerelease === right.prerelease) return 0;
  if (!left.prerelease) return 1;
  if (!right.prerelease) return -1;
  return left.prerelease.localeCompare(right.prerelease, undefined, { numeric: true });
}

export function isPlattsDay(dateString) {
  const date = new Date(`${dateString}T00:00:00`);
  const day = date.getDay();
  const holidays = PLATTS_HOLIDAYS_BY_YEAR[String(dateString || "").slice(0, 4)];
  return day !== 0 && day !== 6 && !holidays?.has(dateString);
}

export function hasPlattsPublicationCalendar(yearMonth) {
  return Boolean(PLATTS_HOLIDAYS_BY_YEAR[String(yearMonth || "").slice(0, 4)]);
}

export function tradingDaysInMonth(yearMonth) {
  if (!/^\d{4}-\d{2}$/.test(String(yearMonth || ""))) return [];
  const [year, month] = yearMonth.split("-").map(Number);
  const count = new Date(year, month, 0).getDate();
  return Array.from({ length: count }, (_, index) => `${yearMonth}-${String(index + 1).padStart(2, "0")}`)
    .filter(isPlattsDay);
}

function hktDateFrom(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return hktToday()
  return new Date(date.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

function mopsRowTimestamp(row) {
  return String(row?.updated_date || row?.created_date || row?.id || '')
}

export function finalMopsMonthlyAverages(yearMonth, records = []) {
  const scheduledDates = tradingDaysInMonth(yearMonth)
  const rowsByDate = new Map()

  for (const row of records || []) {
    if (!scheduledDates.includes(String(row?.price_date || ''))) continue
    const existing = rowsByDate.get(row.price_date)
    if (!existing || (existing.is_estimate && !row.is_estimate) || (Boolean(existing.is_estimate) === Boolean(row.is_estimate) && mopsRowTimestamp(row) > mopsRowTimestamp(existing))) {
      rowsByDate.set(row.price_date, row)
    }
  }

  const rows = scheduledDates.map((date) => rowsByDate.get(date)).filter((row) => row && !row.is_estimate)
  const completeRows = rows.filter((row) => ['s380', 's05', 'sgo'].every((field) => row[field] !== null && row[field] !== '' && Number.isFinite(Number(row[field]))))
  if (!scheduledDates.length || completeRows.length !== scheduledDates.length) return null

  const averages = Object.fromEntries(['s380', 's05', 'sgo'].map((field) => [
    field,
    Math.round((completeRows.reduce((sum, row) => sum + Number(row[field]), 0) / completeRows.length) * 1000) / 1000,
  ]))
  const inputSignature = completeRows
    .map((row) => `${row.price_date}:${['s380', 's05', 'sgo'].map((field) => Number(row[field]).toString()).join(':')}`)
    .join('|')

  return { month: yearMonth, ...averages, publicationDays: scheduledDates.length, inputSignature }
}

export function mopsMonthFinality(yearMonth, records = [], now = new Date(), monthlyVerifications = []) {
  const scheduledDates = tradingDaysInMonth(yearMonth)
  const calendarSupported = hasPlattsPublicationCalendar(yearMonth)
  const lastTradingDay = scheduledDates.at(-1) || null
  const today = hktDateFrom(now)
  const rowsByDate = new Map()

  for (const row of records || []) {
    if (!scheduledDates.includes(String(row?.price_date || ''))) continue
    const existing = rowsByDate.get(row.price_date)
    if (!existing || (existing.is_estimate && !row.is_estimate) || (Boolean(existing.is_estimate) === Boolean(row.is_estimate) && mopsRowTimestamp(row) > mopsRowTimestamp(existing))) {
      rowsByDate.set(row.price_date, row)
    }
  }

  const actualRows = scheduledDates.map((date) => rowsByDate.get(date)).filter((row) => row && !row.is_estimate)
  const completeRows = actualRows.filter((row) => ['s380', 's05', 'sgo'].every((field) => row[field] !== null && row[field] !== '' && Number.isFinite(Number(row[field]))))
  const missingDates = scheduledDates.filter((date) => !rowsByDate.get(date) || rowsByDate.get(date).is_estimate)
  const incompleteDates = scheduledDates.filter((date) => {
    const row = rowsByDate.get(date)
    return row && !row.is_estimate && !completeRows.includes(row)
  })
  const calculatedAverages = finalMopsMonthlyAverages(yearMonth, records)
  const verification = (monthlyVerifications || []).find((row) => row.contract_month === yearMonth) || null
  const averageVerified = Boolean(verification?.is_current === true && calculatedAverages)
  const reachedLastTradingDay = Boolean(lastTradingDay && today >= lastTradingDay)
  const ready = calendarSupported
    && reachedLastTradingDay
    && scheduledDates.length > 0
    && completeRows.length === scheduledDates.length
    && averageVerified

  return {
    month: yearMonth,
    ready,
    calendarSupported,
    today,
    lastTradingDay,
    reachedLastTradingDay,
    total: scheduledDates.length,
    actual: actualRows.length,
    complete: completeRows.length,
    averageVerified,
    verification,
    calculatedAverages,
    missingDates,
    incompleteDates,
  }
}

export function paperHedgeContractMonths(swap = {}) {
  const months = swap.trade_type === 'SPREAD'
    ? [swap.leg1_month, swap.leg2_month]
    : [swap.swap_month]
  return [...new Set(months.filter((month) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(month || ''))))]
}

export function paperHedgeExpiryStatus(swap = {}, records = [], now = new Date(), monthlyVerifications = []) {
  const contractMonths = paperHedgeContractMonths(swap)
  const months = contractMonths.map((month) => mopsMonthFinality(month, records, now, monthlyVerifications))
  return {
    ready: contractMonths.length > 0 && months.every((month) => month.ready),
    contractMonths,
    months,
  }
}

export function forwardCurveState(spreads = {}) {
  const values = ["s380", "s05", "sgo"]
    .map((field) => spreads?.[field])
    .filter((value) => value !== "" && value != null)
    .map(Number)
    .filter(Number.isFinite);
  if (!values.length) return { label: "No curve", tone: "neutral", detail: "No saved forward adjustments" };
  if (values.every((value) => value === 0)) return { label: "Flat", tone: "neutral", detail: "Forward prices match spot" };
  if (values.every((value) => value >= 0)) return { label: "Contango", tone: "warning", detail: "Forward prices are at or above spot" };
  if (values.every((value) => value <= 0)) return { label: "Backwardation", tone: "negative", detail: "Forward prices are at or below spot" };
  return { label: "Mixed curve", tone: "warning", detail: "Product curves point in different directions" };
}

function shiftedMonth(yearMonth, offset) {
  const [year, month] = String(yearMonth || "").split("-").map(Number);
  if (!year || !month) return "";
  const date = new Date(Date.UTC(year, month - 1 + offset, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

const MARKET_PRODUCT_KEY = Object.freeze({ S380: "hsfo380", "S0.5": "vlsfo", SGO: "lsmgo" });

function governedMopsForMonths(product, months, records, governedValuation) {
  if (governedValuation?.mode !== "platts_curve_active") return undefined;
  const productKey = MARKET_PRODUCT_KEY[product];
  const contractMonths = [...new Set((months || []).filter((month) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(month || ""))))];
  if (!productKey || !contractMonths.length) return null;
  const settlements = contractMonths.map((month) => (governedValuation.settlements || []).find((row) => (
    row.productKey === productKey
    && String(row.contractMonth || "").slice(0, 7) === month
    && row.available === true
    && row.authorizedForValuation !== false
  )));
  if (settlements.some((row) => !row)) return null;
  const field = mopsField(product);
  const governedRows = contractMonths.flatMap((month) => {
    const points = (governedValuation.valuationPoints || []).filter((point) => (
      point.productKey === productKey
      && String(point.contractMonth || "").slice(0, 7) === month
      && String(point.priceDate || "").slice(0, 7) === month
      && Number.isFinite(Number(point.value))
    ));
    const uniqueDates = new Set(points.map((point) => point.priceDate));
    if (!points.length || uniqueDates.size !== points.length) return [];
    return points.map((point) => ({
      price_date: point.priceDate,
      [field]: Number(point.value),
      is_estimate: !["approved_actual", "verified_actual"].includes(point.source),
      market_intelligence_source: point.source,
    }));
  });
  if (contractMonths.some((month) => !governedRows.some((row) => String(row.price_date).slice(0, 7) === month))) return null;
  const governedMonths = new Set(contractMonths);
  return [...(records || []).filter((row) => !governedMonths.has(String(row.price_date || "").slice(0, 7))), ...governedRows];
}

function mopsForExposureSwap(swap, records, forwardSpreads = {}, governedValuation = null) {
  const swapMonths = swap?.trade_type === "SPREAD"
    ? [swap.leg1_month, swap.leg2_month]
    : [swap?.swap_month];
  const governed = governedMopsForMonths(swap?.product, swapMonths, records, governedValuation);
  if (governed !== undefined) return governed;
  const forwardMonths = new Set([shiftedMonth(hktThisMonth(), 1), shiftedMonth(hktThisMonth(), 2)]);
  const syntheticMonths = [...new Set(swapMonths.filter((month) => forwardMonths.has(month)))];
  if (!syntheticMonths.length) return records;

  const latestActual = [...(records || [])]
    .filter((row) => row.price_date && !row.is_estimate)
    .sort((left, right) => right.price_date.localeCompare(left.price_date))[0];
  if (!latestActual) return records;

  const syntheticRecords = syntheticMonths.flatMap((month) => tradingDaysInMonth(month).map((priceDate) => ({
    price_date: priceDate,
    s380: asNumber(latestActual.s380) + asNumber(forwardSpreads.s380),
    s05: asNumber(latestActual.s05) + asNumber(forwardSpreads.s05),
    sgo: asNumber(latestActual.sgo) + asNumber(forwardSpreads.sgo),
    is_estimate: true,
  })));
  const syntheticSet = new Set(syntheticMonths);
  return [...(records || []).filter((row) => !syntheticSet.has(String(row.price_date || "").slice(0, 7))), ...syntheticRecords];
}

export function mopsField(product) {
  if (product === "S380") return "s380";
  if (product === "S0.5") return "s05";
  return "sgo";
}

export function calcMopsAverage(yearMonth, records, field, basis = "WMA", startDate) {
  if (!yearMonth || !field) return null;
  let days = tradingDaysInMonth(yearMonth);
  const base = startDate || hktToday();
  if (basis === "BAL_TODAY") days = days.filter((day) => day >= base);
  if (basis === "BAL_TOMORROW") {
    const next = days.find((day) => day > base);
    days = next ? days.filter((day) => day >= next) : [];
  }

  const byDate = new Map((records || []).filter((row) => row.price_date).map((row) => [row.price_date, row]));
  let sum = 0;
  let actualDays = 0;
  let estimatedDays = 0;
  let carryDays = 0;
  let lastKnown = null;

  days.forEach((day) => {
    const row = byDate.get(day);
    const value = row?.[field];
    if (value != null && Number.isFinite(Number(value))) {
      lastKnown = Number(value);
      sum += lastKnown;
      if (row.is_estimate) estimatedDays += 1;
      else actualDays += 1;
    } else if (lastKnown != null) {
      sum += lastKnown;
      carryDays += 1;
    }
  });

  const countedDays = actualDays + estimatedDays + carryDays;
  if (!countedDays) return null;
  return {
    avg: sum / countedDays,
    actualDays,
    estimatedDays,
    carryDays,
    countedDays,
    totalDays: days.length,
  };
}

function calcLegMtm(direction, price, product, quantity, unit, month, basis, startDate, records, sgoRatio = 7.45) {
  if (!month || !product || price == null || price === "") return null;
  const average = calcMopsAverage(month, records, mopsField(product), basis || "WMA", startDate);
  if (!average) return null;
  const market = Math.round(average.avg * 1000) / 1000;
  const tradePrice = asNumber(price);
  const rawQuantity = asNumber(quantity);
  const normalizedQuantity = product === "SGO" && String(unit).toLowerCase() === "mt"
    ? rawQuantity * sgoRatio
    : rawQuantity;
  const value = direction === "SELL"
    ? (tradePrice - market) * normalizedQuantity
    : (market - tradePrice) * normalizedQuantity;
  return { value: roundMoney(value), mtmAvg: market, average };
}

export function calcSwapMtm(swap, records, sgoRatio = 7.45, governedValuation = null) {
  if (!swap) return null;
  const months = swap.trade_type === "SPREAD" ? [swap.leg1_month, swap.leg2_month] : [swap.swap_month];
  const governedRecords = governedMopsForMonths(swap.product, months, records, governedValuation);
  if (governedRecords === null) return null;
  const valuationRecords = governedRecords || records;
  if (swap.trade_type === "SPREAD") {
    const leg1 = calcLegMtm("BUY", swap.leg1_price, swap.product, swap.quantity, swap.unit, swap.leg1_month, swap.leg1_basis, swap.leg1_bal_date, valuationRecords, sgoRatio);
    const leg2 = calcLegMtm("SELL", swap.leg2_price, swap.product, swap.quantity, swap.unit, swap.leg2_month, swap.leg2_basis, swap.leg2_bal_date, valuationRecords, sgoRatio);
    if ((!leg1 && !leg2) || (governedValuation?.mode === "platts_curve_active" && (!leg1 || !leg2))) return null;
    return { value: roundMoney((leg1?.value || 0) + (leg2?.value || 0)), leg1, leg2, isSpread: true };
  }
  return calcLegMtm(swap.direction, swap.price, swap.product, swap.quantity, swap.unit, swap.swap_month, swap.pricing_basis, swap.bal_start_date, valuationRecords, sgoRatio);
}

export function calcSwapFees(swap, rates = DEFAULT_RATES) {
  const quantity = asNumber(swap?.quantity);
  const isBbl = String(swap?.unit || "").toLowerCase() === "bbl";
  const multiplier = swap?.round_trip ? 2 : 1;
  const isIce = swap?.venue === "ICE";
  const broker = isIce ? roundMoney(quantity * (isBbl ? rates.broker_bbl : rates.broker_mt) * multiplier) : 0;
  const ice = isIce ? roundMoney(quantity * (isBbl ? rates.ice_contract_bbl : rates.ice_contract_mt) * multiplier) : 0;
  const iceClearing = isIce ? roundMoney(quantity * (isBbl ? rates.ice_clearing_bbl : rates.ice_clearing_mt) * multiplier) : 0;
  const iceSettlement = isIce ? roundMoney(quantity * (isBbl ? rates.ice_settlement_bbl : rates.ice_settlement_mt) * multiplier) : 0;
  const sfsCommission = isIce ? roundMoney(quantity * (isBbl ? rates.sfs_commission_bbl : rates.sfs_commission_mt) * multiplier) : 0;
  const fcbsVenueFee = swap?.venue === "FCBS" ? roundMoney(quantity * (isBbl ? rates.fcbs_venue_bbl : rates.fcbs_venue_mt)) : 0;
  const cpHandlingFee = swap?.counterparty === "FCBS" ? roundMoney(quantity * (isBbl ? rates.fcbs_cp_recv_bbl : rates.fcbs_cp_recv_mt)) : 0;
  return {
    broker,
    brokerFee: broker,
    ice,
    iceClearing,
    iceSettlement,
    sfsCommission,
    fcbsVenueFee,
    cpHandlingFee,
    total: roundMoney(broker + ice + iceClearing + sfsCommission + fcbsVenueFee),
  };
}

export function physicalMidQuantity(physical, sgoRatio = 7.45) {
  const min = asNumber(physical?.qty_min);
  const max = physical?.qty_max == null || physical.qty_max === "" ? min : asNumber(physical.qty_max, min);
  const midpoint = (min + max) / 2;
  if (physical?.product === "SGO" && String(physical?.unit || "").toLowerCase() === "mt") return midpoint * sgoRatio;
  if (physical?.product !== "SGO" && String(physical?.unit || "").toLowerCase() === "bbl") return midpoint / sgoRatio;
  return midpoint;
}

export function swapShareForPhysical(swap, physicalId, physicals = [], sgoRatio = 7.45) {
  const ids = Array.isArray(swap?.physical_trade_ids) ? swap.physical_trade_ids : [];
  if (!ids.includes(physicalId) || !ids.length) return 0;
  if (ids.length === 1) return 1;
  const weights = ids.map((id) => {
    const physical = physicals.find((row) => row.id === id);
    return physical ? physicalMidQuantity(physical, sgoRatio) : 0;
  });
  const total = weights.reduce((sum, value) => sum + value, 0);
  if (!total) return 1 / ids.length;
  return weights[ids.indexOf(physicalId)] / total;
}

function physicalLegPnl(side, physical, records, quantity) {
  const priceType = physical?.[`${side}_price_type`];
  const fixedPrice = physical?.[`${side}_price`];
  const premium = asNumber(physical?.[`${side}_premium`]);
  const month = physical?.[`${side}_pricing_month`];
  const basis = physical?.[`${side}_pricing_basis`] || "WMA";
  const startDate = physical?.[`${side}_bal_date`];
  const average = calcMopsAverage(month, records, mopsField(physical?.product), basis, startDate);
  if (!average) return null;
  if (priceType !== "Fixed") return { value: roundMoney((side === "sell" ? premium : -premium) * quantity), market: average.avg };
  if (fixedPrice == null || fixedPrice === "") return null;
  const value = side === "sell"
    ? (asNumber(fixedPrice) - average.avg) * quantity
    : (average.avg - asNumber(fixedPrice)) * quantity;
  return { value: roundMoney(value), market: average.avg };
}

export function calcPhysicalPnl(physical, records, sgoRatio = 7.45, governedValuation = null) {
  const governedRecords = governedMopsForMonths(physical?.product, [physical?.sell_pricing_month, physical?.buy_pricing_month], records, governedValuation);
  if (governedRecords === null) return null;
  const valuationRecords = governedRecords || records;
  const quantity = physicalMidQuantity(physical, sgoRatio);
  const sell = physicalLegPnl("sell", physical, valuationRecords, quantity);
  const buy = physicalLegPnl("buy", physical, valuationRecords, quantity);
  if (governedValuation?.mode === "platts_curve_active") {
    const configured = (side) => ["price_type", "price", "premium", "pricing_month", "pricing_basis", "bal_date"]
      .some((field) => physical?.[`${side}_${field}`] != null && physical?.[`${side}_${field}`] !== "");
    if ((configured("sell") && !sell) || (configured("buy") && !buy)) return null;
  }
  if (!sell && !buy) return null;
  return { value: roundMoney((sell?.value || 0) + (buy?.value || 0)), sell, buy };
}

export function latestMops(records) {
  return [...(records || [])].filter((row) => row.price_date).sort((a, b) => b.price_date.localeCompare(a.price_date))[0] || null;
}

export function monthOptions(swaps = [], physicals = [], mops = []) {
  const months = new Set([hktThisMonth()]);
  swaps.forEach((row) => {
    [row.swap_month, row.leg1_month, row.leg2_month, String(row.trade_date || "").slice(0, 7)].filter(Boolean).forEach((month) => months.add(month));
  });
  physicals.forEach((row) => {
    [row.sell_pricing_month, row.buy_pricing_month, String(row.trade_date || "").slice(0, 7)].filter(Boolean).forEach((month) => months.add(month));
  });
  mops.forEach((row) => row.price_date && months.add(row.price_date.slice(0, 7)));
  return [...months].filter((month) => /^\d{4}-\d{2}$/.test(month)).sort().reverse();
}

export function swapMonth(swap) {
  return swap?.trade_type === "SPREAD" ? swap.leg1_month || swap.leg2_month : swap?.swap_month;
}

export function isSwapLive(swap) {
  return !swap?.is_expired;
}

export function estimateSwapInitialMargin(swap, margins = ICE_IM_FALLBACK, sgoRatio = 7.45) {
  if (!swap || swap.venue !== "ICE" || !isSwapLive(swap)) return 0;
  let quantity = asNumber(swap.quantity);
  if (swap.product === "SGO" && String(swap.unit).toLowerCase() === "mt") quantity *= sgoRatio;
  if (swap.product !== "SGO" && String(swap.unit).toLowerCase() === "bbl") quantity /= sgoRatio;
  const prefix = swap.product === "S0.5" ? "S05" : swap.product === "S380" ? "S380" : "SGO";
  const contracts = [margins[`${prefix}_FULL`], margins[`${prefix}_MINI`], margins[`${prefix}_MICRO`]].filter(Boolean);
  let remaining = quantity;
  let total = 0;
  contracts.forEach((contract) => {
    const lots = Math.floor((remaining + 0.000001) / contract.lotSize);
    total += lots * asNumber(contract.im);
    remaining -= lots * contract.lotSize;
  });
  if (remaining > 0 && contracts.length) {
    const smallest = contracts[contracts.length - 1];
    total += Math.ceil(remaining / smallest.lotSize) * asNumber(smallest.im);
  }
  return roundMoney(total * (swap.round_trip ? 2 : 1));
}

export function isClearingLedgerEntry(row) {
  const type = String(row?.type || "").trim().toLowerCase();
  const notes = String(row?.notes || "").trim().toLowerCase();
  if (type === "trader settlement withdrawal" || type === "trader settlement") return false;
  if (/\btrader settlement\b/.test(notes)) return false;
  if (type === "broker fee" || type === "broker commission") return false;
  return !/\bbroker\s+(?:fee|commission)\b/.test(notes);
}

export function clearingEntryAmount(row) {
  const amount = asNumber(row?.amount);
  if (row?.type === "Adjustment") return roundMoney(amount);
  if (row?.type === "Deposit" || row?.type === "Variation Margin Credit") return roundMoney(Math.abs(amount));
  return roundMoney(-Math.abs(amount));
}

export function clearingEntryCategory(row) {
  const type = String(row?.type || "").trim();
  const normalizedType = type.toLowerCase();
  const notes = String(row?.notes || "").trim().toLowerCase();
  if (!isClearingLedgerEntry(row)) return "Archived outside clearing";
  if (notes.includes("ice settlement fee")) return "ICE settlement fee";
  if (type === "Trade Fee" && notes.includes("sfs") && (notes.includes("exchange") || notes.includes("clearing"))) return "SFS + ICE trade costs";
  if (notes.includes("sfs fee")) return "SFS fee";
  if (notes.includes("clearing fee")) return "ICE clearing fee";
  if (notes.includes("exchange fee") || notes.includes("contract fee")) return "ICE exchange fee";
  if (normalizedType === "sfs fee") return "SFS fee";
  if (normalizedType === "ice clearing fee") return "ICE clearing fee";
  if (normalizedType === "ice exchange fee") return "ICE exchange fee";
  if (normalizedType === "ice settlement fee") return "ICE settlement fee";
  if (type === "Trade Fee") return "Trade costs";
  return type || "Other clearing cost";
}

export function buildClearingLedger(rows = []) {
  let runningBalance = 0;
  return rows
    .filter(isClearingLedgerEntry)
    .sort((left, right) => `${left.date || ""}${left.created_date || ""}${left.id || ""}`.localeCompare(`${right.date || ""}${right.created_date || ""}${right.id || ""}`))
    .map((row) => {
      const signedAmount = clearingEntryAmount(row);
      if (row.status !== "pending") runningBalance = roundMoney(runningBalance + signedAmount);
      return {
        ...row,
        category: clearingEntryCategory(row),
        signedAmount,
        runningBalance,
      };
    });
}

export function clearingBalance(rows = []) {
  return roundMoney(rows
    .filter((row) => row.status !== "pending" && isClearingLedgerEntry(row))
    .reduce((sum, row) => sum + clearingEntryAmount(row), 0));
}

export function buyingPower({ clearing = [], swaps = [], mops = [], margins = ICE_IM_FALLBACK, usableRatio = 0.8, sgoRatio = 7.45, governedValuation = null }) {
  const cash = clearingBalance(clearing);
  const swapMtms = swaps.map((swap) => calcSwapMtm(swap, mops, sgoRatio, governedValuation)?.value ?? null);
  const valuationAvailable = governedValuation?.mode !== "platts_curve_active" || swapMtms.every((value) => value != null);
  const unrealizedMtm = valuationAvailable ? roundMoney(swapMtms.reduce((sum, value) => sum + (value || 0), 0)) : null;
  const equity = unrealizedMtm == null ? null : roundMoney(cash + unrealizedMtm);
  const available = equity == null ? null : roundMoney(equity * usableRatio);
  const used = roundMoney(swaps
    .filter((swap) => !swap.is_expired && BROKER_EXCHANGE.includes(swap.broker))
    .reduce((sum, swap) => sum + asNumber(swap.current_margin || swap.initial_margin || estimateSwapInitialMargin(swap, margins, sgoRatio)), 0));
  return {
    equity,
    cash,
    unrealizedMtm,
    available,
    used,
    remaining: available == null ? null : roundMoney(available - used),
    utilization: available > 0 ? (used / available) * 100 : 0,
    valuationAvailable,
  };
}

export function buildExposureRows(physicals = [], swaps = [], mops = [], sgoRatio = 7.45, forwardSpreads = {}, governedValuation = null) {
  const groups = new Map();
  const ensure = (counterparty, product, unit) => {
    const key = `${counterparty || "Unassigned"}::${product || "Unknown"}`;
    if (!groups.has(key)) groups.set(key, { key, counterparty: counterparty || "Unassigned", product, unit, physicalQty: 0, hedgeQty: 0, physicalPnl: 0, swapMtm: 0, physicalPnlAvailable: true, swapMtmAvailable: true, valuationWarnings: [] });
    return groups.get(key);
  };

  physicals.filter((row) => !row.is_closed).forEach((row) => {
    const item = ensure(row.counterparty, row.product, row.product === "SGO" ? "BBL" : "MT");
    item.physicalQty += physicalMidQuantity(row, sgoRatio);
    const result = calcPhysicalPnl(row, mops, sgoRatio, governedValuation);
    if (!result) {
      item.physicalPnlAvailable = false;
      item.valuationWarnings.push({ recordId: row.id, type: "physical", reason: governedValuation?.mode === "platts_curve_active" ? "governed_settlement_unavailable" : "market_average_unavailable" });
    } else item.physicalPnl += result.value;
  });
  swaps.filter((row) => isSwapLive(row) && row.counterparty && !BROKER_EXCHANGE.includes(row.counterparty)).forEach((row) => {
    const item = ensure(row.counterparty, row.product, row.product === "SGO" ? "BBL" : "MT");
    const quantity = row.product === "SGO" && String(row.unit).toLowerCase() === "mt"
      ? asNumber(row.quantity) * sgoRatio
      : row.product !== "SGO" && String(row.unit).toLowerCase() === "bbl"
        ? asNumber(row.quantity) / sgoRatio
        : asNumber(row.quantity);
    item.hedgeQty += quantity * (row.direction === "SELL" ? -1 : 1);
    const valuationRecords = governedValuation?.mode === "platts_curve_active" ? mops : mopsForExposureSwap(row, mops, forwardSpreads);
    const result = calcSwapMtm(row, valuationRecords, sgoRatio, governedValuation);
    if (!result) {
      item.swapMtmAvailable = false;
      item.valuationWarnings.push({ recordId: row.id, type: "swap", reason: governedValuation?.mode === "platts_curve_active" ? "governed_settlement_unavailable" : "market_average_unavailable" });
    } else item.swapMtm += result.value;
  });

  return [...groups.values()].map((item) => {
    const hedgeQty = Math.abs(item.hedgeQty);
    return {
      ...item,
      physicalQty: roundMoney(item.physicalQty),
      hedgeQty: roundMoney(hedgeQty),
      netExposure: roundMoney(item.physicalQty - hedgeQty),
      hedgeRatio: item.physicalQty > 0 ? (hedgeQty / item.physicalQty) * 100 : null,
      physicalPnl: item.physicalPnlAvailable ? roundMoney(item.physicalPnl) : null,
      swapMtm: item.swapMtmAvailable ? roundMoney(item.swapMtm) : null,
      combinedPnl: item.physicalPnlAvailable && item.swapMtmAvailable ? roundMoney(item.physicalPnl + item.swapMtm) : null,
    };
  }).sort((a, b) => Math.abs(b.netExposure) - Math.abs(a.netExposure));
}

export function settlementSummary(swaps = [], mops = [], rates = DEFAULT_RATES, month = hktThisMonth(), sgoRatio = 7.45, governedValuation = null) {
  const monthSwaps = swaps.filter((swap) => swapMonth(swap) === month);
  const brokerSwaps = swaps.filter((swap) => (
    String(swap.broker || "").trim()
    && String(swap.trade_date || "").slice(0, 7) === month
    && calcSwapFees(swap, rates).broker > 0
  ));
  const isFinal = month < hktThisMonth();
  let mtm = 0;
  let fcbs = 0;
  let broker = 0;
  let ice = 0;
  let sfs = 0;
  let mtmAvailable = true;
  monthSwaps.forEach((swap) => {
    const result = calcSwapMtm(swap, mops, sgoRatio, governedValuation);
    if (!result && governedValuation?.mode === "platts_curve_active") mtmAvailable = false;
    else mtm += result?.value || 0;
    const fees = calcSwapFees(swap, rates);
    fcbs += fees.fcbsVenueFee;
    ice += fees.ice + fees.iceClearing + (isFinal ? fees.iceSettlement : 0);
    sfs += fees.sfsCommission;
  });
  brokerSwaps.forEach((swap) => { broker += calcSwapFees(swap, rates).broker; });
  const totalFees = fcbs + broker + ice + sfs;
  return {
    monthSwaps,
    brokerSwaps,
    mtm: mtmAvailable ? roundMoney(mtm) : null,
    fcbs: roundMoney(fcbs),
    broker: roundMoney(broker),
    ice: roundMoney(ice),
    sfs: roundMoney(sfs),
    totalFees: roundMoney(totalFees),
    net: mtmAvailable ? roundMoney(mtm - totalFees) : null,
    mtmAvailable,
    isFinal,
  };
}

export function buildCounterpartySettlementGroups(swaps = [], mops = [], rates = DEFAULT_RATES, sgoRatio = 7.45, governedValuation = null, counterparties = []) {
  const directory = new Map((counterparties || []).map((record) => [normalizeHedgeCounterpartyName(record), record]));
  const grouped = new Map();
  swaps.forEach((swap) => {
    const key = swap.counterparty || "Unassigned";
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(swap);
  });
  return [...grouped.entries()].map(([counterparty, records]) => {
    const counterpartyRecord = directory.get(normalizeHedgeCounterpartyName(counterparty)) || null;
    const rows = records.map((swap) => {
      const mtm = calcSwapMtm(swap, mops, sgoRatio, governedValuation)?.value ?? null;
      const fees = calcSwapFees(swap, rates);
      const iceCost = fees.brokerFee + fees.sfsCommission + fees.ice + fees.iceClearing + fees.iceSettlement;
      const attributedFeeAmount = counterparty === "FCBS"
        ? fees.cpHandlingFee
        : swap.venue === "ICE"
          ? iceCost
          : fees.cpHandlingFee + fees.fcbsVenueFee;
      const attributedFeeImpact = swap.venue === "ICE" && counterparty !== "FCBS"
        ? -attributedFeeAmount
        : attributedFeeAmount;
      return {
        swap,
        mtm: mtm == null ? null : roundMoney(mtm),
        fees,
        attributedFeeAmount: roundMoney(attributedFeeAmount),
        attributedFeeImpact: roundMoney(attributedFeeImpact),
        net: mtm == null ? null : roundMoney(-mtm + attributedFeeImpact),
      };
    });
    const valuationAvailable = rows.every((row) => row.mtm != null);
    return {
      key: counterparty,
      counterparty,
      counterpartyRecord,
      internal: isInternalHedgeCounterparty(counterpartyRecord || counterparty),
      settlementMode: counterpartyRecord?.settlement_mode || counterpartyRecord?.settlementMode || (isInternalHedgeCounterparty(counterparty) ? "internal_no_invoice" : "external"),
      records,
      rows,
      mtm: valuationAvailable ? roundMoney(rows.reduce((sum, row) => sum - row.mtm, 0)) : null,
      fees: roundMoney(rows.reduce((sum, row) => sum + row.attributedFeeAmount, 0)),
      net: valuationAvailable ? roundMoney(rows.reduce((sum, row) => sum + row.net, 0)) : null,
      valuationAvailable,
    };
  }).sort((left, right) => Number(right.valuationAvailable) - Number(left.valuationAvailable) || Math.abs(right.net || 0) - Math.abs(left.net || 0));
}

export function monthlyBrokerCommissionSummary(swaps = [], rates = DEFAULT_RATES) {
  const months = new Map();

  for (const swap of swaps) {
    const month = String(swap?.trade_date || "").slice(0, 7);
    const broker = String(swap?.broker || "").trim();
    const commission = calcSwapFees(swap, rates).broker;
    if (!/^\d{4}-\d{2}$/.test(month) || !broker || commission <= 0) continue;

    if (!months.has(month)) months.set(month, new Map());
    const brokers = months.get(month);
    const brokerKey = broker.toLocaleLowerCase("en-US");
    const current = brokers.get(brokerKey) || {
      broker,
      tradeCount: 0,
      commission: 0,
    };
    current.tradeCount += 1;
    current.commission = roundMoney(current.commission + commission);
    brokers.set(brokerKey, current);
  }

  return [...months.entries()]
    .sort(([left], [right]) => right.localeCompare(left))
    .map(([month, brokers]) => {
      const rows = [...brokers.values()].sort((left, right) => left.broker.localeCompare(right.broker));
      return {
        month,
        rows,
        tradeCount: rows.reduce((sum, row) => sum + row.tradeCount, 0),
        totalCommission: roundMoney(rows.reduce((sum, row) => sum + row.commission, 0)),
      };
    });
}

export const FCBHK_SETTLEMENT_PARTY = Object.freeze({
  shortName: "FCBHK",
  fullName: "FRATELLI COSULICH BUNKERS (HK) LTD",
  bankName: "UBS AG, Singapore",
  bankSwift: "UBSWSGSG",
  accountNumber: "0546-150117-01",
});

function settlementParty(counterparty) {
  if (counterparty && typeof counterparty === "object") {
    return {
      shortName: String(counterparty.short_name || counterparty.shortName || counterparty.full_name || "Counterparty"),
      fullName: String(counterparty.full_name || counterparty.fullName || counterparty.short_name || "Counterparty"),
    };
  }
  const name = String(counterparty || "Counterparty");
  return { shortName: name, fullName: name };
}

export function hedgeSettlementPaymentDirection(netAmount, counterparty) {
  if (isInternalHedgeCounterparty(counterparty)) {
    const error = new Error("Internal hedge — no external settlement document.");
    error.code = "HEDGE_INTERNAL_SETTLEMENT_DOCUMENT_BLOCKED";
    throw error;
  }
  const signedAmount = roundMoney(netAmount);
  const externalParty = settlementParty(counterparty);
  const isReceivable = signedAmount >= 0;
  const payer = isReceivable ? externalParty : FCBHK_SETTLEMENT_PARTY;
  const payee = isReceivable ? FCBHK_SETTLEMENT_PARTY : externalParty;
  return {
    signedAmount,
    amount: Math.abs(signedAmount),
    isReceivable,
    invoiceType: isReceivable ? "Debit Note" : "Credit Note",
    payer,
    payee,
    beneficiary: payee,
    label: `${payer.shortName} pays ${payee.shortName}`,
    detail: `${payer.fullName} pays ${payee.fullName}`,
  };
}

function escapeTemplateValue(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function resolveTemplate(template = "", variables = {}, { escapeHtml = false } = {}) {
  const valueFor = (key) => {
    if (variables[key] == null) return `{${key}}`;
    return escapeHtml ? escapeTemplateValue(variables[key]) : variables[key];
  };
  return String(template)
    .replace(/<span[^>]*data-var="(\w+)"[^>]*>.*?<\/span>/g, (_, key) => valueFor(key))
    .replace(/\{(\w+)\}/g, (_, key) => valueFor(key));
}

export function downloadCsv(filename, headers, rows) {
  const escape = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const csv = [headers, ...rows].map((row) => row.map(escape).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function nextInvoiceNumber(invoices = [], prefix = "FCBHK_INV_OTC") {
  const escapedPrefix = String(prefix).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const maximum = invoices.reduce((current, invoice) => {
    const match = String(invoice.invoice_number || "").match(new RegExp(`^${escapedPrefix}_(\\d+)$`));
    return match ? Math.max(current, Number(match[1])) : current;
  }, 0);
  return `${prefix}_${String(maximum + 1).padStart(3, "0")}`;
}
