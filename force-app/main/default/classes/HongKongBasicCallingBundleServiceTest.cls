@IsTest
private class HongKongBasicCallingBundleServiceTest {
    @TestSetup
    static void makeData() {
        TestDataFactory.prepareDataForNominationConfirmationFlow();
        Pricebook2 pricebook = [SELECT Id FROM Pricebook2 WHERE Name = 'Standard Price Book' LIMIT 1];
        for (String name : new List<String>{
            HongKongBasicCallingBundleService.BASIC_CALLING_COST,
            HongKongBasicCallingBundleService.AGENCY_FEE,
            HongKongBasicCallingBundleService.PORT_CLEARANCE_EXTENSION,
            HongKongBasicCallingBundleService.LIGHT_DUES,
            HongKongBasicCallingBundleService.ANCHORAGE_DUES
        }) {
            TestDataFactory.insertTestProduct(name, pricebook.Id, 'NON-PETROLEUM', true);
        }
        STEM__c stem = [SELECT Id FROM STEM__c LIMIT 1];
        STEM_Line_Item__c line = [
            SELECT Original_Supplier__c FROM STEM_Line_Item__c WHERE STEM__c = :stem.Id LIMIT 1
        ];
        Port__c hongKong = TestDataFactory.createTestPort('HONG KONG', 'HONG KONG', true);
        ContextManager.skipTriggers = true;
        try {
            update new STEM__c(Id = stem.Id, Port__c = hongKong.Id);
            update new Account(Id = line.Original_Supplier__c, Agency_Fee_USD__c = 250);
        } finally {
            ContextManager.skipTriggers = false;
        }
        Test.startTest();
        insertBasicCallingCost();
        Test.stopTest();
    }

    private static STEM_Extra_Cost__c insertBasicCallingCost() {
        STEM__c stem = [SELECT Id FROM STEM__c LIMIT 1];
        STEM_Line_Item__c line = [
            SELECT Original_Supplier__c, Payment_Term__c
            FROM STEM_Line_Item__c WHERE STEM__c = :stem.Id LIMIT 1
        ];
        Product2 product = [
            SELECT Id FROM Product2
            WHERE Name = :HongKongBasicCallingBundleService.BASIC_CALLING_COST AND IsActive = true LIMIT 1
        ];
        STEM_Extra_Cost__c basic = new STEM_Extra_Cost__c(
            STEM__c = stem.Id,
            Supplier__c = line.Original_Supplier__c,
            Product2Id__c = product.Id,
            RecordTypeId = Schema.SObjectType.STEM_Extra_Cost__c
                .getRecordTypeInfosByName().get('STEM Charge').getRecordTypeId(),
            Payment_Term__c = line.Payment_Term__c,
            Fixed__c = true,
            Quantity__c = 1,
            Quantity_Delivered_Per_BDN__c = 1,
            Unit_of_Measure__c = '1.',
            Lumpsum_Cost__c = 100,
            Lumpsum_Price__c = 1000,
            Cancelled__c = false
        );
        insert basic;
        return basic;
    }

    private static List<STEM_Extra_Cost__c> managedRows() {
        return [
            SELECT Id, Product2Id__r.Name, Supplier__c, Payment_Term__c, Cancelled__c,
                Fixed__c, Quantity__c, Unit_of_Measure__c, Unit_Cost__c, Unit_Price__c,
                Lumpsum_Cost__c, Lumpsum_Price__c, Supplier_Cost_Input_Currency__c,
                Supplier_Cost_Input_Value__c, Hong_Kong_Bundle_Key__c,
                Hong_Kong_Bundle_Managed__c, Hong_Kong_Bundle_Sequence__c,
                Hong_Kong_Bundle_Source__c, Port_Clearance_Rate_HKD__c,
                Port_Clearance_Calculation_Version__c
            FROM STEM_Extra_Cost__c
            WHERE Hong_Kong_Bundle_Managed__c = true
            ORDER BY Hong_Kong_Bundle_Sequence__c
        ];
    }

