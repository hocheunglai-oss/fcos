@IsTest
private class FcosXeroContactSyncServiceTest {
    private static List<HttpRequest> capturedRequests = new List<HttpRequest>();

    private class Fixture {
        Account buyer;
        Account supplier;
        Account brokerAccount;
        Opportunity enquiry;
        Quote quoteRow;
        Broker_Enquiry__c brokerEnquiry;
        Supplier_Bid__c supplierBid;
        STEM__c stem;
        STEM_Line_Item__c stemLineItem;
        STEM_Extra_Cost__c stemExtraCost;
        STEM_Variable_Charge_Supplier__c variableChargeSupplier;
        STEM_Buyer_Broker__c stemBuyerBroker;
    }

    private class CaptureMock implements HttpCalloutMock {
        public HttpResponse respond(HttpRequest request) {
            capturedRequests.add(request);
            HttpResponse response = new HttpResponse();
            response.setStatusCode(202);
            response.setBody('{"ok":true}');
            return response;
        }
    }

    private static void enableSync() {
        FcosXeroContactSyncService.enabledOverride = true;
        FcosXeroContactSyncService.endpointOverride = 'https://fcos.fcuno.com/api/salesforce/contact-sync';
        FcosXeroContactSyncService.signingSecretOverride = 'unit-test-secret';
        FcosXeroContactSyncService.timestampOverride = '2026-08-27T12:00:00.000Z';
        FcosXeroContactSyncService.eventIdOverride = 'unit-test-event';
    }

    private static void resetSync() {
        FcosXeroContactSyncService.enabledOverride = null;
        FcosXeroContactSyncService.endpointOverride = null;
        FcosXeroContactSyncService.signingSecretOverride = null;
        FcosXeroContactSyncService.timestampOverride = null;
        FcosXeroContactSyncService.eventIdOverride = null;
        ContextManager.skipTriggers = false;
        ContextManager.avoidEnquiryFiring = false;
        ContextManager.avoidQuoteFiring = false;
        ContextManager.avoidEnquiryBrokerFiring = false;
        ContextManager.avoidSupplierBidRecursion = false;
        ContextManager.avoidStemRecursion = false;
        ContextManager.avoidSTEMLineItemFiring = false;
        ContextManager.avoidSTEMExtraCostFiring = false;
    }

    private static Id accountRecordTypeId(String developerName) {
        return [
            SELECT Id
            FROM RecordType
            WHERE SObjectType = 'Account'
            AND DeveloperName = :developerName
            LIMIT 1
        ].Id;
    }

