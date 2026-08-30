@IsTest
private class MasterContractGenerationTest {
    @TestSetup
    static void makeData() {
        TestDataFactory.prepareDataForNominationConfirmationFlow();
    }

    private static MasterContractGenerationService.CreateRequest request(String suffix) {
        // Test setup and each test transaction may reuse autonumber values. Move the
        // setup STEM outside the Originated workflow before creating a new one so
        // the KeyStem=RefCode workflow can be exercised without a synthetic clash.
        Id historicalId = Schema.SObjectType.STEM__c.getRecordTypeInfosByName().get('Historical').getRecordTypeId();
        List<STEM__c> setupStems = [SELECT Id FROM STEM__c];
        for (Integer index = 0; index < setupStems.size(); index++) {
            setupStems[index].RecordTypeId = historicalId;
            setupStems[index].KeyStem__c = 'MC-SETUP-' + suffix + '-' + index;
        }
        ContextManager.skipTriggers = true;
        try {
            update setupStems;
        } finally {
            ContextManager.skipTriggers = false;
        }
        Account buyer = [SELECT Id FROM Account WHERE RecordTypeId = :FCBStatic.BUYER_ACCOUNT_RT_ID LIMIT 1];
        Account supplier = [SELECT Id FROM Account WHERE RecordTypeId = :FCBStatic.SUPPLIER_ACCOUNT_RT_ID LIMIT 1];
        Account chargeSupplier = TestDataFactory.createTestAccount(
            'Master Contract Charge Supplier ' + suffix,
            'SUPPLIER',
            true
        );
        Product2 product = [SELECT Id, Name FROM Product2 WHERE IsActive = true LIMIT 1];
        Vessel__c vessel = [SELECT Id, Name, IMO__c FROM Vessel__c LIMIT 1];
        Port__c port = [SELECT Id, Name FROM Port__c LIMIT 1];
        User owner = [SELECT Email FROM User WHERE Id = :UserInfo.getUserId()];

        MasterContractGenerationService.ProductTerm term = new MasterContractGenerationService.ProductTerm();
        term.productKey = 'hsfo';
        term.productName = product.Name;
        term.salesforceProductId = product.Id;
        term.uom = 'MT';

        MasterContractGenerationService.DeliveryProduct allocation = new MasterContractGenerationService.DeliveryProduct();
        allocation.productKey = 'hsfo';
        allocation.contractLineKey = 'MC-GEN-' + suffix + '-LINE';
        allocation.quantityMin = 600;
        allocation.quantityMax = 800;

        MasterContractGenerationService.Delivery delivery = new MasterContractGenerationService.Delivery();
        delivery.deliveryKey = 'MC-GEN-' + suffix + '-D01';
        delivery.sequence = 1;
        delivery.vesselName = vessel.Name;
        delivery.vesselImo = vessel.IMO__c;
        delivery.vesselId = vessel.Id;
        delivery.portId = port.Id;
        delivery.portName = port.Name;
        delivery.preliminaryEta = Date.today().addDays(30);
        delivery.supplyLocation = 'Berth';
        delivery.buyerPaymentTerm = '7';
        delivery.supplierPaymentTerm = '2 P';
        delivery.variableChargeSupplierIds = new List<Id>();
        delivery.products = new List<MasterContractGenerationService.DeliveryProduct>{ allocation };

        MasterContractGenerationService.ChargeRule charge = new MasterContractGenerationService.ChargeRule();
        charge.chargeKey = 'sgs';
        charge.salesforceProductId = product.Id;
        charge.supplierAccountId = chargeSupplier.Id;
        charge.chargeName = 'SGS attendance';
        charge.appliesWhen = 'every_delivery';
        charge.fixedCost = 900;
        charge.fixedSell = 900;

        MasterContractGenerationService.VariableCharges variableCharges = new MasterContractGenerationService.VariableCharges();
        variableCharges.mode = 'contract';
        variableCharges.supplierIds = new List<Id>();

        MasterContractGenerationService.CreateRequest result = new MasterContractGenerationService.CreateRequest();
        result.idempotencyKey = 'master-contract-generation-' + suffix;
        result.requestHash = EncodingUtil.convertToHex(Crypto.generateDigest('SHA-256', Blob.valueOf(suffix)));
        result.contractKey = 'MC-GEN-' + suffix;
        result.contractTitle = 'Master Contract Generation Test';
        result.buyerAccountId = buyer.Id;
        result.supplierAccountId = supplier.Id;
        result.ownerEmail = owner.Email;
        result.buyerPic = 'Test PIC';
        result.products = new List<MasterContractGenerationService.ProductTerm>{ term };
        result.chargeRules = new List<MasterContractGenerationService.ChargeRule>{ charge };
        result.variableCharges = variableCharges;
        result.deliveries = new List<MasterContractGenerationService.Delivery>{ delivery };
        return result;
    }