    @IsTest
    static void createsOneOrderedBundleWithCommercialDefaults() {
        Test.startTest();
        STEM_Extra_Cost__c basic = [
            SELECT Id FROM STEM_Extra_Cost__c
            WHERE Product2Id__r.Name = :HongKongBasicCallingBundleService.BASIC_CALLING_COST LIMIT 1
        ];
        Test.stopTest();

        List<STEM_Extra_Cost__c> rows = managedRows();
        System.assertEquals(4, rows.size());
        System.assertEquals('AGENCY FEE', rows[0].Product2Id__r.Name);
        System.assertEquals(Decimal.valueOf('250'), rows[0].Lumpsum_Cost__c);
        System.assertEquals(Decimal.valueOf('0'), rows[0].Lumpsum_Price__c);
        System.assertEquals('PORT CLEARANCE EXTENSION', rows[1].Product2Id__r.Name);
        System.assertEquals(Decimal.valueOf('1'), rows[1].Quantity__c);
        System.assertEquals('1.', rows[1].Unit_of_Measure__c);
        System.assertEquals('HKD', rows[1].Supplier_Cost_Input_Currency__c);
        System.assertEquals(Decimal.valueOf('58'), rows[1].Supplier_Cost_Input_Value__c);
        System.assertEquals(Decimal.valueOf('58'), rows[1].Port_Clearance_Rate_HKD__c);
        System.assertEquals(Decimal.valueOf('0'), rows[1].Unit_Price__c);
        System.assertEquals('LIGHT DUES', rows[2].Product2Id__r.Name);
        System.assertEquals(Decimal.valueOf('0'), rows[2].Lumpsum_Price__c);
        System.assertEquals('ANCHORAGE DUES', rows[3].Product2Id__r.Name);
        for (STEM_Extra_Cost__c row : rows) {
            System.assertEquals(true, row.Hong_Kong_Bundle_Managed__c);
            System.assertEquals(basic.Id, row.Hong_Kong_Bundle_Source__c);
            System.assertNotEquals(null, row.Hong_Kong_Bundle_Key__c);
        }
    }

    @IsTest
    static void repeatedSynchronizationIsIdempotentAndPreservesReviewedValues() {
        STEM_Extra_Cost__c basic = [
            SELECT Id FROM STEM_Extra_Cost__c
            WHERE Product2Id__r.Name = :HongKongBasicCallingBundleService.BASIC_CALLING_COST LIMIT 1
        ];
        STEM_Extra_Cost__c portClearance = [
            SELECT Id, STEM__c, Quantity__c, Unit_Cost__c
            FROM STEM_Extra_Cost__c
            WHERE Hong_Kong_Bundle_Managed__c = true AND Product2Id__r.Name = 'PORT CLEARANCE EXTENSION'
            LIMIT 1
        ];
        ContextManager.skipTriggers = true;
        try {
            update new STEM_Extra_Cost__c(
                Id = portClearance.Id,
                Quantity__c = 3,
                Unit_Cost__c = 7.40
            );
        } finally {
            ContextManager.skipTriggers = false;
        }

        Test.startTest();
        HongKongBasicCallingBundleService.synchronizeStemIds(new Set<Id>{portClearance.STEM__c});
        Test.stopTest();

        portClearance = [SELECT Quantity__c, Unit_Cost__c, Port_Clearance_Rate_HKD__c FROM STEM_Extra_Cost__c WHERE Id = :portClearance.Id];
        System.assertEquals(Decimal.valueOf('3'), portClearance.Quantity__c);
        System.assertEquals(Decimal.valueOf('7.40'), portClearance.Unit_Cost__c);
        System.assertEquals(Decimal.valueOf('58'), portClearance.Port_Clearance_Rate_HKD__c);
        System.assertEquals(4, managedRows().size());
        System.assertNotEquals(null, basic.Id);
    }

