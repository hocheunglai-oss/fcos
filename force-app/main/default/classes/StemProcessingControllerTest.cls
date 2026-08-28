@IsTest
private class StemProcessingControllerTest {

	@TestSetup
	static void makeData() {
		TestDataFactory.prepareDataForNominationConfirmationFlow();
	}

	@IsTest
	static void getSupplierInvoicesForStemTest() {
        Test.startTest();
        STEM__c stem = [SELECT Id FROM STEM__c LIMIT 1];
        Account testBuyer = [SELECT Id FROM Account WHERE RecordTypeId = :FCBStatic.BUYER_ACCOUNT_RT_ID];
		Account testSupplier = [SELECT Id FROM Account WHERE RecordTypeId = :FCBStatic.SUPPLIER_ACCOUNT_RT_ID];
        TestDataFactory.createTestSupplierInvoice('Test invoice', stem.Id, testSupplier.Id, testBuyer.Id, 1000, Date.today(), 'Not Provided', '2 P', true);
		List<Supplier_Invoice__c> supplierInvoices = StemProcessingController.getSupplierInvoicesForStem(stem.Id);
		System.assertEquals(1, supplierInvoices.size());
        supplierInvoices = StemProcessingController.getSupplierInvoicesOptions(stem.Id);
        System.assertEquals(1, supplierInvoices.size());
		Test.stopTest();
	}
    
    @isTest
    static void testGetStemBuyerBrokers(){
        Test.startTest();
    	STEM__c stem = [SELECT Id FROM STEM__c LIMIT 1];
        Account testBroker = TestDataFactory.createTestAccount('TestBroker', 'BROKER', true);
        List<STEM_Line_Item__c> stemLineItems = [SELECT Id, Supplier_Broker__c, Original_Supplier__c, Suppliers_Brokers_Commission_Per_Unit__c FROM STEM_Line_Item__c];
        STEM_Extra_Cost__c stemExtraCost = TestDataFactory.createTestStemExtraCost(stem.Id, null, 20.00, 20.00, 20.00, null, null, 10, 'STEM Charge', false);
        stemExtraCost.Supplier__c = stemLineItems[0].Original_Supplier__c;
        stemExtraCost.Payment_Term__c = '30 I';
        insert stemExtraCost;
        STEM_Buyer_Broker__c stemBuyerBroker = new STEM_Buyer_Broker__c(STEM__c = stem.Id, Buyer_Broker__c = testBroker.Id);
        insert stemBuyerBroker;
        STEM_Line_Item_Buyer_Broker__c stemLineItemBuyerBroker = new STEM_Line_Item_Buyer_Broker__c(STEM_Line_Item__c = stemLineItems[0].Id, STEM_Buyer_Broker__c = stemBuyerBroker.Id,
                                                                                                    Commission__c = 1);
        insert stemLineItemBuyerBroker;
        System.assertEquals(1, StemProcessingController.getStemBuyerBrokers(stem.Id).size());
        System.assertEquals(1, StemProcessingController.getStemLineItemBuyerBrokers(stemLineItems[0].Id).size());
        system.assertEquals(3, StemProcessingController.getAllStemsAccounts(stem.Id).size());
        Test.stopTest();
    }
    
    @isTest
    static void testUpdateExistingPaymentTerms(){
        Test.startTest();
    	STEM__c stem = [SELECT Id FROM STEM__c LIMIT 1];
        List<STEM_Line_Item__c> stemLineItems = [SELECT Id, Original_Supplier__c, BDN_Company__c, Payment_Term__c FROM STEM_Line_Item__c];
        for (STEM_Line_Item__c stemLineItem : stemLineItems) {
            stemLineItem.BDN_Company__c = 'TEST';
            stemLineItem.Payment_Term__c = '30 I';
        }
        update stemLineItems;
        STEM_Extra_Cost__c stemExtraCost = TestDataFactory.createTestStemExtraCost(stem.Id, null, 20.00, 20.00, 20.00, null, null, 10, 'STEM Charge', false);
        stemExtraCost.Supplier__c = stemLineItems[0].Original_Supplier__c;
        stemExtraCost.Payment_Term__c = '30 I';
        insert stemExtraCost;
        StemProcessingController.updateExistingPaymentTerms(stem.Id, stemLineItems[0].Original_Supplier__c, 'TEST', '30 I');
        Test.stopTest();
    }
    
