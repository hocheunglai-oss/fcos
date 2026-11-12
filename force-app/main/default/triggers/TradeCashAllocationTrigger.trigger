trigger TradeCashAllocationTrigger on Trade_Cash_Allocation__c (before insert, before update, before delete, after undelete) {
    FcosTradeCashService.guardLedger(Trigger.isDelete ? Trigger.old : Trigger.new,Trigger.isInsert);
}
