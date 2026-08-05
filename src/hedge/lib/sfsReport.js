import {
  DEFAULT_RATES,
  asNumber,
  calcMopsAverage,
  calcSwapFees,
  hasPlattsPublicationCalendar,
  mopsField,
  roundMoney,
  tradingDaysInMonth,
} from "./domain.js";

export const SFS_REPORT_AUTOMATION_START_MONTH = "2026-07";

const PRICE_FIELDS = ["s380", "s05", "sgo"];

function isFinitePrice(value) {
  return value !== null && value !== "" && Number.isFinite(Number(value));
}

function rowTimestamp(row) {
  return String(row?.updated_date || row?.created_date || row?.id || "");
}

function newestFirst(left, right) {
  return rowTimestamp(right).localeCompare(rowTimestamp(left));
}

function rowsByPublicationDate(month, records, { requireComplete = false, actualOnly = false } = {}) {
  const scheduled = new Set(tradingDaysInMonth(month));
  const grouped = new Map();
  (records || [])
    .filter((row) => scheduled.has(String(row?.price_date || "")))
    .filter((row) => !actualOnly || !row.is_estimate)
    .forEach((row) => {
      if (!grouped.has(row.price_date)) grouped.set(row.price_date, []);
      grouped.get(row.price_date).push(row);
    });

  return new Map([...grouped.entries()].map(([date, rows]) => {
    const ordered = [...rows].sort((left, right) => {
      if (Boolean(left.is_estimate) !== Boolean(right.is_estimate)) return left.is_estimate ? 1 : -1;
      return newestFirst(left, right);
    });
    return [date, ordered[0]];
  }).filter(([, row]) => !requireComplete || PRICE_FIELDS.every((field) => isFinitePrice(row[field]))));
}

export function getSfsMopsCompleteness(month, records = []) {
  const scheduledDates = tradingDaysInMonth(month);
  const completeActual = rowsByPublicationDate(month, records, { requireComplete: true, actualOnly: true });
  const anyActual = rowsByPublicationDate(month, records, { actualOnly: true });
  const estimates = rowsByPublicationDate(month, records).entries();
  const estimateDates = new Set([...estimates].filter(([, row]) => row.is_estimate).map(([date]) => date));
  const missingDates = scheduledDates.filter((date) => !anyActual.has(date));
  const incompleteDates = scheduledDates.filter((date) => anyActual.has(date) && !completeActual.has(date));

  return {
    complete: scheduledDates.length > 0 && completeActual.size === scheduledDates.length,
    total: scheduledDates.length,
    actual: completeActual.size,
    estimated: scheduledDates.filter((date) => !completeActual.has(date) && estimateDates.has(date)).length,
    scheduledDates,
    missingDates,
    incompleteDates,
    records: scheduledDates.map((date) => completeActual.get(date)).filter(Boolean),
  };
}

function selectedMopsRecords(month, records, final) {
  const rows = final
    ? rowsByPublicationDate(month, records, { requireComplete: true, actualOnly: true })
    : rowsByPublicationDate(month, records);
  return tradingDaysInMonth(month).map((date) => rows.get(date)).filter(Boolean);
}

function normalizedQuantity(product, quantity, unit, sgoRatio) {
  const raw = asNumber(quantity);
  return product === "SGO" && String(unit || "").toLowerCase() === "mt"
    ? raw * asNumber(sgoRatio, 7.45)
    : raw;
}

function allocatedHalf(value, legIndex) {
  const amount = roundMoney(value);
  const first = roundMoney(amount / 2);
  return legIndex === 1 ? first : roundMoney(amount - first);
}

function feeAllocation(fees, share, legIndex) {
  const allocate = (value) => share === 1 ? roundMoney(value) : allocatedHalf(value, legIndex);
  const result = {
    sfsCommission: allocate(fees.sfsCommission),
    iceExchange: allocate(fees.ice),
    iceClearing: allocate(fees.iceClearing),
    iceSettlement: allocate(fees.iceSettlement),
  };
  result.total = roundMoney(result.sfsCommission + result.iceExchange + result.iceClearing + result.iceSettlement);
  return result;
}

