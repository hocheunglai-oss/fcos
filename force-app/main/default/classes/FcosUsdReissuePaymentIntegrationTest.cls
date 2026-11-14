@IsTest
private class FcosUsdReissuePaymentIntegrationTest {

    private static FcosCompanyFxRateService.Snapshot lockedRate() {
        FcosCompanyFxRateService.Snapshot rate = new FcosCompanyFxRateService.Snapshot();
        rate.rateId = 'original-hkd-rate';
        rate.revision = 'original-hkd-rate';
        rate.usdHkdRate = Decimal.valueOf('7.8');
        rate.effectiveAt = Datetime.newInstanceGmt(2026, 9, 1, 0, 0, 0);
        return rate;
    }

    private static void configureFx() {
        FcosCompanyFxRateService.settingsOverride = new Fcos_Trading_FX_Setting__c(
            Enabled__c = true
        );
    }

    @TestSetup
    static void seedIssuedHkdOriginalAndCredit() {
        User actor = new User(
            Alias = 'usdr', LastName = 'UsdReissuePaymentIntegration', Email = 'usd-reissue@example.invalid',
            Username = 'usd-reissue.' + UserInfo.getOrganizationId() + '.' + System.now().getTime() + '@example.invalid',
            EmailEncodingKey = 'UTF-8', LanguageLocaleKey = 'en_US', LocaleSidKey = 'en_US',
            TimeZoneSidKey = 'Asia/Hong_Kong', ProfileId = UserInfo.getProfileId()
        );
        insert actor;
        List<PermissionSetAssignment> assignments = new List<PermissionSetAssignment>();
        for (PermissionSet permission : [
            SELECT Id FROM PermissionSet
            WHERE Name IN ('Fcos_Trading_FX_Access', 'Fcos_Trading_FX_Amend_Access', 'FCOS_Variable_Charges_User')
        ]) {
            assignments.add(new PermissionSetAssignment(AssigneeId = actor.Id, PermissionSetId = permission.Id));
        }
        insert assignments;

        Test.startTest();
        try {
            System.assert(Limits.getQueries()<15,'USD reissue fixture must begin below 15 SOQL queries; actual='+Limits.getQueries());
            System.runAs(actor) {
            // This helper is the smallest fixture that creates a valid, triggered
            // STEM fuel row with its required product, payment-term and account links.
            TestDataFactory.prepareDataForNominationConfirmationFlow();
            STEM_Line_Item__c line = [
                SELECT Id, STEM__c, STEM__r.Port__c
                FROM STEM_Line_Item__c WHERE Cancelled__c = false LIMIT 1
            ];
            // Port Name is derived by the org; Country__c is the authoritative HK fixture signal.
            ContextManager.skipTriggers = true;
            try {
                update new Port__c(Id = line.STEM__r.Port__c, Country__c = 'HONG KONG');
            } finally {
                ContextManager.skipTriggers = false;
            }

            // The factory now runs after the test limit reset. Issue the native
            // original and credit asynchronously so the fixture DML does not
            // consume the settlement transaction's query budget.
            System.enqueueJob(new SeedIssuedHkdOriginalAndCredit(line.Id));
            }
        } finally {
            Test.stopTest();
        }
    }

    private class SeedIssuedHkdOriginalAndCredit implements Queueable, Database.AllowsCallouts {
        private final Id lineId;
        SeedIssuedHkdOriginalAndCredit(Id lineId) { this.lineId = lineId; }
        public void execute(QueueableContext context) {
            configureFx();
            STEM_Line_Item__c line = [SELECT Id, STEM__c FROM STEM_Line_Item__c WHERE Id = :lineId];
            FcosTradeCurrencyService.Review reviewed = FcosTradeCurrencyService.review(line.Id, 'Sell', lockedRate());
            FcosTradeCurrencyService.save(line.Id, 'Sell', 'HKD', Decimal.valueOf('780'), reviewed.fingerprint, lockedRate(), true);

            FcosTradeDocumentService.DocumentReview document = FcosTradeDocumentService.preview(
                line.STEM__c, 'Sell', null, new List<Id>{line.Id}
            );
            Invoice__c original = new Invoice__c(
                Name = 'USD-REISSUE-HKD-ORIGINAL', STEM__c = line.STEM__c, Amount__c = document.usdTotal,
                Invoice_Date__c = Date.newInstance(2026, 9, 1), Delivery_Date__c = Date.newInstance(2026, 9, 1),
                Invoice_Due_Date__c = Date.newInstance(2026, 9, 10), Proforma__c = false, Deprecated__c = false,
                Document_Presentation_JSON__c = JSON.serialize(new Map<String, String>{
                    'version' => '1', 'legalEntity' => 'Synthetic test company', 'buyerName' => 'Synthetic buyer'
                })
            );
            FcosTradeDocumentService.applySnapshot(original, document);
            insert original;
            FcosTradeDocumentLineService.persist(original, document);
            attachIssuedPdf(original, line.Id, 'USD reissue original');
            update new STEM_Line_Item__c(Id = line.Id, Buyer_Invoice__c = original.Id);

            FcosTradeCreditService.CreditReview creditReview = FcosTradeCreditService.preview(original.Id);
            Id creditId = FcosTradeCreditService.recordCredit(
                original.Id, creditReview.fingerprint, Date.newInstance(2026, 9, 2), 'Full credit before corrected USD reissue'
            );
            FcosTradeCreditService.generateCreditPdf(creditId);
        }
    }

