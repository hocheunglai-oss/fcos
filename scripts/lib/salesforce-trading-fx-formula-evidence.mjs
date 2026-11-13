import { salesforcePromotionHash } from './salesforce-promotion-journal.mjs';

// These witnesses model the two null-handling modes for exact reviewed formulas.
// Requalify the witness and update its digest when the source formula changes.
const reviewed = new Map([
  ['QuoteLineItem.Internal_Margin__c', '6851b29d464b8046231cc288ee4e0de81cb48be8bbaaf693bf26dd68b4985ee2'],
  ['QuoteLineItem.Our_Cost__c', '59fe51726ac7081ab8350f623497cc321c1af12c738c2c9081efa31d964b0884'],
  ['QuoteLineItem.Profit__c', 'cd630f5ac747a52bfc5bbb5f257647e215e8d3e54c74d695a7292d09b1742edb'],
  ['QuoteLineItem.Total_Sell_At__c', 'd9e74923eb74d072e63503cd4ce9f4f4bd7d86dad68ab69a1d0719f7e6577471'],
  ['STEM_Extra_Cost__c.QLIK_Total_Cost__c', 'e33ab8e32cc90a450f504fc91ade966581c38f0e778317ef3250cca737eeed06'],
  ['STEM_Extra_Cost__c.QLIK_Total_Price__c', '3ef74dc18605eef2cbc6c3c572986bcea174e4b2a0a7a20537388fb72225ccf6'],
  ['STEM_Extra_Cost__c.Spread_Margin__c', '9e98498801f0cfaab0ff02e4826d8867aecb57a383a0b2e240900ec236dfd87a'],
  ['STEM_Line_Item__c.QLIK_Total_Cost__c', 'd3755010cbe2c839c549b5c3d2e699c628a7b940c01f093bfc7e9f6c7f051d1f'],
  ['STEM_Line_Item__c.QLIK_Total_Price__c', 'd27b07631ce68908c74c073c73d65fd04e4f0ac5527aafc945e4edcf952b04c5'],
  ['STEM_Line_Item__c.Total_Cost__c', 'aee7148abf9a6792f6f889cce3a33473b8199af553764f461dba6b6602e9c2f8'],
  ['STEM_Line_Item__c.Total_Price__c', '59b09b8fce1470feee471aa1026d46571df43488302c03437ee47b61da700707'],
  ['STEM_Line_Item__c.Unit_Cost__c', 'ad35db73fc872b8b043270035b9a5dee165fef967ff1ca1c9b1d1eb365b97532'],
  ['Supplier_Bid__c.Total_Supplier_Price__c', '85e5eb158ecff6e90441756852927bee9ba9762fb45240ce83f77a657a56bf34'],
]);

export function supportsTradingFxFormulaWitness(name, sourceHash) {
  return reviewed.has(name) && reviewed.get(name) === sourceHash;
}

