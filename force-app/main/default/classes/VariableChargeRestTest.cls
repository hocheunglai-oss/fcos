@IsTest
private class VariableChargeRestTest {
    @TestSetup
    static void makeData() {
        TestDataFactory.prepareDataForNominationConfirmationFlow();
    }

    private static Map<String, Id> prepareRequiredSupplier() {
        STEM__c stem = [SELECT Id FROM STEM__c LIMIT 1];
        STEM_Line_Item__c line = [
            SELECT Id, Original_Supplier__c
            FROM STEM_Line_Item__c
            WHERE STEM__c = :stem.Id AND Cancelled__c = false
            LIMIT 1
        ];
        ContextManager.skipTriggers = true;
        try {
            update new STEM__c(
                Id = stem.Id,
                Delivery_Date__c = Date.today().addDays(-1),
                Variable_Charges_Confirmed__c = false
            );
            update new Account(Id = line.Original_Supplier__c, Is_Agent__c = true);
        } finally {
            ContextManager.skipTriggers = false;
        }
        STEM_Variable_Charge_Supplier__c stage = new STEM_Variable_Charge_Supplier__c(
            STEM__c = stem.Id,
            Supplier__c = line.Original_Supplier__c,
            Manual_Review_Required__c = false,
            Supplier_Status__c = 'Pending'
        );
        insert stage;
        return new Map<String, Id>{
            'stem' => stem.Id,
            'supplier' => line.Original_Supplier__c,
            'stage' => stage.Id
        };
    }

    private static String iso(Datetime value) {
        return value.formatGmt('yyyy-MM-dd\'T\'HH:mm:ss.SSS\'Z\'');
    }

    private static String restIso(Datetime value) {
        return value.formatGmt('yyyy-MM-dd\'T\'HH:mm:ss.SSS+0000');
    }

    private static void approveBothSidesDirectly(Map<String, Id> ids) {
        STEM_Variable_Charge_Supplier__c stage = [
            SELECT Id, Supplier_Status__c, Verified_At__c, Verified_By_Email__c,
                Reviewed_Source_Fingerprint__c, Buyer_Charge_Status__c,
                Buyer_Charge_Confirmed_At__c, Buyer_Charge_Confirmed_By_Email__c,
                Buyer_Charge_Reviewed_Source_Fingerprint__c
            FROM STEM_Variable_Charge_Supplier__c
            WHERE Id = :ids.get('stage')
        ];
        stage.Supplier_Status__c = 'Verified';
        stage.Verified_At__c = System.now();
        stage.Verified_By_Email__c = 'supplier.trader@example.com';
        stage.Reviewed_Source_Fingerprint__c = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
        stage.Buyer_Charge_Status__c = 'Verified';
        stage.Buyer_Charge_Confirmed_At__c = System.now();
        stage.Buyer_Charge_Confirmed_By_Email__c = 'buyer.trader@example.com';
        stage.Buyer_Charge_Reviewed_Source_Fingerprint__c = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
        update stage;
        ContextManager.skipTriggers = true;
        try {
            update new STEM__c(Id = ids.get('stem'), Variable_Charges_Confirmed__c = true);
        } finally {
            ContextManager.skipTriggers = false;
        }
    }

    private static void request(String method, String suffix, Object body) {
        RestRequest request = new RestRequest();
        request.httpMethod = method;
        request.requestUri = '/services/apexrest/fcos/variable-charges/' + suffix;
        if (body != null) request.requestBody = Blob.valueOf(JSON.serialize(body));
        RestContext.request = request;
        RestContext.response = new RestResponse();
    }

