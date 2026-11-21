@isTest
public class InvoiceControllerTest {
	@TestSetup
	static void makeData() {
		TestDataFactory.prepareDataForNominationConfirmationFlow();
	}

    @IsTest
    static void restrictedSalesSupportCanReadInvoiceBlockerAndCaptureOneReminder() {
        Profile profile = [SELECT Id, PermissionsViewAllData, PermissionsModifyAllData
            FROM Profile WHERE Name = 'Sales Support' LIMIT 1];
        System.assertEquals(false, profile.PermissionsViewAllData);
        System.assertEquals(false, profile.PermissionsModifyAllData);
        User accounts = makeReminderTrader('FCOS QA', 'Accounts CLI Only', 'accounts-cli-only-233');
        accounts.ProfileId = profile.Id;
        User trader = makeReminderTrader('Otto', 'Lai', 'accounts-cli-trader-233');
        System.runAs(new User(Id = UserInfo.getUserId())) {
            insert new List<User>{accounts, trader};
            PermissionSet charges = [SELECT Id FROM PermissionSet WHERE Name = 'FCOS_Variable_Charges_User' LIMIT 1];
            insert new PermissionSetAssignment(AssigneeId = accounts.Id, PermissionSetId = charges.Id);
        }
        InvoiceController.buyerChargeReminderFixtureTraderIds = new Set<Id>{trader.Id};
        Id stemId = preparePendingBuyerChargeReminder('Otto Lai', 'Otto Lai', null);
        String requestId = 'fcos-accounts-cli-233';
        Boolean hasCancellationReads;
        System.runAs(accounts) {
            hasCancellationReads = STEM_Extra_Cost__c.Cancelled__c.getDescribe().isAccessible()
                && STEM_Line_Item__c.Cancelled__c.getDescribe().isAccessible();
            if (!hasCancellationReads) {
                VariableChargeInvoiceReadinessService.Readiness blocked =
                    InvoiceController.getBuyerInvoiceTabReadiness(String.valueOf(stemId));
                System.assertEquals(false, blocked.ready, blocked.reason);
                System.assertEquals(false, blocked.pendingBuyerApproval, blocked.reason);
                System.assertEquals(null, InvoiceController.capturedBuyerChargeReminder);
            }
        }
        if (!hasCancellationReads) {
            // Model the two existing Production reads for this synthetic user only.
            // The QAT profile and all deployed permission sets remain unchanged.
            System.runAs(new User(Id = UserInfo.getUserId())) {
                PermissionSet reads = new PermissionSet(
                    Name = 'InvoiceReminderTestCancellationReads',
                    Label = 'Invoice Reminder Test Cancellation Reads');
                insert reads;
                List<ObjectPermissions> objects = new List<ObjectPermissions>();
                List<FieldPermissions> fields = new List<FieldPermissions>();
                for (String objectName : new List<String>{'STEM_Extra_Cost__c', 'STEM_Line_Item__c'}) {
                    objects.add(new ObjectPermissions(ParentId = reads.Id,
                        SobjectType = objectName, PermissionsRead = true));
                    fields.add(new FieldPermissions(ParentId = reads.Id, SobjectType = objectName,
                        Field = objectName + '.Cancelled__c', PermissionsRead = true, PermissionsEdit = false));
                }
                insert objects;
                insert fields;
                insert new PermissionSetAssignment(AssigneeId = accounts.Id, PermissionSetId = reads.Id);
            }
        }
        Test.startTest();
        System.runAs(accounts) {
            System.assertEquals(accounts.Id, UserInfo.getUserId());
            VariableChargeInvoiceReadinessService.Readiness readiness = InvoiceController.getBuyerInvoiceTabReadiness(String.valueOf(stemId));
            System.assertEquals(false, readiness.ready, readiness.reason);
            System.assertEquals(true, readiness.pendingBuyerApproval, readiness.reason);
            System.assertEquals('Buyer charge reminder sent.', InvoiceController.sendBuyerChargeReminder(String.valueOf(stemId), requestId));
            Messaging.SingleEmailMessage captured = InvoiceController.capturedBuyerChargeReminder;
            System.assertNotEquals(null, captured);
            System.assertEquals(new List<String>{String.valueOf(trader.Id)}, captured.getToAddresses());
            System.assert(captured.getPlainTextBody().contains(readiness.fcosUrl));
            System.assert(captured.getPlainTextBody().contains('Test Supplier'));
            InvoiceController.capturedBuyerChargeReminder = null;
            System.assertEquals('Buyer charge reminder sent.', InvoiceController.sendBuyerChargeReminder(String.valueOf(stemId), requestId));
            System.assertEquals(null, InvoiceController.capturedBuyerChargeReminder);
            System.assertEquals(0, Limits.getEmailInvocations());
        }
        Test.stopTest();
        System.assertEquals(1, [SELECT COUNT() FROM Task WHERE WhatId = :stemId AND CreatedById = :accounts.Id]);
    }