    @IsTest
    static void agentBundleUsesTheAccountAgreedCurrencyForEverySupplierExtraCost() {
        STEM_Extra_Cost__c basic = [
            SELECT STEM__c, Supplier__c FROM STEM_Extra_Cost__c
            WHERE Product2Id__r.Name = :HongKongBasicCallingBundleService.BASIC_CALLING_COST LIMIT 1
        ];
        ContextManager.skipTriggers = true;
        try {
            update new Account(
                Id = basic.Supplier__c,
                Is_Agent__c = true,
                Agency_Fee_USD__c = 1950,
                Agency_Fee_Currency__c = 'HKD'
            );
        } finally {
            ContextManager.skipTriggers = false;
        }

        Test.startTest();
        HongKongBasicCallingBundleService.synchronizeStemIds(new Set<Id>{basic.STEM__c});
        Test.stopTest();

        List<STEM_Extra_Cost__c> rows = managedRows();
        System.assertEquals(4, rows.size());
        for (STEM_Extra_Cost__c row : rows) {
            System.assertEquals('HKD', row.Supplier_Cost_Input_Currency__c, row.Product2Id__r.Name);
        }
        System.assertEquals(Decimal.valueOf('1950'), rows[0].Supplier_Cost_Input_Value__c);
        System.assertEquals(Decimal.valueOf('58'), rows[1].Supplier_Cost_Input_Value__c);
    }

    @IsTest
    static void manualMatchingRowSuppressesGeneratedDuplicate() {
        STEM_Extra_Cost__c basic = [
            SELECT Id, STEM__c, Supplier__c, Payment_Term__c FROM STEM_Extra_Cost__c
            WHERE Product2Id__r.Name = :HongKongBasicCallingBundleService.BASIC_CALLING_COST LIMIT 1
        ];
        STEM_Extra_Cost__c generatedAgency = [
            SELECT Id FROM STEM_Extra_Cost__c
            WHERE Hong_Kong_Bundle_Managed__c = true AND Product2Id__r.Name = 'AGENCY FEE' LIMIT 1
        ];
        Product2 agency = [SELECT Id FROM Product2 WHERE Name = 'AGENCY FEE' AND IsActive = true LIMIT 1];
        STEM_Extra_Cost__c manualAgency = new STEM_Extra_Cost__c(
            STEM__c = basic.STEM__c,
            Supplier__c = basic.Supplier__c,
            Product2Id__c = agency.Id,
            RecordTypeId = Schema.SObjectType.STEM_Extra_Cost__c.getRecordTypeInfosByName().get('STEM Charge').getRecordTypeId(),
            Payment_Term__c = basic.Payment_Term__c,
            Fixed__c = true,
            Lumpsum_Cost__c = 275,
            Lumpsum_Price__c = 0,
            Quantity__c = 1,
            Quantity_Delivered_Per_BDN__c = 1,
            Unit_of_Measure__c = '1.',
            Cancelled__c = false
        );

        ContextManager.skipTriggers = true;
        insert manualAgency;
        ContextManager.skipTriggers = false;
        Test.startTest();
        HongKongBasicCallingBundleService.synchronizeStemIds(new Set<Id>{basic.STEM__c});
        Test.stopTest();
        System.assertEquals(true, [SELECT Cancelled__c FROM STEM_Extra_Cost__c WHERE Id = :generatedAgency.Id].Cancelled__c);
        System.assertEquals(false, [SELECT Cancelled__c FROM STEM_Extra_Cost__c WHERE Id = :manualAgency.Id].Cancelled__c);
    }

