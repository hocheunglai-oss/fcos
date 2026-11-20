@IsTest
private class FcosDeveeEditorFixtureRehearsalTest {
    private class Fixture {
        Id buyerId;
        Id supplierId;
        Id enquiryId;
        Id offerId;
        Id lineId;
        Id siblingId;
        Id otherPortLineId;
        Id bidId;
        Id extraId;
    }

    private static Fixture createFixture(Boolean includeQuoteControls) {
        String workingStatus = 'Offer Sent & Negotiation';
        Integer initialEmails = Limits.getEmailInvocations();
        Integer initialJobs = Limits.getQueueableJobs();
        Account buyer = TestDataFactory.createTestAccount('FCOS fixture rehearsal buyer', 'BUYER', true);
        Account supplier = TestDataFactory.createTestAccount('FCOS fixture rehearsal supplier', 'SUPPLIER', true);
        Port__c port = TestDataFactory.createTestPort('Hong Kong', 'HONG KONG', true);
        // Native Enquiry automation resolves the MT price book by this exact name.
        Pricebook2 pricebook = TestDataFactory.insertPricebook('Standard Price Book', true);
        Product2 product = TestDataFactory.insertTestProduct('FCOS fixture rehearsal petroleum', pricebook.Id, 'PETROLEUM', true);
        if ([SELECT COUNT() FROM PricebookEntry WHERE Pricebook2Id = :pricebook.Id AND Product2Id = :product.Id] == 0) {
            Id standardPricebook = Test.getStandardPricebookId();
            if ([SELECT COUNT() FROM PricebookEntry WHERE Pricebook2Id = :standardPricebook AND Product2Id = :product.Id] == 0) {
                insert new PricebookEntry(Pricebook2Id=standardPricebook, Product2Id=product.Id, UnitPrice=100, IsActive=true);
            }
            insert new PricebookEntry(Pricebook2Id=pricebook.Id, Product2Id=product.Id, UnitPrice=100, IsActive=true);
        }
        Payment_Term__c buyerTerm = TestDataFactory.createTestPaymentTerm('7', 'Buyer', true);
        Payment_Term__c supplierTerm = TestDataFactory.createTestPaymentTerm('2 P', 'Supplier', true);
        Opportunity enquiry = TestDataFactory.createTestEnquiry('FCOS fixture rehearsal enquiry', buyer.Id, null,
            workingStatus, Date.today(), false, Time.newInstance(1, 2, 3, 4), 10000);
        enquiry.Pricebook2Id = pricebook.Id;
        insert enquiry;

        Quote offer = TestDataFactory.createTestQuote('FCOS fixture rehearsal quote', enquiry.Id, port.Id, false);
        offer.Quote_Buyer__c = buyer.Id;
        offer.Status = workingStatus;
        if (Quote.SObjectType.getDescribe().fields.getMap().containsKey('CurrencyIsoCode')) offer.put('CurrencyIsoCode', 'USD');
        insert offer;
        Date delivery = Date.today().addDays(1);
        QuoteLineItem line = TestDataFactory.createTestQuoteLineItem(offer.Id, port.Id, product.Id, 2, 100,
            supplier.Id, delivery, pricebook.Id, supplierTerm.Id, buyerTerm.Id, false, false);
        line.Buy_Currency__c = 'USD';
        line.Sell_Currency__c = 'USD';
        insert line;
        Supplier_Bid__c bid = TestDataFactory.createTestSupplierBid(offer.Id, port.Id, product.Id, supplier.Id,
            2, 80, Datetime.now().addDays(1), false, null, 0, true);
        Supplier_Bid_Extra_Cost__c extra = TestDataFactory.createTestSupplierBidExtraCost(offer.Id, product.Id,
            2, false, null, 10, null, null, false, 'MT', bid.Id, delivery, supplier.Id, port.Id, true);
        Fixture fixture = new Fixture();
        fixture.buyerId = buyer.Id;
        fixture.supplierId = supplier.Id;
        fixture.enquiryId = enquiry.Id;
        fixture.offerId = offer.Id;
        fixture.lineId = line.Id;
        fixture.bidId = bid.Id;
        fixture.extraId = extra.Id;
        if (includeQuoteControls) {
            Port__c otherPort = TestDataFactory.createTestPort('Singapore', 'SINGAPORE', true);
            QuoteLineItem sibling = TestDataFactory.createTestQuoteLineItem(offer.Id, port.Id, product.Id, 2, 110,
                supplier.Id, delivery, pricebook.Id, supplierTerm.Id, buyerTerm.Id, false, false);
            QuoteLineItem otherPortLine = TestDataFactory.createTestQuoteLineItem(offer.Id, otherPort.Id, product.Id, 2, 120,
                supplier.Id, delivery, pricebook.Id, supplierTerm.Id, buyerTerm.Id, false, false);
            for (QuoteLineItem control : new List<QuoteLineItem>{sibling, otherPortLine}) {
                control.Buy_Currency__c = 'USD';
                control.Sell_Currency__c = 'USD';
            }
            insert new List<QuoteLineItem>{sibling, otherPortLine};
            fixture.siblingId = sibling.Id;
            fixture.otherPortLineId = otherPortLine.Id;
        }
        System.assertEquals(initialEmails, Limits.getEmailInvocations(), 'Fixture creation invoked email.');
        System.assertEquals(initialJobs, Limits.getQueueableJobs(), 'Fixture creation queued external or background work.');
        System.assertEquals(0, Limits.getCallouts(), 'Fixture creation sent an unexpected callout.');
        return fixture;
    }

