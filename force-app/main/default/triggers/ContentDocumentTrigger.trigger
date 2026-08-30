trigger ContentDocumentTrigger on ContentDocument (after delete) {
    if (ContextManager.skipTriggers) return;
    if(Trigger.isAfter && Trigger.isDelete){
        ContentDocumentTriggerHandler.updatePsprsStatus(Trigger.oldMap);
    }
}