    private static User actor() {
        return [SELECT Id FROM User WHERE LastName = 'UsdReissuePaymentIntegration' LIMIT 1];
    }

    private static Invoice__c originalInvoice() {
        return [
            SELECT Id, STEM__c, Amount__c, Document_Currency__c, Document_HKD_Amount__c,
                Document_FX_Rate__c, Document_FX_Revision__c, Document_FX_Confirmed_At__c, Document_FX_Side__c,
                Document_FX_Fingerprint__c, File__c
            FROM Invoice__c
            WHERE Document_Currency__c = 'HKD' AND Original_Invoice__c = null
            LIMIT 1
        ];
    }

    private static Invoice__c reissueInvoice() {
        return [
            SELECT Id, STEM__c, Amount__c FROM Invoice__c
            WHERE Document_Currency__c = 'USD' AND Reissue_Of_Invoice__c != null
            LIMIT 1
        ];
    }

    private static Invoice__c originalCredit() {
        return [
            SELECT Id, Amount__c, Original_Invoice__c, Document_Currency__c, Document_HKD_Amount__c,
                Document_FX_Rate__c, Document_FX_Revision__c, Document_FX_Confirmed_At__c, File__c
            FROM Invoice__c WHERE Original_Invoice__c != null AND Document_Currency__c = 'HKD' LIMIT 1
        ];
    }

    private static void attachIssuedPdf(Invoice__c document, Id sourceId, String title) {
        ContentVersion version = new ContentVersion(
            Title = title, PathOnClient = title + '.pdf', VersionData = Blob.valueOf('issued test PDF'),
            FirstPublishLocationId = document.Id
        );
        insert version;
        version = [SELECT ContentDocumentId FROM ContentVersion WHERE Id = :version.Id];
        insert new ContentDocumentLink(ContentDocumentId = version.ContentDocumentId, LinkedEntityId = sourceId, ShareType = 'V');
        document.File__c = URL.getOrgDomainURL().toExternalForm() + '/' + version.ContentDocumentId;
        update document;
    }

