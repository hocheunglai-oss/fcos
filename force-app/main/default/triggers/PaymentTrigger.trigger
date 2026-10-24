trigger PaymentTrigger on Payment__c (before insert, before update, after insert, after update, before delete, after delete) {
    if (ContextManager.skipTriggers) return;
    if(!ContextManager.avoidPaymentFiring){
        if(Trigger.isAfter && (Trigger.isUpdate || Trigger.isInsert)){
            PaymentTriggerHandler.updatePayableBalance(Trigger.newMap);
            //PaymentTriggerHandler.updateCashflows(Trigger.new);
            PaymentTriggerHandler.recalculateRemittanceAmount(Trigger.new);
            PaymentTriggerHandler.calculateCommissionPaidAmount(Trigger.new, Trigger.oldMap, Trigger.operationType);
            PaymentTriggerHandler.updateLastCiaPayment(Trigger.new);
            if(Trigger.isInsert){
                PaymentTriggerHandler.emptyReconfirmInfo(Trigger.new);
                PaymentTriggerHandler.updatePartialCiaBuyerInvoiceDueDate(Trigger.new);
            }
        }
        if(Trigger.isBefore && Trigger.isDelete){
            PaymentTriggerHandler.deleteReceivablePaymentsFromRemittance(Trigger.oldMap);
        }
        if(Trigger.isAfter && (Trigger.isDelete)){
            PaymentTriggerHandler.updatePayableBalance(Trigger.oldMap);
            //PaymentTriggerHandler.updateCashflows(Trigger.old);
            PaymentTriggerHandler.recalculateRemittanceAmount(Trigger.old);
            PaymentTriggerHandler.calculateCommissionPaidAmount(Trigger.new, Trigger.oldMap, Trigger.operationType);
        }    
    }
}