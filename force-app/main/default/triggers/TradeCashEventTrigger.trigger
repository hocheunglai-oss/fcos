trigger TradeCashEventTrigger on Trade_Cash_Event__c (before insert, before update, before delete, after undelete) {
    FcosTradeCashService.guardLedger(Trigger.isDelete ? Trigger.old : Trigger.new,Trigger.isInsert);
}