    @IsTest
    static void createsCompleteOperationalStructureAndRetriesIdempotently() {
        MasterContractGenerationService.CreateRequest input = request('A01');
        Test.startTest();
        MasterContractGenerationService.CreateResponse created = MasterContractGenerationService.create(input);
        MasterContractGenerationService.CreateResponse replay = MasterContractGenerationService.create(input);
        Test.stopTest();

        System.assertEquals(true, created.committed);
        System.assertEquals(false, created.duplicate);
        System.assertEquals(true, replay.duplicate);
        System.assert(created.links.size() >= 6);
        Opportunity enquiry = [
            SELECT StageName, Direct_Offer__c, Master_Contract_Source__c
            FROM Opportunity WHERE Master_Contract_Delivery_Key__c = :input.deliveries[0].deliveryKey
        ];
        System.assertEquals('Closed Won', enquiry.StageName);
        System.assertEquals(true, enquiry.Direct_Offer__c);
        STEM__c stem = [
            SELECT Id, Enquiry__c, Quote__c, Master_Contract_Source__c, Master_Contract_Key__c
            FROM STEM__c WHERE Master_Contract_Delivery_Key__c = :input.deliveries[0].deliveryKey
        ];
        System.assertNotEquals(null, stem.Enquiry__c);
        System.assertEquals(null, stem.Quote__c);
        System.assertEquals(true, stem.Master_Contract_Source__c);
        System.assertEquals(1, [SELECT COUNT() FROM Nomination__c WHERE STEM__c = :stem.Id AND RecordType.Name = 'Buyer Confirmation']);
        System.assert([SELECT COUNT() FROM Nomination__c WHERE STEM__c = :stem.Id AND RecordType.Name != 'Buyer Confirmation'] >= 1);
        System.assertEquals(1, [SELECT COUNT() FROM STEM_Extra_Cost__c WHERE STEM__c = :stem.Id AND Master_Contract_Source__c = true]);

        STEM_Line_Item__c line = [
            SELECT Id, DON_Price_Status__c, Master_Contract_Line_Key__c
            FROM STEM_Line_Item__c WHERE Master_Contract_Line_Key__c = :input.deliveries[0].products[0].contractLineKey
        ];
        System.assertEquals('Unresolved', line.DON_Price_Status__c);
        System.assertEquals(false, MasterContractInvoiceReadinessService.getBuyerReadiness(String.valueOf(stem.Id)).ready);
        System.assertEquals(1, MasterContractGenerationService.status(input.contractKey).deliveries.size());
    }

    @IsTest
    static void restResourceReturnsCreateStatusAndPriceResponses() {
        MasterContractGenerationService.CreateRequest input = request('B01');
        RestRequest restRequest = new RestRequest();
        RestResponse response = new RestResponse();
        restRequest.requestUri = '/services/apexrest/fcos/master-contracts/v1/create';
        restRequest.httpMethod = 'POST';
        restRequest.requestBody = Blob.valueOf(JSON.serialize(input));
        RestContext.request = restRequest;
        RestContext.response = response;
        Test.startTest();
        MasterContractGenerationRest.postAction();
        Test.stopTest();
        System.assertEquals(200, response.statusCode);

        restRequest = new RestRequest();
        response = new RestResponse();
        restRequest.requestUri = '/services/apexrest/fcos/master-contracts/v1/status';
        restRequest.httpMethod = 'GET';
        restRequest.params.put('contractKey', input.contractKey);
        RestContext.request = restRequest;
        RestContext.response = response;
        MasterContractGenerationRest.getStatus();
        System.assertEquals(200, response.statusCode);
        System.assert(response.responseBody.toString().contains(input.deliveries[0].deliveryKey));

        restRequest = new RestRequest();
        response = new RestResponse();
        restRequest.requestUri = '/services/apexrest/fcos/master-contracts/v1/unknown';
        restRequest.httpMethod = 'POST';
        RestContext.request = restRequest;
        RestContext.response = response;
        MasterContractGenerationRest.postAction();
        System.assertEquals(404, response.statusCode);
    }

