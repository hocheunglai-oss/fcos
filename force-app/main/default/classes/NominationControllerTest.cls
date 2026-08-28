@IsTest
private class NominationControllerTest {
	@TestSetup
	static void makeData() {
		TestDataFactory.prepareDataForNominationConfirmationFlow();
	}

	@isTest
	static void getNominationTypesByOpportunityIdTest() {
		Opportunity opportunity = [SELECT Id FROM Opportunity LIMIT 1];
        List<Nomination__c> nominations = [SELECT Id, Enquiry__c, RecordTypeId, File__c, STEM__c FROM Nomination__c]; 
		for(Nomination__c nomination: nominations){
        	NominationController.generateDocument(nomination.Id, null, 'Test');  
        }
		Test.startTest();
		nominations = NominationController.getNominationTypesByOpportunityId(opportunity.id);
		System.assertEquals(2, nominations.size());
		Test.stopTest();
	}

	@isTest
	static void getContentDocumentVersionsTest() {
        List<Nomination__c> nominations = [SELECT Id, Enquiry__c, RecordTypeId, File__c, STEM__c FROM Nomination__c];
        for(Nomination__c nomination: nominations){
        	NominationController.generateDocument(nomination.Id, null, 'Test');  
        }
		Map<String, ContentDocument> contentDocumentMap = new Map<String, ContentDocument>([SELECT Id FROM ContentDocument]);
		Test.startTest();
		List<ContentVersion> result = NominationController.getContentDocumentVersions(new List<String>(contentDocumentMap.keySet()));
		System.assertEquals(contentDocumentMap.size(), result.size());
		Test.stopTest();
	}

    @isTest
    static void generateDocumentFromBlobTest(){
        Test.startTest();
        Nomination__c nomination = [SELECT Id FROM Nomination__c LIMIT 1];
        NominationController.generateDocumentFromBlob('TestString', nomination.Id, null, 'Test');
        nomination = [SELECT Id, File__c FROM Nomination__c WHERE Id =: nomination.Id LIMIT 1];
        system.assertNotEquals(null, nomination.File__c);
        NominationController.generateDocumentFromBlob('TestString', nomination.Id, nomination.File__c, 'Test');
        Test.stopTest();

        Id contentDocumentId = (Id) nomination.File__c.substringAfterLast('/');
        System.assertEquals(
            2,
            [SELECT COUNT() FROM ContentVersion WHERE ContentDocumentId = :contentDocumentId]
        );
    }

    @isTest
    static void anotherBusinessUserCanGenerateANewContractVersionTest(){
        User creator = makeUser('creator');
        User reviewer = makeUser('reviewer');
        insert new List<User>{ creator, reviewer };
        Nomination__c nomination = [SELECT Id, File__c FROM Nomination__c LIMIT 1];

        System.runAs(creator) {
            NominationController.generateDocumentFromBlob('TestString', nomination.Id, null, 'Test');
        }
        nomination = [SELECT Id, File__c FROM Nomination__c WHERE Id = :nomination.Id LIMIT 1];
        Id creatorDocumentId = (Id) nomination.File__c.substringAfterLast('/');

        System.runAs(reviewer) {
            NominationController.generateDocumentFromBlob('TestString', nomination.Id, nomination.File__c, 'Test');
        }
        nomination = [SELECT Id, File__c FROM Nomination__c WHERE Id = :nomination.Id LIMIT 1];
        Id reviewerDocumentId = (Id) nomination.File__c.substringAfterLast('/');
        System.assertNotEquals(creatorDocumentId, reviewerDocumentId);
        System.assertEquals(
            creator.Id,
            [SELECT OwnerId FROM ContentDocument WHERE Id = :creatorDocumentId].OwnerId
        );
        System.assertEquals(
            reviewer.Id,
            [SELECT OwnerId FROM ContentDocument WHERE Id = :reviewerDocumentId].OwnerId
        );
        System.assertEquals(
            1,
            [SELECT COUNT() FROM ContentVersion WHERE ContentDocumentId = :creatorDocumentId]
        );
        System.assertEquals(
            1,
            [SELECT COUNT() FROM ContentVersion WHERE ContentDocumentId = :reviewerDocumentId]
        );
    }