    @IsTest
	static void testCalculateCommissionPaidAmount() {
        Test.startTest();
        STEM__c stem = [SELECT Id FROM STEM__c LIMIT 1];
        Account testBroker = TestDataFactory.createTestAccount('TestBroker', 'BROKER', true);
        List<STEM_Line_Item__c> stemLineItems = [SELECT Id, Supplier_Broker__c, Suppliers_Brokers_Commission_Per_Unit__c FROM STEM_Line_Item__c];
        stemLineItems[0].Supplier_Broker__c = testBroker.Id;
        stemLineItems[0].Suppliers_Brokers_Commission_Per_Unit__c = 1;
		update stemLineItems;
        Commission_Invoice__c commInvoice = new Commission_Invoice__c(STEM__c = stem.Id, Broker__c = testBroker.Id, Invoice_Amount__c = 100);
        insert commInvoice;
        system.assertEquals(1, StemProcessingController.getCommissionInvoiceTemplates(stem.Id).size());
		System.assertEquals(1, StemProcessingController.getCommissionInvoices(stem.Id).size());
		Test.stopTest();
	}

    @IsTest
    static void testCommissionTemplatesExposeCommissionVisibilitySeparately() {
        STEM__c stem = [SELECT Id FROM STEM__c LIMIT 1];
        Account testBroker = TestDataFactory.createTestAccount('Hidden Trading Broker', 'BROKER', true);
        testBroker.Hidden_Broker__c = true;
        testBroker.Hidden_Broker_Company__c = true;
        testBroker.Hidden_Commission__c = false;
        update testBroker;

        STEM_Line_Item__c stemLineItem = [
            SELECT Id, Supplier_Broker__c
            FROM STEM_Line_Item__c
            WHERE STEM__c = :stem.Id
            LIMIT 1
        ];
        stemLineItem.Supplier_Broker__c = testBroker.Id;
        update stemLineItem;

        Test.startTest();
        STEM_Line_Item__c template = StemProcessingController.getCommissionInvoiceTemplates(stem.Id)[0];
        Test.stopTest();

        System.assertEquals(true, template.Supplier_Broker__r.Hidden_Broker__c);
        System.assertEquals(true, template.Supplier_Broker__r.Hidden_Broker_Company__c);
        System.assertEquals(false, template.Supplier_Broker__r.Hidden_Commission__c);
    }
    
    @IsTest
	static void getEarliestSupplierDeliveryDateTest() {
        Test.startTest();
        STEM__c stem = [SELECT Id FROM STEM__c LIMIT 1];
        Account testBuyer = [SELECT Id FROM Account WHERE RecordTypeId = :FCBStatic.BUYER_ACCOUNT_RT_ID];
		Account testSupplier = [SELECT Id FROM Account WHERE RecordTypeId = :FCBStatic.SUPPLIER_ACCOUNT_RT_ID];
        TestDataFactory.createTestSupplierInvoice('Test invoice', stem.Id, testSupplier.Id, testBuyer.Id, 1000, Date.today(), 'Not Provided', '2 P', true);
        TestDataFactory.createTestSupplierInvoice('Test invoice 2', stem.Id, testSupplier.Id, testBuyer.Id, 1000, Date.today().addDays(1), 'Not Provided', '2 P', true);
		List<Supplier_Invoice__c> supplierInvoices = StemProcessingController.getEarliestSupplierDeliveryDate(stem.Id);
		System.assertEquals(Date.today(), supplierInvoices[0].Supplier_Delivery_Date__c);
		Test.stopTest();
	}
    
    @IsTest
	static void getBDNCompanyTest() {
        Test.startTest();
        STEM__c stem = [SELECT Id FROM STEM__c LIMIT 1];
        List<STEM_Line_Item__c> stemLineItems = [SELECT Id, BDN_Company__c FROM STEM_Line_Item__c WHERE STEM__c =: stem.Id];
        for (STEM_Line_Item__c stemLineItem : stemLineItems) {
            stemLineItem.BDN_Company__c = 'TEST';
        }
        update stemLineItems;
        System.assertEquals('TEST', StemProcessingController.getBDNCompany(stem.Id)[0].BDN_Company__c);
		Test.stopTest();
	}
    