    @IsTest
    static void ordinaryEditorRowsStayInsideSyntheticTradingScope() {
        Fixture fixture = createFixture(false);
        Test.startTest();
        update new QuoteLineItem(Id=fixture.lineId, UnitPrice=101);
        update new Supplier_Bid__c(Id=fixture.bidId, Supplier_Unit_Price__c=81);
        update new Supplier_Bid_Extra_Cost__c(Id=fixture.extraId, Unit_Cost__c=11);
        update new Quote(Id=fixture.offerId, Status='Offer Sent & Negotiation');
        assertNoExternalWork();
        Test.stopTest();
        assertScope(fixture);
    }

    @IsTest
    static void nativeUsdFixtureCleanupUsesChildFirstDeletes() {
        Fixture fixture = createFixture(true);
        Test.startTest();
        delete new Supplier_Bid_Extra_Cost__c(Id=fixture.extraId);
        delete new Supplier_Bid__c(Id=fixture.bidId);
        delete new List<QuoteLineItem>{
            new QuoteLineItem(Id=fixture.lineId),
            new QuoteLineItem(Id=fixture.siblingId),
            new QuoteLineItem(Id=fixture.otherPortLineId)
        };
        delete new Quote(Id=fixture.offerId);
        delete new Opportunity(Id=fixture.enquiryId);
        delete new List<Account>{new Account(Id=fixture.buyerId), new Account(Id=fixture.supplierId)};
        assertNoExternalWork();
        Test.stopTest();

        Set<Id> lines = new Set<Id>{fixture.lineId, fixture.siblingId, fixture.otherPortLineId};
        Set<Id> accounts = new Set<Id>{fixture.buyerId, fixture.supplierId};
        System.assertEquals(0, [SELECT COUNT() FROM Supplier_Bid_Extra_Cost__c WHERE Id=:fixture.extraId]);
        System.assertEquals(0, [SELECT COUNT() FROM Supplier_Bid__c WHERE Id=:fixture.bidId]);
        System.assertEquals(0, [SELECT COUNT() FROM QuoteLineItem WHERE Id IN :lines]);
        System.assertEquals(0, [SELECT COUNT() FROM Quote WHERE Id=:fixture.offerId]);
        System.assertEquals(0, [SELECT COUNT() FROM Opportunity WHERE Id=:fixture.enquiryId]);
        System.assertEquals(0, [SELECT COUNT() FROM Account WHERE Id IN :accounts]);
        System.assertEquals(0, [SELECT COUNT() FROM STEM__c]);
        System.assertEquals(0, [SELECT COUNT() FROM Nomination__c]);
        System.assertEquals(0, [SELECT COUNT() FROM Trade_Cash_Event__c]);
    }

    private static void assertNoExternalWork() {
        System.assertEquals(0, Limits.getEmailInvocations(), 'Fixture edit invoked email.');
        System.assertEquals(0, Limits.getQueueableJobs(), 'Fixture edit queued external or background work.');
        System.assertEquals(0, Limits.getCallouts(), 'Fixture edit sent an unexpected callout.');
    }