    @IsTest
    static void manualSupportRowsUseTheSameInvoiceReadinessRules() {
        STEM_Extra_Cost__c basic = [
            SELECT Id, STEM__c, Supplier__c, Payment_Term__c FROM STEM_Extra_Cost__c
            WHERE Product2Id__r.Name = :HongKongBasicCallingBundleService.BASIC_CALLING_COST LIMIT 1
        ];
        STEM_Extra_Cost__c generatedAgency = [
            SELECT Id FROM STEM_Extra_Cost__c
            WHERE Hong_Kong_Bundle_Managed__c = true AND Product2Id__r.Name = 'AGENCY FEE' LIMIT 1
        ];
        STEM_Extra_Cost__c portClearance = [
            SELECT Id FROM STEM_Extra_Cost__c
            WHERE Hong_Kong_Bundle_Managed__c = true AND Product2Id__r.Name = 'PORT CLEARANCE EXTENSION' LIMIT 1
        ];
        Product2 agencyProduct = [SELECT Id FROM Product2 WHERE Name = 'AGENCY FEE' AND IsActive = true LIMIT 1];
        STEM_Extra_Cost__c manualAgency = new STEM_Extra_Cost__c(
            STEM__c = basic.STEM__c,
            Supplier__c = basic.Supplier__c,
            Product2Id__c = agencyProduct.Id,
            RecordTypeId = Schema.SObjectType.STEM_Extra_Cost__c.getRecordTypeInfosByName().get('STEM Charge').getRecordTypeId(),
            Payment_Term__c = basic.Payment_Term__c,
            Fixed__c = true,
            Lumpsum_Cost__c = 250,
            Lumpsum_Price__c = 0,
            Quantity__c = 1,
            Quantity_Delivered_Per_BDN__c = 1,
            Unit_of_Measure__c = '1.',
            Supplier_Cost_Input_Currency__c = 'USD',
            Supplier_Cost_Input_Value__c = 250,
            Supplier_Cost_USD_HKD_Rate__c = 7.84,
            Supplier_Cost_FX_Settings_Revision__c = 1,
            Cancelled__c = false
        );
        ContextManager.skipTriggers = true;
        try {
            update new STEM_Extra_Cost__c(Id = generatedAgency.Id, Cancelled__c = true);
            update new STEM_Extra_Cost__c(
                Id = portClearance.Id,
                Unit_Cost__c = 7.40,
                Unit_Price__c = 0,
                Supplier_Cost_USD_HKD_Rate__c = 7.84,
                Supplier_Cost_FX_Settings_Revision__c = 1
            );
            insert manualAgency;
        } finally {
            ContextManager.skipTriggers = false;
        }

        Test.startTest();
        VariableChargeInvoiceReadinessService.assertHongKongBundleConfirmationReady(
            basic.STEM__c,
            basic.Supplier__c,
            new Set<String>{'cost', 'buyer_charge'}
        );
        ContextManager.skipTriggers = true;
        try {
            update new STEM_Extra_Cost__c(Id = manualAgency.Id, Lumpsum_Price__c = 1);
        } finally {
            ContextManager.skipTriggers = false;
        }
        Boolean blocked = false;
        try {
            VariableChargeInvoiceReadinessService.assertHongKongBundleConfirmationReady(
                basic.STEM__c,
                basic.Supplier__c,
                new Set<String>{'buyer_charge'}
            );
        } catch (Exception ex) {
            blocked = ex.getMessage().contains('included in Basic Calling Cost');
        }
        Test.stopTest();
        System.assertEquals(true, blocked, 'A manual Agency Fee must retain the bundle buyer-zero rule.');
    }

    @IsTest
    static void leavingHongKongCancelsOnlyUnissuedManagedRows() {
        STEM_Extra_Cost__c basic = [
            SELECT Id, STEM__c FROM STEM_Extra_Cost__c
            WHERE Product2Id__r.Name = :HongKongBasicCallingBundleService.BASIC_CALLING_COST LIMIT 1
        ];
        Port__c singapore = TestDataFactory.createTestPort('SINGAPORE', 'SINGAPORE', true);
        ContextManager.skipTriggers = true;
        update new STEM__c(Id = basic.STEM__c, Port__c = singapore.Id);
        ContextManager.skipTriggers = false;
        Test.startTest();
        HongKongBasicCallingBundleService.synchronizeStemIds(new Set<Id>{basic.STEM__c});
        Test.stopTest();
        for (STEM_Extra_Cost__c row : managedRows()) System.assertEquals(true, row.Cancelled__c);
    }