function swapLegs(swap) {
  if (swap.trade_type === "SPREAD") {
    return [
      {
        leg: 1,
        direction: "BUY",
        month: swap.leg1_month,
        price: swap.leg1_price,
        basis: swap.leg1_basis || "WMA",
        startDate: swap.leg1_bal_date,
        feeShare: 0.5,
      },
      {
        leg: 2,
        direction: "SELL",
        month: swap.leg2_month,
        price: swap.leg2_price,
        basis: swap.leg2_basis || "WMA",
        startDate: swap.leg2_bal_date,
        feeShare: 0.5,
      },
    ];
  }
  return [{
    leg: 1,
    direction: swap.direction,
    month: swap.swap_month,
    price: swap.price,
    basis: swap.pricing_basis || "WMA",
    startDate: swap.bal_start_date,
    feeShare: 1,
  }];
}

function lineValidationErrors(swap, leg) {
  const errors = [];
  const id = `${swap.id || "unsaved swap"}${swap.trade_type === "SPREAD" ? ` leg ${leg.leg}` : ""}`;
  if (!["S380", "S0.5", "SGO"].includes(swap.product)) errors.push(`${id}: unsupported product.`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(swap.trade_date || ""))) errors.push(`${id}: trade date is required.`);
  if (!Number.isFinite(Number(swap.quantity)) || Number(swap.quantity) <= 0) errors.push(`${id}: quantity must be greater than zero.`);
  if (!["mt", "bbl"].includes(String(swap.unit || "").toLowerCase())) errors.push(`${id}: unit must be MT or BBL.`);
  if (!Number.isFinite(Number(leg.price)) || leg.price === null || leg.price === "") errors.push(`${id}: trade price is required.`);
  if (!["BUY", "SELL"].includes(leg.direction)) errors.push(`${id}: direction must be BUY or SELL.`);
  if (!/^\d{4}-\d{2}$/.test(String(leg.month || ""))) errors.push(`${id}: contract month is invalid.`);
  if (!["WMA", "BAL_TODAY", "BAL_TOMORROW"].includes(leg.basis)) errors.push(`${id}: pricing basis is invalid.`);
  if (leg.basis !== "WMA" && !/^\d{4}-\d{2}-\d{2}$/.test(String(leg.startDate || ""))) {
    errors.push(`${id}: a valid balance start date is required.`);
  }
  return errors;
}

function buildLine(swap, leg, mopsRecords, rates, sgoRatio) {
  const average = calcMopsAverage(
    leg.month,
    mopsRecords,
    mopsField(swap.product),
    leg.basis,
    leg.startDate,
  );
  const settlementMops = average ? Math.round(average.avg * 1000) / 1000 : null;
  const quantity = normalizedQuantity(swap.product, swap.quantity, swap.unit, sgoRatio);
  const tradePrice = asNumber(leg.price);
  const grossPnl = settlementMops == null
    ? 0
    : roundMoney((leg.direction === "SELL" ? tradePrice - settlementMops : settlementMops - tradePrice) * quantity);
  const fees = feeAllocation(calcSwapFees(swap, rates), leg.feeShare, leg.leg);
  return {
    id: `${swap.id || "swap"}:${leg.leg}`,
    swapId: swap.id || null,
    leg: swap.trade_type === "SPREAD" ? leg.leg : null,
    tradeDate: swap.trade_date || null,
    product: swap.product,
    direction: leg.direction,
    contractMonth: leg.month,
    quantity: asNumber(swap.quantity),
    normalizedQuantity: roundMoney(quantity),
    unit: swap.unit || (swap.product === "SGO" ? "BBL" : "MT"),
    tradePrice,
    pricingBasis: leg.basis,
    balanceStartDate: leg.startDate || null,
    roundTrip: Boolean(swap.round_trip),
    settlementMops,
    averageCoverage: average ? {
      actualDays: average.actualDays,
      estimatedDays: average.estimatedDays,
      carryDays: average.carryDays,
      countedDays: average.countedDays,
      totalDays: average.totalDays,
    } : null,
    grossPnl,
    fees,
    netPnl: roundMoney(grossPnl - fees.total),
  };
}