    @IsTest
    static void supplierActionUsesTheCanonicalGate() {
        Map<String, Id> ids = prepareRequiredSupplier();
        STEM__c stem = [SELECT LastModifiedDate FROM STEM__c WHERE Id = :ids.get('stem')];
        STEM_Variable_Charge_Supplier__c stage = [
            SELECT LastModifiedDate
            FROM STEM_Variable_Charge_Supplier__c
            WHERE Id = :ids.get('stage')
        ];
        VariableChargeRest.RequestBody supplierBody = new VariableChargeRest.RequestBody();
        supplierBody.stemId = String.valueOf(ids.get('stem'));
        supplierBody.supplierId = String.valueOf(ids.get('supplier'));
        supplierBody.verifierEmail = 'gm@example.com';
        supplierBody.expectedFingerprint = VariableChargeInvoiceReadinessService.supplierFingerprint(
            ids.get('stem'), ids.get('supplier')
        );
        supplierBody.expectedStageLastModifiedAt = restIso(stage.LastModifiedDate);
        supplierBody.expectedStemLastModifiedAt = restIso(stem.LastModifiedDate);
        supplierBody.gmOverrideReason = 'Test GM override';
        request(
            'POST',
            String.valueOf(ids.get('stem')) + '/supplier/' + String.valueOf(ids.get('supplier')) + '/verify',
            supplierBody
        );

        Test.startTest();
        VariableChargeRest.ResponseBody verified = VariableChargeRest.post();
        Test.stopTest();
        System.assertEquals('Verified', verified.supplierStatus);
        System.assertEquals(String.valueOf(ids.get('supplier')), verified.supplierId);
    }

    @IsTest
    static void legacyBuyerActionRequiresPairedRefresh() {
        Map<String, Id> ids = prepareRequiredSupplier();
        STEM_Variable_Charge_Supplier__c stage = [
            SELECT Id, STEM__c, Supplier__c
            FROM STEM_Variable_Charge_Supplier__c
            WHERE Id = :ids.get('stage')
        ];
        stage.Supplier_Status__c = 'Verified';
        stage.Verified_At__c = System.now();
        stage.Verified_By_Email__c = 'supplier.trader@example.com';
        stage.Reviewed_Source_Fingerprint__c = VariableChargeInvoiceReadinessService.supplierFingerprint(
            ids.get('stem'), ids.get('supplier')
        );
        update stage;

        STEM__c stem = [SELECT LastModifiedDate FROM STEM__c WHERE Id = :ids.get('stem')];
        VariableChargeRest.RequestBody buyerBody = new VariableChargeRest.RequestBody();
        buyerBody.expectedStemLastModifiedAt = iso(stem.LastModifiedDate);
        request('POST', String.valueOf(ids.get('stem')) + '/buyer/confirm', buyerBody);
        Test.startTest();
        VariableChargeRest.ResponseBody rejected = VariableChargeRest.post();
        System.assertEquals(409, RestContext.response.statusCode);
        System.assertEquals(false, rejected.success);
        System.assert(rejected.message.contains('Refresh FCOS'));
        Test.stopTest();
    }

    @IsTest
    static void buyerSideCanConfirmBeforeSupplierCost() {
        Map<String, Id> ids = prepareRequiredSupplier();
        STEM__c stem = [SELECT LastModifiedDate FROM STEM__c WHERE Id = :ids.get('stem')];
        STEM_Variable_Charge_Supplier__c stage = [
            SELECT LastModifiedDate FROM STEM_Variable_Charge_Supplier__c WHERE Id = :ids.get('stage')
        ];
        VariableChargeRest.RequestBody body = new VariableChargeRest.RequestBody();
        body.stemId = String.valueOf(ids.get('stem'));
        body.supplierId = String.valueOf(ids.get('supplier'));
        body.verifierEmail = 'supplier.trader@example.com';
        body.expectedBuyerFingerprint = VariableChargeInvoiceReadinessService.buyerChargeFingerprint(ids.get('stem'), ids.get('supplier'));
        body.expectedStageLastModifiedAt = iso(stage.LastModifiedDate);
        body.expectedStemLastModifiedAt = iso(stem.LastModifiedDate);
        request('POST', String.valueOf(ids.get('stem')) + '/supplier/' + String.valueOf(ids.get('supplier')) + '/buyer-charge/confirm', body);

        Test.startTest();
        VariableChargeRest.ResponseBody confirmed = VariableChargeRest.post();
        Test.stopTest();
        System.assertEquals('Verified', confirmed.buyerChargeStatus);
        System.assertEquals('Pending', confirmed.supplierStatus);
        System.assertEquals(true, confirmed.buyerConfirmed);
    }

