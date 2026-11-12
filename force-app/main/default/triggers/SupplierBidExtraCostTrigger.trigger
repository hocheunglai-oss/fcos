trigger SupplierBidExtraCostTrigger on Supplier_Bid_Extra_Cost__c (before insert, before update, before delete) {
    if (Trigger.isBefore && (Trigger.isInsert || Trigger.isUpdate)) {
        Map<Id,SObject> previousFxRows = new Map<Id,SObject>();
        if (Trigger.isUpdate) for (SObject previousFxRow : Trigger.old) previousFxRows.put(previousFxRow.Id, previousFxRow);
        FcosTradeCurrencyGuard.beforeSave(Trigger.new, previousFxRows, new List<String>{'Buy'});
    }
    if (Trigger.isBefore && Trigger.isDelete) FcosTradeCurrencyGuard.beforeDelete(Trigger.old, new List<String>{'Buy'});
}
