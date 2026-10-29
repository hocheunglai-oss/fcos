trigger SupplierBidTrigger on Supplier_Bid__c (before insert, after insert,after update) {
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