    @IsTest
    static void approvedSideCanReopenBeforeInvoiceCreation() {
        Map<String, Id> ids = prepareRequiredSupplier();
        approveBothSidesDirectly(ids);
        STEM__c stem = [SELECT LastModifiedDate FROM STEM__c WHERE Id = :ids.get('stem')];
        STEM_Variable_Charge_Supplier__c stage = [SELECT LastModifiedDate FROM STEM_Variable_Charge_Supplier__c WHERE Id = :ids.get('stage')];
        VariableChargeRest.RequestBody reopen = new VariableChargeRest.RequestBody();
        reopen.stemId = String.valueOf(ids.get('stem'));
        reopen.supplierId = String.valueOf(ids.get('supplier'));
        reopen.verifierEmail = 'buyer.trader@example.com';
        reopen.sides = new List<String>{'buyer_charge'};
        reopen.expectedStageLastModifiedAt = restIso(stage.LastModifiedDate);
        reopen.expectedStemLastModifiedAt = restIso(stem.LastModifiedDate);
        request('POST', String.valueOf(ids.get('stem')) + '/supplier/' + String.valueOf(ids.get('supplier')) + '/reopen', reopen);

        Test.startTest();
        VariableChargeRest.ResponseBody reopened = VariableChargeRest.post();
        Test.stopTest();
        System.assertEquals(true, reopened.success);
        System.assertEquals('Verified', reopened.supplierStatus);
        System.assertEquals('Invalidated', reopened.buyerChargeStatus);
        System.assertEquals(false, reopened.buyerConfirmed);
    }

    @IsTest
    static void approvedSidesCannotReopenAfterTheirInvoiceCreation() {
        Map<String, Id> ids = prepareRequiredSupplier();
        approveBothSidesDirectly(ids);
        ContextManager.avoidSupplierInvoiceFiring = true;
        try {
            insert new Supplier_Invoice__c(
                STEM__c = ids.get('stem'),
                Supplier__c = ids.get('supplier'),
                Payment_Term__c = '2 P',
                Supplier_Delivery_Date__c = Date.today(),
                Bank_Details__c = 'Not Provided'
            );
        } finally {
            ContextManager.avoidSupplierInvoiceFiring = false;
        }
        ContextManager.avoidInvoiceFiring = true;
        try {
            insert new Invoice__c(Name = '00001T-INV-AMEND-BLOCK', STEM__c = ids.get('stem'), Proforma__c = false);
        } finally {
            ContextManager.avoidInvoiceFiring = false;
        }
        STEM__c stem = [SELECT LastModifiedDate FROM STEM__c WHERE Id = :ids.get('stem')];
        STEM_Variable_Charge_Supplier__c stage = [SELECT LastModifiedDate FROM STEM_Variable_Charge_Supplier__c WHERE Id = :ids.get('stage')];

        VariableChargeRest.RequestBody reopenCost = new VariableChargeRest.RequestBody();
        reopenCost.stemId = String.valueOf(ids.get('stem'));
        reopenCost.supplierId = String.valueOf(ids.get('supplier'));
        reopenCost.verifierEmail = 'supplier.trader@example.com';
        reopenCost.sides = new List<String>{'cost'};
        reopenCost.expectedStageLastModifiedAt = restIso(stage.LastModifiedDate);
        reopenCost.expectedStemLastModifiedAt = restIso(stem.LastModifiedDate);
        request('POST', String.valueOf(ids.get('stem')) + '/supplier/' + String.valueOf(ids.get('supplier')) + '/reopen', reopenCost);
        VariableChargeRest.ResponseBody supplierBlocked = VariableChargeRest.post();
        System.assertEquals(409, RestContext.response.statusCode);
        System.assert(supplierBlocked.message.contains('supplier invoice'));

        VariableChargeRest.RequestBody reopenBuyer = new VariableChargeRest.RequestBody();
        reopenBuyer.stemId = String.valueOf(ids.get('stem'));
        reopenBuyer.supplierId = String.valueOf(ids.get('supplier'));
        reopenBuyer.verifierEmail = 'buyer.trader@example.com';
        reopenBuyer.sides = new List<String>{'buyer_charge'};
        reopenBuyer.expectedStageLastModifiedAt = restIso(stage.LastModifiedDate);
        reopenBuyer.expectedStemLastModifiedAt = restIso(stem.LastModifiedDate);
        request('POST', String.valueOf(ids.get('stem')) + '/supplier/' + String.valueOf(ids.get('supplier')) + '/reopen', reopenBuyer);
        VariableChargeRest.ResponseBody buyerBlocked = VariableChargeRest.post();
        System.assertEquals(409, RestContext.response.statusCode);
        System.assert(buyerBlocked.message.contains('Buyer Invoice'));
    }

