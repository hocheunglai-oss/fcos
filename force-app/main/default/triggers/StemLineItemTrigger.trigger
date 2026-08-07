trigger StemLineItemTrigger on STEM_Line_Item__c (before insert, before update, after insert, after update, before delete, after delete) {
    if (ContextManager.skipTriggers) return;
    if(!ContextManager.avoidSTEMLineItemFiring){
        if((Trigger.IsInsert || Trigger.isUpdate) && Trigger.IsBefore){
            if(Trigger.IsUpdate){
               StemLineItemTriggerHandler.updateInput(Trigger.new, Trigger.oldMap);
            }
            if(Trigger.IsInsert){
                StemLineItemTriggerHandler.setPortAndVessel(Trigger.new);
            }
            StemLineItemTriggerHandler.calculateSubtotals(Trigger.new);
            if(Trigger.IsUpdate){
                StemLineItemTriggerHandler.updateIsChangedCSVField(Trigger.new, Trigger.oldMap);
            }
        }

        if((Trigger.isInsert || Trigger.isUpdate) && Trigger.IsAfter) {
            ShipAgentInvoiceReadinessService.invalidateForLineItemChanges(Trigger.new, Trigger.isUpdate ? Trigger.oldMap : null);
            if(Trigger.isInsert){
                StemLineItemTriggerHandler.createNomination(Trigger.newMap);
            }
            if(Trigger.isUpdate){
                StemLineItemTriggerHandler.changeProductExtraCostInfo(Trigger.newMap, Trigger.oldMap);
                StemLineItemTriggerHandler.resetPaymentTerm(Trigger.newMap, Trigger.oldMap);
                StemLineItemTriggerHandler.updateNominations(Trigger.newMap, Trigger.oldMap);
                StemLineItemTriggerHandler.updateConfirmations(Trigger.newMap, Trigger.oldMap);
                StemLineItemTriggerHandler.updateNominationUnspecifiedSupplier(Trigger.newMap, Trigger.oldMap);
                StemLineItemTriggerHandler.deleteDepositPayments(Trigger.new, Trigger.oldMap);
                StemLineItemTriggerHandler.sendBdnCompanyAlert(Trigger.new, Trigger.oldMap);
                StemLineItemTriggerHandler.recalculateAmounts(Trigger.new, Trigger.oldMap);
                StemLineItemTriggerHandler.setCalculatedAmountForSupplierInvoice(Trigger.new);
                StemLineItemTriggerHandler.updateDisputes(Trigger.new, Trigger.oldMap);
            }
            StemLineItemTriggerHandler.defineCommissionChanged(Trigger.new, Trigger.oldMap, Trigger.operationType);
            StemLineItemTriggerHandler.updateUninvoicedPayments(Trigger.new, Trigger.oldMap, Trigger.operationType);
            StemLineItemTriggerHandler.createReconfirmTasks(Trigger.new, Trigger.oldMap, Trigger.operationType);
            StemLineItemTriggerHandler.createCashflows(Trigger.newMap, Trigger.oldMap);
            StemLineItemTriggerHandler.applyEnquirySpecialTerms(Trigger.new);
            StemLineItemTriggerHandler.createDepositPayment(Trigger.new, Trigger.oldMap, Trigger.operationType);
        }

        if(Trigger.isUpdate && Trigger.IsAfter){
            StemLineItemTriggerHandler.updateRelatedRecordsIsChangedCSvField(Trigger.new, Trigger.oldMap);
        }

        if(Trigger.isDelete && Trigger.isBefore){
            StemLineItemTriggerHandler.deleteContentDocuments(Trigger.oldMap);
            StemLineItemTriggerHandler.deleteExtraCosts(Trigger.oldMap);
            StemLineItemTriggerHandler.deprecateNomination(Trigger.oldMap);
        }
        if(Trigger.isDelete && Trigger.isAfter){
            ShipAgentInvoiceReadinessService.invalidateForLineItemChanges(null, Trigger.oldMap);
            StemLineItemTriggerHandler.updateUninvoicedPayments(Trigger.new, Trigger.oldMap, Trigger.operationType);
            StemLineItemTriggerHandler.deleteDepositPayments(Trigger.old);
        }
    }
}