    @IsTest
    static void appliesReviewedDonPriceThroughServiceAndRestIdempotently() {
        STEM_Line_Item__c line = [SELECT Id, STEM__c FROM STEM_Line_Item__c LIMIT 1];
        ContextManager.skipTriggers = true;
        try {
            update new STEM__c(
                Id = line.STEM__c,
                Master_Contract_Source__c = true,
                Master_Contract_Key__c = 'MC-GEN-PRICE'
            );
            update new STEM_Line_Item__c(
                Id = line.Id,
                Master_Contract_Source__c = true,
                Master_Contract_Line_Key__c = 'MC-GEN-PRICE-LINE',
                DON_Price_Status__c = 'Unresolved'
            );
        } finally {
            ContextManager.skipTriggers = false;
        }
        MasterContractGenerationService.PriceRequest price = new MasterContractGenerationService.PriceRequest();
        price.idempotencyKey = 'master-contract-price-C01';
        price.requestHash = EncodingUtil.convertToHex(Crypto.generateDigest('SHA-256', Blob.valueOf('price-C01')));
        price.lineItemId = line.Id;
        price.contractLineKey = 'MC-GEN-PRICE-LINE';
        price.buyPrice = 670.41;
        price.sellPrice = 670.41;
        price.benchmarkDate = Date.today();
        price.benchmarkCode = 'PPXDK00';
        price.benchmarkValue = 615.41;
        price.supplierPricingDate = Date.today().addDays(-2);
        price.buyerPricingDate = Date.today();
        price.supplierBenchmarkValue = 612.00;
        price.buyerBenchmarkValue = 615.41;
        price.pricingPosition = 'Long';
        price.buyUnrounded = 670.4100001;
        price.sellUnrounded = 670.4100001;
        price.evidenceHash = EncodingUtil.convertToHex(Crypto.generateDigest('SHA-256', Blob.valueOf('evidence-C01')));

        Test.startTest();
        Map<String, Object> applied = MasterContractGenerationService.applyPrice(price);
        RestRequest restRequest = new RestRequest();
        RestResponse response = new RestResponse();
        restRequest.requestUri = '/services/apexrest/fcos/master-contracts/v1/prices';
        restRequest.httpMethod = 'POST';
        restRequest.requestBody = Blob.valueOf(JSON.serialize(price));
        RestContext.request = restRequest;
        RestContext.response = response;
        MasterContractGenerationRest.postAction();
        Test.stopTest();

        System.assertEquals(true, applied.get('applied'));
        System.assertEquals(false, applied.get('duplicate'));
        System.assertEquals(200, response.statusCode);
        System.assert(response.responseBody.toString().contains('duplicate'));
        STEM_Line_Item__c appliedLine = [
            SELECT DON_Supplier_Pricing_Date__c, DON_Buyer_Pricing_Date__c,
                DON_Supplier_Benchmark_Value__c, DON_Buyer_Benchmark_Value__c,
                DON_Pricing_Position__c
            FROM STEM_Line_Item__c WHERE Id = :line.Id
        ];
        System.assertEquals(Date.today().addDays(-2), appliedLine.DON_Supplier_Pricing_Date__c);
        System.assertEquals(Date.today(), appliedLine.DON_Buyer_Pricing_Date__c);
        System.assertEquals(Decimal.valueOf('612.00'), appliedLine.DON_Supplier_Benchmark_Value__c);
        System.assertEquals(Decimal.valueOf('615.41'), appliedLine.DON_Buyer_Benchmark_Value__c);
        System.assertEquals('Long', appliedLine.DON_Pricing_Position__c);
        System.assertEquals(true, MasterContractInvoiceReadinessService.getBuyerReadiness(String.valueOf(line.STEM__c)).ready);
    }

    @IsTest
    static void invalidExactIdentityFailsBeforeAnyPartialCreation() {
        MasterContractGenerationService.CreateRequest input = request('C01');
        input.deliveries[0].vesselId = input.buyerAccountId;
        Test.startTest();
        try {
            MasterContractGenerationService.create(input);
            System.assert(false, 'A cross-object identity must fail closed.');
        } catch (Exception expected) {
            System.assertNotEquals(null, expected);
        }
        Test.stopTest();
        System.assertEquals(0, [SELECT COUNT() FROM STEM__c WHERE Master_Contract_Delivery_Key__c = :input.deliveries[0].deliveryKey]);
        System.assertEquals(0, [SELECT COUNT() FROM Opportunity WHERE Master_Contract_Delivery_Key__c = :input.deliveries[0].deliveryKey]);
    }
}