    @IsTest
    static void buyerChargeReminderEmailsExactTradersOnceAndReplaysTheCommittedResult() {
        User buyer = makeReminderTrader('Otto', 'Lai', 'buyer-reminder');
        User firstSupplier = makeReminderTrader('Stanley', 'Chui', 'first-supplier-reminder');
        User secondSupplier = makeReminderTrader('Sam', 'Yip', 'second-supplier-reminder');
        System.runAs(new User(Id = UserInfo.getUserId())) {
            insert new List<User>{buyer, firstSupplier, secondSupplier};
        }
        InvoiceController.buyerChargeReminderFixtureTraderIds = new Set<Id>{buyer.Id, firstSupplier.Id, secondSupplier.Id};
        Id stemId = preparePendingBuyerChargeReminder('Otto Lai', 'Stanley Chui', 'Sam Yip');
        Integer invoiceCount = [SELECT COUNT() FROM Invoice__c WHERE STEM__c = :stemId];
        Integer stageCount = [SELECT COUNT() FROM STEM_Variable_Charge_Supplier__c WHERE STEM__c = :stemId];
        String requestId = 'invoice-reminder-test-1';

        Test.startTest();
        VariableChargeInvoiceReadinessService.Readiness readiness =
            InvoiceController.getBuyerInvoiceTabReadiness(String.valueOf(stemId));
        System.assertEquals(true, readiness.pendingBuyerApproval);
        System.assertEquals(2, readiness.blockingBuyerSupplierIds.size());
        String result = InvoiceController.sendBuyerChargeReminder(String.valueOf(stemId), requestId);
        Messaging.SingleEmailMessage email = InvoiceController.capturedBuyerChargeReminder;
        System.assertEquals('Buyer charge reminder sent.', result);
        System.assertEquals(new Set<String>{String.valueOf(buyer.Id), String.valueOf(firstSupplier.Id),
            String.valueOf(secondSupplier.Id)}, new Set<String>(email.getToAddresses()));
        System.assert(email.getPlainTextBody().contains(readiness.fcosUrl));
        System.assert(email.getPlainTextBody().contains('Test Supplier'));
        System.assert(email.getPlainTextBody().contains('Second Reminder Supplier'));

        InvoiceController.capturedBuyerChargeReminder = null;
        System.assertEquals(result, InvoiceController.sendBuyerChargeReminder(String.valueOf(stemId), requestId));
        System.assertEquals(null, InvoiceController.capturedBuyerChargeReminder, 'Replay must not send another email.');
        Test.stopTest();

        Id actorId = UserInfo.getUserId();
        List<Task> reminders = [SELECT OwnerId, IsClosed, Description FROM Task WHERE WhatId = :stemId
            AND Subject LIKE 'Buyer charge reminder sent %' AND CreatedById = :actorId];
        System.assertEquals(1, reminders.size());
        System.assertEquals(actorId, reminders[0].OwnerId);
        System.assertEquals(true, reminders[0].IsClosed);
        System.assert(reminders[0].Description.contains(String.valueOf(secondSupplier.Id)));
        System.assertEquals(invoiceCount, [SELECT COUNT() FROM Invoice__c WHERE STEM__c = :stemId]);
        System.assertEquals(stageCount, [SELECT COUNT() FROM STEM_Variable_Charge_Supplier__c WHERE STEM__c = :stemId]);
        System.assertEquals(false, [SELECT Variable_Charges_Confirmed__c FROM STEM__c WHERE Id = :stemId].Variable_Charges_Confirmed__c);
    }