    private static void assertScope(Fixture fixture) {
        Quote saved = [SELECT OpportunityId, Quote_Buyer__c, Status FROM Quote WHERE Id=:fixture.offerId];
        System.assertEquals(fixture.enquiryId, saved.OpportunityId);
        System.assertEquals(fixture.buyerId, saved.Quote_Buyer__c);
        System.assertEquals('Offer Sent & Negotiation', saved.Status);
        System.assertEquals(fixture.buyerId, [SELECT AccountId FROM Opportunity WHERE Id=:fixture.enquiryId].AccountId);
        QuoteLineItem savedLine = [SELECT QuoteId, Supplier__c, Winning__c FROM QuoteLineItem WHERE Id=:fixture.lineId];
        System.assertEquals(fixture.offerId, savedLine.QuoteId);
        System.assertEquals(fixture.supplierId, savedLine.Supplier__c);
        System.assertEquals(false, savedLine.Winning__c);
        Supplier_Bid__c savedBid = [SELECT Quote__c, Supplier__c FROM Supplier_Bid__c WHERE Id=:fixture.bidId];
        System.assertEquals(fixture.offerId, savedBid.Quote__c);
        System.assertEquals(fixture.supplierId, savedBid.Supplier__c);
        System.assertEquals(fixture.bidId, [SELECT Supplier_Bid__c FROM Supplier_Bid_Extra_Cost__c WHERE Id=:fixture.extraId].Supplier_Bid__c);
        System.assertEquals(0, [SELECT COUNT() FROM STEM__c], 'A non-nomination Quote created STEM records.');
        System.assertEquals(0, [SELECT COUNT() FROM Nomination__c], 'A non-nomination Quote created nominations.');
        System.assertEquals(0, [SELECT COUNT() FROM Trade_Cash_Event__c], 'An ordinary fixture edit created ledger events.');
    }

    private static User createTrader(Boolean canEditFx) {
        Id profileId = [SELECT Id FROM Profile WHERE Name='FCB Trader' AND UserLicense.LicenseDefinitionKey='SFDC'
            AND PermissionsModifyAllData=false LIMIT 1].Id;
        User actor = new User(Alias='fxrehear', LastName='FCOS Fixture Rehearsal Trader', Email='fxrehearsal@example.com',
            Username='fxrehearsal.'+UserInfo.getOrganizationId()+'.'+Datetime.now().getTime()+'@example.com',
            EmailEncodingKey='UTF-8', LanguageLocaleKey='en_US', LocaleSidKey='en_US',
            TimeZoneSidKey='Asia/Hong_Kong', ProfileId=profileId);
        insert actor;
        if (canEditFx) {
            insert new PermissionSetAssignment(AssigneeId=actor.Id,
                PermissionSetId=[SELECT Id FROM PermissionSet WHERE Name='Fcos_Trading_FX_Access' LIMIT 1].Id);
        }
        return actor;
    }

    private static FcosCompanyFxRateService.Snapshot rate(String revision, Decimal value) {
        FcosCompanyFxRateService.Snapshot snapshot = new FcosCompanyFxRateService.Snapshot();
        snapshot.rateId = revision;
        snapshot.revision = revision;
        snapshot.usdHkdRate = value;
        snapshot.effectiveAt = Datetime.newInstanceGmt(2026, 9, 1, 0, 0, 0);
        return snapshot;
    }

    private static FcosCompanyFxRateService.EditorFixtureEnrollment offerEnrollment(Fixture fixture, Set<Id> recordIds) {
        FcosCompanyFxRateService.EditorFixtureEnrollment enrollment = new FcosCompanyFxRateService.EditorFixtureEnrollment();
        enrollment.fixtureId = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
        enrollment.actorId = UserInfo.getUserId();
        enrollment.scopeId = fixture.offerId;
        enrollment.direction = 'Sell';
        enrollment.recordIds = recordIds;
        enrollment.startsAt = System.now().addMinutes(-1);
        enrollment.expiresAt = System.now().addMinutes(1);
        return enrollment;
    }

