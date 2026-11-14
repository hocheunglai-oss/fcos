@IsTest
private class FcosTradeDocumentLineSharingTest {
    private static final String OWNER_LAST_NAME = 'DocumentEvidenceOwner';
    private static final String VIEWER_LAST_NAME = 'DocumentEvidenceViewer';

    @TestSetup
    static void createOwnerIssuedNativeDocument() {
        Id profileId = restrictedTraderProfile();
        User owner = trader('dlown', OWNER_LAST_NAME, profileId);
        User viewer = trader('dlview', VIEWER_LAST_NAME, profileId);
        insert new List<User>{owner, viewer};
        assignPermissions(new Set<Id>{owner.Id, viewer.Id});

        System.runAs(owner) {
            TestDataFactory.prepareDataForNominationConfirmationFlow();
            STEM_Line_Item__c line = [
                SELECT Id, STEM__c, STEM__r.Port__c
                FROM STEM_Line_Item__c
                WHERE Cancelled__c = false
                LIMIT 1
            ];
            ContextManager.skipTriggers = true;
            try {
                update new Port__c(Id = line.STEM__r.Port__c, Country__c = 'HONG KONG');
            } finally {
                ContextManager.skipTriggers = false;
            }

            // The complete factory consumes setup limits. The real reviewed
            // confirmation, document snapshot, and private immutable line use
            // their own transaction budget.
            Test.startTest();
            try {
                FcosCompanyFxRateService.settingsOverride = new Fcos_Trading_FX_Setting__c(Enabled__c = true);
                FcosCompanyFxRateService.Snapshot rate = snapshot();
                FcosTradeCurrencyService.Review reviewed = FcosTradeCurrencyService.review(line.Id, 'Sell', rate);
                FcosTradeCurrencyService.save(line.Id, 'Sell', 'HKD', Decimal.valueOf('780'), reviewed.fingerprint, rate, true);
                FcosTradeDocumentService.DocumentReview document = FcosTradeDocumentService.preview(
                    line.STEM__c, 'Sell', null, new List<Id>{line.Id}
                );
                Invoice__c invoice = new Invoice__c(
                    Name = 'DOCUMENT-LINE-SHARING', STEM__c = line.STEM__c, Amount__c = document.usdTotal,
                    Invoice_Date__c = Date.newInstance(2026, 9, 1), Delivery_Date__c = Date.newInstance(2026, 9, 1),
                    Invoice_Due_Date__c = Date.newInstance(2026, 9, 10), Proforma__c = false, Deprecated__c = false,
                    Document_Presentation_JSON__c = JSON.serialize(new Map<String, String>{
                        'version' => '1', 'legalEntity' => 'Synthetic test company', 'buyerName' => 'Synthetic buyer'
                    })
                );
                FcosTradeDocumentService.applySnapshot(invoice, document);
                insert invoice;
                FcosTradeDocumentLineService.persist(invoice, document);
            } finally {
                Test.stopTest();
            }
        }
    }

    @IsTest
    static void privateEvidenceIsReadOnlyThroughVisibleBusinessDocument() {
        Invoice__c invoice = [
            SELECT Id, STEM__c, STEM__r.Account__c, STEM__r.Account__r.OwnerId
            FROM Invoice__c WHERE Name = 'DOCUMENT-LINE-SHARING' LIMIT 1
        ];
        User viewer = [SELECT Id FROM User WHERE LastName = :VIEWER_LAST_NAME LIMIT 1];
        grantFixtureAccountReadIfNeeded(invoice, viewer);

        System.runAs(viewer) {
            System.assertEquals(1, [SELECT COUNT() FROM Invoice__c WHERE Id = :invoice.Id WITH USER_MODE],
                'The trader may read the business document under the org sharing model.');
            System.assertEquals(0, [SELECT COUNT() FROM Trade_Document_Line__c WHERE Buyer_Invoice__c = :invoice.Id WITH USER_MODE],
                'Private immutable evidence must not be directly queryable by the second trader.');

            List<Trade_Document_Line__c> evidence = FcosTradeDocumentLineService.readForAuthorizedDocument(invoice.Id);
            System.assertEquals(1, evidence.size(), 'The checked parent document authorizes the controlled immutable-evidence read.');
            System.assertEquals('HKD', evidence[0].Currency__c);
            System.assertEquals(Decimal.valueOf('7.8'), evidence[0].FX_Rate__c);
            System.assertEquals('document-line-sharing-rate', evidence[0].FX_Revision__c);

            try {
                FcosTradeDocumentLineService.readForAuthorizedDocument(nonexistentInvoiceId());
                System.assert(false, 'The reader must reject a valid-shaped but unavailable business document ID.');
            } catch (AuraHandledException expected) {
                System.assertNotEquals(null, expected.getMessage());
            }
            try {
                FcosTradeDocumentLineService.readForAuthorizedDocument(invoice.STEM__c);
                System.assert(false, 'The reader must reject an unsupported parent record type.');
            } catch (AuraHandledException expected) {
                System.assertNotEquals(null, expected.getMessage());
            }
        }
    }

