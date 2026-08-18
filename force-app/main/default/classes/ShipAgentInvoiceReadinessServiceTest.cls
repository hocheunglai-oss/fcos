@IsTest
private class ShipAgentInvoiceReadinessServiceTest {
    @TestSetup
    static void makeData() {
        TestDataFactory.prepareDataForNominationConfirmationFlow();
    }

    @IsTest
    static void compatibilityFacadeMatchesCanonicalReadiness() {
        STEM__c stem = [SELECT Id FROM STEM__c LIMIT 1];
        VariableChargeInvoiceReadinessService.Readiness canonical =
            VariableChargeInvoiceReadinessService.evaluateBuyer(stem.Id);
        ShipAgentInvoiceReadinessService.Readiness compatibility =
            ShipAgentInvoiceReadinessService.evaluate(stem.Id);

        System.assertEquals(canonical.ready, compatibility.ready);
        System.assertEquals(canonical.requiresVariableChargeReview, compatibility.requiresShipAgentReview);
        System.assertEquals(canonical.reason, compatibility.reason);
        System.assertEquals(canonical.fcosUrl, compatibility.fcosUrl);
        System.assertEquals(true, compatibility.fcosUrl.contains('tab=variable-charges'));
    }

    @IsTest
    static void compatibilityFacadeFailsClosedAndKeepsInvoiceClassification() {
        ShipAgentInvoiceReadinessService.Readiness invalid =
            ShipAgentInvoiceReadinessService.getReadiness('not-a-salesforce-id');
        System.assertEquals(false, invalid.ready);
        System.assertEquals(true, invalid.requiresShipAgentReview);

        System.assertEquals(false, ShipAgentInvoiceReadinessService.isFinalBuyerInvoice(
            new Invoice__c(Name = 'TEST-CN-1', Proforma__c = false)
        ));
        System.assertEquals(false, ShipAgentInvoiceReadinessService.isFinalBuyerInvoice(
            new Invoice__c(Name = 'TEST-PROFORMA', Proforma__c = true)
        ));
        System.assertEquals(true, ShipAgentInvoiceReadinessService.isFinalBuyerInvoice(
            new Invoice__c(Name = 'TEST-INV-1', Proforma__c = false)
        ));
    }
}