    @IsTest
    static void managedQuoteSaleAppliesOnlyToTheSamePortAndSide() {
        System.runAs(createTrader(true)) {
            Fixture fixture = createFixture(true);
            FcosCompanyFxRateService.settingsOverride = new Fcos_Trading_FX_Setting__c(Enabled__c=true);
            FcosCompanyFxRateService.Snapshot current = rate('fixture-quote-rate', 7.8);
            Test.startTest();
            FcosTradeCurrencyService.Review before = FcosTradeCurrencyService.review(fixture.lineId, 'Sell', current);
            FcosTradeCurrencyService.Review buy = FcosTradeCurrencyService.review(fixture.lineId, 'Buy', null);
            FcosTradeCurrencyService.Review other = FcosTradeCurrencyService.review(fixture.otherPortLineId, 'Sell', null);
            System.assertEquals(false, before.managedPrice);
            System.assertEquals(true, before.hongKong);
            FcosTradeCurrencyService.Review saved = FcosTradeCurrencyService.save(fixture.lineId, 'Sell', 'HKD', 780,
                before.fingerprint, current, true);
            System.assertEquals(true, saved.managedPrice);
            System.assertEquals('HKD', saved.currencyCode);
            System.assertEquals('fixture-quote-rate', saved.rateId);
            System.assertEquals(buy.fingerprint, FcosTradeCurrencyService.review(fixture.lineId, 'Buy', null).fingerprint);
            System.assertEquals(other.fingerprint, FcosTradeCurrencyService.review(fixture.otherPortLineId, 'Sell', null).fingerprint);
            QuoteLineItem sibling = [SELECT Sell_FX_Side__c, Sell_HKD_Unit_Price__c, UnitPrice FROM QuoteLineItem WHERE Id=:fixture.siblingId];
            Quote parent = [SELECT Sell_FX_Side__c FROM Quote WHERE Id=:fixture.offerId];
            System.assertNotEquals(null, parent.Sell_FX_Side__c);
            System.assertEquals(parent.Sell_FX_Side__c, sibling.Sell_FX_Side__c);
            System.assertEquals(858, sibling.Sell_HKD_Unit_Price__c);
            System.assertEquals(110, sibling.UnitPrice);
            assertNoExternalWork();
            Test.stopTest();
            assertScope(fixture);
        }
    }

    @IsTest
    static void staleBidConfirmationLeavesDraftAndRelatedPricesUnchanged() {
        System.runAs(createTrader(true)) {
            Fixture fixture = createFixture(false);
            FcosCompanyFxRateService.settingsOverride = new Fcos_Trading_FX_Setting__c(Enabled__c=true);
            FcosCompanyFxRateService.Snapshot current = rate('fixture-bid-rate', 7.8);
            Test.startTest();
            FcosTradeCurrencyService.Review before = FcosTradeCurrencyService.review(fixture.bidId, 'Buy', current);
            FcosTradeCurrencyService.Review draft = FcosTradeCurrencyService.save(fixture.bidId, 'Buy', 'HKD', 624,
                before.fingerprint, current, false);
            System.assertEquals(true, draft.managedPrice);
            Integer dmlBefore = Limits.getDmlStatements();
            try {
                FcosTradeCurrencyService.save(fixture.bidId, 'Buy', 'HKD', 624, draft.fingerprint,
                    rate('fixture-bid-new-rate', 8), true);
                System.assert(false, 'A changed rate must refuse confirmation.');
            } catch (FcosTradeCurrencyService.TradeFxException error) {
                System.assert(error.getMessage().contains('changed'));
            }
            System.assertEquals(dmlBefore, Limits.getDmlStatements(), 'Stale requests must perform no DML.');
            FcosTradeCurrencyService.Review after = FcosTradeCurrencyService.review(fixture.bidId, 'Buy', current);
            System.assertEquals(draft.fingerprint, after.fingerprint);
            System.assertEquals(null, after.confirmedAt);
            Supplier_Bid_Extra_Cost__c extra = [SELECT Buy_Currency__c, Buy_HKD_Unit_Price__c, Unit_Cost__c FROM Supplier_Bid_Extra_Cost__c WHERE Id=:fixture.extraId];
            System.assertEquals('HKD', extra.Buy_Currency__c);
            System.assertEquals(78, extra.Buy_HKD_Unit_Price__c);
            System.assertEquals(10, extra.Unit_Cost__c);
            assertNoExternalWork();
            Test.stopTest();
            assertScope(fixture);
        }
    }

