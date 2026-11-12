@IsTest
private class FcosNativeEntryIntegrationTest {
    private static final String ACTOR_LAST_NAME = 'NativeEntryIntegration';
    private static final String RATE_ID = 'native-entry-rate';
    private static final Decimal USD_HKD_RATE = Decimal.valueOf('7.800000');

    private class CompanyRateMock implements HttpCalloutMock {
        public HttpResponse respond(HttpRequest request) {
            Map<String, Object> payload = (Map<String, Object>) JSON.deserializeUntyped(request.getBody());
            String purpose = (String) payload.get('purpose');
            System.assert(purpose == 'preview' || purpose == 'confirmation', 'Unexpected company-rate purpose: ' + purpose);
            if (purpose == 'confirmation') {
                System.assertEquals(RATE_ID, payload.get('reviewedRateId'));
            }

            HttpResponse response = new HttpResponse();
            response.setStatusCode(200);
            response.setBody(JSON.serialize(new Map<String, Object>{
                'ok' => true,
                'purpose' => purpose,
                'requestId' => request.getHeader('x-salesforce-event-id'),
                'rate' => new Map<String, Object>{
                    'rateId' => RATE_ID,
                    'revision' => 1,
                    'usdHkdRate' => String.valueOf(USD_HKD_RATE),
                    'effectiveAt' => '2026-09-10T00:00:00.000Z'
                }
            }));
            return response;
        }
    }

    @TestSetup
    static void fixtures() {
        User actor = new User(
            Alias = 'natentry',
            LastName = ACTOR_LAST_NAME,
            Email = 'native-entry@example.invalid',
            Username = 'native-entry.' + UserInfo.getOrganizationId() + '.' + System.now().getTime() + '@example.invalid',
            EmailEncodingKey = 'UTF-8',
            LanguageLocaleKey = 'en_US',
            LocaleSidKey = 'en_US',
            TimeZoneSidKey = 'Asia/Hong_Kong',
            ProfileId = UserInfo.getProfileId()
        );
        insert actor;
        insert new PermissionSetAssignment(
            AssigneeId = actor.Id,
            PermissionSetId = [SELECT Id FROM PermissionSet WHERE Name = 'Fcos_Trading_FX_Access' LIMIT 1].Id
        );

        Test.startTest();
        try {
            System.runAs(actor) {
                System.assert(Limits.getQueries() < 15, 'The native-entry fixture must start with a fresh query budget.');
                TestDataFactory.prepareDataForNominationConfirmationFlow();
                STEM_Line_Item__c line = [
                    SELECT Id, STEM__c, STEM__r.Port__c, STEM__r.Account__c
                    FROM STEM_Line_Item__c
                    WHERE Cancelled__c = false
                    LIMIT 1
                ];
                update new Port__c(Id = line.STEM__r.Port__c, Country__c = 'HONG KONG');
                update new Account(Id = line.STEM__r.Account__c, Banking_Preference__c = 'DBS');
                update new STEM__c(Id = line.STEM__c, Partial_CIA__c = false);

                DBS_Bank__c bank = DBS_Bank__c.getOrgDefaults();
                bank.SetupOwnerId = UserInfo.getOrganizationId();
                bank.Beneficiary_Bank__c = 'Synthetic test bank';
                bank.Beneficiary__c = 'FRATELLI COSULICH BUNKERS (HK) LTD';
                bank.Account_No__c = 'SYNTHETIC-NOT-A-BANK-ACCOUNT';
                upsert bank;
            }
        } finally {
            Test.stopTest();
        }
    }

    private static User actor() {
        return [SELECT Id FROM User WHERE LastName = :ACTOR_LAST_NAME LIMIT 1];
    }

    private static STEM_Line_Item__c sourceLine() {
        return [
            SELECT Id, STEM__c, Original_Supplier__c, Quantity__c, Quantity_Delivered_Per_BDN__c
            FROM STEM_Line_Item__c
            WHERE Cancelled__c = false
            LIMIT 1
        ];
    }

    private static void configureCompanyRate() {
        FcosCompanyFxRateService.settingsOverride = new Fcos_Trading_FX_Setting__c(
            Enabled__c = true,
            Endpoint__c = 'https://fcos.example.invalid/api/salesforce/company-fx',
            Signing_Secret__c = 'native-entry-integration-test-secret'
        );
        Test.setMock(HttpCalloutMock.class, new CompanyRateMock());
    }