    @IsTest
    static void buyerChargeReminderDeduplicatesTraderAssignedToBothRoles() {
        User trader = makeReminderTrader('Otto', 'Lai', 'dual-role-reminder');
        System.runAs(new User(Id = UserInfo.getUserId())) {
            insert trader;
        }
        InvoiceController.buyerChargeReminderFixtureTraderIds = new Set<Id>{trader.Id};
        Id stemId = preparePendingBuyerChargeReminder('Otto Lai', 'Otto Lai', null);

        Test.startTest();
        InvoiceController.sendBuyerChargeReminder(String.valueOf(stemId), 'invoice-reminder-test-2');
        Test.stopTest();

        System.assertEquals(new List<String>{String.valueOf(trader.Id)},
            InvoiceController.capturedBuyerChargeReminder.getToAddresses());
    }

    @IsTest
    static void buyerChargeReminderRejectsAnUnassignedSupplierDespiteTheDocumentEmailDefault() {
        User buyer = makeReminderTrader('Otto', 'Lai', 'buyer-reminder-missing');
        System.runAs(new User(Id = UserInfo.getUserId())) {
            insert buyer;
        }
        InvoiceController.buyerChargeReminderFixtureTraderIds = new Set<Id>{buyer.Id};
        Id stemId = preparePendingBuyerChargeReminder('Otto Lai', null, null);

        Test.startTest();
        assertBuyerChargeReminderRejected(stemId, 'Supplier Trader for Test Supplier');
        Test.stopTest();
    }

    @IsTest
    static void buyerChargeReminderRejectsAnAmbiguousInternalTraderName() {
        User buyer = makeReminderTrader('Otto', 'Lai', 'buyer-reminder-ambiguous');
        User firstSupplier = makeReminderTrader('Stanley', 'Chui', 'first-ambiguous-reminder');
        User secondSupplier = makeReminderTrader('Stanley', 'Chui', 'second-ambiguous-reminder');
        System.runAs(new User(Id = UserInfo.getUserId())) {
            insert new List<User>{buyer, firstSupplier, secondSupplier};
        }
        InvoiceController.buyerChargeReminderFixtureTraderIds = new Set<Id>{buyer.Id, firstSupplier.Id, secondSupplier.Id};
        Id stemId = preparePendingBuyerChargeReminder('Otto Lai', 'Stanley Chui', null);

        Test.startTest();
        assertBuyerChargeReminderRejected(stemId, 'must resolve to one active internal Salesforce user');
        Test.stopTest();
    }

    @IsTest
    static void buyerChargeReminderRollsBackOnMailFailureAndAcceptsTheSameRequestAgain() {
        User trader = makeReminderTrader('Otto', 'Lai', 'reminder-after-failure');
        System.runAs(new User(Id = UserInfo.getUserId())) {
            insert trader;
        }
        InvoiceController.buyerChargeReminderFixtureTraderIds = new Set<Id>{trader.Id};
        Id stemId = preparePendingBuyerChargeReminder('Otto Lai', 'Otto Lai', null);
        String requestId = 'invoice-reminder-rejected';

        Test.startTest();
        InvoiceController.failBuyerChargeReminderForTest = true;
        assertBuyerChargeReminderRejected(stemId, 'Salesforce could not record and send the reminder');
        InvoiceController.failBuyerChargeReminderForTest = false;
        System.assertEquals('Buyer charge reminder sent.',
            InvoiceController.sendBuyerChargeReminder(String.valueOf(stemId), requestId));
        Test.stopTest();

        System.assertEquals(new List<String>{String.valueOf(trader.Id)},
            InvoiceController.capturedBuyerChargeReminder.getToAddresses());
        System.assertEquals(1, [SELECT COUNT() FROM Task WHERE WhatId = :stemId AND Subject LIKE 'Buyer charge reminder sent %']);
    }