    @isTest
    static void testGetDefaultSupplierPaymentTerm(){
        Test.startTest();
        STEM__c stem = [SELECT Id FROM STEM__c LIMIT 1];
		STEM_Line_Item__c stemLineItem = [SELECT Id, Original_Supplier__c FROM STEM_Line_Item__c where STEM__c = :stem.Id];
        String stemLineItemPaymentTerm = StemProcessingController.getDefaultSupplierPaymentTerm(stem.Id, stemLineItem.Original_Supplier__c);
		STEM_Extra_Cost__c stemExtraCost = TestDataFactory.createTestStemExtraCost(stem.Id, null, 20.00, 20.00, 20.00, null, null, 10, 'STEM Charge', false);
        stemExtraCost.Supplier__c = stemLineItem.Original_Supplier__c;
        stemExtraCost.Payment_Term__c = '30 I';
        insert stemExtraCost;
        delete stemLineItem;
        System.assertNotEquals(stemLineItemPaymentTerm, StemProcessingController.getDefaultSupplierPaymentTerm(stem.Id, stemExtraCost.Supplier__c));
        Test.stopTest();
    }
    
    @isTest
    static void testGetUnassignedPayments(){
        Test.startTest();
        Account testSupplier = [SELECT Id FROM Account WHERE RecordTypeId = :FCBStatic.SUPPLIER_ACCOUNT_RT_ID];
        List<Deposit__c> deposits = new List<Deposit__c>{new Deposit__c(Paid_Date__c = Date.today().addDays(-1), Paid_Amount__c = 10000, Account__c = testSupplier.Id),
            											new Deposit__c(Paid_Date__c = Date.today(), Paid_Amount__c = 100000, Account__c = testSupplier.Id)};
        insert deposits;
        STEM__c stem = [SELECT Id FROM STEM__c LIMIT 1];
		STEM_Line_Item__c stemLineItem = [SELECT Id, Payment_Term__c FROM STEM_Line_Item__c where STEM__c = :stem.Id ];
        stemLineItem.Payment_Term__c = 'Deposit';
        update stemLineItem;
        system.assertEquals(1, StemProcessingController.getUnassignedSupplierInvoicePayments(stem.Id).size());
        Test.stopTest();
    }
    
    @isTest
    static void testGetConsultations(){
        Test.startTest();
        STEM__c stem = [SELECT Id FROM STEM__c LIMIT 1];
		STEM_Line_Item__c stemLineItem = [SELECT Id, Original_Supplier__c FROM STEM_Line_Item__c where STEM__c = :stem.Id ];
        Consultation__c consultation = new Consultation__c(Fee__c = 100, STEM_Line_Item__c = stemLineItem.Id);
        insert consultation;
        List<Consultation__c> consultations = StemProcessingController.getConsultations(stemLineItem.Id);
        system.assertEquals(1, consultations.size());
        Test.stopTest();
    }
    
    @isTest
    static void testSendDisputeEmail(){
        Test.startTest();
        STEM__c stem = [SELECT Id FROM STEM__c LIMIT 1];
        Account testSupplier = [SELECT Id FROM Account WHERE RecordTypeId = :FCBStatic.SUPPLIER_ACCOUNT_RT_ID];
        Account testBuyer = [SELECT Id FROM Account WHERE RecordTypeId = :FCBStatic.BUYER_ACCOUNT_RT_ID];
        StemProcessingController.operateDisputes(stem.Id, testBuyer.Id, new List<String>{testSupplier.Id});
        List<String> disputeIds = new List<String>();
        List<Dispute__c> disputes = StemProcessingController.getDisputeData(stem.Id);
        for(Dispute__c dispute: disputes){
            dispute.Deduction_Amount_Supplier__c = 1000.7;
			disputeIds.add(dispute.Id);
        }
        update disputes;
        Integer countOfEmailInvocationsBefore = Limits.getEmailInvocations();
		StemProcessingController.sendDisputeEmail(stem.Id, disputeIds);
		System.assertNotEquals(countOfEmailInvocationsBefore, Limits.getEmailInvocations(), 'Should have decreased.');
        Test.stopTest();
    }

