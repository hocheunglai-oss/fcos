public with sharing class KoreaDeskCloseService {
    private static final String FCBS = 'FRATELLI COSULICH BUNKERS (S) PTE LTD';
    public static Map<String, String> transactionChoices = new Map<String, String>();
    public static Set<Id> closingQuoteIds = new Set<Id>();

    public static Boolean isSouthKorea(String country) {
        if (country == null) return false;
        String normalized = country.trim().toUpperCase();
        return normalized == 'KOREA' || normalized == 'KOREA, REPUBLIC OF';
    }

    public class GroupChoice {
        @AuraEnabled public String key { get; set; }
        @AuraEnabled public String label { get; set; }
        @AuraEnabled public String kind { get; set; }
        @AuraEnabled public String answer { get; set; }
        @AuraEnabled public String fingerprint { get; set; }
    }

    private static String stemKey(Id quoteId, Id portId, Date deliveryDate) {
        return String.valueOf(quoteId) + '-' + String.valueOf(portId) + '-' + String.valueOf(deliveryDate);
    }

    private static List<Quote> getQuotes(Id recordId, String recordType, Boolean lockRows) {
        String predicate = recordType == 'quote' ? 'Id = :recordId' : 'OpportunityId = :recordId AND Status != \'Closed Won\'';
        return Database.query('SELECT Id, Name, Status, OpportunityId, Quote_Buyer__c, Quote_Buyer__r.Name FROM Quote WHERE ' + predicate + (lockRows ? ' FOR UPDATE' : ' ORDER BY Id'));
    }

    private static List<GroupChoice> groups(List<Quote> quotes, Boolean lockRows) {
        Map<Id, Quote> byId = new Map<Id, Quote>(quotes);
        Set<Id> quoteIds = byId.keySet();
        List<QuoteLineItem> items = Database.query('SELECT Id, QuoteId, Port__c, Port__r.Name, Port__r.Country__c, Expected_Delivery_Date__c, Winning__c FROM QuoteLineItem WHERE QuoteId IN :quoteIds AND Product_Line_Item__c = null' + (lockRows ? ' FOR UPDATE' : ' ORDER BY Id'));
        Map<String, GroupChoice> grouped = new Map<String, GroupChoice>();
        Map<String, List<String>> signatures = new Map<String, List<String>>();
        for (QuoteLineItem item : items) {
            Quote quote = byId.get(item.QuoteId);
            String country = item.Port__r == null ? null : item.Port__r.Country__c;
            Boolean korea = isSouthKorea(country);
            String buyer = quote.Quote_Buyer__r == null ? '' : quote.Quote_Buyer__r.Name;
            Boolean fcbs = buyer != null && buyer.trim().toUpperCase() == FCBS;
            String key = stemKey(item.QuoteId, item.Port__c, item.Expected_Delivery_Date__c);
            if (!grouped.containsKey(key)) {
                GroupChoice deskGroup = new GroupChoice();
                deskGroup.key = key;
                deskGroup.label = quote.Name + ' — ' + (item.Port__r == null ? 'No port' : item.Port__r.Name) + ' — ' + String.valueOf(item.Expected_Delivery_Date__c) + ' — ' + buyer;
                deskGroup.kind = korea ? 'fixed' : (fcbs ? 'required' : 'hidden');
                deskGroup.answer = korea ? 'Yes' : null;
                grouped.put(key, deskGroup);
                signatures.put(key, new List<String>{String.valueOf(quote.Quote_Buyer__c), String.valueOf(country), buyer});
            }
            signatures.get(key).add(String.valueOf(item.Id) + ':' + String.valueOf(item.Winning__c));
        }
        List<String> keys = new List<String>(grouped.keySet());
        keys.sort();
        List<GroupChoice> result = new List<GroupChoice>();
        for (String key : keys) {
            GroupChoice deskGroup = grouped.get(key);
            signatures.get(key).sort();
            deskGroup.fingerprint = EncodingUtil.convertToHex(Crypto.generateDigest('SHA-256', Blob.valueOf(JSON.serialize(signatures.get(key)))));
            result.add(deskGroup);
        }
        return result;
    }

    @AuraEnabled
    public static List<GroupChoice> getChoices(Id recordId, String recordType) {
        if (recordType != 'quote' && recordType != 'enquiry') throw new AuraHandledException('Invalid close request.');
        return groups(getQuotes(recordId, recordType, false), false);
    }

    @AuraEnabled
    public static void closeWon(Id recordId, String recordType, String choicesJson, String message) {
        if (recordType != 'quote' && recordType != 'enquiry') throw new AuraHandledException('Invalid close request.');
        if ((recordType == 'quote' && (!Schema.sObjectType.Quote.isUpdateable() || !Schema.sObjectType.Quote.fields.Status.isUpdateable() || !Schema.sObjectType.Quote.fields.Message__c.isUpdateable()))
            || (recordType == 'enquiry' && (!Schema.sObjectType.Opportunity.isUpdateable() || !Schema.sObjectType.Opportunity.fields.StageName.isUpdateable()))) {
            throw new AuraHandledException('You do not have permission to close this quote.');
        }
        List<UserRecordAccess> access = [SELECT RecordId, HasEditAccess FROM UserRecordAccess WHERE UserId = :UserInfo.getUserId() AND RecordId = :recordId];
        if (access.isEmpty() || !access[0].HasEditAccess) throw new AuraHandledException('You do not have permission to edit this record.');
        List<Quote> quotes = getQuotes(recordId, recordType, true);
        if (quotes.isEmpty() && recordType == 'enquiry') {
            List<GroupChoice> submitted = (List<GroupChoice>)JSON.deserialize(choicesJson, List<GroupChoice>.class);
            if (!submitted.isEmpty()) throw new AuraHandledException('Quote details changed. Reopen the close window and review the Korea Desk choices.');
            return;
        }
        if (quotes.isEmpty() || (recordType == 'quote' && quotes.size() != 1)) throw new AuraHandledException('Quote is unavailable.');
        Set<Id> quoteIds = new Map<Id, Quote>(quotes).keySet();
        Set<Id> buyerIds = new Set<Id>();
        for (Quote quote : quotes) if (quote.Quote_Buyer__c != null) buyerIds.add(quote.Quote_Buyer__c);
        List<QuoteLineItem> lockedItems = [SELECT Id, Port__c FROM QuoteLineItem WHERE QuoteId IN :quoteIds AND Product_Line_Item__c = null FOR UPDATE];
        Set<Id> portIds = new Set<Id>();
        for (QuoteLineItem item : lockedItems) if (item.Port__c != null) portIds.add(item.Port__c);
        List<Account> lockedBuyers = [SELECT Id FROM Account WHERE Id IN :buyerIds FOR UPDATE];
        List<Port__c> lockedPorts = [SELECT Id FROM Port__c WHERE Id IN :portIds FOR UPDATE];
        quotes = getQuotes(recordId, recordType, false);
        List<GroupChoice> latest = groups(quotes, true);
        List<GroupChoice> submitted = (List<GroupChoice>)JSON.deserialize(choicesJson, List<GroupChoice>.class);
        Map<String, GroupChoice> byKey = new Map<String, GroupChoice>();
        for (GroupChoice choice : submitted) {
            if (byKey.containsKey(choice.key)) throw new AuraHandledException('Duplicate Korea Desk selection.');
            byKey.put(choice.key, choice);
        }
        if (byKey.size() != latest.size()) throw new AuraHandledException('Quote details changed. Reopen the close window and review the Korea Desk choices.');
        transactionChoices.clear();
        try {
            for (GroupChoice deskGroup : latest) {
                GroupChoice choice = byKey.get(deskGroup.key);
                if (choice == null || choice.fingerprint != deskGroup.fingerprint) throw new AuraHandledException('Quote details changed. Reopen the close window and review the Korea Desk choices.');
                if (deskGroup.kind == 'fixed') transactionChoices.put(deskGroup.key, 'Yes');
                else if (deskGroup.kind == 'hidden') continue;
                else if (choice.answer == 'Yes' || choice.answer == 'No') transactionChoices.put(deskGroup.key, choice.answer);
                else throw new AuraHandledException('Select Yes or No for each Korea Desk choice.');
            }
            List<Quote> updates = new List<Quote>();
            for (Quote quote : quotes) {
                Quote change = new Quote(Id = quote.Id, Status = 'Closed Won');
                if (recordType == 'quote') change.Message__c = message;
                updates.add(change);
            }
            if (recordType == 'quote') Database.update(updates, AccessLevel.USER_MODE);
            else update as system updates;
        } finally {
            transactionChoices.clear();
            closingQuoteIds.clear();
        }
    }
}
