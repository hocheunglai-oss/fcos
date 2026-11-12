trigger SupplierBidTrigger on Supplier_Bid__c (before insert, before update, before delete, after insert,after update) {
    if (Trigger.isBefore && (Trigger.isInsert || Trigger.isUpdate)) {
        Map<Id,SObject> previousFxRows = new Map<Id,SObject>();
        if (Trigger.isUpdate) for (SObject previousFxRow : Trigger.old) previousFxRows.put(previousFxRow.Id,previousFxRow);
        FcosTradeCurrencyGuard.beforeSave(Trigger.new,previousFxRows,new List<String>{'Buy'});
    }
    if (Trigger.isBefore && Trigger.isDelete) FcosTradeCurrencyGuard.beforeDelete(Trigger.old, new List<String>{'Buy'});

  if (ContextManager.skipTriggers) return;

  if(Trigger.isBefore && Trigger.isInsert){
    //SupplierBidTriggerHandler.validateSupplierBids(Trigger.new);
    SupplierBidTriggerHandler.checkSupplierDuplicates(Trigger.new);
    SupplierBidTriggerHandler.syncronizeSupplierBids(Trigger.new);
  }

  if(Trigger.isAfter && Trigger.isInsert){
    SupplierBidTriggerHandler.checkAndCreatePreferredSupplier(Trigger.new);

    ContextManager.triggerExecutionCount +=1;
     /*
    if (!ContextManager.avoidRecursion) {
      SupplierBidTriggerHandler.addSupplierBidsToAllBrokerEnquiryQuotes(Trigger.new);
    }
	*/
  }

  if(Trigger.isAfter && Trigger.isUpdate) {
  	if (!ContextManager.avoidSupplierBidRecursion) {
        SupplierBidTriggerHandler.syncronizePaymentTerms(Trigger.newMap);
    }
    
    /*
    if (!ContextManager.avoidRecursion) {
    	SupplierBidTriggerHandler.updateSupplierBids(Trigger.new);
    }
	*/
  }

    
    
  if(Trigger.isAfter && (Trigger.isUpdate || Trigger.isInsert)) {
      if (!ContextManager.avoidSupplierBidRecursion) {
      	SupplierBidTriggerHandler.createPortSupplier(Trigger.new);
      }
      SupplierBidTriggerHandler.updateStatuses(Trigger.new);
  }

}
