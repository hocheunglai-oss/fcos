trigger FcosTradeDocumentLineTrigger on Trade_Document_Line__c (before insert,before update,before delete) {
    FcosTradeDocumentLineService.guard(Trigger.isDelete?Trigger.old:Trigger.new);
}