    private static Fixture makeFixture() {
        Fixture fixture = new Fixture();
        ContextManager.skipTriggers = true;
        fixture.buyer = new Account(
            Name = 'FCOS Xero Sync Test Buyer',
            RecordTypeId = accountRecordTypeId('Buyer'),
            Company_Code__c = 'HKTESTBUYER',
            Inactive_Suspended__c = false
        );
        fixture.supplier = new Account(
            Name = 'FCOS Xero Sync Test Supplier',
            RecordTypeId = accountRecordTypeId('Supplier'),
            Company_Code__c = 'HKTESTSUPPLIER',
            Inactive_Suspended__c = false
        );
        fixture.brokerAccount = new Account(
            Name = 'FCOS Xero Sync Test Broker',
            RecordTypeId = accountRecordTypeId('Broker'),
            Company_Code__c = 'HKTESTBROKER',
            Inactive_Suspended__c = false,
            Is_Broker__c = true
        );
        insert new List<Account>{ fixture.buyer, fixture.supplier, fixture.brokerAccount };

        fixture.enquiry = new Opportunity(
            Name = 'FCOS Xero Sync Test Enquiry',
            StageName = 'RFQ',
            CloseDate = Date.newInstance(2026, 1, 1),
            Time__c = Time.newInstance(12, 0, 0, 0),
            AccountId = fixture.buyer.Id
        );
        insert fixture.enquiry;

        fixture.quoteRow = new Quote(
            Name = 'FCOS Xero Sync Test Quote',
            OpportunityId = fixture.enquiry.Id,
            Quote_Buyer__c = fixture.buyer.Id,
            Broker__c = fixture.brokerAccount.Id
        );
        insert fixture.quoteRow;

        fixture.brokerEnquiry = new Broker_Enquiry__c(
            Buyer__c = fixture.buyer.Id,
            Broker__c = fixture.brokerAccount.Id
        );
        fixture.brokerEnquiry.put('Enquiry__c', fixture.enquiry.Id);
        insert fixture.brokerEnquiry;

        fixture.supplierBid = new Supplier_Bid__c(Supplier__c = fixture.supplier.Id);
        fixture.supplierBid.put('Enquiry__c', fixture.enquiry.Id);
        fixture.supplierBid.put('Suppliers_Broker__c', fixture.brokerAccount.Id);
        insert fixture.supplierBid;

        fixture.stem = new STEM__c(Account__c = fixture.buyer.Id);
        fixture.stem.put('Delivery_Date__c', Date.newInstance(2026, 1, 2));
        fixture.stem.put('Buyer_Broker__c', fixture.brokerAccount.Id);
        insert fixture.stem;

        Product2 product = new Product2(Name = 'FCOS Xero Sync Test Product', IsActive = true);
        insert product;
        fixture.stemLineItem = new STEM_Line_Item__c(
            STEM__c = fixture.stem.Id,
            Original_Supplier__c = fixture.supplier.Id
        );
        fixture.stemLineItem.put('Product__c', product.Id);
        fixture.stemLineItem.put('Substitute_Supplier__c', fixture.supplier.Id);
        fixture.stemLineItem.put('Buyers_Broker__c', fixture.brokerAccount.Id);
        fixture.stemLineItem.put('Supplier_Broker__c', fixture.brokerAccount.Id);
        insert fixture.stemLineItem;

        fixture.stemExtraCost = new STEM_Extra_Cost__c(STEM__c = fixture.stem.Id);
        fixture.stemExtraCost.put('Supplier__c', fixture.supplier.Id);
        insert fixture.stemExtraCost;

        fixture.variableChargeSupplier = new STEM_Variable_Charge_Supplier__c(
            External_Key__c = 'xero-sync-test-' + String.valueOf(System.now().getTime()),
            STEM__c = fixture.stem.Id,
            Supplier__c = fixture.supplier.Id
        );
        insert fixture.variableChargeSupplier;

        fixture.stemBuyerBroker = new STEM_Buyer_Broker__c(STEM__c = fixture.stem.Id);
        fixture.stemBuyerBroker.put('Buyer_Broker__c', fixture.brokerAccount.Id);
        insert fixture.stemBuyerBroker;
        ContextManager.skipTriggers = false;
        return fixture;
    }

    @IsTest
    static void opportunityBuyerIsPostedWhenChanged() {
        resetSync();
        enableSync();
        capturedRequests.clear();
        Test.setMock(HttpCalloutMock.class, new CaptureMock());
        Opportunity oldRow = new Opportunity(
            Id = '006000000000001',
            AccountId = '001000000000001',
            CloseDate = Date.newInstance(2026, 1, 1)
        );
        Opportunity newRow = new Opportunity(
            Id = oldRow.Id,
            AccountId = '001000000000002',
            CloseDate = Date.newInstance(2026, 1, 1)
        );

        Test.startTest();
        FcosXeroContactSyncService.enqueueForOpportunities(
            new List<Opportunity>{ newRow },
            new Map<Id, Opportunity>{ oldRow.Id => oldRow }
        );
        Test.stopTest();

        System.assertEquals(1, capturedRequests.size());
        HttpRequest request = capturedRequests[0];
        System.assertEquals('POST', request.getMethod());
        System.assertEquals('https://fcos.fcuno.com/api/salesforce/contact-sync', request.getEndpoint());
        System.assertEquals(UserInfo.getOrganizationId(), request.getHeader('x-salesforce-org-id'));
        System.assertEquals('unit-test-event', request.getHeader('x-salesforce-contact-sync-event-id'));

        Map<String, Object> payload = (Map<String, Object>) JSON.deserializeUntyped(request.getBody());
        List<Object> records = (List<Object>) payload.get('records');
        System.assertEquals(1, records.size());
        Map<String, Object> source = (Map<String, Object>) records[0];
        System.assertEquals('Opportunity', source.get('objectApiName'));
        System.assertEquals('AccountId', source.get('fieldName'));
        System.assert(String.valueOf(source.get('accountId')).startsWith('001000000000002'));
        System.assertEquals('update', source.get('operation'));

        String expectedSignature = EncodingUtil.convertToHex(Crypto.generateMac(
            'HmacSHA256',
            Blob.valueOf('2026-08-27T12:00:00.000Z.unit-test-event.' + request.getBody()),
            Blob.valueOf('unit-test-secret')
        ));
        System.assertEquals(expectedSignature, request.getHeader('x-salesforce-contact-sync-signature'));
    }