    private static Invoice__c releaseAmendAndIssueUsdReissue(Invoice__c original) {
        Invoice__c credit = originalCredit();
        FcosTradeReissueService.ReleaseResult release = FcosTradeReissueService.release(credit.Id);
        System.assertEquals(original.Id, release.originalInvoiceId);
        System.assertEquals(1, release.releasedLineCount);

        STEM_Line_Item__c released = [
            SELECT Id, STEM__c, Buyer_Invoice__c, Reissue_Of_Buyer_Invoice__c,
                Sell_Currency__c, Sell_HKD_Unit_Price__c, Sell_USD_Unit_Price_Precise__c,
                Sell_FX_Rate__c, Sell_FX_Revision__c, Sell_FX_Confirmed_At__c, Sell_FX_Side__c
            FROM STEM_Line_Item__c WHERE STEM__c = :original.STEM__c AND Cancelled__c = false LIMIT 1
        ];
        System.assertEquals(null, released.Buyer_Invoice__c);
        System.assertEquals(original.Id, released.Reissue_Of_Buyer_Invoice__c);

        FcosTradeCurrencyService.Review hkdReview = FcosTradeCurrencyService.review(released.Id, 'Sell', null);
        FcosTradeCurrencyService.Review usdDraft = FcosTradeCurrencyService.amend(
            released.Id, 'Sell', 'USD', hkdReview.usdUnitPrice, hkdReview.fingerprint, null,
            'Corrected agreement is denominated in USD'
        );
        System.assertEquals(null, usdDraft.confirmedAt);
        FcosTradeCurrencyService.Review usdConfirmed = FcosTradeCurrencyService.save(
            released.Id, 'Sell', 'USD', usdDraft.nativeUnitPrice, usdDraft.fingerprint, null, true
        );
        System.assertEquals('USD', usdConfirmed.currencyCode);
        System.assertEquals(false, usdConfirmed.needsConfirmation);

        FcosTradeDocumentService.DocumentReview reissueReview = FcosTradeDocumentService.preview(
            released.STEM__c, 'Sell', null, new List<Id>{released.Id}
        );
        System.assertEquals('USD', reissueReview.currencyCode);
        System.assertEquals(original.Id, reissueReview.reissueOfId);
        System.assertEquals(null, reissueReview.rate);
        System.assertEquals(null, reissueReview.rateId);
        System.assertNotEquals(null, reissueReview.lines[0].originalLineId);

        Invoice__c reissue = new Invoice__c(
            Name = 'USD-REISSUE-CORRECTED', STEM__c = released.STEM__c, Amount__c = reissueReview.usdTotal,
            Invoice_Date__c = Date.newInstance(2026, 9, 3), Delivery_Date__c = Date.newInstance(2026, 9, 1),
            Invoice_Due_Date__c = Date.newInstance(2026, 9, 12), Proforma__c = false, Deprecated__c = false,
            Document_Presentation_JSON__c = JSON.serialize(new Map<String, String>{
                'version' => '1', 'legalEntity' => 'Synthetic test company', 'buyerName' => 'Synthetic buyer'
            })
        );
        FcosTradeDocumentService.applySnapshot(reissue, reissueReview);
        insert reissue;
        FcosTradeDocumentLineService.persist(reissue, reissueReview);
        attachIssuedPdf(reissue, released.Id, 'USD reissue corrected');
        update new STEM_Line_Item__c(Id = released.Id, Buyer_Invoice__c = reissue.Id);
        return reissue;
    }