    private static void grantFixtureAccountReadIfNeeded(Invoice__c invoice, User viewer) {
        Id accountId = invoice.STEM__r.Account__c;
        Boolean hasAccountRead;
        System.runAs(viewer) {
            hasAccountRead = [SELECT COUNT() FROM Account WHERE Id = :accountId WITH USER_MODE] == 1;
        }
        if (hasAccountRead) return;

        // Invoice and STEM inherit visibility from the test Account.
        // Private Account sharing requires one explicit grant to the test viewer.
        User accountOwner = new User(Id = invoice.STEM__r.Account__r.OwnerId);
        System.runAs(accountOwner) {
            insert new AccountShare(
                AccountId = accountId, UserOrGroupId = viewer.Id, RowCause = Schema.AccountShare.RowCause.Manual,
                AccountAccessLevel = 'Read', OpportunityAccessLevel = 'None', CaseAccessLevel = 'None'
            );
        }
    }

    private static Id nonexistentInvoiceId() {
        return Id.valueOf(Invoice__c.SObjectType.getDescribe().getKeyPrefix() + '000000000000');
    }

    private static Id restrictedTraderProfile() {
        Profile profile = [
            SELECT Id, PermissionsModifyAllData
            FROM Profile
            WHERE Name = 'FCB Trader' AND UserLicense.LicenseDefinitionKey = 'SFDC'
            LIMIT 1
        ];
        System.assertEquals(false, profile.PermissionsModifyAllData,
            'The sharing regression requires the restricted FCB Trader profile.');
        return profile.Id;
    }

    private static User trader(String alias, String lastName, Id profileId) {
        String unique = String.valueOf(Datetime.now().getTime()) + '.' + alias;
        return new User(
            Alias = alias, LastName = lastName, Email = alias + '@example.invalid', Username = unique + '@example.invalid',
            EmailEncodingKey = 'UTF-8', LanguageLocaleKey = 'en_US', LocaleSidKey = 'en_US',
            TimeZoneSidKey = 'Asia/Hong_Kong', ProfileId = profileId
        );
    }

    private static void assignPermissions(Set<Id> userIds) {
        List<PermissionSetAssignment> assignments = new List<PermissionSetAssignment>();
        for (PermissionSet permission : [
            SELECT Id FROM PermissionSet WHERE Name IN ('Fcos_Trading_FX_Access', 'FCOS_Variable_Charges_User')
        ]) for (Id userId : userIds)
            assignments.add(new PermissionSetAssignment(AssigneeId = userId, PermissionSetId = permission.Id));
        System.assertEquals(4, assignments.size(), 'Both restricted traders require the standard FX read/entry permissions.');
        insert assignments;
    }

    private static FcosCompanyFxRateService.Snapshot snapshot() {
        FcosCompanyFxRateService.Snapshot rate = new FcosCompanyFxRateService.Snapshot();
        rate.rateId = 'document-line-sharing-rate';
        rate.revision = 'document-line-sharing-rate';
        rate.usdHkdRate = Decimal.valueOf('7.8');
        rate.effectiveAt = Datetime.newInstanceGmt(2026, 9, 1, 0, 0, 0);
        return rate;
    }
}
