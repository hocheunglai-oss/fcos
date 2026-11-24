@IsTest
private class KoreaDeskCloseServiceTest {
    @TestSetup
    static void prepareData() {
        TestDataFactory.prepareQuoteLineItemForDataStem();
    }

    @IsTest
    static void requiresAnAnswerAndPreservesChoiceOnCreatedStem() {
        Quote quote = [SELECT Id, Quote_Buyer__c FROM Quote WHERE Quote_Buyer__c != null LIMIT 1];
        Account buyer = [SELECT Id, Name FROM Account WHERE Id = :quote.Quote_Buyer__c];
        buyer.Name = 'FRATELLI COSULICH BUNKERS (S) PTE LTD';
        update as system buyer;
        List<KoreaDeskCloseService.GroupChoice> choices = (List<KoreaDeskCloseService.GroupChoice>)JSON.deserialize(
            QuoteProgressBarController.getKoreaDeskChoices(quote.Id, 'quote'), List<KoreaDeskCloseService.GroupChoice>.class);
        System.assert(!choices.isEmpty());
        for (KoreaDeskCloseService.GroupChoice choice : choices) {
            if (choice.kind == 'required') choice.answer = 'No';
        }
        Test.startTest();
        QuoteProgressBarController.closeKoreaDeskWon(quote.Id, 'quote', JSON.serialize(choices), null);
        Test.stopTest();
        List<STEM__c> stems = [SELECT Id, Port__r.Country__c, Korea_Desk__c FROM STEM__c WHERE Quote__c = :quote.Id WITH SYSTEM_MODE];
        System.assert(!stems.isEmpty());
        for (STEM__c stem : stems) {
            System.assertEquals(stem.Port__r.Country__c == 'KOREA' ? 'Yes' : 'No', stem.Korea_Desk__c);
        }
    }

    @IsTest
    static void rejectsMissingAndStaleChoices() {
        Quote quote = [SELECT Id, Quote_Buyer__c FROM Quote WHERE Quote_Buyer__c != null LIMIT 1];
        Account buyer = [SELECT Id, Name FROM Account WHERE Id = :quote.Quote_Buyer__c];
        buyer.Name = 'FRATELLI COSULICH BUNKERS (S) PTE LTD';
        update as system buyer;
        List<KoreaDeskCloseService.GroupChoice> choices = KoreaDeskCloseService.getChoices(quote.Id, 'quote');
        System.assert(!choices.isEmpty());
        Test.startTest();
        try {
            KoreaDeskCloseService.closeWon(quote.Id, 'quote', '[]', null);
            System.assert(false, 'A missing group must be rejected.');
        } catch (AuraHandledException expected) { }
        try {
            KoreaDeskCloseService.closeWon(quote.Id, 'quote', JSON.serialize(choices), null);
            System.assert(false, 'A blank answer must be rejected.');
        } catch (AuraHandledException expected) { }
        choices[0].fingerprint = 'stale';
        try {
            KoreaDeskCloseService.closeWon(quote.Id, 'quote', JSON.serialize(choices), null);
            System.assert(false, 'A changed group must be rejected.');
        } catch (AuraHandledException expected) { }
        Test.stopTest();
        System.assertNotEquals('Closed Won', [SELECT Status FROM Quote WHERE Id = :quote.Id].Status);
    }

    @IsTest
    static void directQuoteCloseCannotBypassTheChoice() {
        Quote quote = [SELECT Id, Status, Quote_Buyer__c FROM Quote WHERE Quote_Buyer__c != null LIMIT 1];
        Account buyer = [SELECT Id, Name FROM Account WHERE Id = :quote.Quote_Buyer__c];
        buyer.Name = 'FRATELLI COSULICH BUNKERS (S) PTE LTD';
        update as system buyer;
        quote.Status = 'Closed Won';
        Test.startTest();
        Database.SaveResult result = Database.update(quote, false, AccessLevel.SYSTEM_MODE);
        Test.stopTest();
        System.assertEquals(false, result.isSuccess());
        System.assert(result.getErrors()[0].getMessage().contains('Korea Desk'));
    }

    @IsTest
    static void enquiryClosePersistsYesOnTheMatchingStem() {
        Quote quote = [SELECT Id, Quote_Buyer__c, OpportunityId FROM Quote WHERE Quote_Buyer__c != null LIMIT 1];
        Account buyer = [SELECT Id, Name FROM Account WHERE Id = :quote.Quote_Buyer__c];
        buyer.Name = 'FRATELLI COSULICH BUNKERS (S) PTE LTD';
        update as system buyer;
        List<KoreaDeskCloseService.GroupChoice> choices = (List<KoreaDeskCloseService.GroupChoice>)JSON.deserialize(
            EnquiryProgressBarController.getKoreaDeskChoices(quote.OpportunityId, 'enquiry'), List<KoreaDeskCloseService.GroupChoice>.class);
        Boolean found = false;
        for (KoreaDeskCloseService.GroupChoice choice : choices) {
            if (choice.kind == 'required') {
                choice.answer = 'Yes';
                found = true;
            }
        }
        System.assert(found, 'The eligible group must be offered for the enquiry close.');
        Test.startTest();
        EnquiryProgressBarController.closeKoreaDeskWon(quote.OpportunityId, 'enquiry', JSON.serialize(choices), null);
        Test.stopTest();
        List<STEM__c> stems = [SELECT Id, Korea_Desk__c FROM STEM__c WHERE Quote__c = :quote.Id WITH SYSTEM_MODE];
        System.assert(!stems.isEmpty());
        for (STEM__c stem : stems) System.assertEquals('Yes', stem.Korea_Desk__c);
    }