    @IsTest
    static void unchangedOrOldEnquiryDoesNotPost() {
        resetSync();
        enableSync();
        capturedRequests.clear();
        Test.setMock(HttpCalloutMock.class, new CaptureMock());
        Opportunity oldRow = new Opportunity(
            Id = '006000000000003',
            AccountId = '001000000000003',
            CloseDate = Date.newInstance(2024, 12, 31)
        );
        Opportunity newRow = new Opportunity(
            Id = oldRow.Id,
            AccountId = oldRow.AccountId,
            CloseDate = Date.newInstance(2024, 12, 31)
        );

        Test.startTest();
        FcosXeroContactSyncService.enqueueForOpportunities(
            new List<Opportunity>{ newRow },
            new Map<Id, Opportunity>{ oldRow.Id => oldRow }
        );
        Test.stopTest();

        System.assertEquals(0, capturedRequests.size());
    }

    @IsTest
    static void unapprovedWebhookEndpointFailsClosed() {
        resetSync();
        enableSync();
        FcosXeroContactSyncService.endpointOverride = 'https://example.invalid/contact-sync';
        capturedRequests.clear();
        Test.setMock(HttpCalloutMock.class, new CaptureMock());

        Test.startTest();
        FcosXeroContactSyncService.enqueueForOpportunities(new List<Opportunity>{
            new Opportunity(
                Id = '006000000000004',
                AccountId = '001000000000004',
                CloseDate = Date.newInstance(2026, 1, 1)
            )
        }, null);
        Test.stopTest();

        System.assertEquals(0, capturedRequests.size());
    }

    @IsTest
    static void triggerLinesExecuteWhileOrgGateIsDisabled() {
        resetSync();

        Test.startTest();
        Fixture fixture = makeFixture();
        Test.stopTest();

        System.assertNotEquals(null, fixture.enquiry.Id);
        System.assertNotEquals(null, fixture.quoteRow.Id);
        System.assertNotEquals(null, fixture.brokerEnquiry.Id);
        System.assertNotEquals(null, fixture.supplierBid.Id);
        System.assertNotEquals(null, fixture.stem.Id);
        System.assertNotEquals(null, fixture.stemLineItem.Id);
        System.assertNotEquals(null, fixture.stemExtraCost.Id);
        System.assertNotEquals(null, fixture.variableChargeSupplier.Id);
        System.assertNotEquals(null, fixture.stemBuyerBroker.Id);
    }

    @IsTest
    static void enabledSourcesPostSignedWebhookEvents() {
        resetSync();
        Fixture fixture = makeFixture();
        enableSync();
        capturedRequests.clear();
        Test.setMock(HttpCalloutMock.class, new CaptureMock());

        Test.startTest();
        FcosXeroContactSyncService.enqueueForOpportunities(new List<Opportunity>{
            new Opportunity(
                Id = fixture.enquiry.Id,
                AccountId = fixture.buyer.Id,
                CloseDate = Date.newInstance(2026, 1, 1)
            )
        }, null);
        FcosXeroContactSyncService.enqueueForQuotes(new List<Quote>{
            new Quote(
                Id = fixture.quoteRow.Id,
                OpportunityId = fixture.enquiry.Id,
                Quote_Buyer__c = fixture.buyer.Id,
                Broker__c = fixture.brokerAccount.Id
            )
        }, null);
        FcosXeroContactSyncService.enqueueForBrokerEnquiries(new List<Broker_Enquiry__c>{
            fixture.brokerEnquiry
        }, null);
        FcosXeroContactSyncService.enqueueForSupplierBids(new List<Supplier_Bid__c>{
            fixture.supplierBid
        }, null);
        FcosXeroContactSyncService.enqueueForStems(new List<STEM__c>{
            fixture.stem
        }, null);
        FcosXeroContactSyncService.enqueueForStemLineItems(new List<STEM_Line_Item__c>{
            fixture.stemLineItem
        }, null);
        FcosXeroContactSyncService.enqueueForStemExtraCosts(new List<STEM_Extra_Cost__c>{
            fixture.stemExtraCost
        }, null);
        FcosXeroContactSyncService.enqueueForVariableChargeSuppliers(new List<STEM_Variable_Charge_Supplier__c>{
            fixture.variableChargeSupplier
        }, null);
        FcosXeroContactSyncService.enqueueForStemBuyerBrokers(new List<STEM_Buyer_Broker__c>{
            fixture.stemBuyerBroker
        }, null);
        Test.stopTest();

        System.assertEquals(9, capturedRequests.size());
        for (HttpRequest request : capturedRequests) {
            System.assertEquals('POST', request.getMethod());
            System.assertEquals('unit-test-event', request.getHeader('x-salesforce-contact-sync-event-id'));
            System.assert(request.getBody().contains('"records"'));
        }
    }
}
