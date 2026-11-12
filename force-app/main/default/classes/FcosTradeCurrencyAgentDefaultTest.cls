@IsTest
private class FcosTradeCurrencyAgentDefaultTest {
    private static final String FX_SECRET = 'agent-default-fx-test-secret';

    private class CurrentRateMock implements HttpCalloutMock {
        public HttpResponse respond(HttpRequest request) {
            Map<String,Object> body = (Map<String,Object>)JSON.deserializeUntyped(request.getBody());
            HttpResponse response = new HttpResponse();
            response.setStatusCode(200);
            response.setBody(JSON.serialize(new Map<String,Object>{
                'ok' => true,
                'purpose' => body.get('purpose'),
                'requestId' => request.getHeader('x-salesforce-event-id'),
                'rate' => new Map<String,Object>{
                    'rateId' => 'new-agent-current-rate',
                    'revision' => '24',
                    'usdHkdRate' => '7.8',
                    'effectiveAt' => '2026-09-11T00:00:00.000Z'
                }
            }));
            return response;
        }
    }

    @TestSetup
    static void fixtures() {
        Fcos_Trading_FX_Setting__c setting = Fcos_Trading_FX_Setting__c.getOrgDefaults();
        if (setting == null) setting = new Fcos_Trading_FX_Setting__c(SetupOwnerId=UserInfo.getOrganizationId());
        setting.Enabled__c = true;
        setting.Endpoint__c = 'https://fcos.example.invalid/api/salesforce/company-fx';
        setting.Signing_Secret__c = FX_SECRET;
        upsert setting;

        User actor = new User(Alias='agfx',LastName='AgentCurrencyDefault',Email='agent-fx@example.com',
            Username='agent-fx.'+UserInfo.getOrganizationId()+'.'+Datetime.now().getTime()+'@example.com',
            EmailEncodingKey='UTF-8',LanguageLocaleKey='en_US',LocaleSidKey='en_US',
            TimeZoneSidKey='Asia/Hong_Kong',ProfileId=UserInfo.getProfileId());
        insert actor;
        List<PermissionSetAssignment> assignments = new List<PermissionSetAssignment>();
        for (PermissionSet permission : [
            SELECT Id FROM PermissionSet WHERE Name IN ('Fcos_Trading_FX_Access','FCOS_Variable_Charges_User')
        ]) assignments.add(new PermissionSetAssignment(AssigneeId=actor.Id,PermissionSetId=permission.Id));
        insert assignments;

        // The complete quote-to-STEM factory exercises the normal trigger
        // chain. Reset governor limits only before the guarded extra-cost
        // creation that this test class is asserting.
        TestDataFactory.prepareDataForNominationConfirmationFlow();
        STEM__c stem = [SELECT Id FROM STEM__c LIMIT 1];
        STEM_Line_Item__c line = [
            SELECT Product__c, Payment_Term__c FROM STEM_Line_Item__c WHERE STEM__c = :stem.Id LIMIT 1
        ];
        Port__c hongKong = TestDataFactory.createTestPort('Hong Kong', 'HONG KONG', true);
        Account agent = TestDataFactory.createTestAccount('HKD pending agent', 'SUPPLIER', true);
        ContextManager.skipTriggers = true;
        try {
            update new STEM__c(Id=stem.Id,Port__c=hongKong.Id);
            update new Account(Id=agent.Id,Is_Agent__c=true,Agency_Fee_Currency__c='HKD');
        } finally {
            ContextManager.skipTriggers = false;
        }

        Test.startTest();
        try {
            insert new STEM_Extra_Cost__c(
                STEM__c=stem.Id,Supplier__c=agent.Id,Product2Id__c=line.Product__c,
                RecordTypeId=Schema.SObjectType.STEM_Extra_Cost__c.getRecordTypeInfosByName().get('STEM Charge').getRecordTypeId(),
                Payment_Term__c=line.Payment_Term__c,Cancelled__c=false,Fixed__c=false,
                Quantity__c=1,Quantity_Delivered_Per_BDN__c=1,Unit_of_Measure__c='1.',Unit_Cost__c=100
            );
        } finally {
            Test.stopTest();
        }
    }

    private static User actor() {
        return [SELECT Id FROM User WHERE LastName='AgentCurrencyDefault' LIMIT 1];
    }
    private static STEM_Extra_Cost__c pendingExtra() {
        return [SELECT Id,STEM__c,Supplier__c,Buy_Agent_Currency_Pending__c FROM STEM_Extra_Cost__c
            WHERE Supplier__r.Name='HKD pending agent' LIMIT 1];
    }
    private static Id insertAgentExtra(Id stemId, Id supplierId) {
        STEM_Line_Item__c line = [
            SELECT Product__c, Payment_Term__c FROM STEM_Line_Item__c WHERE STEM__c=:stemId LIMIT 1
        ];
        STEM_Extra_Cost__c row = new STEM_Extra_Cost__c(
            STEM__c=stemId,Supplier__c=supplierId,Product2Id__c=line.Product__c,
            RecordTypeId=Schema.SObjectType.STEM_Extra_Cost__c.getRecordTypeInfosByName().get('STEM Charge').getRecordTypeId(),
            Payment_Term__c=line.Payment_Term__c,Cancelled__c=false,Fixed__c=false,
            Quantity__c=1,Quantity_Delivered_Per_BDN__c=1,Unit_of_Measure__c='1.',Unit_Cost__c=100
        );
        insert row;
        return row.Id;
    }
    private static void setFxEnabled(Boolean enabled) {
        Fcos_Trading_FX_Setting__c setting = Fcos_Trading_FX_Setting__c.getOrgDefaults();
        setting.Enabled__c = enabled;
        upsert setting;
    }

