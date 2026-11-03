trigger QuoteLineItemTrigger on QuoteLineItem (before insert, before update, after insert, after update, before delete, after delete) {
    if (ContextManager.skipTriggers) return;
	// Util check that enable or disable trigger
	if(!TriggerUtil.checkIsDisabled('QuoteLineItem', null) && !ContextManager.avoidQuoteLineItemFiring){
		if (Trigger.isBefore) {
			if (Trigger.isDelete) {
				LockerService.checkValidity(Trigger.oldMap, Trigger.oldMap, Trigger.operationType);
				QuoteLineItemTriggerHandler.deleteExtraCosts(Trigger.oldMap);
			} else {
				QuoteLineItemTriggerHandler.setPriceBookEntryId(Trigger.new);
				QuoteLineItemTriggerHandler.setEnquiryLineItemId(Trigger.new);
                
			}
		}
		if (Trigger.isAfter && (Trigger.isInsert || Trigger.isUpdate)) {
			QuoteLineItemTriggerHandler.applyEnquirySpecialTerms(Trigger.new);
		}
		
        if ((Trigger.isInsert || Trigger.isUpdate) && Trigger.isBefore){
            QuoteLineItemTriggerHandler.setTotalExposure(Trigger.new);
        }
        
		if ((Trigger.isInsert || Trigger.isUpdate) && Trigger.isAfter) {
			LockerService.checkValidity(Trigger.newMap, Trigger.oldMap, Trigger.operationType);
            if(Trigger.isUpdate){
                QuoteLineItemTriggerHandler.updateSpecifiedSupplier(Trigger.new, Trigger.oldMap);
                QuoteLineItemTriggerHandler.validateWinningQuoteLineItems(Trigger.new);
            }
		}
        if(Trigger.isDelete && Trigger.isAfter){
            QuoteLineItemTriggerHandler.deleteSpecialTermsLinks(Trigger.oldMap);
        }
        if(Trigger.isAfter){
            List<QuoteLineItem> itemsToProcess = Trigger.isDelete ? Trigger.old : Trigger.new;
        
            QuoteLineItemTriggerHandler.handleLineItemChanges(itemsToProcess);
        }
	}
}