const decimal = value => value ?? 0;
const total = (price, quantity) => price * decimal(quantity);
const buy='(Buy_Currency__c = null OR Buy_Currency__c = \'USD\') AND Buy_USD_Unit_Price_Precise__c = null';
const sell='(Sell_Currency__c = null OR Sell_Currency__c = \'USD\') AND Sell_USD_Unit_Price_Precise__c = null';
const deliveredQuantity = row => row.Quantity_Delivered_Per_BDN__c || row.Quantity__c;
const checks = [
  {
    object: 'QuoteLineItem', input: 'Quantity,UnitPrice,Supplier_Unit_Price__c,Buyer_Broker_Commission__c,Supplier_Broker_Commission__c,Unit_Transportation_Cost__c,Minimum_Sell_At__c',
    filter: buy + ' AND '+sell+' AND Fixed__c = false AND UnitPrice != 0 AND Supplier_Unit_Price__c != null AND Supplier_Unit_Price__c != 0',
    expected: {
      Internal_Margin__c: row => [row.UnitPrice-decimal(row.Buyer_Broker_Commission__c)-row.Supplier_Unit_Price__c-decimal(row.Supplier_Broker_Commission__c),-decimal(row.Buyer_Broker_Commission__c)-decimal(row.Supplier_Broker_Commission__c)],
      Our_Cost__c: row => {
        const additions = decimal(row.Supplier_Broker_Commission__c) + decimal(row.Unit_Transportation_Cost__c);
        return [row.Supplier_Unit_Price__c + additions, additions];
      },
      Profit__c: row => [total(row.UnitPrice-row.Supplier_Unit_Price__c,row.Quantity),0],
      Total_Sell_At__c: row => [Math.max(total(row.UnitPrice,row.Quantity),decimal(row.Minimum_Sell_At__c)),Math.max(0,decimal(row.Minimum_Sell_At__c))],
    },
  },
  {
    object: 'STEM_Line_Item__c', input: 'Quantity__c,Quantity_Delivered_Per_BDN__c,QLIK_Quantity__c,Unit_Sell_At__c,Unit_Buy_At__c,Total_Consultation_Fee__c,Buyers_Brokers_Commission_Per_Unit__c,Suppliers_Brokers_Commission_Per_Unit__c',
    filter: buy + ' AND '+sell+' AND Unit_Sell_At__c != null AND Unit_Sell_At__c != 0 AND Unit_Buy_At__c != null AND Unit_Buy_At__c != 0',
    expected: {
      QLIK_Total_Cost__c: row => [total(row.Unit_Buy_At__c,row.QLIK_Quantity__c),0],
      QLIK_Total_Price__c: row => [total(row.Unit_Sell_At__c,row.QLIK_Quantity__c),0],
      Total_Cost__c: row => [total(row.Unit_Buy_At__c,deliveredQuantity(row)),0],
      Total_Price__c: row => [total(row.Unit_Sell_At__c,deliveredQuantity(row)),0],
      Unit_Cost__c: row => {
        const additions = decimal(row.Total_Consultation_Fee__c)
          - decimal(row.Buyers_Brokers_Commission_Per_Unit__c) - decimal(row.Suppliers_Brokers_Commission_Per_Unit__c);
        return [row.Unit_Buy_At__c + additions, additions];
      },
    },
  },
  {
    object: 'STEM_Extra_Cost__c', input: 'Quantity__c,QLIK_Quantity__c,Unit_Cost__c,Unit_Price__c,Minimum_Buy_At__c,Minimum_Sell_At__c,Lumpsum_Price__c,Lumpsum_Cost__c',
    filter: buy + ' AND '+sell+' AND Fixed__c = false AND (Unit_Price__c != null OR Unit_Cost__c != null OR Lumpsum_Price__c != null OR Lumpsum_Cost__c != null)',
    expected: {
      QLIK_Total_Cost__c: row => [Math.max(decimal(row.Minimum_Buy_At__c),total(row.Unit_Cost__c,row.QLIK_Quantity__c)),Math.max(0,decimal(row.Minimum_Buy_At__c))],
      QLIK_Total_Price__c: row => [Math.max(decimal(row.Minimum_Sell_At__c),total(row.Unit_Price__c,row.QLIK_Quantity__c)),Math.max(0,decimal(row.Minimum_Sell_At__c))],
    },
  },
  {
    object: 'STEM_Extra_Cost__c', input: 'Quantity__c,Unit_Cost__c,Unit_Price__c,Lumpsum_Price__c,Lumpsum_Cost__c',
    filter: buy + ' AND '+sell+' AND (Lumpsum_Price__c != null OR Unit_Price__c = null OR (Unit_Cost__c = null AND Lumpsum_Cost__c = null))',
    expected: {
      Spread_Margin__c: row => {
        const { Quantity__c: quantity, Lumpsum_Price__c: lumpsumPrice, Lumpsum_Cost__c: lumpsumCost,
          Unit_Price__c: unitPrice, Unit_Cost__c: unitCost } = row;
        const zero = decimal(lumpsumPrice);
        if (lumpsumPrice !== null && unitCost !== null) {
          return [quantity === null ? null : lumpsumPrice - unitCost * quantity, zero];
        }
        if (lumpsumPrice !== null && lumpsumCost !== null) return [lumpsumPrice - lumpsumCost, zero];
        if (quantity !== null && unitPrice !== null && lumpsumCost !== null) return [unitPrice * quantity - lumpsumCost, zero];
        if (quantity !== null && unitPrice !== null && unitCost !== null) return [(unitPrice - unitCost) * quantity, zero];
        return [null, zero];
      },
    },
  },
  {
    object: 'Supplier_Bid__c', input: 'Quantity__c,Supplier_Unit_Price__c',
    filter: buy + ' AND Quantity__c != null AND Quantity__c != 0 AND Supplier_Unit_Price__c != null AND Supplier_Unit_Price__c != 0',
    expected: {Total_Supplier_Price__c: row => [total(row.Supplier_Unit_Price__c,row.Quantity__c),0]},
  },
];

function matches(actual, expected) {
  return expected === null ? actual === null
    : Number.isFinite(actual) && Math.abs(actual - expected) < 0.0051;
}

export function verifyTradingFxFormulaWitnesses(requested, query) {
  if (!requested.length) return null;
  const pending = new Set(requested);
  if (pending.size !== requested.length) throw new Error('Salesforce formula witness scope contains duplicates.');
  const counts = {};
  const observations = {};
  for (const { object, input, filter, expected } of checks) {
    const fields = Object.keys(expected).filter(field => pending.has(object + '.' + field));
    if (!fields.length) continue;
    const result = query('SELECT ' + input + ',' + fields.join(',') + ' FROM ' + object + ' WHERE ' + filter + ' LIMIT 100');
    if (!Array.isArray(result?.records) || result.records.length > 100 || result.done === false) throw new Error('Salesforce formula behavior query returned invalid evidence.');
    for (const field of fields) {
      const name = object + '.' + field;
      const witnesses = [];
      for (const row of result.records) {
        const [blank, zero] = expected[field](row);
        if (matches(blank, zero)) continue;
        if (!matches(row[field], blank) || matches(row[field], zero)) {
          throw new Error('Salesforce formula behavior differs from the reviewed blank mode: ' + name);
        }
        witnesses.push([row[field], blank, zero]);
      }
      if (!witnesses.length) throw new Error('Salesforce formula has no distinguishing native readback: ' + name);
      counts[name] = witnesses.length;
      observations[name] = witnesses;
      pending.delete(name);
    }
  }
  if (pending.size) throw new Error('Salesforce formula witness scope is incomplete.');
  return { formulaWitnesses: counts, formulaWitnessEvidenceSha256: salesforcePromotionHash(observations) };
}
