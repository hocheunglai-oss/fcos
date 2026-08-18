trigger SupplierInvoiceTrigger on Supplier_Invoice__c (before insert, before update, after insert, after update, before delete, after delete) {
    if (ContextManager.skipTriggers) return;
    if(!ContextManager.avoidSupplierInvoiceFiring){
        if((Trigger.isUpdate || Trigger.isInsert) && Trigger.isBefore){
            VariableChargeInvoiceReadinessService.assertSupplierInvoiceTransitionsAllowed(Trigger.new, Trigger.isUpdate ? Trigger.oldMap : null);
            if(Trigger.isInsert){
                SupplierInvoiceTriggerHandler.setRefcodeIndex(Trigger.new);
            }
            if(Trigger.isUpdate){
                SupplierInvoiceTriggerHandler.setCalculatedAmount(Trigger.new, Trigger.oldMap);
                SupplierInvoiceTriggerHandler.updateIsChangedCSVField(Trigger.new, Trigger.oldMap);
            }
        }
        if(Trigger.isInsert && Trigger.isAfter){
            SupplierInvoiceTriggerHandler.setPayableDepositPayment(Trigger.new);
            //SupplierInvoiceTriggerHandler.createCashflow(Trigger.newMap);
            SupplierInvoiceTriggerHandler.createPaymentOverview(Trigger.new);    
        }
        if(Trigger.isUpdate && Trigger.isAfter){
            VariableChargeInvoiceReadinessService.invalidateForSupplierInvoiceChanges(Trigger.new, Trigger.oldMap);
            SupplierInvoiceTriggerHandler.changeDepositPaymentAmount(Trigger.new, Trigger.oldMap);
            SupplierInvoiceTriggerHandler.addBankDetailToSupplier(Trigger.new, Trigger.oldMap);
            //SupplierInvoiceTriggerHandler.updateCashflowAccount(Trigger.newMap, Trigger.oldMap);
            SupplierInvoiceTriggerHandler.updateLastPayments(Trigger.new, Trigger.oldMap);
        }
        if(Trigger.isDelete && Trigger.isBefore){
            SupplierInvoiceTriggerHandler.unissueProducts(Trigger.oldMap);
            SupplierInvoiceTriggerHandler.unassignDepositPayment(Trigger.oldMap);
            //SupplierInvoiceTriggerHandler.deleteCashflows(Trigger.oldMap);
            SupplierInvoiceTriggerHandler.deleteContentDocuments(Trigger.oldMap);
        }
        if(Trigger.isDelete && Trigger.isAfter){
            //SupplierInvoiceTriggerHandler.updateCashflows(Trigger.oldMap);
        }
    }
}