export function buildSfsMonthlyReport({
  month,
  swaps = [],
  mops = [],
  rates = DEFAULT_RATES,
  sgoRatio = 7.45,
  generatedAt = null,
  requireComplete = false,
} = {}) {
  if (!/^\d{4}-\d{2}$/.test(String(month || ""))) throw new Error("A valid report month is required.");
  const completeness = getSfsMopsCompleteness(month, mops);
  const calendarSupported = hasPlattsPublicationCalendar(month);
  if (requireComplete && !calendarSupported) {
    throw new Error(`The Platts publication calendar for ${month.slice(0, 4)} has not been approved.`);
  }
  if (requireComplete && !completeness.complete) throw new Error(`MOPS is incomplete for ${month}.`);
  const final = requireComplete || completeness.complete;
  const mopsRecords = selectedMopsRecords(month, mops, final);
  const candidates = (swaps || [])
    .filter((swap) => swap.venue === "ICE")
    .flatMap((swap) => swapLegs(swap)
      .filter((leg) => leg.month === month)
      .map((leg) => ({ swap, leg })));
  const validationErrors = candidates.flatMap(({ swap, leg }) => lineValidationErrors(swap, leg));
  const lines = candidates
    .map(({ swap, leg }) => buildLine(swap, leg, mopsRecords, rates, sgoRatio))
    .sort((left, right) => `${left.tradeDate || ""}:${left.swapId || ""}:${left.leg || 0}`
      .localeCompare(`${right.tradeDate || ""}:${right.swapId || ""}:${right.leg || 0}`));
  lines.forEach((line) => {
    if (line.settlementMops == null) {
      validationErrors.push(`${line.swapId || "unsaved swap"}${line.leg ? ` leg ${line.leg}` : ""}: final MOPS could not be calculated for the saved pricing basis.`);
    }
  });
  if (requireComplete && validationErrors.length) {
    throw new Error(`SFS report inputs are invalid: ${validationErrors.join(" ")}`);
  }

  const totals = lines.reduce((result, line) => ({
    grossPnl: roundMoney(result.grossPnl + line.grossPnl),
    sfsCommission: roundMoney(result.sfsCommission + line.fees.sfsCommission),
    iceExchange: roundMoney(result.iceExchange + line.fees.iceExchange),
    iceClearing: roundMoney(result.iceClearing + line.fees.iceClearing),
    iceSettlement: roundMoney(result.iceSettlement + line.fees.iceSettlement),
    totalFees: roundMoney(result.totalFees + line.fees.total),
    netPnl: roundMoney(result.netPnl + line.netPnl),
  }), {
    grossPnl: 0,
    sfsCommission: 0,
    iceExchange: 0,
    iceClearing: 0,
    iceSettlement: 0,
    totalFees: 0,
    netPnl: 0,
  });

  return {
    month,
    final: completeness.complete && calendarSupported && validationErrors.length === 0,
    generatedAt,
    recipient: null,
    completeness: {
      complete: completeness.complete,
      total: completeness.total,
      actual: completeness.actual,
      estimated: completeness.estimated,
      missingDates: completeness.missingDates,
      incompleteDates: completeness.incompleteDates,
      calendarSupported,
    },
    source: {
      name: "S&P Global Platts Singapore MOPS",
      records: mopsRecords.map((row) => ({
        id: row.id || null,
        priceDate: row.price_date,
        s380: isFinitePrice(row.s380) ? Number(row.s380) : null,
        s05: isFinitePrice(row.s05) ? Number(row.s05) : null,
        sgo: isFinitePrice(row.sgo) ? Number(row.sgo) : null,
        source: row.source || "Manual",
        updatedAt: row.updated_date || row.created_date || null,
      })),
    },
    assumptions: {
      sgoBblPerMt: asNumber(sgoRatio, 7.45),
      rates: { ...DEFAULT_RATES, ...(rates || {}) },
      clearingAccount: "SFS",
      venueFilter: "ICE",
      publicationCalendarYear: month.slice(0, 4),
    },
    validationErrors,
    lines,
    totals,
  };
}

export function sfsReportInputPayload(report) {
  return {
    month: report.month,
    source: report.source.records,
    assumptions: report.assumptions,
    lines: report.lines.map((line) => ({
      swapId: line.swapId,
      leg: line.leg,
      tradeDate: line.tradeDate,
      product: line.product,
      direction: line.direction,
      contractMonth: line.contractMonth,
      quantity: line.quantity,
      unit: line.unit,
      tradePrice: line.tradePrice,
      pricingBasis: line.pricingBasis,
      balanceStartDate: line.balanceStartDate,
      roundTrip: line.roundTrip,
      normalizedQuantity: line.normalizedQuantity,
      settlementMops: line.settlementMops,
      grossPnl: line.grossPnl,
      fees: line.fees,
      netPnl: line.netPnl,
    })),
  };
}
