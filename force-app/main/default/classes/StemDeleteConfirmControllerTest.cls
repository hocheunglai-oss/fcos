@IsTest
private class StemDeleteConfirmControllerTest {
    @TestSetup
    static void makeData() {
        TestDataFactory.prepareDataForNominationConfirmationFlow();
    }

    private static STEM_Variable_Charge_Supplier__c addVariableChargeSupplier(STEM__c stem) {
        STEM_Line_Item__c lineItem = [
            SELECT Original_Supplier__c
            FROM STEM_Line_Item__c
            WHERE STEM__c = :stem.Id AND Original_Supplier__c != null
            LIMIT 1
        ];
        STEM_Variable_Charge_Supplier__c row = new STEM_Variable_Charge_Supplier__c(
            STEM__c = stem.Id,
            Supplier__c = lineItem.Original_Supplier__c,
            Manual_Review_Required__c = true,
            Supplier_Status__c = 'Pending',
            Buyer_Charge_Status__c = 'Pending'
        );
        insert row;
        return row;
    }

    private static StemDeleteConfirmController controllerFor(STEM__c stem) {
        Test.setCurrentPage(Page.StemDeleteConfirm);
        ApexPages.currentPage().getParameters().put('id', stem.Id);
        return new StemDeleteConfirmController(new ApexPages.StandardController(stem));
    }

    @IsTest
    static void deletesStemAndVariableChargesTogether() {
        STEM__c stem = [SELECT Id, Enquiry__c FROM STEM__c LIMIT 1];
        STEM_Variable_Charge_Supplier__c row = addVariableChargeSupplier(stem);
        StemDeleteConfirmController controller = controllerFor(stem);
        System.assertEquals(true, controller.getHasVariableChargeSuppliers());
        System.assertEquals(1, controller.variableChargeSuppliers.size());

        Test.startTest();
        PageReference destination = controller.deleteStemAndVariableCharges();
        Test.stopTest();

        System.assertEquals('/lightning/r/Opportunity/' + stem.Enquiry__c + '/view', destination.getUrl());
        System.assertEquals(0, [SELECT Count() FROM STEM__c WHERE Id = :stem.Id]);
        System.assertEquals(0, [SELECT Count() FROM STEM_Variable_Charge_Supplier__c WHERE Id = :row.Id]);
    }

    @IsTest
    static void rollsBackBothRecordsAndShowsTheFailure() {
        STEM__c stem = [SELECT Id FROM STEM__c LIMIT 1];
        STEM_Variable_Charge_Supplier__c row = addVariableChargeSupplier(stem);
        StemDeleteConfirmController controller = controllerFor(stem);

        Test.startTest();
        StemDeleteConfirmController.forceFailureAfterVariableChargeDelete = true;
        PageReference destination = controller.deleteStemAndVariableCharges();
        StemDeleteConfirmController.forceFailureAfterVariableChargeDelete = false;
        Test.stopTest();

        System.assertEquals(null, destination);
        System.assertEquals(1, [SELECT Count() FROM STEM__c WHERE Id = :stem.Id]);
        System.assertEquals(1, [SELECT Count() FROM STEM_Variable_Charge_Supplier__c WHERE Id = :row.Id]);
        System.assertEquals(1, ApexPages.getMessages().size());
        System.assert(ApexPages.getMessages()[0].getSummary().startsWith('Nothing was deleted.'));
    }

    @IsTest
    static void handlesMissingStemAndCancelWithoutDeleting() {
        Test.setCurrentPage(Page.StemDeleteConfirm);
        StemDeleteConfirmController missingController = new StemDeleteConfirmController(
            new ApexPages.StandardController(new STEM__c())
        );
        System.assertEquals(null, missingController.stem);
        System.assertEquals(false, missingController.getHasVariableChargeSuppliers());
        System.assertEquals(null, missingController.deleteStemAndVariableCharges());
        System.assertEquals(1, ApexPages.getMessages().size());

        STEM__c stem = [SELECT Id FROM STEM__c LIMIT 1];
        StemDeleteConfirmController existingController = controllerFor(stem);
        System.assertNotEquals(null, existingController.cancel());
        System.assertEquals(1, [SELECT Count() FROM STEM__c WHERE Id = :stem.Id]);
    }
}