    private static FcosTradeCurrencyService.Review confirmHkdSide(Id lineId, String direction) {
        FcosTradeCurrencyService.Review reviewed = FcosTradeCurrencyController.previewCurrency(lineId, direction, 'HKD');
        System.assertEquals(USD_HKD_RATE, reviewed.rate);
        System.assertEquals(RATE_ID, reviewed.rateId);
        FcosTradeCurrencyService.Review confirmed = FcosTradeCurrencyController.saveDraft(
            lineId,
            direction,
            'HKD',
            Decimal.valueOf('780.00000000'),
            reviewed.fingerprint,
            reviewed.rateId,
            true
        );
        System.assertEquals(false, confirmed.needsConfirmation);
        System.assertNotEquals(null, confirmed.confirmedAt);
        return confirmed;
    }

    private class ConfirmSideJob implements Queueable, Database.AllowsCallouts {
        private final Id lineId;
        private final String direction;

        ConfirmSideJob(Id lineId, String direction) {
            this.lineId = lineId;
            this.direction = direction;
        }

        public void execute(QueueableContext context) {
            configureCompanyRate();
            confirmHkdSide(lineId, direction);
        }
    }

    private class IssueBuyerAndCreditJob implements Queueable, Database.AllowsCallouts {
        private final Id lineId;

        IssueBuyerAndCreditJob(Id lineId) {
            this.lineId = lineId;
        }

        public void execute(QueueableContext context) {
            configureCompanyRate();
            STEM_Line_Item__c line = [SELECT Id, STEM__c FROM STEM_Line_Item__c WHERE Id = :lineId];
            confirmHkdSide(line.Id, 'Sell');
            List<String> selected = new List<String>{String.valueOf(line.Id)};
            FcosTradeDocumentService.DocumentReview invoiceReview = FcosTradeDocumentService.preview(
                line.STEM__c,
                'Sell',
                null,
                new List<Id>{line.Id}
            );
            Invoice__c invoice = InvoiceController.createReviewedInvoice(
                String.valueOf(line.STEM__c),
                selected,
                false,
                false,
                Date.newInstance(2026, 9, 10),
                Date.newInstance(2026, 9, 10),
                Date.newInstance(2026, 9, 20),
                invoiceReview.fingerprint
            );
            InvoiceController.generateInvoicePDF(
                String.valueOf(invoice.Id),
                'Native entry integration invoice',
                selected,
                null,
                false,
                invoiceReview.fingerprint
            );
            FcosTradeCreditService.CreditReview creditReview = FcosTradeCreditService.preview(invoice.Id);
            FcosTradeCreditService.recordCredit(
                invoice.Id,
                creditReview.fingerprint,
                Date.newInstance(2026, 9, 11),
                'Full reversal for persisted constructor verification'
            );
        }
    }

    private class RecordSupplierInvoiceJob implements Queueable, Database.AllowsCallouts {
        private final Id lineId;

        RecordSupplierInvoiceJob(Id lineId) {
            this.lineId = lineId;
        }

        public void execute(QueueableContext context) {
            configureCompanyRate();
            STEM_Line_Item__c line = [
                SELECT Id, STEM__c, Original_Supplier__c
                FROM STEM_Line_Item__c
                WHERE Id = :lineId
            ];
            confirmHkdSide(line.Id, 'Buy');
            FcosTradeDocumentService.DocumentReview review = FcosTradeDocumentService.preview(
                line.STEM__c,
                'Buy',
                line.Original_Supplier__c,
                new List<Id>{line.Id}
            );
            Map<String, Object> fields = new Map<String, Object>{
                'Name' => 'NATIVE-ENTRY-SUPPLIER-1',
                'Bank_Details__c' => 'Synthetic supplier bank instructions',
                'Invoice_Date__c' => '2026-09-10',
                'Supplier_Delivery_Date__c' => '2026-09-10'
            };

            Boolean staleRejected = false;
            try {
                FcosTradeDocumentService.recordSupplierInvoice(
                    line.STEM__c,
                    line.Original_Supplier__c,
                    new List<Id>{line.Id},
                    'stale-document-review',
                    fields
                );
            } catch (AuraHandledException expected) {
                staleRejected = true;
            }
            System.assert(staleRejected, 'A stale supplier-document review must be rejected before persistence.');

            Id invoiceId = FcosTradeDocumentService.recordSupplierInvoice(
                line.STEM__c,
                line.Original_Supplier__c,
                new List<Id>{line.Id},
                review.fingerprint,
                fields
            );
            System.assertNotEquals(null, invoiceId);

            Boolean duplicateRejected = false;
            try {
                FcosTradeDocumentService.recordSupplierInvoice(
                    line.STEM__c,
                    line.Original_Supplier__c,
                    new List<Id>{line.Id},
                    review.fingerprint,
                    fields
                );
            } catch (AuraHandledException expected) {
                duplicateRejected = true;
            }
            System.assert(duplicateRejected, 'A linked supplier line must require credit and reissue.');
        }
    }