    private class ReleaseCorrectedUsdReissue implements Queueable, Database.AllowsCallouts {
        private final Id originalInvoiceId;
        ReleaseCorrectedUsdReissue(Id originalInvoiceId) { this.originalInvoiceId = originalInvoiceId; }
        public void execute(QueueableContext context) {
            configureFx();
            Invoice__c original=[SELECT Id,STEM__c FROM Invoice__c WHERE Id=:originalInvoiceId];
            releaseAmendAndIssueUsdReissue(original);
        }
    }
    private static Invoice__c prepareUsdReissue(Id originalInvoiceId) {
        Test.startTest();System.enqueueJob(new ReleaseCorrectedUsdReissue(originalInvoiceId));Test.stopTest();
        return reissueInvoice();
    }
    private static void assertUsdUnpaidCredit(Invoice__c reissue) {
        FcosTradeCreditService.CreditReview review=FcosTradeCreditService.preview(reissue.Id);
        Id creditId=FcosTradeCreditService.recordCredit(reissue.Id,review.fingerprint,Date.newInstance(2026,9,11),'USD credit before any cash settlement');
        FcosTradeCreditService.generateCreditPdf(creditId);
        FcosTradePaymentService.PaymentAllocationReview allocation=FcosTradePaymentService.previewAllocation(creditId,null,Date.newInstance(2026,9,11));
        System.assertEquals(Decimal.valueOf('0'),allocation.remainingNative,'An unpaid USD reissue cannot create a cash refund.');
        Boolean rejected=false;
        try {
            FcosTradePaymentService.recordUsdReissuePayment(creditId,Decimal.valueOf('-0.01'),Date.newInstance(2026,9,11),'DBS','USD',Decimal.valueOf('0.01'),
                'USD refund bank statement evidence','62000000-0000-4000-8000-000000000001');
        } catch(AuraHandledException expected) { rejected=true; }
        System.assert(rejected);System.assertEquals(0,[SELECT COUNT() FROM Payment__c WHERE Buyer_Invoice__c=:creditId]);
    }
    private static void assertUsdPartialRefundCap(Invoice__c reissue) {
        Decimal paid=Decimal.valueOf('1.00');
        FcosTradePaymentService.recordUsdReissuePayment(reissue.Id,paid,Date.newInstance(2026,9,10),'DBS','USD',paid,
            'USD reissue bank statement evidence','63000000-0000-4000-8000-000000000001');
        FcosTradeCreditService.CreditReview review=FcosTradeCreditService.preview(reissue.Id);
        Id creditId=FcosTradeCreditService.recordCredit(reissue.Id,review.fingerprint,Date.newInstance(2026,9,11),'USD credit after partial settlement');
        FcosTradeCreditService.generateCreditPdf(creditId);
        Boolean originalRejected=false;
        try {
            FcosTradePaymentService.recordUsdReissuePayment(reissue.Id,Decimal.valueOf('0.01'),Date.newInstance(2026,9,11),'DBS','USD',Decimal.valueOf('0.01'),
                'USD reissue bank statement evidence','63000000-0000-4000-8000-000000000002');
        } catch(AuraHandledException expected) { originalRejected=true; }
        System.assert(originalRejected,'A USD reissue with its own credit cannot receive new cash.');
        FcosTradePaymentService.PaymentAllocationReview initial=FcosTradePaymentService.previewAllocation(creditId,null,Date.newInstance(2026,9,11));
        System.assertEquals(Decimal.valueOf('-1.00'),initial.remainingNative);
        Id first=FcosTradePaymentService.recordUsdReissuePayment(creditId,Decimal.valueOf('-0.40'),Date.newInstance(2026,9,11),'DBS','USD',Decimal.valueOf('0.40'),
            'USD refund bank statement evidence','63000000-0000-4000-8000-000000000003');
        FcosTradePaymentService.PaymentAllocationReview remaining=FcosTradePaymentService.previewAllocation(creditId,null,Date.newInstance(2026,9,11));
        System.assertEquals(Decimal.valueOf('-0.60'),remaining.remainingNative,'The prior cash refund reduces the USD entitlement.');
        System.assertNotEquals(null,first);
    }
    private static void assertUsdFullRefundCapAndRetry(Invoice__c reissue) {
        Decimal paid=Decimal.valueOf('1.00');
        FcosTradePaymentService.recordUsdReissuePayment(reissue.Id,paid,Date.newInstance(2026,9,10),
            'DBS','USD',paid,'USD reissue bank statement evidence',
            '63100000-0000-4000-8000-000000000001');
        FcosTradeCreditService.CreditReview review=FcosTradeCreditService.preview(reissue.Id);
        Id creditId=FcosTradeCreditService.recordCredit(reissue.Id,review.fingerprint,
            Date.newInstance(2026,9,11),'USD credit after complete original cash settlement');
        FcosTradeCreditService.generateCreditPdf(creditId);
        Id fullRefund=FcosTradePaymentService.recordUsdReissuePayment(creditId,Decimal.valueOf('-1.00'),
            Date.newInstance(2026,9,11),'DBS','USD',Decimal.valueOf('1.00'),
            'USD refund bank statement evidence','63100000-0000-4000-8000-000000000002');
        Boolean excessRejected=false;
        try {
            FcosTradePaymentService.recordUsdReissuePayment(creditId,Decimal.valueOf('-0.01'),
                Date.newInstance(2026,9,11),'DBS','USD',Decimal.valueOf('0.01'),
                'USD refund bank statement evidence','63100000-0000-4000-8000-000000000003');
        } catch(AuraHandledException expected) {excessRejected=true;}
        System.assert(excessRejected,'A fully refunded USD credit cannot exceed the original cash received.');
        Id retry=FcosTradePaymentService.recordUsdReissuePayment(creditId,Decimal.valueOf('-1.00'),
            Date.newInstance(2026,9,11),'DBS','USD',Decimal.valueOf('1.00'),
            'USD refund bank statement evidence','63100000-0000-4000-8000-000000000002');
        System.assertEquals(fullRefund,retry,'An exact retry must return the existing refund evidence.');
    }
    @IsTest
    static void unpaidUsdReissueCreditCannotRefundCash() {
        System.runAs(actor()) {
            configureFx();Invoice__c reissue=prepareUsdReissue(originalInvoice().Id);
            assertUsdUnpaidCredit(reissue);
        }
    }
    @IsTest
    static void partialUsdReissueCreditRefundIsCappedAtOriginalCash() {
        System.runAs(actor()) {
            configureFx();Invoice__c reissue=prepareUsdReissue(originalInvoice().Id);
            assertUsdPartialRefundCap(reissue);
        }
    }
    @IsTest
    static void usdReissueFullRefundRejectsExcessAndRetries() {
        System.runAs(actor()) {
            configureFx();Invoice__c reissue=prepareUsdReissue(originalInvoice().Id);
            assertUsdFullRefundCapAndRetry(reissue);
        }
    }

