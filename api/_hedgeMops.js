import { createHash } from 'node:crypto'
import { finalMopsMonthlyAverages, mopsMonthFinality } from '../src/hedge/lib/domain.js'

const NUMBER_PATTERN = '(-?\\d+(?:\\.\\d+)?)'
const MOPS_PRICE_FIELDS = ['s380', 's05', 'sgo']

const MONTH_NUMBER = Object.fromEntries([
  ['jan', 1], ['january', 1], ['feb', 2], ['february', 2], ['mar', 3], ['march', 3],
  ['apr', 4], ['april', 4], ['may', 5], ['jun', 6], ['june', 6], ['jul', 7],
  ['july', 7], ['aug', 8], ['august', 8], ['sep', 9], ['sept', 9], ['september', 9],
  ['oct', 10], ['october', 10], ['nov', 11], ['november', 11], ['dec', 12],
  ['december', 12],
])

function readPriceAfterLabel(text, labels) {
  for (const label of labels) {
    const match = text.match(new RegExp(`${label}\\s*(?::|=|-)?\\s*(?:USD\\s*)?(?:US\\$|\\$)?\\s*${NUMBER_PATTERN}`, 'i'))
    if (match) return Number(match[1])
  }
  return null
}

function fallbackNumbers(text) {
  const cleaned = text
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, ' ')
    .replace(/\b\d{1,2}[-/][A-Za-z]{3,9}[-/]\d{2,4}\b/gi, ' ')
    .replace(/\b\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]{3,9}[,\s]+\d{2,4}\b/gi, ' ')
    .replace(/\b[A-Za-z]{3,9}\s+\d{1,2}(?:st|nd|rd|th)?[,]?\s+\d{2,4}\b/gi, ' ')
    .replace(/\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g, ' ')
    .replace(/\bS\s*380\b/gi, ' ')
    .replace(/\bS\s*0\.?5\b/gi, ' ')
    .replace(/\b(?:SGO|GO)\b/gi, ' ')

  return [...cleaned.matchAll(new RegExp(NUMBER_PATTERN, 'g'))].map(match => Number(match[1]))
}

function validIsoDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function normalizeYear(value) {
  const year = Number(value)
  return year < 100 ? 2000 + year : year
}

function inferReportYear(month, day, now) {
  const hktNow = new Date(now.getTime() + (8 * 60 * 60 * 1000))
  const year = hktNow.getUTCFullYear()
  const today = Date.UTC(year, hktNow.getUTCMonth(), hktNow.getUTCDate())
  const candidate = Date.UTC(year, month - 1, day)
  return candidate > today ? year - 1 : year
}

export function parseMopsPriceDate(text, { now = new Date() } = {}) {
  const input = String(text || '')
  let match = input.match(/\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/)
  if (match) return validIsoDate(Number(match[1]), Number(match[2]), Number(match[3]))

  match = input.match(/\b([A-Za-z]{3,9})[ \t]+(\d{1,2})(?:st|nd|rd|th)?[,]?[ \t]+(\d{2}|(?:19|20)\d{2})\b/i)
  if (match && MONTH_NUMBER[match[1].toLowerCase()]) {
    const date = validIsoDate(normalizeYear(match[3]), MONTH_NUMBER[match[1].toLowerCase()], Number(match[2]))
    if (date) return date
  }

  match = input.match(/\b(\d{1,2})(?:[-/]|[ \t]+)([A-Za-z]{3,9})(?:[-/,]|[ \t])+(\d{2}|(?:19|20)\d{2})\b/i)
  if (match && MONTH_NUMBER[match[2].toLowerCase()]) {
    const date = validIsoDate(normalizeYear(match[3]), MONTH_NUMBER[match[2].toLowerCase()], Number(match[1]))
    if (date) return date
  }

  match = input.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{2}|(?:19|20)\d{2})\b/)
  if (match) {
    const date = validIsoDate(normalizeYear(match[3]), Number(match[2]), Number(match[1]))
    if (date) return date
  }

  for (const shortDate of input.matchAll(/\b([A-Za-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?\b/gi)) {
    const month = MONTH_NUMBER[shortDate[1].toLowerCase()]
    const day = Number(shortDate[2])
    if (!month || !validIsoDate(2000, month, day)) continue
    return validIsoDate(inferReportYear(month, day, now), month, day)
  }

  return null
}

function getMopsSection(text) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n')
  const start = lines.findIndex(line => /^\s*MOPS\s*:?\s*$/i.test(line))
  if (start < 0) return lines.join('\n')

  const relativeEnd = lines.slice(start + 1).findIndex(line => /^\s*(?:MOC|MOPJ(?:\s+MOC)?)\s*:?\s*$/i.test(line))
  const end = relativeEnd < 0 ? lines.length : start + 1 + relativeEnd
  return lines.slice(start + 1, end).join('\n')
}

