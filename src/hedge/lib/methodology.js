const PLATTS_HOLIDAY_URL = "https://www.spglobal.com/energy/en/pricing-benchmarks/our-methodology/holiday";
const PLATTS_METHODOLOGY_URL = "https://www.spglobal.com/energy/en/pricing-benchmarks/our-methodology/methodology-specifications/refined-products";

export const PAGE_METHODOLOGIES = {
  Markets: {
    summary: "Markets compares delivered bunker observations with controlled exact-date MOPS benchmarks and keeps settlement publication behind a complete European Marketscan three-symbol gate.",
    steps: [
      "Delivered Bunkers shows Hong Kong, Singapore, South Korea, South Korea West, Zhoushan and Kaohsiung in USD/MT. South Korea West HSFO and LSMGO remain explicit Not published gaps.",
      "Each matrix cell uses one three-month premium/discount sparkline and exact-date 1W, 1M and 3M statistics. Missing dates are never forward-filled, interpolated or replaced with a cargo proxy.",
      "Kaohsiung VLSFO is displayed with the local LS180 label; MF-380 is mapped to HSFO 380. These names do not change the source symbol or methodology basis.",
      "Synchronized product panels compare delivered prices or delivered-minus-MOPS spreads over 1W, 1M, 3M, 6M or 1Y. SGO is converted to USD/MT with the controlled 7.45 bbl/MT factor.",
      "Cargo & Forward retains the controlled MOPS publication workflow and separately shows licensed cargo, BM, M1, M2, East-West and gasoil observations.",
      "Trading Signals calculates transparent port spreads, delivered premiums, curve structure and quote differences. It never makes or executes a trading decision.",
      "Report import extracts only allowlisted symbols, requires an entitlement confirmation, re-parses the PDF before saving, and stores immutable structured evidence plus a source hash rather than the report or its text. Conflicts are quarantined.",
      "FCOS checks the approved Bunkerwire and European Marketscan Google Drive folders hourly through the pinned vince.less@gmail.com server authorization. It imports only unseen checksums and refreshes an open Markets page shortly after each scheduled check. If browser reauthorization is required, use only the Vincent profile; normal scheduled processing uses the server OAuth refresh token.",
      "Only one European Marketscan report containing AMFSA00, PPXDK00 and POABC00 for the same date may publish MOPS. Estimates are replaced, matching actuals are verified, differing actuals are never overwritten, and monthly-average verification and hedge-expiry gates remain unchanged.",
    ],
    sources: [
      { label: "S&P Global refined products assessment methodology", url: PLATTS_METHODOLOGY_URL },
    ],
  },
  "Position control": {
    summary: "Portfolio control combines live physical exposure, linked paper hedges, clearing cash, initial margin, and current MOPS-based valuation.",
    steps: [
      "Net exposure is physical quantity less active hedge quantity for each counterparty and product.",
      "Paper mark-to-market uses the applicable monthly MOPS average; forward months use the latest actual MOPS plus the saved forward adjustment.",
      "Account equity is clearing cash plus unrealized hedge mark-to-market. Buying power deducts usable initial margin from that equity.",
      "Attention items are generated from material unhedged positions, pending clearing records, stale MOPS data, and open settlement months.",
    ],
  },
  "Physical trades": {
    summary: "Physical positions are valued from their buy and sell pricing legs, premiums, quantities, pricing months, and any linked paper hedges.",
    steps: [
      "Fixed legs use the entered fixed price. MOPS legs use the selected monthly or balance-month average plus the entered premium.",
      "SGO quantities are normalized with the configured barrel-per-metric-ton conversion when required.",
      "Physical P&L is sell value less buy value. Combined P&L adds mark-to-market from linked active hedges.",
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
    summary: "The MOPS workspace combines recorded Singapore assessments, the Platts publication calendar, projected monthly averages, and forward MOC indications.",
    steps: [
      "Projected monthly averages use recorded actual or estimated values and carry the latest available price through each remaining publication day.",
      "The publication ledger includes every weekday in the selected month except Singapore Platts holidays, alongside any saved source and record type.",
      "Daily actual rows provide the inputs but do not require individual source verification.",
      "After all daily values are complete, a user pastes and saves the text used for manual verification. FCOS retains the text but does not parse or compare its contents.",
      "A paper hedge expires automatically after every contract month reaches its final trading day and its manual verification text is saved.",
      "Forward prices equal the latest actual spot MOPS plus the saved product adjustment. Positive adjustments indicate contango; negative adjustments indicate backwardation.",
      "Assisted capture parses published MOPS bulletins. Market-indication capture creates an editable estimate for today and can derive the nearest future MOC adjustment.",
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
