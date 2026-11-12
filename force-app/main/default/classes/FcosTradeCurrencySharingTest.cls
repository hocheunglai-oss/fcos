@IsTest
private class FcosTradeCurrencySharingTest {
    private static final String OWNER_LAST_NAME = 'FxCanonicalOwner';
    private static final String VIEWER_LAST_NAME = 'FxCanonicalViewer';

    @TestSetup
    static void setupTradeOwnedByAnotherTrader() {
        Id profileId = restrictedTraderProfile();
        User owner = trader('fxown', OWNER_LAST_NAME, profileId);
        User viewer = trader('fxview', VIEWER_LAST_NAME, profileId);
        insert new List<User>{owner, viewer};
        assignTradingPermissions(new Set<Id>{owner.Id, viewer.Id});

        System.runAs(owner) {
            TestDataFactory.prepareDataForNominationConfirmationFlow();
            STEM_Line_Item__c line = [
                SELECT Id, STEM__c, STEM__r.Account__c, STEM__r.Port__c
                FROM STEM_Line_Item__c
                WHERE Cancelled__c = false
                LIMIT 1
            ];
            // The factory's port name is derived. Country is the canonical HK signal.
            ContextManager.skipTriggers = true;
            try {
                update new Port__c(Id = line.STEM__r.Port__c, Country__c = 'HONG KONG');
            } finally {
                ContextManager.skipTriggers = false;
            }

            Test.startTest();
            FcosCompanyFxRateService.settingsOverride = new Fcos_Trading_FX_Setting__c(Enabled__c = true);
            FcosCompanyFxRateService.Snapshot rate = snapshot();
            FcosTradeCurrencyService.Review reviewed = FcosTradeCurrencyService.review(line.Id, 'Sell', rate);
            FcosTradeCurrencyService.save(line.Id, 'Sell', 'HKD', Decimal.valueOf('780'), reviewed.fingerprint, rate, true);
            Test.stopTest();
        }
        STEM_Line_Item__c source = [SELECT STEM__r.Account__c FROM STEM_Line_Item__c WHERE Cancelled__c = false LIMIT 1];
        // STEM and its lines are controlled by the buyer account. Move only that
        // source parent to the second trader; the independent canonical side
        // remains private and owned by the first trader.
        update new Account(Id = source.STEM__r.Account__c, OwnerId = viewer.Id);
    }

    @IsTest
    static void visibleTradeUsesPrivateCanonicalSideWithoutExposingIt() {
        User viewer = [SELECT Id FROM User WHERE LastName = :VIEWER_LAST_NAME LIMIT 1];
        System.runAs(viewer) {
            List<STEM_Line_Item__c> visibleRows = [
                SELECT Id, STEM__c, Sell_FX_Side__c
                FROM STEM_Line_Item__c
                WHERE Cancelled__c = false AND Sell_FX_Side__c != null
                WITH USER_MODE
                LIMIT 1
            ];
            System.assertEquals(1, visibleRows.size(), 'The buyer account owner must retain access to the controlled STEM source.');
            STEM_Line_Item__c visible = visibleRows[0];

            List<Trade_Currency_Side__c> directCanonicalRows = [
                SELECT Id
                FROM Trade_Currency_Side__c
                WHERE Id = :visible.Sell_FX_Side__c
                WITH USER_MODE
            ];
            System.assertEquals(0, directCanonicalRows.size(),
                'A second restricted trader must not read the private canonical FX side directly.');

            FcosCompanyFxRateService.settingsOverride = new Fcos_Trading_FX_Setting__c(Enabled__c = true);
            Test.startTest();
            FcosTradeCurrencyService.Review review = FcosTradeCurrencyService.review(visible.Id, 'Sell', null);
            FcosTradeDocumentService.DocumentReview document = FcosTradeDocumentService.preview(
                visible.STEM__c, 'Sell', null, new List<Id>{visible.Id}
            );
            FcosTradeCurrencyService.Review saved = FcosTradeCurrencyService.save(
                visible.Id, 'Sell', 'HKD', review.nativeUnitPrice, review.fingerprint, null, true
            );
            STEM__c previousParent=[SELECT Id,Account__c,Port__c,Sell_Currency__c,Sell_FX_Side__c FROM STEM__c WHERE Id=:visible.STEM__c];
            STEM__c changedParent=previousParent.clone(true,false,false,false);
            changedParent.Port__c=null;
            FcosTradeCurrencyParentGuard.guard(new List<SObject>{changedParent},new Map<Id,SObject>{previousParent.Id=>previousParent},false);
            System.assert(changedParent.hasErrors(),'A private canonical HKD side must still prevent moving the visible trade to another port.');
            Test.stopTest();

            System.assertEquals('HKD', review.currencyCode);
            System.assertEquals(Decimal.valueOf('7.8'), review.rate);
            System.assertEquals('sharing-rate', review.rateId);
            System.assertEquals('HKD', document.currencyCode);
            System.assertEquals(Decimal.valueOf('7.8'), document.rate);
            System.assertEquals('sharing-rate', document.rateId);
            System.assertEquals('HKD', saved.currencyCode);
            System.assertEquals('sharing-rate', saved.rateId,
                'The reviewed service save must retain the private canonical rate without direct side access.');
        }
    }

    private static Id restrictedTraderProfile() {
        List<Profile> profiles = [
            SELECT Id, PermissionsModifyAllData
            FROM Profile
            WHERE Name = 'FCB Trader' AND UserLicense.LicenseDefinitionKey = 'SFDC'
            LIMIT 1
        ];
        System.assertEquals(1, profiles.size(), 'The sharing regression requires the restricted FCB Trader profile.');
        System.assertEquals(false, profiles[0].PermissionsModifyAllData,
            'The test must not rely on Modify All Data to hide or expose the private canonical side.');
        return profiles[0].Id;
    }

    private static User trader(String alias, String lastName, Id profileId) {
        String unique = String.valueOf(Datetime.now().getTime()) + '.' + alias;
        return new User(
            Alias = alias, LastName = lastName, Email = alias + '@example.invalid',
            Username = unique + '@example.invalid', EmailEncodingKey = 'UTF-8',
            LanguageLocaleKey = 'en_US', LocaleSidKey = 'en_US', TimeZoneSidKey = 'Asia/Hong_Kong', ProfileId = profileId
        );
    }

    private static void assignTradingPermissions(Set<Id> userIds) {
        Map<String, Id> permissionIds = new Map<String, Id>();
        for (PermissionSet permission : [
            SELECT Id, Name FROM PermissionSet
            WHERE Name IN ('Fcos_Trading_FX_Access', 'FCOS_Variable_Charges_User')
        ]) permissionIds.put(permission.Name, permission.Id);
        System.assertEquals(2, permissionIds.size(), 'Both trader permission sets are required for the real guarded fixture.');
        List<PermissionSetAssignment> assignments = new List<PermissionSetAssignment>();
        for (Id userId : userIds) for (Id permissionId : permissionIds.values())
            assignments.add(new PermissionSetAssignment(AssigneeId = userId, PermissionSetId = permissionId));
        insert assignments;
    }

    private static FcosCompanyFxRateService.Snapshot snapshot() {
        FcosCompanyFxRateService.Snapshot rate = new FcosCompanyFxRateService.Snapshot();
        rate.rateId = 'sharing-rate';
        rate.revision = 'sharing-rate';
        rate.usdHkdRate = Decimal.valueOf('7.8');
        rate.effectiveAt = Datetime.newInstanceGmt(2026, 9, 1, 0, 0, 0);
        return rate;
    }
}
