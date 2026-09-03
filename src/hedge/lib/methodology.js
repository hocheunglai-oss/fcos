const PLATTS_HOLIDAY_URL = "https://www.spglobal.com/energy/en/pricing-benchmarks/our-methodology/holiday";
const PLATTS_METHODOLOGY_URL = "https://www.spglobal.com/energy/en/pricing-benchmarks/our-methodology/methodology-specifications/refined-products";
const PLATTS_FORWARD_CURVE_URL = "https://www.spglobal.com/content/dam/spglobal/ci/en/documents/platts/en/our-methodology/methodology-specifications/risk/forward-curve-oil-specifications.pdf";
const PLATTS_BUNKER_FUELS_URL = "https://www.spglobal.com/content/dam/spglobal/ci/en/documents/platts/en/our-methodology/methodology-specifications/shipping/bunker-fuels-specifications.pdf";
const PLATTS_ASSESSMENT_GUIDE_URL = "https://www.spglobal.com/content/dam/spglobal/ci/en/documents/platts/en/our-methodology/methodology-specifications/platts-assessments-methodology-guide.pdf";
const PLATTS_OIL_TIMING_URL = "https://www.spglobal.com/content/dam/spglobal/ci/en/documents/platts/en/our-methodology/methodology-specifications/oil-timing-increment-guidelines.pdf";
const PLATTS_ASIA_REFINED_URL = "https://www.spglobal.com/platts/plattscontent/_assets/_files/en/our-methodology/methodology-specifications/asia-refined-oil-products-methodology.pdf";