	@IsTest
	static void getSupplierInvoiceTemplatesTest() {
        Test.startTest();
        String stemChargeRecordTypeId = Schema.SObjectType.STEM_Extra_Cost__c.getRecordTypeInfosByName().get('STEM Charge').getRecordTypeId();
        String productChargeRecordTypeId = Schema.SObjectType.STEM_Extra_Cost__c.getRecordTypeInfosByName().get('Product Charge').getRecordTypeId();
        STEM__c stem = [SELECT Id FROM STEM__c LIMIT 1];
        Account testSupplier = [SELECT Id FROM Account WHERE RecordTypeId = :FCBStatic.SUPPLIER_ACCOUNT_RT_ID];
		STEM_Line_Item__c stemLineItem = [SELECT Id FROM STEM_Line_Item__c where STEM__c = :stem.Id ];
        List<STEM_Extra_Cost__c> stemExtraCosts = new List<STEM_Extra_Cost__c>{
           new STEM_Extra_Cost__c(RecordTypeId = stemChargeRecordTypeId, STEM__c = stem.id, Unit_Price__c = 100, Unit_Cost__c = 50, Quantity__c = 100, Quantity_Delivered_per_BDN__c = 100),
           new STEM_Extra_Cost__c(RecordTypeId = productChargeRecordTypeId, STEM__c = stem.id, STEM_Line_Item__c =stemLineItem.id, Unit_Price__c = 100, Unit_Cost__c = 50, Quantity__c = 100)
        };
        StemProcessingController.upsertStemExtraCosts(stemExtraCosts);
		List<StemProcessingController.SupplierInvoiceTemplate> supplierInvoiceTemplates = StemProcessingController.getSupplierInvoiceTemplates(stem.Id);
		System.assertEquals(3, supplierInvoiceTemplates.size());
        supplierInvoiceTemplates = StemProcessingController.getUncreatedSupplierInvoices(stem.Id);
		System.assertEquals(2, supplierInvoiceTemplates.size());
		Test.stopTest();
	}
    
    @isTest
    static void testGetExtraCostsBySupplier(){
        Test.startTest();
        STEM__c stem = [SELECT Id FROM STEM__c LIMIT 1];
		STEM_Line_Item__c stemLineItem = [SELECT Id, Original_Supplier__c FROM STEM_Line_Item__c where STEM__c = :stem.Id ];
		STEM_Extra_Cost__c stemExtraCost = TestDataFactory.createTestStemExtraCost(stem.Id, stemLineItem.Id, 20.00, 20.00, 20.00, null, null, 10, 'STEM Charge', false);
        stemExtraCost.Supplier__c = stemLineItem.Original_Supplier__c;
        insert stemExtraCost;
        List<STEM_Extra_Cost__c> stemExtraCosts = StemProcessingController.getExtraCostsBySupplier(stem.Id ,stemLineItem.Original_Supplier__c);
        System.assertEquals(1, stemExtraCosts.size());
        Test.stopTest();
    }

	@IsTest
	static void getExtraCostTest() {
        Test.startTest();
		STEM__c stem = [SELECT Id FROM STEM__c LIMIT 1];
		STEM_Line_Item__c stemLineItem = [SELECT Id FROM STEM_Line_Item__c where STEM__c = :stem.Id ];
		TestDataFactory.createTestStemExtraCost(stem.Id, null, 20.00, 20.00, 20.00, 20.00, 20.00, 10, 'STEM Charge', true);
		List<STEM_Extra_Cost__c> stemExtraCosts = StemProcessingController.getExtraCost(stem.Id ,stemLineItem.Id);
		System.assertEquals(0, stemExtraCosts.size());
		List<STEM_Extra_Cost__c> stemExtraCostsWithoutStemLineItems = StemProcessingController.getExtraCost(stem.Id ,null);
		System.assertEquals(1, stemExtraCostsWithoutStemLineItems.size());
		Test.stopTest();
	}