    private static void assertBuyerChargeReminderRejected(Id stemId, String message) {
        try {
            InvoiceController.sendBuyerChargeReminder(String.valueOf(stemId), 'invoice-reminder-rejected');
            System.assert(false, 'The reminder must fail closed for an unresolved assignment.');
        } catch (AuraHandledException expected) {
            System.assert(expected.getMessage().contains(message), expected.getMessage());
        }
        System.assertEquals(null, InvoiceController.capturedBuyerChargeReminder);
        System.assertEquals(0, [SELECT COUNT() FROM Task WHERE WhatId = :stemId AND Subject LIKE 'Buyer charge reminder sent %']);
    }

    private static User makeReminderTrader(String firstName, String lastName, String marker) {
        return new User(FirstName = firstName, LastName = lastName, Alias = marker.left(8),
            Email = marker + '@example.invalid', EmailEncodingKey = 'UTF-8',
            LanguageLocaleKey = 'en_US', LocaleSidKey = 'en_US', ProfileId = UserInfo.getProfileId(),
            TimeZoneSidKey = 'Asia/Hong_Kong',
            Username = marker + '.' + UserInfo.getOrganizationId() + '.' + DateTime.now().getTime() + '@example.invalid');
    }

    private static Id preparePendingBuyerChargeReminder(String buyerTrader, String supplierTrader, String secondSupplierTrader) {
        STEM__c stem = [SELECT Id FROM STEM__c LIMIT 1];
        STEM_Line_Item__c line = [SELECT Original_Supplier__c FROM STEM_Line_Item__c WHERE STEM__c = :stem.Id LIMIT 1];
        Nomination__c confirmation = [SELECT Id, Enquiry__c, Port__c, Expected_Delivery_Date__c FROM Nomination__c
            WHERE STEM__c = :stem.Id AND Deprecated__c = false AND RecordTypeId = :FCBStatic.BUYER_NOMINATION_RT_ID LIMIT 1];
        Nomination__c nomination = [SELECT Id, Payment_Term__c FROM Nomination__c
            WHERE STEM__c = :stem.Id AND Account__c = :line.Original_Supplier__c
                AND Deprecated__c = false AND RecordTypeId = :FCBStatic.SUPPLIER_NOMINATION_RT_ID LIMIT 1];
        ContextManager.skipTriggers = true;
        try {
            update new STEM__c(Id = stem.Id, Delivery_Date__c = Date.today().addDays(-1), Variable_Charges_Confirmed__c = false);
            update new Account(Id = line.Original_Supplier__c, Is_Variable__c = true);
            update new List<Nomination__c>{
                new Nomination__c(Id = confirmation.Id, Buyer_Supplier_Trader__c = buyerTrader),
                new Nomination__c(Id = nomination.Id, Buyer_Supplier_Trader__c = supplierTrader)
            };
            if (secondSupplierTrader != null) {
                Account secondSupplier = TestDataFactory.createTestAccount('Second Reminder Supplier', 'SUPPLIER', false);
                secondSupplier.Is_Variable__c = true;
                insert secondSupplier;
                STEM_Extra_Cost__c extra = TestDataFactory.createTestStemExtraCost(
                    stem.Id, null, null, null, null, 25, 20, null, 'STEM Charge', false);
                extra.Supplier__c = secondSupplier.Id;
                extra.Fixed__c = true;
                insert extra;
                insert new Nomination__c(Name = 'Nomination', STEM__c = stem.Id, Account__c = secondSupplier.Id,
                    Enquiry__c = confirmation.Enquiry__c, Port__c = confirmation.Port__c,
                    Expected_Delivery_Date__c = confirmation.Expected_Delivery_Date__c,
                    Buyer_Confirmation__c = confirmation.Id, Payment_Term__c = nomination.Payment_Term__c,
                    RecordTypeId = FCBStatic.SUPPLIER_NOMINATION_RT_ID, Buyer_Supplier_Trader__c = secondSupplierTrader);
            }
        } finally {
            ContextManager.skipTriggers = false;
        }
        return stem.Id;
    }
    
