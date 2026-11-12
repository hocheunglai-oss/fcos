const lineFields = `Id, Name, STEM__c, Product__c, Product__r.Name, Product__r.Family, Supplier_Name__c,
  BDN_Company__c, Quantity__c, Quantity_Delivered_Per_BDN__c, Quantity_Max__c, Quantity_in_MT__c,
  Is_Quantity_Range__c, Price_Per_Unit__c, Cost_Per_Unit__c, Unit_Sell_At__c, Unit_Buy_At__c, Unit_Cost__c,
  Subtotal_Sell_At__c, Subtotal_Buy_At__c, Total_Price__c, Total_Cost__c, Supplier_Invoice__c, Payment_Term__c,
  BDN_Number__c, Cancelled__c, Buyers_Broker__c, Buyer_Broker__c, Buyers_Brokers_Commission_Per_Unit__c,
  Buyers_Brokers_Commission_Lumpsum__c, Commission_Cost__c, Supplier_Broker__c, Suppliers_Brokers_Commission_Per_Unit__c,
  Suppliers_Brokers_Commission_Lumpsum__c, Offer_Line_Item__r.UnitPrice, Offer_Line_Item__r.Supplier_Unit_Price__c`;

const nativeFields = ['Currency__c', 'HKD_Unit_Price__c', 'FX_Rate__c', 'FX_Revision__c', 'FX_Confirmed_At__c'];

export async function loadStemDetailLineItems(stemId, { describe, query }) {
  if (typeof stemId !== 'string' || !/^[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?$/.test(stemId)) {
    throw new Error('A resolved Salesforce STEM ID is required.');
  }
  const schema = await describe().catch(() => null);
  const available = new Set(Array.isArray(schema?.fields) ? schema.fields.map((field) => field?.name) : []);
  const pricingFields = ['Buy', 'Sell'].flatMap((side) => {
    const required = nativeFields.map((field) => `${side}_${field}`);
    const preciseUsd = `${side}_USD_Unit_Price_Precise__c`;
    return [
      ...(required.every((field) => available.has(field)) ? required : []),
      ...(available.has(preciseUsd) ? [preciseUsd] : []),
    ];
  });
  const fetchLines = (fields) => query(`SELECT ${fields} FROM STEM_Line_Item__c WHERE STEM__c = '${stemId}' ORDER BY CreatedDate ASC`, { softFail: false });
  try {
    return await fetchLines([lineFields, ...pricingFields].join(', '));
  } catch (error) {
    if (error?.code !== 'INVALID_FIELD' || !pricingFields.length) throw error;
    return fetchLines(lineFields);
  }
}
