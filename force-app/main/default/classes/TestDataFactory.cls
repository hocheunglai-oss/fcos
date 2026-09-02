@isTest
public  with sharing class TestDataFactory {
    public static Account createTestAccount(String name, String typeOfaccount, Boolean insertAccount) {
        Account a = new Account();
        a.Name = name;
        a.Inactive_Suspended__c = false;

        switch on typeOfaccount{
            when 'BUYER' {
                a.RecordTypeId = FCBStatic.BUYER_ACCOUNT_RT_ID;
            }
            when 'SUPPLIER' {
                a.RecordTypeId =  FCBStatic.SUPPLIER_ACCOUNT_RT_ID;
            }

            when 'BROKER' {
                a.RecordTypeId =  FCBStatic.BROKER_ACCOUNT_RT_ID;
            }
            when 'GROUP' {
                a.RecordTypeId =  FCBStatic.GROUP_ACCOUNT_RT_ID;
            }
        }
        if (insertAccount) {
            insert a;
        }

        return a;
    }
    
    public static Office__c createTestOffice(String accountId, String defaultContactId, Boolean insertOffice) {
        Office__c office = new Office__c(Account__c = accountId, Default_Contact__c = defaultContactId);
        if (insertOffice) {
            insert office;
        }
        return office;
    }

    
    public static Vessel__c createTestVessel(String name, String imo, String accountId, Boolean insertVessel) {
        Vessel__c v = new Vessel__c();
        v.Name = name;
        v.Account__c = accountId;
        v.IMO__c = imo;
        if (insertVessel) {
            insert v;
        }
        return v;
    }

    /*
     *
     */
    public static Port__c createTestPort(String area, String country, Boolean insertPort) {
        Port__c p = new Port__c(Name = area , Port_Area__c = area, Country__c = country);
        if (insertPort) {
            insert p;
        }
        return p;
    }

    /*
     *
     */
    public static Port_Supplier__c createTestPortSupplier(String portId,
                                                          String supplierAccountId,
                                                          Boolean insertSupplier) {
        Port_Supplier__c ps = new Port_Supplier__c(Port__c = portId, Supplier__c = supplierAccountId);
        if (insertSupplier) {
            insert ps;
        }
        return ps;
    }

    /*
     * Temporary until deployment passes
     */
    public static Opportunity createTestEnquiry(String enquiryName,
                                                String buyerAccountId,
                                                String vesselId,
                                                String stageName,
                                                Date closeDate,
                                                Boolean insertEnquiry,
                                                Time myTime) {
        Opportunity o = new Opportunity(
                Name = enquiryName,
                CloseDate = closeDate,
                Vessel__c = vesselId,
                AccountId = buyerAccountId,
                StageName = stageName,
                Time__c = myTime,
                Unit_of_Measure__c = 'MT',
                Estimated_Value__c = 1000000.0
        );
        if (insertEnquiry) {
            insert o;
        }
        return o;
    }


    /*
     * [8.10.20] Add Estimated Value
     */
    public static Opportunity createTestEnquiry(String enquiryName,
                                                String buyerAccountId,
                                                String vesselId,
                                                String stageName,
                                                Date closeDate,
                                                Boolean insertEnquiry,
                                                Time myTime,
                                                Decimal estimatedValue) {
        Opportunity o = new Opportunity(
                Name = enquiryName,
                CloseDate = closeDate,
                Vessel__c = vesselId,
                AccountId = buyerAccountId,
                StageName = stageName,
                Time__c = myTime,
                Unit_of_Measure__c = 'MT',
                Estimated_Value__c = estimatedValue
        );
        if (insertEnquiry) {
            insert o;
        }
        return o;
    }

    public static Preferred_Supplier__c createPreferredSupplier(String buyerAccountId,
                                                                String sypplierAccountId,
                                                                String port,
                                                                Boolean preferredSupplier) {

        Preferred_Supplier__c preferred_supplier = new Preferred_Supplier__c(
                Buyer__c = buyerAccountId,
                Supplier__c = sypplierAccountId,
                Port__c = port
        );
        if (preferredSupplier) {
            insert preferred_supplier;
        }
        return preferred_supplier;
    }


    /*
     *
     */
    public static OpportunityLineItem createTestEnquiryLineItem(String opportunityId,
                                                                Decimal price,
                                                                String portId,
                                                                String productId,
                                                                Integer quantity,
                                                                Boolean isQuantityRange,
                                                                String etaEtb,
                                                                DateTime etaStart,
                                                                DateTime etaEnd,
                                                                Boolean insertOli) {
        OpportunityLineItem enquiryLineItem = new OpportunityLineItem(
                OpportunityId = opportunityId,
                TotalPrice = price,
                Port__c = portId,
                Quantity = quantity,
                ETA_ETB__c = etaEtb,
                Product2Id = productId,
                IsQuantityRange__c = isQuantityRange,
                Unit_of_Measure__c = 'MT'
        );

         if (enquiryLineItem.ETA_ETB__c == 'ETA') {
            enquiryLineItem.ETA_Start_Date__c = etaStart.date();
            enquiryLineItem.ETA_End_Date__c = etaEnd.date();
        } else if (enquiryLineItem.ETA_ETB__c == 'ETB'){
            enquiryLineItem.ETB_Start_Date__c = etaStart.date();
            enquiryLineItem.ETB_End_Date__c = etaEnd.date();
        }

        if (insertOli) {
            insert enquiryLineItem;
        }

        return enquiryLineItem;
    }

    public static Pricebook2 insertPricebook(String name, Boolean insertPricebook){
        Pricebook2 customPB = new Pricebook2(Name=name, isActive=true);
        if(insertPricebook){
        	insert customPB;
        }
        return customPB;
    }
    
    public static Product2 insertTestProduct(String name, String pricebookId, String typeOfProduct, Boolean insertProduct) {  
		Product2 prod = new Product2(Name = name, isActive = true);
        
        switch on typeOfProduct{
            when 'PETROLEUM'{
                prod.RecordTypeId = FCBStatic.PETROLEUM_RT_ID;
            }
            when 'NON-PETROLEUM'{
                prod.RecordTypeId = FCBStatic.NON_PETROLEUM_PRODUCT_RT_ID;
            }
            when 'ADJUSTMENT'{
                prod.RecordTypeId = FCBStatic.ACCOUNTING_ADJUSTMENT_RT_ID;
            }
        }
        
        
        insert prod;
        return prod;
    }
    
    public static Payment_Term__c createTestPaymentTerm(String name, String recordTypeName, Boolean insertPaymentTerm){
        Id recordTypeId = Schema.SObjectType.Payment_Term__c.getRecordTypeInfosByName().get(recordTypeName).getRecordTypeId();
        Payment_Term__c paymentTerm = new Payment_Term__c(Name = name, RecordTypeId = recordTypeId);
        if(insertPaymentTerm){
            insert paymentTerm;
        }
        return paymentTerm;
    }

    /*
     *
     */
    public static Quote createTestQuote(String name, String OpportunityId, String portId, Boolean insertQuote) {
        Quote q = new Quote(OpportunityId = opportunityId,
                Name = name,
                Port__c = portId
        );

        if (insertQuote) {
            insert q;
        }

        return q;

    }
    
    public static QuoteLineItem createTestQuoteLineItem(String quoteId,
                                                        String portId,
                                                        String productId,
                                                        Integer quantity,
                                                        Decimal unitPrice,
                                                        String supplierId,
                                                        Date expectedDeliveryDate,
                                                        String pricebookId,
                                                        String supplierPaymentTermId,
                                                        String buyerPaymentTermId,
                                                        Boolean winning,
                                                        Boolean insertRecord) {
        String priceBookEntryId = null;     
        try {
            priceBookEntryId = [SELECT Id FROM PricebookEntry WHERE Pricebook2Id =: pricebookId AND Product2Id = :productId].Id;
        } catch (Exception e) {
            priceBookEntryId = null;
        }                                                  
        QuoteLineItem qli = new QuoteLineItem(
                QuoteId = QuoteId,
                Port__c = portId,
                Quantity = quantity,
                Product2Id = productId,
            	Supplier_Unit_Price__c = unitPrice,
                UnitPrice = unitPrice,
                Supplier__c = supplierId,
                Expected_Delivery_Date__c = expectedDeliveryDate,
                Unit_of_Measure__c = 'MT',
                PricebookEntryId = priceBookEntryId,
            	Supplier_Payment_Term__c = supplierPaymentTermId,
            	Buyer_Payment_Term__c = buyerPaymentTermId,
            	Winning__c = winning
        );

        if (insertRecord) {
            insert qli;
        }

        return qli;
    }

    /**
     * This method should be updated to Support creating Supplier Bids 
     * by Enquiry Id but don't have time [jB]
     */
    public static Supplier_Bid__c createTestSupplierBid(String quoteId,
                                                        String portId,
                                                        String productId,
                                                        String supplierId,
                                                        Integer quantity,
                                                        Decimal supplierUnitPrice,
                                                        Datetime expirationDate,
                                                        Boolean RFP_Sent,
                                                        String SupplierConstraint,
                                                        Decimal supplier_Broker_Commission,
                                                        Boolean insertRecord) {
        Supplier_Bid__c sb = new Supplier_Bid__c(
                Quote__c = quoteId,
                Port__c = portId,
                Product__c = productId,
                Quantity__c = quantity,
                Supplier_Unit_Price__c = supplierUnitPrice,
//                Expiration_Date__c = expirationDate,
                RFP_Sent__c = RFP_Sent,

                Supplier_Constraints__c = SupplierConstraint,
                Supplier_Broker_Commission__c = supplier_Broker_Commission,
                Supplier__c = supplierId);


        if (insertRecord) {
            insert sb;
        }
        return sb;
    }


    public static Task createTestTask(String subject,
                                      String whatId,
                                      String description,
                                      String ownerId,
                                      Boolean insertRecord) {
        Task task = new Task(
                Subject = subject,
                WhatId = whatId,
                Description = description,
                OwnerId = ownerId
        );
        if (insertRecord) {
            insert task;
        }
        return task;
    }

    /*
     *
     */
    public static Special_Term__c createTestSpecialTerm(String name, String termsText, Boolean insertRecord) {
        Special_Term__c st = new Special_Term__c(Name = name, Terms_Text__c = termsText);
        if (insertRecord) {
            insert st;
        }
        return st;
    }


    /*
     *
     */
    public static Special_Term_Rule__c createSpecialTermRule(String specialTermId,
                                                             String productId,
                                                             String portId,
                                                             String accountId,
                                                             String country,
                                                             String supplierBuyer,
                                                             Boolean insertRecord) {
        Special_Term_Rule__c str = new Special_Term_Rule__c(Special_Term__c = specialTermId,
                Product__c = productId, Port__c = portId, Account__c = accountId, Country__c = country,
                Supplier_Buyer__c = supplierBuyer);
        if (insertRecord) {
            insert str;
        }
        return str;
    }

    public static Enquiry_Special_Term__c createTestEnquirySpecialTerm(String enquiryId,
                                                                       String specialTermId,
                                                                       String reason,
                                                                       List<String> offerLineItemIds,
                                                                       Boolean insertRecord) {
        Enquiry_Special_Term__c enquirySpecialTerm = new Enquiry_Special_Term__c(Enquiry__c = enquiryId, 
                                                                                 Special_Term__c = specialTermId,
                                                                                 Reason__c = reason);
        
       	
        if (insertRecord) {
            insert enquirySpecialTerm;
        }
        
        List<Special_Terms_Link__c> specialTermsLinks = new List<Special_Terms_Link__c>();
        for(String offerLineItemId : offerLineItemIds){
        	specialTermsLinks.add(new Special_Terms_Link__c(Offer_Line_Item__c = offerLineItemId, Enquiry_Special_Term__c = enquirySpecialTerm.Id, Unique_Key__c = offerLineItemId + '' + enquirySpecialTerm.Id));
        } 
        insert specialTermsLinks;
		
        return enquirySpecialTerm;
    }
    

    /**
     * 
     */
    public static Nomination__c createTestNomination(String recordTypeId,
                                                 String accountId,
                                                 String enquiryId,
                                                 String offerLineItemId,
                                                 Date expectedDeliveryDate,
                                                 String portId,
                                                 Boolean insertNomination) {
        Nomination__c nom = new Nomination__c(
                Account__c = accountId,
                Enquiry__c = enquiryId,
                Offer_Line_Item__c = offerLineItemId,
                Expected_Delivery_Date__c = expectedDeliveryDate,
                Port__c = portId);


        switch on recordTypeId{
            when 'BUYER'{
                nom.RecordTypeId = FCBStatic.BUYER_NOMINATION_RT_ID;
            }
            when 'SUPPLIER'
                {
                    nom.RecordTypeId =  FCBStatic.SUPPLIER_NOMINATION_RT_ID;
                }
        }
        if (insertNomination) {
            insert nom;
        }
        return nom;
    }

    public static STEM__c createTestSTEM(String recordTypeId,
                                     String name,
                                     String accountId,
                                     String enquiryId,
                                     String quoteId,
                                     String portId,
                                     String vesselId,
                                     String status,
                                     String disputeStatus,    
                                     Decimal actualBalance,
                                     Decimal balance,
                                     Date deliveryDate,
                                     Date stemDate,
                                     String paymentTerm,
                                     Boolean insertSTEM
                                     ) {
        STEM__c stem = new STEM__c(
                Name = name,
                Account__c = accountId,
                Enquiry__c = enquiryId,
                Quote__c = quoteId,
                Port__c = portId,
                Vessel__c = vesselId,
                Invoice_Status__c = status,
            	Dispute_Status__c = disputeStatus,
                Actual_Balance__c = actualBalance,
                Balance__c = balance,
                Stem_Date__c = stemDate,
            	Payment_Term__c = paymentTerm,
                Delivery_Date__c = deliveryDate
        );


        switch on recordTypeId{
            when 'HISTORICAL'{
                stem.RecordTypeId = FCBStatic.HISTORICAL_STEM_RT_ID;
            }
            when 'ORIGINATED'{
                stem.RecordTypeId =  FCBStatic.ORIGINATED_STEM_RT_ID;
            }
        }

        if (insertSTEM) {
            insert stem;
        }
        return stem;
    }

    public static STEM_Line_Item__c createTestStemLineItem(String name,
                                                       String stemId,
                                                       String originalSupplier,
                                                       String productId,
                                                       Decimal quantity,
                                                       Decimal pricePerUnit,
                                                       Decimal costPerUnit,
                                                       Decimal quantityDeliveredPerBdn,
                                                       String paymentTerm,
                                                       Boolean insertStemLineItem) {

        STEM_Line_Item__c stemLineItem = new STEM_Line_Item__c(
                Name = name,
                STEM__c = stemId,
                Original_Supplier__c = originalSupplier,
                Product__c = productId,
                Quantity__c = quantity,
                Unit_Sell_At__c = pricePerUnit,
                Unit_Buy_At__c = costPerUnit,
                Quantity_Delivered_Per_BDN__c = quantityDeliveredPerBdn,
            	Payment_Term__c = paymentTerm
        );
        if (insertStemLineItem) {
            insert stemLineItem;
        }
        return stemLineItem;
    }

    public static Broker_Enquiry__c createTestBrokerEnquiry(String brokerId,
                                                        String enquiryId,
                                                        Boolean directInvoice,
                                                        Boolean insertBrokerEnquiry) {

        Broker_Enquiry__c brokerEnquiry = new Broker_Enquiry__c(
                Broker__c = brokerId,
                Enquiry__c = enquiryId,
                Direct_Invoice__c = directInvoice
        );
        if (insertBrokerEnquiry) {
            insert brokerEnquiry;
        }
        return brokerEnquiry;
    }

    public static STEM_Extra_Cost__c createTestStemExtraCost(String stemId,
                                                              String stemLineItemId,
                                                              Decimal quantity,
                                                              Decimal unitPrice,
                                                              Decimal unitCost,
                                                              Decimal lumpsumPrice,
                                                              Decimal lumpsumCost,
                                                              Decimal minimum,
                                                              String recordTypeName,
                                                              Boolean insertStemExtraCost) {

        STEM_Extra_Cost__c stemExtraCost = new STEM_Extra_Cost__c(
                STEM__c = stemId,
                STEM_Line_Item__c = stemLineItemId,
                Quantity__c = quantity,
            	Quantity_Delivered_Per_BDN__c = quantity,
                Unit_Price__c = unitPrice,
                Unit_Cost__c = unitCost,
                Lumpsum_Price__c = lumpsumPrice,
                Lumpsum_Cost__c = lumpsumCost,
                Minimum__c = minimum
        );
        if (recordTypeName == 'STEM Charge') {
            stemExtraCost.RecordTypeId = Schema.SObjectType.STEM_Extra_Cost__c.getRecordTypeInfosByName().get('STEM Charge').getRecordTypeId();
        } else {
            stemExtraCost.RecordTypeId = Schema.SObjectType.STEM_Extra_Cost__c.getRecordTypeInfosByName().get('Product Charge').getRecordTypeId();
        }
        if (insertStemExtraCost) {
            insert stemExtraCost;
        }
        return stemExtraCost;
    }


    public static Supplier_Invoice__c createTestSupplierInvoice(String invoiceName,
                                                                String stemId,
                                                                String expectedSupplier,
                                                                String Beneficiary,
                                                                Decimal invoiceAmount,
                                                                Date supplierDeliveryDate,
                                                                String bankDetails,
                                                                String paymentTerm,
                                                            	Boolean insertSupplierInvoice
                                                               ) {

        Supplier_Invoice__c supplierInvoice = new Supplier_Invoice__c(
                Name = invoiceName,
                STEM__c = stemId,
                Supplier__c = expectedSupplier,
                Beneficiary__c = Beneficiary,
                Invoice_Amount__c = invoiceAmount,
            	Payable_Balance__c = invoiceAmount,
            	Supplier_Delivery_Date__c = supplierDeliveryDate,
            	Bank_Details__c = bankDetails,
            	Payment_Term__c = paymentTerm
        );
        if (insertSupplierInvoice) {
            insert supplierInvoice;
        }
        return supplierInvoice;
    }

    public static Supplier_Bid_Extra_Cost__c createTestSupplierBidExtraCost(String quoteId,
                                                                            String productId,
                                                                            Decimal quantity,
                                                                            Boolean isQuantityRange,
                                                                            Decimal quantityMaximum,
                                                                            Decimal unitCost,
                                                                            Decimal minimum,
                                                                            Decimal lumpsumCost,
                                                                            Boolean isFixed,
                                                                            String unitOfMeasure,
                                                                            String supplierBidId,
                                                                            Date expectedDeliveryDate,
                                                                            String supplierId,
                                                                            String portId,
                                                                            Boolean insertStemLineItem) {

        Supplier_Bid_Extra_Cost__c supplierBidExtraCost = new Supplier_Bid_Extra_Cost__c(
                Quote__c = quoteId,
                Product__c = productId,
                Quantity__c = quantity,
                Is_Quantity_Range__c = isQuantityRange,
                Quantity_Range_Maximum__c = quantityMaximum,
                Unit_Cost__c = unitCost,
                Minimum__c = minimum,
                Lumpsum_Cost__c = lumpsumCost,
                Fixed__c = isFixed,
                Unit_of_Measure__c = unitOfMeasure,
                Supplier_Bid__c = supplierBidId,
                Expected_Delivery_Date__c = expectedDeliveryDate,
                Supplier__c = supplierId,
                Port__c = portId

        );
        if (insertStemLineItem) {
            insert supplierBidExtraCost;
        }
        return supplierBidExtraCost;
    }
    
    public static Market_Portfolio__c createTestMarketPortfolio(Date determinationDate, 
                                                                 String recordType,
                                                            	 Boolean insertMarketPortfolio
                                                               ) {
        Market_Portfolio__c marketPortfolio = new Market_Portfolio__c(
               Determination_Date__c =  determinationDate
        );
		switch on recordType{
            when 'GENERAL' {
                marketPortfolio.RecordTypeId = FCBStatic.GENERAL_PORTFOLIO_RT_ID;
            }
            when 'IDENTITY' {
                marketPortfolio.RecordTypeId =  FCBStatic.IDENTITY_PORTFOLIO_RT_ID;
            }
        }
        if (insertMarketPortfolio) {
            insert marketPortfolio;
        }
        return marketPortfolio;
    }
    
    public static Market_Portfolio_Item__c createTestMarketPortfolioItem(Id marketPortfolioId, 
                                                                 		 Id portId,
                                                                         String productFamily,
                                                                         Decimal price,
                                                            	 		 Boolean insertMarketPortfolioItem
                                                               ) {
        Market_Portfolio_Item__c marketPortfolioItem = new Market_Portfolio_Item__c(
        	Market_Portfolio__c =  marketPortfolioId,
            Port__c = portId,
            Product_Family__c = productFamily,
            Price__c = price
        );
        if (insertMarketPortfolioItem) {
            insert marketPortfolioItem;
        }
        return marketPortfolioItem;
    }
    
    public static Market_Portfolio_Formula__c createTestMarketPortfolioFormula(Id portId,
                                                                         Id changedPortId,
                                                                         String productFamily,
                                                                         Decimal priceDifference,
                                                                         Date startDate,
                                                                         Date endDate,
                                                            	 		 Boolean insertMarketPortfolioFormula
                                                               ) {
        Market_Portfolio_Formula__c marketPortfolioFormula = new Market_Portfolio_Formula__c(
            Port__c = portId,
            Changed_Port__c = changedPortId,
            Product_Family__c = productFamily,
            Price_Difference__c = priceDifference,
            Start_Date__c = startDate,
            End_Date__c = endDate
        );
        if (insertMarketPortfolioFormula) {
            insert marketPortfolioFormula;
        }
        return marketPortfolioFormula;
    }
    
    public static void prepareMarketReport(){
        List<Port__c> testPorts = new List<Port__c>();
        testPorts.add(createTestPort('ZHOUSHAN', 'CHINA', false));
        testPorts.add(createTestPort('SINGAPORE', 'SINGAPORE', false));
        testPorts.add(createTestPort('HONG KONG', 'HONG KONG', false));
        insert testPorts;
        List<Market_Portfolio__c> marketPortfolios = new List<Market_Portfolio__c>();
        for(Date startDate = Date.today().addDays(-2); startDate <= Date.today(); startDate = startDate.addDays(1)){
        	marketPortfolios.add(createTestMarketPortfolio(startDate, 'GENERAL', false));
        }
        insert marketPortfolios;
        List<String> productFamilies = new List<String>{'MGO', 'HSFO', 'ULSFO'};
        List<Market_Portfolio_Item__c> marketPortfolioItems = new List<Market_Portfolio_Item__c>();
        for(Market_Portfolio__c marketPortfolio: marketPortfolios){
            for(Port__c port: testPorts){
                for(String productFamily: productFamilies){
                    marketPortfolioItems.add(TestDataFactory.createTestMarketPortfolioItem(marketPortfolio.Id, port.Id, productFamily, 700.00, false));
                }
            }    
        }
        insert marketPortfolioItems;
    }

    public static void prepareDataForNominationConfirmationFlow() {
        Pricebook2 pricebook = insertPricebook('Standard Price Book', true);
        Product2 testProduct = insertTestProduct('DMA ISO2017 S0.1%', pricebook.Id, 'PETROLEUM', true);
        Account testSupplier = createTestAccount('Test Supplier', 'SUPPLIER', true);
        Account testBuyer = createTestAccount('Test Buyer', 'BUYER', true);
        Payment_Term__c supplierPaymentTerm = createTestPaymentTerm('2 P', 'Supplier', true);
        Payment_Term__c buyerPaymentTerm = createTestPaymentTerm('7', 'Buyer', true);
        Vessel__c testVessel = createTestVessel('TEST', '1234567', null, true);
        Opportunity testEnquiry = createTestEnquiry('Test Enquiry', testBuyer.Id, testVessel.Id, 'Offer Sent & Negotiation', Date.today(), true, Time.newInstance(1,2,3,4), 10000);
        Port__c testPort = createTestPort('Test port', 'CHINA', true);
        Broker_Enquiry__c testEnquiryBroker = createTestBrokerEnquiry(null, testEnquiry.Id, true, false);
        testEnquiryBroker.Buyer__c = testEnquiry.AccountId;
        insert testEnquiryBroker;
        Quote testQuote = [SELECT Id FROM Quote WHERE OpportunityId = :testEnquiry.Id LIMIT 1];
        QuoteLineItem testOfferLineItem = createTestQuoteLineItem(testQuote.Id, testPort.Id, testProduct.Id, 100, 600, testSupplier.Id, Date.today(), pricebook.Id, supplierPaymentTerm.Id, buyerPaymentTerm.Id, true, true);
        List<Special_Term__c> testSpecialTerms = new List<Special_Term__c>();
        testSpecialTerms.add(createTestSpecialTerm('Test special term 1', 'Test text 1', false)); 
        insert testSpecialTerms;
        createTestEnquirySpecialTerm(testEnquiry.Id, testSpecialTerms[0].Id, 'Test reason1', new List<String>{testOfferLineItem.Id}, true);
        ContextManager.avoidLockerRecursion = false;
        ContextManager.avoidStemRecursion = false;
        testQuote.Status = 'Closed Won';
        update testQuote;
    }

    public static void prepareEnquiryToQuoteData() {
        Pricebook2 pricebook = insertPricebook('Standard Price Book', true);
        Product2 testProduct = insertTestProduct('DMA ISO2017 S0.1%', pricebook.Id, 'PETROLEUM', true);
        Account testSupplier = createTestAccount('Test Supplier', 'SUPPLIER', true);
        Account testBuyer = createTestAccount('Test Buyer', 'BUYER', true);
        Payment_Term__c supplierPaymentTerm = createTestPaymentTerm('2 P', 'Supplier', true);
        Payment_Term__c buyerPayementTerm = createTestPaymentTerm('7', 'Buyer', true);
        Opportunity testEnquiry = createTestEnquiry('Test Enquiry', testBuyer.Id, null, 'Offer Sent & Negotiation', Date.today(), true, Time.newInstance(1,2,3,4), 10000);
        Port__c testPort = createTestPort('Test port', 'CHINA', true);
        Broker_Enquiry__c testEnquiryBroker = createTestBrokerEnquiry(null, testEnquiry.Id, true, false);
        testEnquiryBroker.Buyer__c = testEnquiry.AccountId;
        insert testEnquiryBroker;
        Quote testQuote = [SELECT Id FROM Quote WHERE OpportunityId = :testEnquiry.Id LIMIT 1];
        QuoteLineItem testOfferLineItem = createTestQuoteLineItem(testQuote.Id, testPort.Id, testProduct.Id, 12, 2, testSupplier.Id, Date.today(), pricebook.Id, supplierPaymentTerm.Id, buyerPayementTerm.Id, true, true);
    }

    public static void prepareQuoteLineItemForDataStem(){
        Pricebook2 pricebook = insertPricebook('Standard Price Book', true);
        Product2 testProduct = insertTestProduct('DMA ISO2017 S0.1%', pricebook.Id,'PETROLEUM', true);
        Product2 nonPetroleumProduct = insertTestProduct('DMA ISO2017 S0.1%', pricebook.Id, 'NON-PETROLEUM', true);
        Account testSupplier = createTestAccount('Test Supplier', 'SUPPLIER', true);
        Account testBuyer = createTestAccount('Test Buyer', 'BUYER', true);
        Port__c testPort = createTestPort('Test port', 'CHINA', true);
        Payment_Term__c supplierPaymentTerm = createTestPaymentTerm('2 P', 'Supplier', true);
        Payment_Term__c buyerPayementTerm = createTestPaymentTerm('7', 'Buyer', true);
        Opportunity testEnquiry = createTestEnquiry('Test Enquiry', testBuyer.Id, null, 'Offer Sent & Negotiation', Date.today(), true, Time.newInstance(1,2,3,4), 10000);
        Quote testQuote = createTestQuote('TestQuoteWithoutBroker',testEnquiry.Id,testPort.Id,false);
        testQuote.Quote_Buyer__c = testBuyer.id;
        testQuote.Status = 'Offer Sent & Negotiation';
        List<QuoteLineItem> quoteLineItems = new List<QuoteLineItem>();
        insert testQuote;
        QuoteLineItem testOfferLineItem = createTestQuoteLineItem(testQuote.Id, testPort.Id, testProduct.Id, 12, 2, testSupplier.Id, Date.today(), pricebook.Id, supplierPaymentTerm.Id, buyerPayementTerm.Id, true, false);
        testOfferLineItem.Product_Line_Item__c = null;
        insert testOfferLineItem;
        QuoteLineItem testOfferLineItemWithProductLineItemId = createTestQuoteLineItem(testQuote.Id, testPort.Id, nonPetroleumProduct.Id, 12, 2, testSupplier.Id, Date.today(), pricebook.Id, supplierPaymentTerm.Id, buyerPayementTerm.Id, true, false);
        testOfferLineItemWithProductLineItemId.Product_Line_Item__c = testOfferLineItem.Id;
        QuoteLineItem testOfferLineItemWithProductLineItemId2 = createTestQuoteLineItem(testQuote.Id, testPort.Id, nonPetroleumProduct.Id, 14, 2, testSupplier.Id, Date.today(), pricebook.Id, supplierPaymentTerm.Id, buyerPayementTerm.Id, true, false);
        testOfferLineItemWithProductLineItemId2.Product_Line_Item__c = testOfferLineItem.Id;
        quoteLineItems.add(testOfferLineItemWithProductLineItemId);
        quoteLineItems.add(testOfferLineItemWithProductLineItemId2);
        insert quoteLineItems;
    }

    public static void prepareEnquiryWithEnquiryLineItemsData() {
        Pricebook2 pricebook = insertPricebook('Standard Price Book', true);
        Account testBuyer = createTestAccount('New Account', 'BUYER', true); 
        Opportunity testEnquiry = createTestEnquiry('Test Enquiry', testBuyer.Id, null, 'Offer Sent & Negotiation', Date.today(), true, Time.newInstance(1,2,3,4), 10000);
        Broker_Enquiry__c testEnquiryBroker = createTestBrokerEnquiry(null, testEnquiry.Id, true, false);
        testEnquiryBroker.Buyer__c = testEnquiry.AccountId;
        insert testEnquiryBroker;
        Product2 testProduct = insertTestProduct('DMA ISO2017 S0.1%', pricebook.Id, 'PETROLEUM', true);
        Port__c testPort = createTestPort('Test port', 'CHINA', true);
        List<OpportunityLineItem> oppLineItems = new List<OpportunityLineItem>();
        oppLineItems.add(createTestEnquiryLineItem(testEnquiry.Id, 1000, testPort.Id, testProduct.Id, 100, true, 'ETA', Datetime.now().addDays(1), Datetime.now().addDays(2), false));
        oppLineItems.add(createTestEnquiryLineItem(testEnquiry.Id, 2000, testPort.Id, testProduct.Id, 200, true, 'ETB', Datetime.now().addDays(2), Datetime.now().addDays(3), false));
        oppLineItems.add(createTestEnquiryLineItem(testEnquiry.Id, 3000, testPort.Id, testProduct.Id, 300, true, 'PROMPT', Datetime.now().addDays(3), Datetime.now().addDays(4), false));
        insert oppLineItems;
    }

    public static AccountContactRelation prepareAccountContactRelationship(Account account, String contactRole) {
        Contact contact = new Contact();
        contact.Lastname = 'Test contact';
        contact.Salutation = 'Mr.';
        contact.CISTEMCompanyCountry__c = 'Test country';
        insert contact;
        AccountContactRelation relation = new AccountContactRelation(AccountId = account.Id, ContactId = contact.Id, Roles = contactRole);
        insert relation;
        return relation;
    }

    public static String generateRandomString(Integer length) {
        final String chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdefghijklmnopqrstuvwxyz';
        String randString = '';
        while (randString.length() < length) {
           Integer idx = Math.mod(Math.abs(Crypto.getRandomInteger()), chars.length());
           randString += chars.substring(idx, idx+1);
        }
        return randString; 
    }
}