    @IsTest
    static void finalBuyerInvoiceRollsBackPdfFailureAndGuardsRetry() {
        STEM_Line_Item__c line = [SELECT Id, STEM__c FROM STEM_Line_Item__c WHERE Cancelled__c = false LIMIT 1];
        List<String> selected = new List<String>{String.valueOf(line.Id)};
        Date invoiceDate = Date.today();
        Date deliveryDate = invoiceDate.addDays(-1);
        Date dueDate = invoiceDate.addDays(30);
        Test.startTest();
        try {
            InvoiceController.saveFinalBuyerInvoicePdf(line.STEM__c, selected, invoiceDate, deliveryDate, dueDate, '!');
            System.assert(false, 'Invalid PDF data must fail.');
        } catch (AuraHandledException expected) {
            System.assert(expected.getMessage().contains('Salesforce could not save the invoice PDF'));
        }
        System.assertEquals(0, [SELECT COUNT() FROM Invoice__c WHERE STEM__c = :line.STEM__c]);
        System.assertEquals(null, [SELECT Buyer_Invoice__c FROM STEM_Line_Item__c WHERE Id = :line.Id].Buyer_Invoice__c);
        Test.stopTest();
    }

    @IsTest
    static void finalBuyerInvoiceAttachesPdfAndRejectsAnAlreadyIssuedLine() {
        STEM_Line_Item__c line = [SELECT Id, STEM__c FROM STEM_Line_Item__c WHERE Cancelled__c = false LIMIT 1];
        List<String> selected = new List<String>{String.valueOf(line.Id)};
        Date invoiceDate = Date.today();
        Date deliveryDate = invoiceDate.addDays(-1);
        Date dueDate = invoiceDate.addDays(30);
        String pdf = EncodingUtil.base64Encode(Blob.valueOf('%PDF-1.4 test'));
        Test.startTest();
        Invoice__c invoice = InvoiceController.saveFinalBuyerInvoicePdf(line.STEM__c, selected, invoiceDate, deliveryDate, dueDate, pdf);
        try {
            InvoiceController.saveFinalBuyerInvoicePdf(line.STEM__c, selected, invoiceDate, deliveryDate, dueDate, pdf);
            System.assert(false, 'Retry on a completed invoice must not create another invoice.');
        } catch (AuraHandledException expected) {
            System.assert(expected.getMessage().contains(invoice.Name));
        }
        Test.stopTest();
        System.assertEquals(1, [SELECT COUNT() FROM Invoice__c WHERE STEM__c = :line.STEM__c]);
        System.assertEquals(1, [SELECT COUNT() FROM ContentDocumentLink WHERE LinkedEntityId = :invoice.Id]);
        System.assertNotEquals(null, [SELECT File__c FROM Invoice__c WHERE Id = :invoice.Id].File__c);
        System.assertEquals(invoice.Id, [SELECT Buyer_Invoice__c FROM STEM_Line_Item__c WHERE Id = :line.Id].Buyer_Invoice__c);
    }

    @isTest
    static void getStemInfoTest(){
        Test.startTest();
        STEM__c stem = [SELECT Id, Invoice_Date__c FROM STEM__c LIMIT 1];
        InvoiceController.getDBSInfo();
        InvoiceController.getUBSInfo();
        system.assertEquals(stem.Invoice_Date__c, InvoiceController.getStemInfo(stem.Id).Invoice_Date__c);
        Test.stopTest();
    }
    
    @isTest
    static void getPaymentTermTest(){
        Test.startTest();
        Payment_Term__c paymentTerm = [SELECT Id, Name FROM Payment_Term__c WHERE RecordType.Name = 'Buyer' LIMIT 1];
        system.assertEquals(paymentTerm.Id, InvoiceController.getPaymentTerm(paymentTerm.Name).Id);
        Test.stopTest();
    }
    