function getMocSection(text) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n')
  const start = lines.findIndex(line => /^\s*MOC\s*:?\s*$/i.test(line))
  if (start < 0) return ''

  const relativeEnd = lines.slice(start + 1).findIndex(line => /^\s*(?:-{5,}|MOPJ\b)/i.test(line))
  const end = relativeEnd < 0 ? lines.length : start + 1 + relativeEnd
  return lines.slice(start + 1, end).join('\n')
}

function mocProductField(label) {
  const normalized = String(label || '').toLowerCase().replace(/\s+/g, ' ').trim()
  if (/^(?:s\s*)?380$/.test(normalized)) return 's380'
  if (/^(?:s\s*)?0\s*\.\s*5\s*%?$/.test(normalized)) return 's05'
  if (/^(?:s\s*)?g\s*o$/.test(normalized) || /^(?:10\s*ppm\s+)?gas(?:\s*oil)?$/.test(normalized)) return 'sgo'
  return null
}

function parseForwardEstimate(text, priceDate, spotPrices) {
  if (!priceDate) return null
  const mocSection = getMocSection(text)
  if (!mocSection) return null

  const [reportYear, reportMonth] = priceDate.split('-').map(Number)
  const reportPeriod = (reportYear * 12) + reportMonth - 1
  const quotes = new Map()

  for (const line of mocSection.split('\n')) {
    const match = line.match(/^\s*(?:bal(?:ance)?\s+)?([A-Za-z]{3,9})\s+(.+?)\s*(?::|=)\s*(?:USD\s*)?(?:US\$|\$)?\s*(-?\d+(?:\.\d+)?)\s*$/i)
    if (!match) continue
    const monthNumber = MONTH_NUMBER[match[1].toLowerCase()]
    const field = mocProductField(match[2])
    if (!monthNumber || !field) continue

    const year = monthNumber < reportMonth ? reportYear + 1 : reportYear
    const month = `${year}-${String(monthNumber).padStart(2, '0')}`
    const period = (year * 12) + monthNumber - 1
    if (period <= reportPeriod) continue

    const quote = quotes.get(month) || { month, period, prices: {} }
    quote.prices[field] = Number(match[3])
    quotes.set(month, quote)
  }

  const candidates = [...quotes.values()].sort((left, right) => left.period - right.period)
  const selected = candidates[0]
  if (!selected) return null

  const adjustments = Object.fromEntries(['s380', 's05', 'sgo'].map(field => {
    const forwardPrice = selected.prices[field]
    const spotPrice = spotPrices[field]
    const adjustment = forwardPrice == null || spotPrice == null
      ? null
      : Math.round((forwardPrice - spotPrice) * 100) / 100
    return [field, adjustment]
  }))

  if (Object.values(adjustments).every(value => value == null)) return null
  return {
    month: selected.month,
    source: 'MOC',
    prices: {
      s380: selected.prices.s380 ?? null,
      s05: selected.prices.s05 ?? null,
      sgo: selected.prices.sgo ?? null,
    },
    adjustments,
  }
}

export function parseMopsText(text = '', options = {}) {
  const rawInput = String(text)
  const mopsSection = getMopsSection(rawInput)
  const s380 = readPriceAfterLabel(mopsSection, ['\\bS\\s*380\\b', '\\b380\\b'])
  const s05 = readPriceAfterLabel(mopsSection, ['\\bS\\s*0\\s*\\.\\s*5\\s*%?', '\\b0\\s*\\.\\s*5\\s*%'])
  const sgo = readPriceAfterLabel(mopsSection, [
    '\\bS\\s*G\\s*O\\b',
    '\\bG\\s*O\\b',
    '\\b10\\s*PPM\\s*(?:GAS(?:\\s*OIL)?)\\b',
  ])
  const labelledPrices = [s380, s05, sgo]
  const fallback = labelledPrices.every(value => value == null) ? fallbackNumbers(mopsSection) : []
  const parsedPrices = {
    s380: s380 ?? fallback[0] ?? null,
    s05: s05 ?? fallback[1] ?? null,
    sgo: sgo ?? fallback[2] ?? null,
  }
  const priceDate = parseMopsPriceDate(rawInput, options)

  return {
    price_date: priceDate,
    ...parsedPrices,
    forward_estimate: parseForwardEstimate(rawInput, priceDate, parsedPrices),
    source: 'Parsed',
    raw_input: rawInput,
  }
}