    @IsTest
    static void newMarkedAgentExtraProposesCurrentHkdAndReviewedSaveConsumesMarker() {
        System.runAs(actor()) {
            STEM_Extra_Cost__c extra = pendingExtra();
            System.assertEquals(true,extra.Buy_Agent_Currency_Pending__c,
                'Only the creation guard may establish the agent HKD proposal marker.');
            System.assertEquals(true,FcosTradeCurrencyService.isInitialAgentHkdDefault(extra.Id,'Buy'));
            Test.setMock(HttpCalloutMock.class,new CurrentRateMock());

            Test.startTest();
            FcosTradeCurrencyService.Review review = FcosTradeCurrencyController.preview(extra.Id,'Buy');
            FcosTradeCurrencyService.Review saved = FcosTradeCurrencyController.saveDraft(
                extra.Id,'Buy','HKD',review.nativeUnitPrice,review.fingerprint,review.rateId,false);
            Test.stopTest();

            System.assertEquals('HKD',review.currencyCode);
            System.assertEquals(Decimal.valueOf('100'),review.usdUnitPrice);
            System.assertEquals(Decimal.valueOf('780'),review.nativeUnitPrice);
            System.assertEquals('new-agent-current-rate',review.rateId);
            System.assertEquals('HKD',saved.currencyCode);
            System.assertEquals(false,[SELECT Buy_Agent_Currency_Pending__c FROM STEM_Extra_Cost__c WHERE Id=:extra.Id].Buy_Agent_Currency_Pending__c,
                'The first reviewed currency save consumes the creation-only marker.');
        }
    }

    @IsTest
    static void independentSellSaveRetainsPendingBuyProposal() {
        System.runAs(actor()) {
            STEM_Extra_Cost__c extra = pendingExtra();
            Test.setMock(HttpCalloutMock.class,new CurrentRateMock());
            Test.startTest();
            FcosTradeCurrencyService.Review sell = FcosTradeCurrencyController.preview(extra.Id,'Sell');
            FcosTradeCurrencyController.saveDraft(extra.Id,'Sell','USD',sell.nativeUnitPrice,sell.fingerprint,sell.rateId,false);
            Test.stopTest();
            System.assertEquals(true,[SELECT Buy_Agent_Currency_Pending__c FROM STEM_Extra_Cost__c WHERE Id=:extra.Id].Buy_Agent_Currency_Pending__c,
                'A reviewed buyer-side save cannot consume a supplier Buy proposal.');
        }
    }

    @IsTest
    static void legacyUnmarkedUsdExtraSuppressesNewAgentProposal() {
        STEM_Extra_Cost__c initial = pendingExtra();
        Test.startTest();
        try {
            setFxEnabled(false);
            Id legacyId = insertAgentExtra(initial.STEM__c,initial.Supplier__c);
            System.assertEquals(false,[SELECT Buy_Agent_Currency_Pending__c FROM STEM_Extra_Cost__c WHERE Id=:legacyId].Buy_Agent_Currency_Pending__c);
            setFxEnabled(true);

            Id newExtraId = insertAgentExtra(initial.STEM__c,initial.Supplier__c);
            STEM_Extra_Cost__c newExtra = [SELECT Buy_Agent_Currency_Pending__c FROM STEM_Extra_Cost__c WHERE Id=:newExtraId];
            System.assertEquals(false,newExtra.Buy_Agent_Currency_Pending__c,
                'A new proposal must not sweep an existing unmarked USD extra into HKD.');
            System.assertEquals(false,FcosTradeCurrencyService.isInitialAgentHkdDefault(newExtraId,'Buy'));
        } finally {
            Test.stopTest();
        }
    }

    @IsTest
    static void liveFuelAndUntrustedMarkerUpdatesCannotCreateOrReviveProposal() {
        STEM_Extra_Cost__c extra = pendingExtra();
        STEM_Line_Item__c fuel = [SELECT Id FROM STEM_Line_Item__c WHERE STEM__c=:extra.STEM__c LIMIT 1];
        ContextManager.skipTriggers = true;
        try {
            update new STEM_Line_Item__c(Id=fuel.Id,Original_Supplier__c=extra.Supplier__c);
        } finally {
            ContextManager.skipTriggers = false;
        }
        System.assertEquals(false,FcosTradeCurrencyService.isInitialAgentHkdDefault(extra.Id,'Buy'),
            'A supplier with live fuel must retain the normal fuel USD side and cannot receive an agent-only default.');

        try {
            update new STEM_Extra_Cost__c(Id=extra.Id,Buy_Agent_Currency_Pending__c=false);
            System.assert(false,'A client cannot consume or otherwise change the system marker directly.');
        } catch (DmlException expected) {
            System.assert(expected.getMessage().contains('system managed'));
        }
    }
}