    @IsTest
    static void staleNativeReviewCannotAuthorizeInvoiceCreation() {
        STEM_Line_Item__c selected=[SELECT Id FROM STEM_Line_Item__c LIMIT 1];
        FcosTradeDocumentService.Line line=new FcosTradeDocumentService.Line();
        line.id=selected.Id;
        FcosTradeDocumentService.DocumentReview review=new FcosTradeDocumentService.DocumentReview();
        review.currencyCode='HKD';
        review.fingerprint='current-review';
        review.lines.add(line);
        Integer dmlBefore=Limits.getDmlStatements();
        for(String fingerprint:new List<String>{null,'stale-review'}) {
            try {
                InvoiceController.assertNativeCreateReview(review,fingerprint,new List<Id>{selected.Id});
                System.assert(false,'A missing or stale fingerprint cannot authorize an invoice.');
            } catch(AuraHandledException expected) {}
        }
        try {
            InvoiceController.assertNativeCreateReview(review,'current-review',new List<Id>{selected.Id,selected.Id});
            System.assert(false,'Duplicate selected rows cannot authorize an invoice.');
        } catch(AuraHandledException expected) {}
        InvoiceController.assertNativeCreateReview(review,'current-review',new List<Id>{selected.Id});
        System.assertEquals(dmlBefore,Limits.getDmlStatements(),'Review admission is read-only.');
    }

    @IsTest
    static void ordinaryInvoiceRejectsAnUnmatchedReviewBeforeWriting() {
        STEM__c stem=[SELECT Id FROM STEM__c LIMIT 1];
        Integer invoiceCount=[SELECT COUNT() FROM Invoice__c WHERE STEM__c=:stem.Id];
        Integer taskCount=[SELECT COUNT() FROM Task WHERE WhatId=:stem.Id];
        try {
            InvoiceController.createReviewedInvoice(stem.Id,new List<String>(),false,false,Date.today(),Date.today(),Date.today(),'review-for-another-selection');
            System.assert(false,'An ordinary invoice must refuse an unrelated managed review.');
        } catch(AuraHandledException expected) {}
        System.assertEquals(invoiceCount,[SELECT COUNT() FROM Invoice__c WHERE STEM__c=:stem.Id]);
        System.assertEquals(taskCount,[SELECT COUNT() FROM Task WHERE WhatId=:stem.Id]);
    }

    @IsTest
    static void testUpserLastInvoiceForm(){
        Test.startTest();
        Last_Invoice_Form__c lastInvoiceForm = new Last_Invoice_Form__c(Info_Text__c = 'Test');
        InvoiceController.upsertLastInvoiceForm(lastInvoiceForm);
        System.assertEquals(1, [SELECT Id FROM Last_Invoice_Form__c].size());
        Test.stopTest();
    }
    
    @IsTest
    static void testGetBDNBase64Strings(){
        Test.startTest();
        STEM_Line_Item__c stemLineItem = [SELECT Id FROM STEM_Line_Item__c];
        ContentVersion contentVersion = new ContentVersion( Title  = 'BDN', PathOnClient = 'BDN.pdf', VersionData = Blob.valueOf('Test Content'), IsMajorVersion = true);
        insert contentVersion; 
		List<ContentDocument> documents = [SELECT Id, Title, LatestPublishedVersionId FROM ContentDocument];
		//create ContentDocumentLink  record 
    	ContentDocumentLink cdl = New ContentDocumentLink();
        cdl.LinkedEntityId = stemLineItem.id;
        cdl.ContentDocumentId = documents[0].Id;
        insert cdl;
        system.assertEquals(1, InvoiceController.getBDNBase64Strings(new List<String>{stemLineItem.Id}).size());
        Test.stopTest();
    }
    
    @IsTest
    static void testUpdateStemDeliveryDate(){
        Test.startTest();
        Product2 testProduct = [SELECT Id FROM Product2 LIMIT 1];
        Account testSupplier = [SELECT Id FROM Account WHERE RecordTypeId = :FCBStatic.SUPPLIER_ACCOUNT_RT_ID];
        STEM__c stem = [SELECT Id FROM STEM__c LIMIT 1];
		STEM_Extra_Cost__c stemExtraCost = TestDataFactory.createTestStemExtraCost(stem.Id, null, 100,31,31,31,31,31,'STEM Charge',false);
        stemExtraCost.Payment_Term__c = '2 I';
        stemExtraCost.Supplier__c = testSupplier.Id;
        insert stemExtraCost;
        InvoiceController.updateStemDeliveryDate(stem.Id);
        system.assertEquals(null, [SELECT Id, Delivery_Date__c FROM STEM__c LIMIT 1].Delivery_Date__c);
        Test.stopTest();
    }
}