    @IsTest
    static void laterAccountFeeFillsOnlyBlankUnissuedAgencyRow() {
        STEM_Line_Item__c line = [SELECT Original_Supplier__c FROM STEM_Line_Item__c LIMIT 1];
        STEM_Extra_Cost__c agency = [
            SELECT Id, Lumpsum_Cost__c, Line_Total_Buy__c
            FROM STEM_Extra_Cost__c
            WHERE Hong_Kong_Bundle_Managed__c = true AND Product2Id__r.Name = 'AGENCY FEE' LIMIT 1
        ];
        ContextManager.skipTriggers = true;
        try {
            agency.Lumpsum_Cost__c = null;
            agency.Line_Total_Buy__c = 0;
            update agency;
        } finally {
            ContextManager.skipTriggers = false;
        }
        agency = [
            SELECT Id, Lumpsum_Cost__c FROM STEM_Extra_Cost__c
            WHERE Hong_Kong_Bundle_Managed__c = true AND Product2Id__r.Name = 'AGENCY FEE' LIMIT 1
        ];
        System.assertEquals(null, agency.Lumpsum_Cost__c);

        Test.startTest();
        Account before = new Account(Id = line.Original_Supplier__c, Agency_Fee_USD__c = null);
        Account after = new Account(Id = line.Original_Supplier__c, Agency_Fee_USD__c = 325);
        HongKongBasicCallingBundleService.afterAccountChange(
            new Map<Id, Account>{after.Id => after},
            new Map<Id, Account>{before.Id => before}
        );
        Test.stopTest();
        agency = [SELECT Lumpsum_Cost__c, Supplier_Cost_Input_Currency__c, Supplier_Cost_Input_Value__c FROM STEM_Extra_Cost__c WHERE Id = :agency.Id];
        System.assertEquals(Decimal.valueOf('325'), agency.Lumpsum_Cost__c);
        System.assertEquals('USD', agency.Supplier_Cost_Input_Currency__c);
        System.assertEquals(Decimal.valueOf('325'), agency.Supplier_Cost_Input_Value__c);
    }

    @IsTest
    static void hkdAccountFeeRetainsNativeEvidenceForGovernedConversion() {
        STEM_Line_Item__c line = [SELECT Original_Supplier__c FROM STEM_Line_Item__c LIMIT 1];
        STEM_Extra_Cost__c agency = [
            SELECT Id, Lumpsum_Cost__c, Line_Total_Buy__c
            FROM STEM_Extra_Cost__c
            WHERE Hong_Kong_Bundle_Managed__c = true AND Product2Id__r.Name = 'AGENCY FEE' LIMIT 1
        ];

        Test.startTest();
        Account before = new Account(
            Id = line.Original_Supplier__c,
            Agency_Fee_USD__c = 250,
            Agency_Fee_Currency__c = 'USD'
        );
        Account after = new Account(
            Id = line.Original_Supplier__c,
            Agency_Fee_USD__c = 1950,
            Agency_Fee_Currency__c = 'HKD'
        );
        HongKongBasicCallingBundleService.afterAccountChange(
            new Map<Id, Account>{after.Id => after},
            new Map<Id, Account>{before.Id => before}
        );
        Test.stopTest();

        agency = [
            SELECT Lumpsum_Cost__c, Line_Total_Buy__c, Supplier_Cost_Input_Currency__c,
                Supplier_Cost_Input_Value__c, Supplier_Cost_USD_HKD_Rate__c
            FROM STEM_Extra_Cost__c WHERE Id = :agency.Id
        ];
        System.assertEquals(null, agency.Lumpsum_Cost__c);
        System.assertEquals(Decimal.valueOf('0'), agency.Line_Total_Buy__c);
        System.assertEquals('HKD', agency.Supplier_Cost_Input_Currency__c);
        System.assertEquals(Decimal.valueOf('1950'), agency.Supplier_Cost_Input_Value__c);
        System.assertEquals(null, agency.Supplier_Cost_USD_HKD_Rate__c);
    }

    @IsTest
    static void ordinaryBasicCostUpdateKeepsBundleSynchronized() {
        STEM_Extra_Cost__c basic = [
            SELECT Id, Description__c FROM STEM_Extra_Cost__c
            WHERE Product2Id__r.Name = :HongKongBasicCallingBundleService.BASIC_CALLING_COST LIMIT 1
        ];
        Test.startTest();
        basic.Description__c = 'Reviewed basic calling cost';
        update basic;
        Test.stopTest();
        System.assertEquals(4, managedRows().size());
    }
}
