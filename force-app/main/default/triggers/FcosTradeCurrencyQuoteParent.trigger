trigger FcosTradeCurrencyQuoteParent on Quote (before insert,before update,before delete) {
    Map<Id,SObject> priorRows=new Map<Id,SObject>();
    if(Trigger.isUpdate || Trigger.isDelete) for(SObject priorRow:Trigger.old) priorRows.put(priorRow.Id,priorRow);
    FcosTradeCurrencyParentGuard.guard(Trigger.isDelete?Trigger.old:Trigger.new,priorRows,Trigger.isDelete);
}