    @IsTest
    static void persistedInvoiceAndCreditConstructorsReadImmutableEvidence() {
        System.runAs(actor()) {
            STEM_Line_Item__c line = sourceLine();
            configureCompanyRate();
            Test.startTest();
            System.enqueueJob(new IssueBuyerAndCreditJob(line.Id));
            Test.stopTest();

            Invoice__c invoice = [
                SELECT Id, Name, Amount__c, Document_HKD_Amount__c, Document_FX_Rate__c
                FROM Invoice__c
                WHERE Document_Currency__c = 'HKD' AND Original_Invoice__c = null
                LIMIT 1
            ];
            Test.setCurrentPage(Page.FcosNativeInvoice);
            ApexPages.currentPage().getParameters().put('id', String.valueOf(invoice.Id));
            FcosNativeInvoiceController invoiceController = new FcosNativeInvoiceController();
            System.assertEquals('HKD', invoiceController.currencyCode);
            System.assertEquals('INVOICE', invoiceController.title);
            System.assertEquals(String.valueOf(invoice.Document_HKD_Amount__c.setScale(2, RoundingMode.HALF_UP)), invoiceController.nativeTotal);
            System.assertEquals(String.valueOf(invoice.Amount__c.setScale(2, RoundingMode.HALF_UP)), invoiceController.accountingTotal);
            System.assertEquals(String.valueOf(invoice.Document_FX_Rate__c.setScale(6, RoundingMode.HALF_UP)), invoiceController.companyRate);
            System.assertEquals(1, invoiceController.lines.size());
            System.assertEquals('Quantity × agreed unit price', invoiceController.lines[0].pricingBasis);
            System.assertEquals('Test Buyer', invoiceController.presentation.get('buyerName'));

            Invoice__c credit = [
                SELECT Id, Name, Amount__c, Document_HKD_Amount__c, Document_FX_Rate__c,
                    Document_FX_Revision__c, Original_Invoice__c, Credit_Reason__c
                FROM Invoice__c
                WHERE Original_Invoice__c = :invoice.Id
                LIMIT 1
            ];
            Test.setCurrentPage(Page.FcosNativeCredit);
            ApexPages.currentPage().getParameters().put('id', String.valueOf(credit.Id));
            FcosNativeCreditController creditController = new FcosNativeCreditController();
            System.assertEquals('CREDIT NOTE', creditController.title);
            System.assertEquals(invoice.Name, creditController.originalReference);
            System.assertEquals('Test Buyer', creditController.counterparty);
            System.assertEquals(credit.Credit_Reason__c, creditController.reason);
            System.assertEquals(credit.Document_HKD_Amount__c, creditController.total);
            System.assertEquals(credit.Amount__c, creditController.usd);
            System.assertEquals(credit.Document_FX_Rate__c, creditController.rate);
            System.assertEquals(credit.Document_FX_Revision__c, creditController.revision);
            System.assertEquals(1, creditController.lines.size());
            System.assertNotEquals(null, creditController.lines[0].Original_Line__c);
            System.assert(creditController.lines[0].Native_Amount__c < 0);
        }
    }

