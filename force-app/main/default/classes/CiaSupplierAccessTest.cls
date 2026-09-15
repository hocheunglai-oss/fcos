@IsTest
private with sharing class CiaSupplierAccessTest {
    @TestSetup
    static void setupData() {
        TestDataFactory.prepareDataForNominationConfirmationFlow();
    }

    @IsTest
    static void supportCanSaveSupplierConfirmationWithAnotherUsersTask() {
        verifySupportSave(false, true, false);
    }

    @IsTest
    static void supportCanClearSupplierConfirmationWithAnotherUsersTask() {
        verifySupportSave(true, false, false);
    }

    @IsTest
    static void supportStaleSaveCannotChangeAnotherUsersTask() {
        verifySupportSave(false, true, true);
    }

    private static void verifySupportSave(Boolean initiallyConfirmed, Boolean confirm, Boolean stale) {
        Profile supportProfile = [SELECT Id FROM Profile WHERE Name = 'Sales Support' LIMIT 1];
        User support = new User(
            Alias = 'ciatest', Email = 'cia-support@example.invalid',
            EmailEncodingKey = 'UTF-8', LastName = 'CIA Support Test',
            LanguageLocaleKey = 'en_US', LocaleSidKey = 'en_US',
            ProfileId = supportProfile.Id, TimeZoneSidKey = 'Asia/Hong_Kong',
            Username = 'cia-support.' + UserInfo.getOrganizationId() + '.' + DateTime.now().getTime() + '@example.invalid'
        );
        System.runAs(new User(Id = UserInfo.getUserId())) {
            insert support;
            // This is already assigned to the affected user in Production and
            // exposes the native fields read by asynchronous charge processing.
            List<PermissionSetAssignment> assignments = new List<PermissionSetAssignment>();
            for (PermissionSet permission : [SELECT Id, PermissionsModifyAllData FROM PermissionSet
                WHERE Name = 'FCOS_Variable_Charges_User']) {
                System.assertEquals(false, permission.PermissionsModifyAllData);
                assignments.add(new PermissionSetAssignment(AssigneeId = support.Id, PermissionSetId = permission.Id));
            }
            System.assertEquals(1, assignments.size(), 'The existing charge-user permission set must be available.');
            insert assignments;
        }
        STEM__c stem = [SELECT Id, Enquiry__c FROM STEM__c LIMIT 1];
        Account supplier = [SELECT Id FROM Account WHERE RecordTypeId = :FCBStatic.SUPPLIER_ACCOUNT_RT_ID LIMIT 1];
        STEM_Extra_Cost__c charge = TestDataFactory.createTestStemExtraCost(
            stem.Id, null, 100, 1, 1, 1, 1, 1, 'STEM Charge', false);
        charge.Supplier__c = supplier.Id;
        charge.Payment_Term__c = 'CIA';
        charge.Intended_Payment_Date__c = Date.today().addDays(4);
        charge.Reconfirm__c = initiallyConfirmed;
        insert charge;
        String taskKey = stem.Id + '-' + supplier.Id;
        Task initialTask = [SELECT Id, OwnerId FROM Task WHERE Reconfirm_Unique_Key__c = :taskKey LIMIT 1];
        System.assertNotEquals(support.Id, initialTask.OwnerId, 'The regression requires a task owned by someone else.');
        if (initiallyConfirmed) update new Task(Id = initialTask.Id, Status = 'Completed');
        UserRecordAccess taskAccess = [SELECT RecordId, HasEditAccess FROM UserRecordAccess
            WHERE UserId = :support.Id AND RecordId = :initialTask.Id];
        System.assertEquals(false, taskAccess.HasEditAccess, 'Support must not gain direct access to another user\'s task.');

        System.runAs(support) {
            ReconfirmProcessing.ReconfirmItem loaded;
            for (ReconfirmProcessing.ReconfirmItem row : ReconfirmProcessing.getReconfirmInfo(new List<String>{stem.Enquiry__c})) {
                if (row.id == charge.Id) loaded = row;
            }
            System.assertNotEquals(null, loaded, 'Support must be able to read the authorized CIA row.');
            ReconfirmProcessing.CiaChangeInput change = new ReconfirmProcessing.CiaChangeInput();
            change.recordId = charge.Id;
            change.intendedPaymentDate = Date.today().addDays(5);
            change.intendedPaymentDateChanged = true;
            change.reconfirm = confirm;
            change.reconfirmChanged = true;
            change.expectedLastModifiedAt = stale ? loaded.lastModifiedAt.addDays(-1) : loaded.lastModifiedAt;
            Test.startTest();
            if (stale) {
                Boolean rejected = false;
                try {
                    ReconfirmProcessing.saveCiaChanges(stem.Enquiry__c, new List<ReconfirmProcessing.CiaChangeInput>{change});
                } catch (AuraHandledException expected) {
                    rejected = true;
                }
                System.assertEquals(true, rejected, 'Stale source rows must not reach task automation.');
            } else {
                ReconfirmProcessing.saveCiaChanges(stem.Enquiry__c, new List<ReconfirmProcessing.CiaChangeInput>{change});
            }
            Test.stopTest();
        }
        STEM_Extra_Cost__c saved = [SELECT Reconfirm__c, Intended_Payment_Date__c FROM STEM_Extra_Cost__c WHERE Id = :charge.Id];
        System.assertEquals(stale ? initiallyConfirmed : confirm, saved.Reconfirm__c);
        System.assertEquals(Date.today().addDays(stale ? 4 : 5), saved.Intended_Payment_Date__c);
        Task savedTask = [SELECT OwnerId, Status FROM Task WHERE Id = :initialTask.Id];
        System.assertEquals(initialTask.OwnerId, savedTask.OwnerId, 'Saving must preserve task ownership.');
        System.assertEquals((stale ? initiallyConfirmed : confirm) ? 'Completed' : 'Open', savedTask.Status);
        System.assertEquals(1, [SELECT COUNT() FROM Task WHERE Reconfirm_Unique_Key__c = :taskKey]);

        System.assertEquals(false, [SELECT RecordId, HasEditAccess FROM UserRecordAccess
            WHERE UserId = :support.Id AND RecordId = :initialTask.Id].HasEditAccess);
    }
}