    @IsTest
    static void traderWithoutFxEntryCannotWriteManagedSide() {
        System.runAs(createTrader(false)) {
            Fixture fixture = createFixture(false);
            FcosCompanyFxRateService.settingsOverride = new Fcos_Trading_FX_Setting__c(Enabled__c=true);
            FcosCompanyFxRateService.Snapshot current = rate('fixture-restricted-rate', 7.8);
            System.assertEquals(false, FeatureManagement.checkPermission('Fcos_Trading_FX_Entry'));
            Test.startTest();
            FcosTradeCurrencyService.Review before = FcosTradeCurrencyService.review(fixture.lineId, 'Sell', current);
            System.assertEquals(true, before.hongKong);
            Integer dmlBefore = Limits.getDmlStatements();
            try {
                FcosTradeCurrencyService.save(fixture.lineId, 'Sell', 'HKD', 780, before.fingerprint, current, true);
                System.assert(false, 'The restricted trader cannot confirm a managed side.');
            } catch (FcosTradeCurrencyService.TradeFxException error) {
                System.assertEquals('HKD trading entry is not enabled for this user.', error.getMessage());
            }
            String fixtureId = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
            String refusal = (Id)UserInfo.getOrganizationId() == FcosCompanyFxRateService.DEVEE
                ? 'requires FX Entry access' : 'only in DEVEE';
            try {
                FcosTradeCurrencyController.previewFixture(fixtureId, fixture.lineId, 'Sell', 'HKD');
                System.assert(false, 'The restricted trader cannot preview a fixture side.');
            } catch (FcosCompanyFxRateService.FxException error) {
                System.assert(error.getMessage().contains(refusal));
            }
            try {
                FcosTradeCurrencyController.saveFixture(fixtureId, fixture.lineId, 'Sell', 'HKD', 780,
                    before.fingerprint, current.rateId, true);
                System.assert(false, 'The restricted trader cannot save a fixture side.');
            } catch (FcosCompanyFxRateService.FxException error) {
                System.assert(error.getMessage().contains(refusal));
            }
            System.assertEquals(dmlBefore, Limits.getDmlStatements());
            System.assertEquals(before.fingerprint, FcosTradeCurrencyService.review(fixture.lineId, 'Sell', current).fingerprint);
            System.assertEquals(0, [SELECT COUNT() FROM Trade_Currency_Side__c]);
            assertNoExternalWork();
            Test.stopTest();
        }
    }