function finitePrice(value) {
  return value !== null && value !== '' && Number.isFinite(Number(value))
}

export function parseMopsContractMonth(text) {
  const input = String(text || '')
  let match = input.match(/\b(20\d{2})[-/](0?[1-9]|1[0-2])\b/)
  if (match) return `${match[1]}-${String(Number(match[2])).padStart(2, '0')}`

  match = input.match(/\b([A-Za-z]{3,9})[\s'/-]+(\d{2}|(?:19|20)\d{2})\b/i)
  if (match && MONTH_NUMBER[match[1].toLowerCase()]) {
    return `${normalizeYear(match[2])}-${String(MONTH_NUMBER[match[1].toLowerCase()]).padStart(2, '0')}`
  }

  match = input.match(/\b(\d{2}|(?:19|20)\d{2})[\s'/-]+([A-Za-z]{3,9})\b/i)
  if (match && MONTH_NUMBER[match[2].toLowerCase()]) {
    return `${normalizeYear(match[1])}-${String(MONTH_NUMBER[match[2].toLowerCase()]).padStart(2, '0')}`
  }
  return null
}

export function mopsMonthInputFingerprint(yearMonth, records = []) {
  const calculated = finalMopsMonthlyAverages(yearMonth, records)
  return calculated
    ? createHash('sha256').update(`${yearMonth}|${calculated.inputSignature}`).digest('hex')
    : null
}

export function decorateMopsMonthVerifications(verifications = [], records = []) {
  return (verifications || []).map((verification) => {
    const currentFingerprint = mopsMonthInputFingerprint(verification.contract_month, records)
    return {
      ...verification,
      is_current: Boolean(currentFingerprint && currentFingerprint === verification.input_fingerprint),
    }
  })
}

export function verifyMopsMonthlyAverage(yearMonth, records = [], rawInput = '', options = {}) {
  const sourceMessage = String(rawInput || '').trim()
  const now = options.now || new Date()
  const finality = mopsMonthFinality(yearMonth, records, now)
  const issues = []
  if (!finality.calendarSupported) issues.push(`The approved Platts publication calendar is unavailable for ${String(yearMonth).slice(0, 4)}.`)
  if (!finality.reachedLastTradingDay) issues.push(`The final trading day ${finality.lastTradingDay || 'is unavailable'} has not been reached.`)
  if (finality.complete !== finality.total) issues.push(`All ${finality.total} scheduled publication days must contain complete actual MOPS values first.`)
  if (!sourceMessage) issues.push('Paste the third-party final monthly-average message.')

  const sourceMonth = sourceMessage ? parseMopsContractMonth(sourceMessage) : null
  const parsed = sourceMessage ? parseMopsText(sourceMessage, options) : null
  const calculated = finality.calculatedAverages
  if (sourceMessage && !sourceMonth) issues.push('The third-party message does not contain a recognizable contract month and year.')
  else if (sourceMonth && sourceMonth !== yearMonth) issues.push(`The message month ${sourceMonth} does not match ${yearMonth}.`)

  for (const field of MOPS_PRICE_FIELDS) {
    if (!calculated || !finitePrice(calculated[field])) continue
    if (!finitePrice(parsed?.[field])) {
      issues.push(`The third-party message does not contain the final ${field.toUpperCase()} monthly average.`)
      continue
    }
    if (Math.abs(Number(calculated[field]) - Number(parsed[field])) >= 0.0005) {
      issues.push(`${field.toUpperCase()} in the message does not match FCOS's final monthly average of ${Number(calculated[field]).toFixed(3)}.`)
    }
  }

  return {
    verified: issues.length === 0,
    issues,
    calculatedSnapshot: calculated ? {
      contract_month: yearMonth,
      publication_days: calculated.publicationDays,
      s380: calculated.s380,
      s05: calculated.s05,
      sgo: calculated.sgo,
    } : null,
    sourceSnapshot: parsed ? {
      contract_month: sourceMonth,
      s380: parsed.s380,
      s05: parsed.s05,
      sgo: parsed.sgo,
    } : null,
    inputFingerprint: mopsMonthInputFingerprint(yearMonth, records),
    sourceHash: sourceMessage ? createHash('sha256').update(sourceMessage).digest('hex') : null,
  }
}