    @IsTest
    static void fingerprintAndUnsupportedPathsFailClosed() {
        Map<String, Id> ids = prepareRequiredSupplier();
        request(
            'GET',
            String.valueOf(ids.get('stem')) + '/supplier/' + String.valueOf(ids.get('supplier')) + '/fingerprint',
            null
        );
        VariableChargeRest.ResponseBody result = VariableChargeRest.get();
        System.assertEquals(
            VariableChargeInvoiceReadinessService.supplierFingerprint(ids.get('stem'), ids.get('supplier')),
            result.fingerprint
        );

        request('POST', String.valueOf(ids.get('stem')) + '/unsupported', new VariableChargeRest.RequestBody());
        VariableChargeRest.ResponseBody rejected = VariableChargeRest.post();
        System.assertEquals(409, RestContext.response.statusCode);
        System.assertEquals(false, rejected.success);
        System.assertEquals('VARIABLE_CHARGE_REQUEST_REJECTED', rejected.errorCode);
    }

    @IsTest
    static void staleStemTimestampReturnsStructuredConflict() {
        Map<String, Id> ids = prepareRequiredSupplier();
        STEM__c stem = [SELECT LastModifiedDate FROM STEM__c WHERE Id = :ids.get('stem')];
        STEM_Variable_Charge_Supplier__c stage = [
            SELECT LastModifiedDate FROM STEM_Variable_Charge_Supplier__c WHERE Id = :ids.get('stage')
        ];
        VariableChargeRest.RequestBody body = new VariableChargeRest.RequestBody();
        body.stemId = String.valueOf(ids.get('stem'));
        body.supplierId = String.valueOf(ids.get('supplier'));
        body.verifierEmail = 'gm@example.com';
        body.expectedFingerprint = VariableChargeInvoiceReadinessService.supplierFingerprint(ids.get('stem'), ids.get('supplier'));
        body.expectedStageLastModifiedAt = restIso(stage.LastModifiedDate);
        body.expectedStemLastModifiedAt = restIso(stem.LastModifiedDate.addSeconds(-1));
        body.gmOverrideReason = 'Test GM override';
        request(
            'POST',
            String.valueOf(ids.get('stem')) + '/supplier/' + String.valueOf(ids.get('supplier')) + '/verify',
            body
        );

        VariableChargeRest.ResponseBody rejected = VariableChargeRest.post();

        System.assertEquals(409, RestContext.response.statusCode);
        System.assertEquals(false, rejected.success);
        System.assertEquals('VARIABLE_CHARGE_REQUEST_REJECTED', rejected.errorCode);
        System.assertEquals('The STEM changed after it was opened.', rejected.message);
    }
}