    @IsTest
    static void deveeEditorSaveRequiresExactLockedSetWithGlobalFxDisabled() {
        if ((Id)UserInfo.getOrganizationId() != FcosCompanyFxRateService.DEVEE) {
            try {
                FcosCompanyFxRateService.assertEditorFixtureContext(null, null);
                System.assert(false, 'A fixture guard must refuse any other org.');
            } catch (FcosCompanyFxRateService.FxException error) {
                System.assert(error.getMessage().contains('only in DEVEE'));
            }
            return;
        }
        System.runAs(createTrader(true)) {
            Fixture fixture = createFixture(true);
            FcosCompanyFxRateService.settingsOverride = new Fcos_Trading_FX_Setting__c(Enabled__c=false);
            FcosCompanyFxRateService.Snapshot current = rate('fixture-locked-rate', 7.8);
            FcosCompanyFxRateService.EditorFixtureEnrollment enrollment = offerEnrollment(fixture, new Set<Id>{fixture.lineId});
            Test.startTest();
            FcosTradeCurrencyService.Review before = FcosTradeCurrencyService.review(fixture.lineId, 'Sell', current);
            FcosTradeCurrencyService.Review ordinary = FcosTradeCurrencyController.previewCurrency(fixture.lineId, 'Sell', 'USD');
            System.assertEquals(false, ordinary.enabled);
            System.assertEquals('USD', ordinary.currencyCode);
            System.assertEquals(100, ordinary.nativeUnitPrice);
            System.assertEquals(ordinary.nativeUnitPrice, ordinary.usdUnitPrice);
            System.assertEquals(before.fingerprint, ordinary.fingerprint);
            FcosTradeCurrencyService.Review otherPort = FcosTradeCurrencyService.review(fixture.otherPortLineId, 'Sell', null);
            FcosTradeCurrencyService.Review buy = FcosTradeCurrencyService.review(fixture.lineId, 'Buy', null);
            FcosTradeCurrencyService.Context ctx = FcosTradeCurrencyService.context(fixture.lineId, 'Sell');
            Integer dmlBefore = Limits.getDmlStatements();
            try {
                FcosTradeCurrencyService.reviewEditorFixtureContext(enrollment, ctx, current);
                System.assert(false, 'An unenrolled sibling must block the preview.');
            } catch (FcosTradeCurrencyService.TradeFxException error) {
                System.assert(error.getMessage().contains('write set changed'));
            }
            try {
                FcosTradeCurrencyService.saveReviewed(fixture.lineId, 'Sell', 'HKD', 780, before.fingerprint,
                    current, true, null, enrollment);
                System.assert(false, 'An unenrolled sibling must block the save.');
            } catch (FcosTradeCurrencyService.TradeFxException error) {
                System.assert(error.getMessage().contains('write set changed'));
            }
            System.assertEquals(dmlBefore, Limits.getDmlStatements());
            enrollment.recordIds.add(fixture.siblingId);
            FcosTradeCurrencyService.Review scoped = FcosTradeCurrencyService.reviewEditorFixtureContext(enrollment, ctx, current);
            System.assertEquals(true, scoped.enabled);
            System.assertEquals(false, before.enabled);
            System.assertEquals(before.fingerprint, scoped.fingerprint);
            System.assertEquals(current.rateId, scoped.rateId);
            FcosTradeCurrencyService.Review saved = FcosTradeCurrencyService.saveReviewed(fixture.lineId, 'Sell', 'HKD', 780,
                scoped.fingerprint, current, true, null, enrollment);
            System.assertEquals('HKD', saved.currencyCode);
            System.assertEquals(true, saved.enabled);
            System.assertEquals(false, FcosCompanyFxRateService.enabled());
            System.assertEquals(false, FcosTradeCurrencyService.isManagedWrite());
            System.assertEquals(otherPort.fingerprint, FcosTradeCurrencyService.review(fixture.otherPortLineId, 'Sell', null).fingerprint);
            System.assertEquals(buy.fingerprint, FcosTradeCurrencyService.review(fixture.lineId, 'Buy', null).fingerprint);
            Id sideId = [SELECT Sell_FX_Side__c FROM QuoteLineItem WHERE Id=:fixture.lineId].Sell_FX_Side__c;
            assertDeleteRefused(new QuoteLineItem(Id=fixture.lineId), 'Retain native trading');
            assertDeleteRefused(new Quote(Id=fixture.offerId), 'Retain the buyer');
            assertDeleteRefused(new Trade_Currency_Side__c(Id=sideId), 'Use the reviewed trading-currency action');
            System.assertEquals(saved.fingerprint, FcosTradeCurrencyService.review(fixture.lineId, 'Sell', null).fingerprint);
            assertNoExternalWork();
            Test.stopTest();
            assertScope(fixture);
        }
    }

    @IsTest
    static void nativeTeardownRejectsUnverifiedClaimBeforeCalloutOrDml() {
        System.runAs(createTrader(true)) {
            Integer initialDml = Limits.getDmlStatements();
            Integer initialCallouts = Limits.getCallouts();
            try {
                FcosTradeCurrencyController.teardownFixture('invalid-payload', 'invalid-signature');
                System.assert(false, 'The unverified teardown should be refused.');
            } catch (FcosCompanyFxRateService.FxException error) {
                String expectedError = (Id)UserInfo.getOrganizationId() == FcosCompanyFxRateService.DEVEE
                    ? 'The editor fixture teardown claim could not be verified.'
                    : 'The editor fixture is available only in DEVEE.';
                System.assertEquals(expectedError, error.getMessage(), 'Teardown must stop at the applicable guard.');
            }
            System.assertEquals(initialDml, Limits.getDmlStatements());
            System.assertEquals(initialCallouts, Limits.getCallouts());
        }
    }