    private static User makeUser(String marker) {
        String uniqueName = marker + '.' + DateTime.now().getTime();
        return new User(
            Alias = marker.left(8),
            Email = uniqueName + '@example.com',
            EmailEncodingKey = 'UTF-8',
            LastName = marker,
            LanguageLocaleKey = 'en_US',
            LocaleSidKey = 'en_US',
            ProfileId = UserInfo.getProfileId(),
            TimeZoneSidKey = 'Asia/Hong_Kong',
            Username = uniqueName + '@example.com'
        );
    }
    
    @isTest
    static void getStemBuyerInfoTest(){
        Test.startTest();
        STEM__c stem = [SELECT Id FROM STEM__c LIMIT 1];
        List<STEM_Line_Item__c> stemLineItems = [SELECT Id FROM STEM_Line_Item__c WHERE STEM__c =: stem.Id];
        stem = NominationController.getStemBuyerInfo(stem.Id);
        system.assertEquals(stemLineItems.size(), stem.STEM_Line_Items__r.size());
        Test.stopTest();
    }
    
    @isTest
    static void getStemSupplierInfoTest(){
        Test.startTest();
        Nomination__c nomination = [SELECT Id, STEM__c, Account__c, Payment_Term__c FROM Nomination__c WHERE RecordTypeId =: FCBStatic.NOMINATION_SUPPLIER_RT_IT LIMIT 1];
        STEM__c stem = NominationController.getStemSupplierInfo(nomination.STEM__c, nomination.Account__c, nomination.Payment_Term__c);
        system.assertEquals(stem.STEM_Line_Items__r[0].Original_Supplier__c, nomination.Account__c);
        Test.stopTest();
    }
    
    @isTest
    static void getPaymentTermTest(){
        Test.startTest();
        Payment_Term__c paymentTerm = [SELECT Id, Name FROM Payment_Term__c WHERE RecordType.Name = 'Buyer' LIMIT 1];
        system.assertEquals(paymentTerm.Id, NominationController.getPaymentTerm(paymentTerm.Name).Id);
        Test.stopTest();
    }
    
    @isTest
    static void getSupplierPaymentTermsTest(){
        Test.startTest();
        List<Payment_Term__c> paymentTerms = [SELECT Id, Name FROM Payment_Term__c WHERE RecordType.Name = 'Supplier'];
        List<String> paymentTermNames = new List<String>();
        for(Payment_Term__c paymentTerm: paymentTerms){
            paymentTermNames.add(paymentTerm.Name);
        }
        system.assertEquals(1, NominationController.getSupplierPaymentTerms(paymentTermNames).size());
        
        Test.stopTest();
    }
    
    @isTest
    static void getSpecialTermsTest(){
        Test.startTest();
        Opportunity opp = [SELECT Id FROM Opportunity LIMIT 1];
        Special_Term__c specialTerm = TestDataFactory.createTestSpecialTerm('Test name 1', 'Test text 1', false);
        specialTerm.Add_to_Confirmation__c = true;
        specialTerm.Add_to_Nomination__c = true;
        insert specialTerm;
        Enquiry_Special_Term__c enqSpecialTerm = TestDataFactory.createTestEnquirySpecialTerm(opp.Id, specialTerm.Id, 'Test Reason', new List<String>(), true);
        Nomination__c nomination = [SELECT Id, Remarks__c, Enquiry__c FROM Nomination__c WHERE RecordTypeId =: FCBStatic.NOMINATION_SUPPLIER_RT_IT LIMIT 1];
        Map<String, STEM_Line_Item__c> stemLineItemMap = new Map<String, STEM_Line_Item__c>([SELECT Id FROM STEM_Line_Item__c]);
        NominationController.getNominationSpecialTerms(new List<String>(stemLineItemMap.keySet()), nomination.Remarks__c, nomination.Enquiry__c);
        NominationController.getConfirmationSpecialTerms(new List<String>(stemLineItemMap.keySet()), nomination.Remarks__c, nomination.Enquiry__c);
        Test.stopTest();
    }
}