    @IsTest
    static void futureUsdPaymentDateIsRejectedBeforeDml() {
        System.runAs(actor()) {
            configureFx();Invoice__c reissue=prepareUsdReissue(originalInvoice().Id);
            Date futureDate=Date.valueOf(Datetime.now().format('yyyy-MM-dd','Asia/Hong_Kong')).addDays(1);
            String operationId='63200000-0000-4000-8000-000000000001';Boolean rejected=false;
            try {
                FcosTradePaymentService.recordUsdReissuePayment(reissue.Id,Decimal.valueOf('1.00'),futureDate,
                    'DBS','USD',Decimal.valueOf('1.00'),'future USD statement evidence',operationId);
            } catch(AuraHandledException expected) {rejected=true;}
            System.assert(rejected,'A planned future date must not be accepted as actual USD bank cash.');
            System.assertEquals(0,[SELECT COUNT() FROM Payment__c WHERE Payment_Operation_Id__c=:operationId],
                'Rejecting a future date must leave no payment evidence.');
        }
    }

    @IsTest
    static void issuedHkdCreditReleaseCreatesUsdReissueWithExactUsdSettlementsAndRefund() {
        System.runAs(actor()) {
            configureFx();
            Invoice__c original = originalInvoice();
            Invoice__c reissue = prepareUsdReissue(original.Id);
            Decimal partial=Decimal.valueOf('1.00');
            FcosTradePaymentService.recordUsdReissuePayment(reissue.Id,partial,Date.newInstance(2026,9,10),'DBS','USD',partial,
                'USD reissue bank statement evidence','61000000-0000-4000-8000-000000000001');
            FcosTradePaymentService.recordUsdReissuePayment(reissue.Id,reissue.Amount__c-partial,Date.newInstance(2026,9,10),'DBS','USD',reissue.Amount__c-partial,
                'USD reissue bank statement evidence','61000000-0000-4000-8000-000000000002');
            FcosTradeCreditService.CreditReview refundReview=FcosTradeCreditService.preview(reissue.Id);
            Id refundCreditId=FcosTradeCreditService.recordCredit(reissue.Id,refundReview.fingerprint,Date.newInstance(2026,9,11),'Full USD reissue refund');
            FcosTradeCreditService.generateCreditPdf(refundCreditId);
            FcosTradePaymentService.recordUsdReissuePayment(refundCreditId,-reissue.Amount__c,Date.newInstance(2026,9,11),'DBS','USD',reissue.Amount__c,
                'USD refund bank statement evidence','61000000-0000-4000-8000-000000000003');
            Invoice__c issuedReissue = [
                SELECT Id, Amount__c, Reissue_Of_Invoice__c, Document_Currency__c, Document_HKD_Amount__c,
                    Document_FX_Rate__c, Document_FX_Revision__c, Document_FX_Confirmed_At__c,
                    Document_FX_Side__c, Document_FX_Fingerprint__c, File__c
                FROM Invoice__c WHERE Id = :reissue.Id
            ];
            System.assertEquals(original.Id, issuedReissue.Reissue_Of_Invoice__c);
            System.assertEquals('USD', issuedReissue.Document_Currency__c);
            System.assertEquals(original.Amount__c, issuedReissue.Amount__c);
            System.assertEquals(null, issuedReissue.Document_HKD_Amount__c);
            System.assertEquals(null, issuedReissue.Document_FX_Rate__c);
            System.assertEquals(null, issuedReissue.Document_FX_Revision__c);
            System.assertNotEquals(null, issuedReissue.Document_FX_Confirmed_At__c);
            System.assertNotEquals(null, issuedReissue.Document_FX_Side__c);
            System.assertNotEquals(null, issuedReissue.Document_FX_Fingerprint__c);
            System.assertNotEquals(null, issuedReissue.File__c);

            Invoice__c retainedOriginal = originalInvoice();
            Invoice__c retainedCredit = originalCredit();
            System.assertEquals('HKD', retainedOriginal.Document_Currency__c);
            System.assertEquals(Decimal.valueOf('7.8'), retainedOriginal.Document_FX_Rate__c);
            System.assertEquals('original-hkd-rate', retainedOriginal.Document_FX_Revision__c);
            System.assertNotEquals(null, retainedOriginal.Document_HKD_Amount__c);
            System.assertEquals(-retainedOriginal.Document_HKD_Amount__c, retainedCredit.Document_HKD_Amount__c);
            System.assertEquals(retainedOriginal.Document_FX_Rate__c, retainedCredit.Document_FX_Rate__c);
            System.assertEquals(retainedOriginal.Document_FX_Revision__c, retainedCredit.Document_FX_Revision__c);

            List<Trade_Document_Line__c> reissueLines = [
                SELECT Currency__c, Native_Amount__c, Accounting_USD__c, FX_Rate__c, FX_Revision__c, Original_Line__c
                FROM Trade_Document_Line__c WHERE Buyer_Invoice__c = :issuedReissue.Id
            ];
            System.assertEquals(1, reissueLines.size());
            System.assertEquals('USD', reissueLines[0].Currency__c);
            System.assertEquals(reissueLines[0].Native_Amount__c, reissueLines[0].Accounting_USD__c);
            System.assertEquals(null, reissueLines[0].FX_Rate__c);
            System.assertEquals(null, reissueLines[0].FX_Revision__c);
            System.assertNotEquals(null, reissueLines[0].Original_Line__c);

            Invoice__c refundCredit=[
                SELECT Id,Amount__c,Original_Invoice__c,Document_Currency__c,Document_HKD_Amount__c,
                    Document_FX_Rate__c,Document_FX_Revision__c,Document_FX_Confirmed_At__c,Document_FX_Side__c,File__c
                FROM Invoice__c WHERE Original_Invoice__c=:issuedReissue.Id LIMIT 1
            ];
            System.assertEquals(issuedReissue.Id,refundCredit.Original_Invoice__c);
            System.assertEquals('USD',refundCredit.Document_Currency__c);
            System.assertEquals(-issuedReissue.Amount__c,refundCredit.Amount__c);
            System.assertEquals(null,refundCredit.Document_HKD_Amount__c);
            System.assertEquals(null,refundCredit.Document_FX_Rate__c);
            System.assertEquals(null,refundCredit.Document_FX_Revision__c);
            System.assertNotEquals(null,refundCredit.Document_FX_Confirmed_At__c);
            System.assertNotEquals(null,refundCredit.Document_FX_Side__c);
            System.assertNotEquals(null,refundCredit.File__c);

            Set<Id> settledDocuments = new Set<Id>{issuedReissue.Id, refundCredit.Id};
            List<Payment__c> payments = [
                SELECT Amount__c, Payment_Currency__c, Payment_HKD_Amount__c, Payment_FX_Rate__c,
                    Payment_FX_Revision__c, Invoice_Carrying_USD__c, Settlement_FX_USD__c,
                    Bank_Currency__c, Bank_Native_Amount__c, Buyer_Invoice__c
                FROM Payment__c
                WHERE Buyer_Invoice__c IN :settledDocuments
            ];
            System.assertEquals(3, payments.size());
            Decimal allocated = 0, refunded = 0;
            for (Payment__c payment : payments) {
                System.assertEquals('USD', payment.Payment_Currency__c);
                System.assertEquals(null, payment.Payment_HKD_Amount__c);
                System.assertEquals(null, payment.Payment_FX_Rate__c);
                System.assertEquals(null, payment.Payment_FX_Revision__c);
                System.assertEquals(payment.Amount__c, payment.Invoice_Carrying_USD__c);
                System.assertEquals(Decimal.valueOf('0'), payment.Settlement_FX_USD__c);
                System.assertEquals('USD', payment.Bank_Currency__c);
                System.assertEquals(payment.Amount__c.abs(), payment.Bank_Native_Amount__c);
                if (payment.Buyer_Invoice__c == issuedReissue.Id) allocated += payment.Amount__c;
                else if (payment.Buyer_Invoice__c == refundCredit.Id) refunded += payment.Amount__c;
            }
            System.assertEquals(issuedReissue.Amount__c, allocated, 'Partial and final payments must clear only the USD reissue.');
            System.assertEquals(-issuedReissue.Amount__c, refunded, 'The USD credit refund must retain its own exact USD allocation.');
            System.assertEquals(1,[SELECT COUNT() FROM Payment__c WHERE Buyer_Invoice__c=:refundCredit.Id]);
        }
    }
}