    @IsTest
    static void prepareFreezesContentAndLinesAndIsIdempotent() {
        System.runAs(actor()) {
            STEM_Line_Item__c line = sourceLine();
            configureCompanyRate();
            Test.startTest();
            System.enqueueJob(new ConfirmSideJob(line.Id, 'Sell'));
            Test.stopTest();
            configureCompanyRate();

            Nomination__c nomination = [
                SELECT Id, STEM__c, Saved_Inputs__c, Saved_Remarks__c, Document_Content_Fingerprint__c
                FROM Nomination__c
                WHERE RecordTypeId = :FCBStatic.NOMINATION_BUYER_RT_IT
                LIMIT 1
            ];
            FcosTradeDocumentService.DocumentReview review = FcosTradeDocumentService.nomination(nomination.Id);

            Boolean staleRejected = false;
            try {
                FcosNativeConfirmationService.prepare(nomination.Id, 'stale-confirmation-review');
            } catch (AuraHandledException expected) {
                staleRejected = true;
            }
            System.assert(staleRejected, 'Preparation must reject a stale reviewed FX fingerprint.');
            System.assertEquals(0, [SELECT COUNT() FROM Trade_Document_Line__c WHERE Nomination__c = :nomination.Id]);

            FcosNativeConfirmationService.PreparationResult first = FcosNativeConfirmationService.prepare(
                nomination.Id,
                review.fingerprint
            );
            FcosNativeConfirmationService.PreparationResult retry = FcosNativeConfirmationService.prepare(
                nomination.Id,
                review.fingerprint
            );
            System.assertEquals(false, first.alreadyPrepared);
            System.assertEquals(true, retry.alreadyPrepared);
            System.assertEquals(first.contentFingerprint, retry.contentFingerprint);

            Nomination__c frozen = [
                SELECT Saved_Inputs__c, Saved_Remarks__c, Document_Content_Fingerprint__c,
                    Document_Currency__c, Document_FX_Fingerprint__c
                FROM Nomination__c
                WHERE Id = :nomination.Id
            ];
            System.assertEquals('HKD', frozen.Document_Currency__c);
            System.assertEquals(review.fingerprint, frozen.Document_FX_Fingerprint__c);
            System.assertEquals(first.contentFingerprint, frozen.Document_Content_Fingerprint__c);
            System.assert(frozen.Saved_Inputs__c.contains('HKD 780.00000000'));
            System.assertEquals(
                first.contentFingerprint,
                FcosNativeConfirmationService.contentFingerprint(
                    frozen.Document_FX_Fingerprint__c,
                    frozen.Saved_Inputs__c,
                    frozen.Saved_Remarks__c
                )
            );

            List<Trade_Document_Line__c> evidence = [
                SELECT Id, Source_Record_Id__c, Currency__c, Quantity__c, Native_Unit_Price__c,
                    Native_Amount__c, Accounting_USD__c, FX_Rate__c, FX_Revision__c
                FROM Trade_Document_Line__c
                WHERE Nomination__c = :nomination.Id
            ];
            System.assertEquals(1, evidence.size());
            System.assertEquals(String.valueOf(line.Id), evidence[0].Source_Record_Id__c);
            System.assertEquals('HKD', evidence[0].Currency__c);
            System.assertEquals(Decimal.valueOf('780.00000000'), evidence[0].Native_Unit_Price__c);
            System.assertEquals(
                (evidence[0].Quantity__c * evidence[0].Native_Unit_Price__c).setScale(6, RoundingMode.HALF_UP),
                evidence[0].Native_Amount__c.setScale(6, RoundingMode.HALF_UP)
            );
            System.assertEquals(RATE_ID, evidence[0].FX_Revision__c);
            System.assertEquals(USD_HKD_RATE, evidence[0].FX_Rate__c);

            Database.SaveResult contentTamper = Database.update(
                new Nomination__c(Id = nomination.Id, Saved_Inputs__c = '[]'),
                false
            );
            System.assertEquals(false, contentTamper.isSuccess(), 'Prepared confirmation content must remain immutable.');
            Database.SaveResult lineTamper = Database.update(
                new Trade_Document_Line__c(Id = evidence[0].Id, Native_Amount__c = evidence[0].Native_Amount__c + 1),
                false
            );
            System.assertEquals(false, lineTamper.isSuccess(), 'Prepared confirmation line evidence must remain immutable.');
            Id evidenceId = evidence[0].Id;
            System.assertEquals(
                first.contentFingerprint,
                [SELECT Document_Content_Fingerprint__c FROM Nomination__c WHERE Id = :nomination.Id].Document_Content_Fingerprint__c
            );
            System.assertEquals(
                evidence[0].Native_Amount__c,
                [SELECT Native_Amount__c FROM Trade_Document_Line__c WHERE Id = :evidenceId].Native_Amount__c
            );
        }
    }