	@IsTest
	static void testInsetExtraCostTest() {
        Test.startTest();
		STEM__c stem = [SELECT Id FROM STEM__c LIMIT 1];
		STEM_Line_Item__c stemLineItem = [SELECT Id FROM STEM_Line_Item__c where STEM__c = :stem.Id ];
		STEM_Extra_Cost__c stemExtraCost = new STEM_Extra_Cost__c(STEM__c =stem.id ,STEM_Line_Item__c =stemLineItem.id , Unit_Price__c =100, Unit_Cost__c = 50, Quantity__c = 100);
        TestDataFactory.createTestStemExtraCost(stem.Id, null, 20.00, 20.00, 20.00, 20.00, 20.00, 10, 'STEM Charge', true);
		List<STEM_Extra_Cost__c> stemExtraCostList = new List<STEM_Extra_Cost__c>();
		stemExtraCostList.add(stemExtraCost);
        
		StemProcessingController.insertStemExtraCosts(stemExtraCostList);
		List<STEM_Extra_Cost__c> insertedExtraCosts = [SELECT Id, Unit_Price__c from STEM_Extra_Cost__c WHERE STEM_Line_Item__c = :stemLineItem.Id LIMIT 1];
		System.assertEquals(1,insertedExtraCosts.size());
        Test.stopTest();
	}
    
    
    @isTest
    static void testUpdateStemExtraCosts(){
        Test.startTest();
        Account testSupplier = [SELECT Id FROM Account WHERE RecordTypeId = :FCBStatic.SUPPLIER_ACCOUNT_RT_ID];
        STEM__c stem = [SELECT Id FROM STEM__c LIMIT 1];
		STEM_Line_Item__c stemLineItem = [SELECT Id, STEM__c, Subtotal_Sell_At__c
                                          FROM STEM_Line_Item__c where STEM__c = :stem.Id];
		STEM_Extra_Cost__c stemExtraCost = new STEM_Extra_Cost__c(STEM__c = stem.id ,STEM_Line_Item__c =stemLineItem.id, Supplier__c = testSupplier.Id, Unit_Price__c =100, Quantity__c = 10.00, Quantity_Delivered_Per_BDN__c = 10.00, Unit_Cost__c = 50, Payment_Term__c = '2 I');
        insert stemExtraCost;
        stemExtraCost.Unit_Price__c = 10;
        StemProcessingController.updateAllStemExtraCosts(new List<STEM_Extra_Cost__c>{stemExtraCost});
        Test.stopTest();
    }

    
    @isTest
    static void testGetProductInfo(){
        Test.startTest();
        STEM__c stem = [SELECT Id FROM STEM__c LIMIT 1];
		STEM_Line_Item__c stemLineItem = [SELECT Id FROM STEM_Line_Item__c where STEM__c = :stem.Id ];
		STEM_Extra_Cost__c stemExtraCost = new STEM_Extra_Cost__c(STEM__c =stem.id ,STEM_Line_Item__c =stemLineItem.id , Unit_Price__c = 100, Unit_Cost__c = 50, Quantity__c = 100);
        insert stemExtraCost;
        List<StemProcessingController.ProductInfo> productInfo = StemProcessingController.getProductInfo(stem.Id);
        system.assertEquals(2, productInfo.size());
        Test.stopTest();
    }
    
    @isTest
    static void testGetInvoices(){
        Test.startTest();
        STEM__c stem = [SELECT Id FROM STEM__c LIMIT 1];
		STEM_Line_Item__c stemLineItem = [SELECT Id FROM STEM_Line_Item__c WHERE STEM__c = :stem.Id ];
		STEM_Extra_Cost__c stemExtraCost = new STEM_Extra_Cost__c(STEM__c =stem.id ,STEM_Line_Item__c =stemLineItem.id, Unit_Price__c = 100, Unit_Cost__c = 50, Quantity__c = 100);
        insert stemExtraCost;
        List<String> extraIds = new List<String>{stemLineItem.Id, stemExtraCost.Id};
        Invoice__c invoice = InvoiceController.createInvoice(stem.Id, extraIds, false, false, Date.today(), Date.today(), Date.today());
        InvoiceController.generateInvoicePdf(invoice.Id, invoice.Name, extraIds, 'TestString', false);
        system.assertEquals(1, StemProcessingController.getInvoices(stem.Id).size());
        Test.stopTest();
    }
    
    @isTest
    static void testOperateDisputes(){
        Test.startTest();
        STEM__c stem = [SELECT Id FROM STEM__c LIMIT 1];
        Account testSupplier = [SELECT Id FROM Account WHERE RecordTypeId = :FCBStatic.SUPPLIER_ACCOUNT_RT_ID];
        Account testBuyer = [SELECT Id FROM Account WHERE RecordTypeId = :FCBStatic.BUYER_ACCOUNT_RT_ID];
        StemProcessingController.operateDisputes(stem.Id, null, new List<String>{testSupplier.Id});
        system.assertEquals(1, StemProcessingController.getDisputeData(stem.Id).size());
        StemProcessingController.operateDisputes(stem.Id, testBuyer.Id, new List<String>{testSupplier.Id});
        system.assertEquals(1, StemProcessingController.getDisputeData(stem.Id).size());
        StemProcessingController.operateDisputes(stem.Id, testBuyer.Id, new List<String>());
        system.assertEquals(1, StemProcessingController.getDisputeData(stem.Id).size());
        Test.stopTest();
    }
    
    @isTest
    static void testGetStemPayments(){
        Test.startTest();
        STEM__c stem = [SELECT Id, Account__c FROM STEM__c LIMIT 1];
        Payment__c payment = new Payment__c(STEM__c = stem.Id, Account__c = stem.Account__c, RecordTypeId = Schema.SObjectType.Payment__c.getRecordTypeInfosByName().get('Receivable').getRecordTypeId(),
                                            Amount__c = 10, Date__c = Date.newInstance(2022, 01, 01));
        insert payment;
        STEM__c stemPayments = StemProcessingController.getStemPayments(stem.Id);
        System.assertEquals(1, stemPayments.Payments__r.size());
        Test.stopTest();
    }
    
