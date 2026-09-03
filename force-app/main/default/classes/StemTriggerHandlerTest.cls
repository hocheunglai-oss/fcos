@IsTest
private class StemTriggerHandlerTest {
    @TestSetup
    static void makeData(){
        TestDataFactory.prepareDataForNominationConfirmationFlow();     
    }
    
    @IsTest
    static void passBuyersPayTermDate() {
        Test.startTest();
        STEM__c stem = [SELECT Id, Buyer_Pay_Term_Date__c, Delivery_Date__c FROM STEM__c LIMIT 1];
        stem.Delivery_Date__c = Date.today();
        update stem;
        stem = [SELECT Id, Buyer_Pay_Term_Date__c, Delivery_Date__c FROM STEM__c LIMIT 1];
        System.assertEquals(29, stem.Delivery_Date__c.daysBetween(stem.Buyer_Pay_Term_Date__c));
        Test.stopTest();
    }

    @IsTest
    static void rejectsNewInactiveBuyerBrokerSelection() {
        Account inactiveBroker = TestDataFactory.createTestAccount('Inactive Broker', 'BROKER', true);
        inactiveBroker.Inactive_Suspended__c = true;
        update inactiveBroker;
        STEM__c stem = [SELECT Id, Buyer_Broker__c FROM STEM__c LIMIT 1];
        stem.Buyer_Broker__c = inactiveBroker.Id;

        Test.startTest();
        Database.SaveResult result = Database.update(stem, false);
        Test.stopTest();

        System.assertEquals(false, result.isSuccess());
        System.assert(result.getErrors()[0].getMessage().contains('Choose an active Account'));
    }

    @IsTest
    static void acceptsActiveIsBrokerAccountOutsideBrokerRecordType() {
        Account designatedBroker = TestDataFactory.createTestAccount('Buyer Acting As Broker', 'BUYER', false);
        designatedBroker.Is_Broker__c = true;
        insert designatedBroker;
        STEM__c stem = [SELECT Id, Buyer_Broker__c FROM STEM__c LIMIT 1];
        stem.Buyer_Broker__c = designatedBroker.Id;

        Test.startTest();
        update stem;
        Test.stopTest();

        System.assertEquals(designatedBroker.Id, [SELECT Buyer_Broker__c FROM STEM__c WHERE Id = :stem.Id].Buyer_Broker__c);
    }

    @IsTest
    static void updateVessel() {
        Test.startTest();
        Vessel__c vessel = TestDataFactory.createTestVessel('VesselTest', '9898785', null, true);
        STEM__c stem = [SELECT Id, Vessel__c FROM STEM__c LIMIT 1];
        stem.Vessel__c = vessel.Id;
        update stem;
        Test.stopTest();
    }
    
    @isTest
    static void testSetPaymentDelay(){
        Test.startTest();
        STEM__c stem = [SELECT Id, Account__c FROM STEM__c];
        Invoice__c invoice = new Invoice__c(Amount__c = 10000, Invoice_Date__c = Date.newInstance(2022, 02, 24), STEM__c = stem.Id);
        insert invoice;
        
        Payment__c payment = new Payment__c(Amount__c = 10000, Date__c = Date.newInstance(2022, 02, 25), STEM__c = stem.Id, Account__c = stem.Account__c,
                                            RecordTypeId = Schema.SObjectType.Payment__c.getRecordTypeInfosByName().get('Receivable').getRecordTypeId());
        insert payment;
        stem = [SELECT Id, Payment_Delay__c FROM STEM__c LIMIT 1];
        system.assertNotEquals(null, stem.Payment_Delay__c);
        Test.stopTest();
    }
    
    @isTest
    static void testUpdateNominations(){
        Test.startTest();
        Account account = TestDataFactory.createTestAccount('Test Buyer 2', 'BUYER', true);
        STEM__c stem = [SELECT Id, Account__c, Payment_Term__c FROM STEM__c];
        stem.Payment_Term__c = '60';
        update stem;
        Nomination__c confirmation = [SELECT Id, PDF__c FROM Nomination__c WHERE RecordTypeId =: FCBStatic.NOMINATION_BUYER_RT_IT LIMIT 1];
        system.assertEquals('🔴', confirmation.PDF__c);
        stem.Account__c = account.Id;
        update stem;
        confirmation = [SELECT Id, PDF__c FROM Nomination__c WHERE RecordTypeId =: FCBStatic.NOMINATION_BUYER_RT_IT LIMIT 1];
        system.assertEquals('🔴', confirmation.PDF__c);
        Test.stopTest();
    }
    
    @isTest
    static void testResetPsprs(){
        Test.startTest();
        Account account = TestDataFactory.createTestAccount('Test Buyer 2', 'BUYER', false);
        account.PSPRS__c = 'A - w/ Agreement (Payment Conditional)';
        insert account;
        STEM__c stem = [SELECT Id, Account__c, Payment_Term__c FROM STEM__c];
        stem.Account__c = account.Id;
        update stem;
        stem = [SELECT Id, PSPRS__c FROM STEM__c];
        system.assertEquals(stem.PSPRS__c, account.PSPRS__c);
        Test.stopTest();
    }
    
    @isTest
    static void testDeleteRelatedRecords(){
        Test.startTest();
        STEM__c stem = [SELECT Id FROM STEM__c];
        STEM_Line_Item__c lineItem = [
            SELECT Original_Supplier__c
            FROM STEM_Line_Item__c
            WHERE STEM__c = :stem.Id AND Original_Supplier__c != null
            LIMIT 1
        ];
        STEM_Variable_Charge_Supplier__c variableChargeSupplier = new STEM_Variable_Charge_Supplier__c(
            STEM__c = stem.Id,
            Supplier__c = lineItem.Original_Supplier__c,
            Manual_Review_Required__c = true,
            Supplier_Status__c = 'Pending'
        );
        insert variableChargeSupplier;
        System.assertNotEquals(0, [SELECT Id FROM STEM_Payment_Overview__c].size());
        System.assertNotEquals(0, [SELECT Id FROM Mailing_Record__c].size());
        System.assertEquals(1, [SELECT Count() FROM STEM_Variable_Charge_Supplier__c WHERE STEM__c = :stem.Id]);
        delete stem;
        System.assertEquals(0, [SELECT Id FROM STEM_Payment_Overview__c].size());
        System.assertEquals(0, [SELECT Id FROM Mailing_Record__c].size());
        System.assertEquals(0, [SELECT Count() FROM STEM_Variable_Charge_Supplier__c WHERE STEM__c = :stem.Id]);
        Test.stopTest();
    }
    
    @isTest
    static void testDeleteContentDocument(){
        Test.startTest();
        STEM__c stem = [SELECT Id FROM STEM__c];
        ContentVersion contentVersion = new ContentVersion( Title  = 'Sanction Compliance', PathOnClient = 'Sanction_Compliance.pdf', VersionData = Blob.valueOf('Test Content'), IsMajorVersion = true);
        insert contentVersion; 
        List<ContentDocument> documents = [SELECT Id, Title, LatestPublishedVersionId FROM ContentDocument];
        //create ContentDocumentLink  record 
        ContentDocumentLink cdl = New ContentDocumentLink();
        cdl.LinkedEntityId = stem.id;
        cdl.ContentDocumentId = documents[0].Id;
        insert cdl;
        delete stem;
        system.assertEquals(0, [SELECT Id FROM ContentDocumentLink WHERE LinkedEntityId =: stem.Id].size());
        Test.stopTest();
    }
}