    @IsTest
    static void recordSupplierInvoicePersistsLinksEvidenceAndRejectsRetries() {
        System.runAs(actor()) {
            STEM_Line_Item__c line = sourceLine();
            configureCompanyRate();
            Test.startTest();
            System.enqueueJob(new RecordSupplierInvoiceJob(line.Id));
            Test.stopTest();

            Supplier_Invoice__c invoice = [
                SELECT Id, Name, STEM__c, Supplier__c, Invoice_Amount__c, Payment_Term__c,
                    Document_Currency__c, Document_HKD_Amount__c, Document_FX_Rate__c,
                    Document_FX_Revision__c, Document_FX_Confirmed_At__c,
                    Document_FX_Fingerprint__c, Document_Presentation_JSON__c
                FROM Supplier_Invoice__c
                WHERE Name = 'NATIVE-ENTRY-SUPPLIER-1'
                LIMIT 1
            ];
            System.assertEquals(1, [SELECT COUNT() FROM Supplier_Invoice__c WHERE Name = 'NATIVE-ENTRY-SUPPLIER-1']);
            System.assertEquals(line.STEM__c, invoice.STEM__c);
            System.assertEquals(line.Original_Supplier__c, invoice.Supplier__c);
            System.assertEquals('HKD', invoice.Document_Currency__c);
            System.assertEquals(RATE_ID, invoice.Document_FX_Revision__c);
            System.assertEquals(USD_HKD_RATE, invoice.Document_FX_Rate__c);
            System.assertNotEquals(null, invoice.Document_FX_Confirmed_At__c);
            System.assertNotEquals(null, invoice.Document_FX_Fingerprint__c);
            System.assertEquals(
                (invoice.Document_HKD_Amount__c / invoice.Document_FX_Rate__c).setScale(2, RoundingMode.HALF_UP),
                invoice.Invoice_Amount__c
            );
            Map<String, Object> presentation = (Map<String, Object>) JSON.deserializeUntyped(invoice.Document_Presentation_JSON__c);
            System.assertEquals('Test Supplier', presentation.get('supplierName'));

            STEM_Line_Item__c linked = [
                SELECT Supplier_Invoice__c, Supplier_Input__c, Supplier_Issued__c
                FROM STEM_Line_Item__c
                WHERE Id = :line.Id
            ];
            System.assertEquals(invoice.Id, linked.Supplier_Invoice__c);
            System.assertEquals('🟢', linked.Supplier_Input__c);
            System.assertEquals(true, linked.Supplier_Issued__c);

            List<Trade_Document_Line__c> evidence = [
                SELECT Supplier_Invoice__c, Source_Record_Id__c, Currency__c, Pricing_Mode__c,
                    Quantity__c, Native_Unit_Price__c, Native_Amount__c, Accounting_USD__c,
                    FX_Rate__c, FX_Revision__c
                FROM Trade_Document_Line__c
                WHERE Supplier_Invoice__c = :invoice.Id
            ];
            System.assertEquals(1, evidence.size());
            System.assertEquals(invoice.Id, evidence[0].Supplier_Invoice__c);
            System.assertEquals(String.valueOf(line.Id), evidence[0].Source_Record_Id__c);
            System.assertEquals('HKD', evidence[0].Currency__c);
            System.assertEquals('Unit', evidence[0].Pricing_Mode__c);
            System.assertEquals(
                (evidence[0].Quantity__c * evidence[0].Native_Unit_Price__c).setScale(6, RoundingMode.HALF_UP),
                evidence[0].Native_Amount__c.setScale(6, RoundingMode.HALF_UP)
            );
            System.assertEquals(
                (evidence[0].Native_Amount__c / evidence[0].FX_Rate__c).setScale(2, RoundingMode.HALF_UP),
                evidence[0].Accounting_USD__c.setScale(2, RoundingMode.HALF_UP)
            );
            System.assertEquals(
                invoice.Document_HKD_Amount__c.setScale(2, RoundingMode.HALF_UP),
                evidence[0].Native_Amount__c.setScale(2, RoundingMode.HALF_UP)
            );
        }
    }
}