    @IsTest
    static void deveeManagedTeardownRejectsStaleProofAndRemovesOnlyItsExactScope() {
        if ((Id)UserInfo.getOrganizationId() != FcosCompanyFxRateService.DEVEE) return;
        System.runAs(createTrader(true)) {
            Fixture fixture = createFixture(true);
            FcosCompanyFxRateService.settingsOverride = new Fcos_Trading_FX_Setting__c(Enabled__c=false);
            FcosCompanyFxRateService.Snapshot current = rate('fixture-teardown-rate', 7.8);
            Set<Id> enrolled = new Set<Id>{fixture.lineId, fixture.siblingId};
            FcosCompanyFxRateService.EditorFixtureEnrollment enrollment = offerEnrollment(fixture, enrolled);
            Test.startTest();
            FcosTradeCurrencyService.Review before = FcosTradeCurrencyService.review(fixture.lineId, 'Sell', current);
            FcosTradeCurrencyService.Review otherPort = FcosTradeCurrencyService.review(fixture.otherPortLineId, 'Sell', null);
            FcosTradeCurrencyService.Review saved = FcosTradeCurrencyService.saveReviewed(fixture.lineId, 'Sell', 'HKD', 780,
                before.fingerprint, current, true, null, enrollment);
            Id sideId = [SELECT Sell_FX_Side__c FROM QuoteLineItem WHERE Id=:fixture.lineId].Sell_FX_Side__c;
            Integer teardownDml = Limits.getDmlStatements();
            FcosCompanyFxRateService.EditorFixtureTeardownClaim claim = new FcosCompanyFxRateService.EditorFixtureTeardownClaim();
            claim.schemaVersion = 1;
            claim.purpose = 'devee-editor-fixture-teardown';
            claim.orgId = FcosCompanyFxRateService.DEVEE;
            claim.fixtureId = enrollment.fixtureId;
            claim.actorId = enrollment.actorId;
            claim.operationId = 'fixture-rehearsal-create';
            claim.sourceTreeHash = enrollment.fixtureId;
            claim.creationDigest = enrollment.fixtureId;
            claim.saveDigest = enrollment.fixtureId;
            claim.observationDigest = enrollment.fixtureId;
            claim.scopeId = fixture.offerId;
            claim.recordId = fixture.lineId;
            claim.direction = 'Sell';
            claim.recordIds = new List<Id>(enrolled);
            claim.sideId = sideId;
            claim.fingerprint = enrollment.fixtureId;
            claim.issuedAtMs = System.now().getTime();
            claim.expiresAtMs = claim.issuedAtMs + 60000;
            try {
                FcosTradeCurrencyService.applyEditorFixtureTeardown(enrollment, claim);
                System.assert(false, 'The rehearsal must reject changed evidence.');
            } catch (FcosCompanyFxRateService.FxException error) {
                System.assert(error.getMessage().contains('does not match the locked scope'));
            }
            System.assertEquals(teardownDml, Limits.getDmlStatements());
            claim.fingerprint = saved.fingerprint;
            FcosTradeCurrencyService.applyEditorFixtureTeardown(enrollment, claim);
            System.assertEquals(0, [SELECT COUNT() FROM QuoteLineItem WHERE Id IN :enrolled]);
            System.assertEquals(0, [SELECT COUNT() FROM Trade_Currency_Side__c WHERE Id=:sideId]);
            System.assertEquals(null, [SELECT Sell_FX_Side__c FROM Quote WHERE Id=:fixture.offerId].Sell_FX_Side__c);
            System.assertEquals(otherPort.fingerprint, FcosTradeCurrencyService.review(fixture.otherPortLineId, 'Sell', null).fingerprint);
            System.assertEquals(1, [SELECT COUNT() FROM Supplier_Bid__c WHERE Id=:fixture.bidId]);
            System.assertEquals(false, FcosTradeCurrencyService.isEditorFixtureTeardownRow(fixture.lineId, 'Sell', sideId));
            assertNoExternalWork();
            Test.stopTest();
        }
    }

    private static void assertDeleteRefused(SObject record, String message) {
        Database.DeleteResult attempt = Database.delete(record, false);
        System.assertEquals(false, attempt.isSuccess());
        System.assert(attempt.getErrors()[0].getMessage().contains(message), attempt.getErrors()[0].getMessage());
    }
}