export const PAGE_METHODOLOGIES = {
  Markets: {
    summary: "Markets combines a source-linked daily bunker brief, exact-date delivered/MOPS comparisons and report-derived contract-month curves without converting evidence into a trading recommendation.",
    steps: [
      "Daily Decision Brief presents report completeness, same-snapshot curve regimes, material moves, port dislocations, physical-versus-paper confirmation or divergence, supported drivers and risks. AI may paraphrase commentary with store:false, but it cannot create, adjust or delay a price.",
      "Daily Decision Brief opens on the newest completed Bunkerwire and European Marketscan report pair on or before the Hong Kong date. Previous and Next skip incomplete dates; the displayed report date remains in the URL across refresh and browser navigation.",
      "Intraday paper market retains reviewed morning indications and provisional Asia MOC references as immutable structured history. Screenshot extraction uses protected store:false vision and requires row-by-row user review; raw images, pasted text, prompts and model responses are not stored. 180 CST is ignored.",
      "Asia MOC is a controlled assessment process using tested market evidence, not a formula. Intraday references may show exact same-date and same-contract movements, structures and a BM-based provisional monthly estimate, but they never become official MOPS, settlement evidence, automatic fallbacks or hedge marks.",
      "Delivered & MOPS shows Hong Kong, Singapore, South Korea, South Korea West, Zhoushan and Kaohsiung in USD/MT. South Korea West HSFO and LSMGO remain explicit Not published gaps.",
      "Each matrix cell uses one three-month premium/discount sparkline and exact-date 1W, 1M and 3M statistics. Missing dates are never forward-filled, interpolated or replaced with a cargo proxy.",
      "Kaohsiung VLSFO is displayed with the local LS180 label; MF-380 is mapped to HSFO 380. These names do not change the source symbol or methodology basis.",
      "Synchronized product panels compare delivered prices or delivered-minus-MOPS spreads over 1W, 1M, 3M, 6M or 1Y. SGO is converted to USD/MT with the controlled 7.45 bbl/MT factor.",
      "Forward Curves uses the exact report outright for each printed contract month. It never copies M1 into M2, reuses a mark after roll, interpolates a tenor, forward-fills a gap or derives a numeric mark from commentary.",
      "Closed-month settlement uses the approved publication-day average. Current month uses actual publication days before a valid balance-month assessment and applies that balance-month outright to remaining publication days including its assessment date.",
      "An authorized manual fallback is an exact outright product, contract month and unit. It expires on the next verified report, next Platts publication day or contract roll and never overrides verified data. Legacy per-product adjustments are not trading inputs.",
      "Drivers & Alerts retains only concise non-verbatim bunker-relevant summaries, tags, confidence and report/page lineage. A numeric fact is dropped unless it validates against the cited page; no PDF, report text, prompt or raw model response is stored.",
      "The licensed report price library retains every deterministically detected table row with its exact source product name, code, native unit, report date, page, price, range and published movement from 1 January 2025 onward. It is separate from the governed settlement and alert series, so broad reference data cannot change MOPS, curves or financial calculations.",
      "Users may select up to eight exact report series, a bounded date range and an authorized OpenAI model for an evidence-backed analysis. The model receives only structured facts and deterministic statistics with store:false; PDF text, prompts and model responses are not persisted, invalid citations are removed, and the displayed deterministic evidence remains authoritative.",
      "Company alerts use the larger of a configured floor or the previous 60-day 95th percentile after at least 20 samples. Regime flips require two complete reports outside the controlled deadband and notifications remain in-app only.",
      "Report import extracts the complete structured price library and separately applies the existing allowlist to governed trading symbols. It requires an entitlement confirmation, re-parses the PDF before saving, and stores immutable structured evidence plus a source hash rather than the report or its text. Governed-series conflicts are quarantined.",
      "A value printed as N/A is retained as immutable availability evidence and remains distinct from an unreadable or absent symbol. Neither state creates a zero, estimate, fallback, or carried-forward value.",
      "FCOS checks the approved Bunkerwire and European Marketscan Google Drive folders hourly through the pinned vince.less@gmail.com server authorization. It imports only unseen checksums and refreshes an open Markets page shortly after each scheduled check. If browser reauthorization is required, use only the Vincent profile; normal scheduled processing uses the server OAuth refresh token.",
      "Only one European Marketscan report containing AMFSA00, PPXDK00 and POABC00 for the same date may publish MOPS. Estimates are replaced, matching actuals are verified, differing actuals are never overwritten, and monthly-average verification and hedge-expiry gates remain unchanged.",
    ],
    sources: [
      { label: "S&P Global refined products assessment methodology", url: PLATTS_METHODOLOGY_URL },
      { label: "S&P Global Platts forward curve oil specifications", url: PLATTS_FORWARD_CURVE_URL },
      { label: "S&P Global Platts global bunker fuels specifications", url: PLATTS_BUNKER_FUELS_URL },
      { label: "S&P Global Platts assessment methodology guide", url: PLATTS_ASSESSMENT_GUIDE_URL },
      { label: "S&P Global Platts oil timing and increment guidelines", url: PLATTS_OIL_TIMING_URL },
      { label: "S&P Global Platts Asia refined oil products methodology", url: PLATTS_ASIA_REFINED_URL },
    ],
  },
  "Position control": {
    summary: "Portfolio control combines live physical exposure, linked paper hedges, clearing cash, initial margin, and current MOPS-based valuation.",
    steps: [
      "Net exposure is physical quantity less active hedge quantity for each counterparty and product.",
      "Paper mark-to-market uses the applicable approved monthly MOPS average or the exact report-derived outright for an open future contract month. Missing tenors remain unavailable unless a current authorized fallback exists.",
      "Account equity is clearing cash plus unrealized hedge mark-to-market. Buying power deducts usable initial margin from that equity.",
      "Attention items are generated from material unhedged positions, pending clearing records, stale MOPS data, and open settlement months.",
    ],
  },
  "Physical trades": {
    summary: "Physical positions are valued from their buy and sell pricing legs, premiums, quantities, pricing months, linked paper hedges, and explicitly reviewed Salesforce hedge-result costs.",
    steps: [
      "Fixed legs use the entered fixed price. MOPS legs use the selected monthly or balance-month average plus the entered premium.",
      "SGO quantities are normalized with the configured barrel-per-metric-ton conversion when required.",
      "Physical P&L is sell value less buy value. Combined P&L adds mark-to-market from linked active hedges.",
      "A final Paper Hedge result is allocated across its linked Physical Trades by normalized midpoint quantity. The Salesforce preview uses gross hedge P&L before broker, exchange, clearing, or settlement fees; a gain becomes a negative STEM cost and a loss becomes a positive STEM cost.",
      "FCOS groups each Physical Trade result by venue and checks live Salesforce, including deleted or cancelled rows. Calculation and reconciliation are read-only until an authorized user reviews the exact Physical Trade and confirms Add, Update, Recreate, Restore, or Adopt.",
      "One managed SWAPS STEM Charge is maintained for each Physical Trade and venue with fixed quantity 1 and unit of measure 1. Changed calculations remain visibly pending until confirmed; invoiced rows are locked and unmanaged matches are never adopted silently.",
      "Open and closed status follows the trade close flag and retained settlement history.",
    ],
  },
  Hedges: {
    summary: "Hedge valuation uses product quantity, direction, trade price, pricing month, venue fees, and MOPS-derived market prices.",
    steps: [
      "A buy hedge gains when market exceeds trade price; a sell hedge gains when trade price exceeds market.",
      "Monthly, balance-today, and balance-tomorrow averages use only the applicable Platts publication dates.",
      "Spread trades value the buy and sell legs independently before combining their results.",
      "Expiry is server-controlled: each contract month must reach its final Platts trading day, contain every scheduled actual MOPS value, and have manual verification text saved for its final monthly average.",
      "Estimated net P&L deducts configured broker, exchange, clearing, settlement, venue, and commission charges.",
    ],
  },
  "MOPS market": {
    summary: "The MOPS workspace combines recorded Singapore assessments, the Platts publication calendar, projected monthly averages and exact report-derived contract-month outrights.",
    steps: [
      "A closed-month projected average is its approved publication-day average. A current month with a valid balance-month assessment combines actuals strictly before that assessment date with the balance-month outright for every remaining publication day including the assessment date.",
      "The publication ledger includes every weekday in the selected month except Singapore Platts holidays, alongside any saved source and record type.",
      "Daily actual rows provide the inputs but do not require individual source verification.",
      "After all daily values are complete, a user pastes and saves the text used for manual verification. FCOS retains the text but does not parse or compare its contents.",
      "A paper hedge expires automatically after every contract month reaches its final trading day and its manual verification text is saved.",
      "Future M1 and M2 use the exact outright assessment printed for their contract month. Positive front-minus-back structure indicates backwardation; negative indicates contango.",
      "An exact-month authorized fallback may be used only while verified report data is absent. It expires at the next report, next Platts publication day or contract roll and cannot override verified data.",
      "Assisted capture parses allowlisted published symbols deterministically. It cannot derive a price from commentary or reuse one tenor for another.",
    ],
    sources: [
      { label: "S&P Global Platts holiday publication schedule", url: PLATTS_HOLIDAY_URL },
      { label: "S&P Global refined products assessment methodology", url: PLATTS_METHODOLOGY_URL },
    ],
  },
  Settlement: {
    summary: "Monthly settlement consolidates hedge P&L, counterparty balances, broker and venue charges, clearing postings, and invoice records.",
    steps: [
      "Each hedge is valued for the selected settlement month using its applicable MOPS average and direction.",
      "Counterparty net settlement combines hedge P&L and configured charges, then determines debit or credit direction.",
      "A positive FCBHK net means the counterparty pays FCBHK; a negative FCBHK net means FCBHK pays the counterparty. The payee is always the document beneficiary.",
      "When FCBHK pays the counterparty, FCOS omits counterparty banking details because payment instructions come from the counterparty's own invoice.",
      "Monthly broker commissions group every qualifying ICE trade by its trade month and broker. Amounts use the current configured UOM rate and double for round-trip trades.",
      "Broker settlement status is independent for each broker and trade month. Closing a pricing month or sending an SFS report never closes a broker settlement.",
      "If trades or fee settings change after settlement, FCOS marks that broker month Changed and requires it to be reopened and reviewed before settling again.",
      "The selected-month charge detail combines broker groups by trade month with ICE and SFS charges by pricing month, without duplicating automatically posted records.",
      "Closing a month records its control state; generated FCBHK invoices and credit notes preserve the month, counterparty, amount, PDF, and delivery status.",
    ],
  },
  Counterparties: {
    summary: "Counterparty records are the controlled source for legal identity, invoice delivery, address, and attention details.",
    steps: [
      "Short names link counterparties to physical trades, hedges, settlement groups, and invoices.",
      "Legal name, address, and attention fields populate settlement documents.",
      "Recipient fields are used as defaults during invoice composition and remain editable before delivery.",
      "Counterparty banking instructions are not maintained or printed: when FCOS must pay, the counterparty supplies its own invoice and payment instructions.",
    ],
  },
  Settings: {
    summary: "Settings are shared AppConfig records that control desk lists, calculation rates, authorised access, integrations, and communications.",
    steps: [
      "Saved list and rate changes apply to all users after live data refresh.",
      "Risk calculations use the configured SGO conversion, usable margin ratio, fee rates, and ICE margin schedule.",
      "Integrations combines server-verified access with cached quick checks and deeper permission or data-path tests.",
      "Connection history records latency plus the last successful and failed checks for operational follow-up.",
      "Connection secrets remain server-side; the interface reports configuration and live service status without exposing secret values.",
    ],
  },
  "Audit history": {
    summary: "Audit history records user-facing creates, updates, deletes, approvals, and undo operations performed through the trading workspace.",
    steps: [
      "Each action records its entity, record ID, label, user, timestamp, and available before-and-after values.",
      "Filters operate on record type, action, date range, and searchable activity text.",
      "Undo creates a compensating live-data operation and a corresponding audit record rather than removing history.",
      "System jobs or changes outside the application may not appear unless they explicitly create an audit entry.",
    ],
  },
};
