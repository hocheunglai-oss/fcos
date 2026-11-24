trigger KoreaDeskEnquiryCloseGuard on Opportunity (before update) {
    if (ContextManager.avoidEnquiryFiring) return;
    Set<Id> closing = new Set<Id>();
    for (Opportunity enquiry : Trigger.new) {
        if (enquiry.StageName == 'Closed Won' && Trigger.oldMap.get(enquiry.Id).StageName != 'Closed Won') closing.add(enquiry.Id);
    }
    if (closing.isEmpty()) return;
    Set<Id> requiresChoice = new Set<Id>();
    for (QuoteLineItem item : [
        SELECT Quote.OpportunityId, Quote.Quote_Buyer__r.Name, Port__r.Country__c
        FROM QuoteLineItem
        WHERE Quote.OpportunityId IN :closing AND Product_Line_Item__c = null WITH SYSTEM_MODE
    ]) {
        String buyer = item.Quote.Quote_Buyer__r == null ? null : item.Quote.Quote_Buyer__r.Name;
        String country = item.Port__r == null ? null : item.Port__r.Country__c;
        if (buyer != null && buyer.trim().toUpperCase() == 'FRATELLI COSULICH BUNKERS (S) PTE LTD'
            && !KoreaDeskCloseService.isSouthKorea(country)) {
            requiresChoice.add(item.Quote.OpportunityId);
        }
    }
    for (Opportunity enquiry : Trigger.new) {
        if (requiresChoice.contains(enquiry.Id)) enquiry.addError('Close this enquiry using the Korea Desk selection window and choose Yes or No.');
    }
}