    @IsTest
    static void mixedPortsHaveIndependentChoices() {
        Quote quote = [SELECT Id, Quote_Buyer__c, Pricebook2Id FROM Quote WHERE Quote_Buyer__c != null LIMIT 1];
        Account buyer = [SELECT Id, Name FROM Account WHERE Id = :quote.Quote_Buyer__c];
        buyer.Name = 'FRATELLI COSULICH BUNKERS (S) PTE LTD';
        update as system buyer;
        QuoteLineItem first = [SELECT Id, Port__c, Product2Id, Supplier__c, Supplier_Payment_Term__c, Buyer_Payment_Term__c, Expected_Delivery_Date__c FROM QuoteLineItem WHERE QuoteId = :quote.Id AND Product_Line_Item__c = null LIMIT 1];
        String koreaValue;
        for (Schema.PicklistEntry entry : Port__c.Country__c.getDescribe().getPicklistValues()) {
            if (entry.isActive() && KoreaDeskCloseService.isSouthKorea(entry.getValue())) koreaValue = entry.getValue();
        }
        System.assertNotEquals(null, koreaValue, 'The org needs an active South Korea country value.');
        Port__c koreanPort = [SELECT Id, Country__c FROM Port__c WHERE Id = :first.Port__c];
        koreanPort.Country__c = koreaValue;
        update as system koreanPort;
        Port__c singaporePort = TestDataFactory.createTestPort('Singapore mixed port', 'SINGAPORE', true);
        TestDataFactory.createTestQuoteLineItem(quote.Id, singaporePort.Id, first.Product2Id, 12, 2,
            first.Supplier__c, first.Expected_Delivery_Date__c, quote.Pricebook2Id,
            first.Supplier_Payment_Term__c, first.Buyer_Payment_Term__c, true, true);
        ContextManager.avoidLockerRecursion = false;
        ContextManager.avoidStemRecursion = false;
        List<KoreaDeskCloseService.GroupChoice> choices = KoreaDeskCloseService.getChoices(quote.Id, 'quote');
        System.assertEquals(2, choices.size());
        for (KoreaDeskCloseService.GroupChoice choice : choices) {
            if (choice.kind == 'required') choice.answer = 'No';
            if (choice.kind == 'fixed') System.assertEquals('Yes', choice.answer);
        }
        System.assertEquals(false, ContextManager.skipTriggers, 'Quote line setup left all triggers disabled');
        System.assertEquals(false, ContextManager.avoidQuoteFiring, 'Quote line setup left Quote processing disabled');
        System.assertNotEquals('Closed Won', [SELECT Status FROM Quote WHERE Id = :quote.Id].Status, 'Quote line setup closed the quote');
        Test.startTest();
        KoreaDeskCloseService.closeWon(quote.Id, 'quote', JSON.serialize(choices), null);
        Test.stopTest();
        List<STEM__c> stems = [SELECT Port__c, Korea_Desk__c FROM STEM__c WHERE Quote__c = :quote.Id WITH SYSTEM_MODE];
        System.assertEquals(2, stems.size());
        for (STEM__c stem : stems) System.assertEquals(stem.Port__c == koreanPort.Id ? 'Yes' : 'No', stem.Korea_Desk__c);
    }

    @IsTest
    static void directEnquiryCloseCannotBypassTheChoice() {
        Quote quote = [SELECT Id, Quote_Buyer__c, OpportunityId FROM Quote WHERE Quote_Buyer__c != null LIMIT 1];
        Account buyer = [SELECT Id, Name FROM Account WHERE Id = :quote.Quote_Buyer__c];
        buyer.Name = 'FRATELLI COSULICH BUNKERS (S) PTE LTD';
        update as system buyer;
        QuoteLineItem item = [SELECT Id, Port__c FROM QuoteLineItem WHERE QuoteId = :quote.Id AND Product_Line_Item__c = null LIMIT 1];
        Port__c port = [SELECT Id, Country__c FROM Port__c WHERE Id = :item.Port__c];
        port.Country__c = 'SINGAPORE';
        update as system port;
        Opportunity enquiry = [SELECT Id, StageName FROM Opportunity WHERE Id = :quote.OpportunityId];
        enquiry.StageName = 'Closed Won';
        Test.startTest();
        Database.SaveResult result = Database.update(enquiry, false, AccessLevel.SYSTEM_MODE);
        Test.stopTest();
        System.assertEquals(false, result.isSuccess());
        System.assert(result.getErrors()[0].getMessage().contains('Korea Desk'));
    }
}
