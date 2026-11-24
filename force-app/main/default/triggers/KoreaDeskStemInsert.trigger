trigger KoreaDeskStemInsert on STEM__c (before insert) {
    Set<Id> quoteIds = new Set<Id>();
    Set<Id> portIds = new Set<Id>();
    Set<Id> buyerIds = new Set<Id>();
    for (STEM__c stem : Trigger.new) {
        if (stem.Quote__c == null || !KoreaDeskCloseService.closingQuoteIds.contains(stem.Quote__c)) continue;
        quoteIds.add(stem.Quote__c);
        if (stem.Port__c != null) portIds.add(stem.Port__c);
        if (stem.Account__c != null) buyerIds.add(stem.Account__c);
    }
    if (quoteIds.isEmpty()) return;
    Map<Id, Quote> closedQuotes = new Map<Id, Quote>([SELECT Id FROM Quote WHERE Id IN :quoteIds AND Status = 'Closed Won' WITH SYSTEM_MODE]);
    Map<Id, Port__c> ports = new Map<Id, Port__c>([SELECT Id, Country__c FROM Port__c WHERE Id IN :portIds WITH SYSTEM_MODE]);
    Map<Id, Account> buyers = new Map<Id, Account>([SELECT Id, Name FROM Account WHERE Id IN :buyerIds WITH SYSTEM_MODE]);
    for (STEM__c stem : Trigger.new) {
        if (!KoreaDeskCloseService.closingQuoteIds.contains(stem.Quote__c) || !closedQuotes.containsKey(stem.Quote__c)) continue;
        Port__c port = ports.get(stem.Port__c);
        Account buyer = buyers.get(stem.Account__c);
        Boolean korea = port != null && KoreaDeskCloseService.isSouthKorea(port.Country__c);
        Boolean fcbs = buyer != null && buyer.Name != null && buyer.Name.trim().toUpperCase() == 'FRATELLI COSULICH BUNKERS (S) PTE LTD';
        if (korea) stem.Korea_Desk__c = 'Yes';
        else if (fcbs) {
            String key = String.valueOf(stem.Quote__c) + '-' + String.valueOf(stem.Port__c) + '-' + String.valueOf(stem.Expected_Delivery_Date__c);
            String choice = KoreaDeskCloseService.transactionChoices.get(key);
            if (choice != 'Yes' && choice != 'No') stem.addError('Close this quote using the Korea Desk selection window and choose Yes or No.');
            else stem.Korea_Desk__c = choice;
        }
    }
}
