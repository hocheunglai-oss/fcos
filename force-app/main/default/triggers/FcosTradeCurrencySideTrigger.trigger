trigger FcosTradeCurrencySideTrigger on Trade_Currency_Side__c (before insert, before update, before delete) {
    FcosTradeCurrencyService.guardSideMutation(Trigger.isDelete ? Trigger.old : Trigger.new);
}