    @isTest
    static void testGetStemLineItemsAndExtraCosts(){
        Test.startTest();
        String stemChargeRecordTypeId = Schema.SObjectType.STEM_Extra_Cost__c.getRecordTypeInfosByName().get('STEM Charge').getRecordTypeId();
        String productChargeRecordTypeId = Schema.SObjectType.STEM_Extra_Cost__c.getRecordTypeInfosByName().get('Product Charge').getRecordTypeId();
        STEM__c stem = [SELECT Id FROM STEM__c LIMIT 1];
		STEM_Line_Item__c stemLineItem = [SELECT Id FROM STEM_Line_Item__c where STEM__c = :stem.Id ];
        List<STEM_Extra_Cost__c> stemExtraCosts = new List<STEM_Extra_Cost__c>{
           new STEM_Extra_Cost__c(RecordTypeId = stemChargeRecordTypeId, STEM__c = stem.id, Unit_Price__c = 100, Unit_Cost__c = 50, Quantity__c = 100, Quantity_Delivered_per_BDN__c = 100),
           new STEM_Extra_Cost__c(RecordTypeId = productChargeRecordTypeId, STEM__c = stem.id, STEM_Line_Item__c =stemLineItem.id, Unit_Price__c = 100, Unit_Cost__c = 50, Quantity__c = 100)
        };
        StemProcessingController.upsertStemExtraCosts(stemExtraCosts);
        Consultation__c consultation = new Consultation__c(Fee__c = 100, STEM_Line_Item__c = stemLineItem.Id);
        insert consultation;
        List<StemProcessingController.ProductInfo> productInfo = StemProcessingController.getStemLineItemsAndExtraCosts(stem.Id);
        system.assertEquals(5, productInfo.size());
        Test.stopTest();
    }
    
    @isTest
    static void testGetLastInvoiceForm(){
        Test.startTest();
        STEM__c stem = [SELECT Id FROM STEM__c LIMIT 1];
        Last_Invoice_Form__c lastInvoiceForm = new Last_Invoice_Form__c(STEM__c = stem.Id, Info_Text__c = 'TEST');
        insert lastInvoiceForm;
       	system.assertEquals('TEST', StemProcessingController.getLastInvoiceForm(stem.Id).Info_Text__c);
        Test.stopTest();
    }
    
    @isTest
    static void testUpdateExtraCostExportedField(){
        Test.startTest();
        String stemChargeRecordTypeId = Schema.SObjectType.STEM_Extra_Cost__c.getRecordTypeInfosByName().get('STEM Charge').getRecordTypeId();
        String productChargeRecordTypeId = Schema.SObjectType.STEM_Extra_Cost__c.getRecordTypeInfosByName().get('Product Charge').getRecordTypeId();
        STEM__c stem = [SELECT Id FROM STEM__c LIMIT 1];
		STEM_Line_Item__c stemLineItem = [SELECT Id, Is_Purchase_CSV_Exported__c FROM STEM_Line_Item__c where STEM__c = :stem.Id];
        stemLineItem.Is_Purchase_CSV_Exported__c = true;
        update stemLineItem;
        List<STEM_Extra_Cost__c> stemExtraCosts = new List<STEM_Extra_Cost__c>{
           new STEM_Extra_Cost__c(RecordTypeId = stemChargeRecordTypeId, STEM__c = stem.id, Unit_Price__c = 100, Unit_Cost__c = 50, Quantity__c = 100, Quantity_Delivered_per_BDN__c = 100, Is_Purchase_CSV_Exported__c = true),
           new STEM_Extra_Cost__c(RecordTypeId = productChargeRecordTypeId, STEM__c = stem.id, STEM_Line_Item__c =stemLineItem.id, Unit_Price__c = 100, Unit_Cost__c = 50, Quantity__c = 100, Is_Purchase_CSV_Exported__c = true)
        };
        insert stemExtraCosts;
        List<String> recordIds = new List<String>{stemLineItem.Id};
        for(STEM_Extra_Cost__c stemExtraCost: stemExtraCosts){
        	recordIds.add(stemExtraCost.Id);
        }
        StemProcessingController.updateExtraCostExportedField(recordIds, stem.Id);
        Test.stopTest();
    }
}
