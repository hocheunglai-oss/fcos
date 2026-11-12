@IsTest
private class FcosSupplierTermScopeProofTest {
    @TestSetup
    static void setup() {
        TestDataFactory.prepareDataForNominationConfirmationFlow();
    }

    @IsTest
    static void aSupplierRuleCannotCrossToAnotherSupplierWithTheSameTerm() {
        assertMatchingRules(true, false, true, 0);
    }

    @IsTest
    static void matchingSupplierAndTermReceivesTheRule() {
        assertMatchingRules(true, true, true, 1);
    }

    @IsTest
    static void matchingSupplierWithDifferentTermDoesNotReceiveTheRule() {
        assertMatchingRules(true, true, false, 0);
    }

    @IsTest
    static void termOnlyRuleAppliesToAnotherSupplierWithThatTerm() {
        assertMatchingRules(false, false, true, 1);
    }

    private static void assertMatchingRules(Boolean supplierScoped, Boolean matchingSupplier, Boolean matchingTerm, Integer expected) {
        Account targetSupplier = [SELECT Id FROM Account WHERE RecordTypeId = :FCBStatic.SUPPLIER_ACCOUNT_RT_ID LIMIT 1];
        Account otherSupplier = TestDataFactory.createTestAccount('FCOS Scope Fixture Other', 'SUPPLIER', true);
        STEM__c stem = [SELECT Id FROM STEM__c LIMIT 1];
        STEM_Line_Item__c line = [SELECT Id FROM STEM_Line_Item__c WHERE STEM__c = :stem.Id LIMIT 1];
        Payment_Term__c paymentTerm = [SELECT Id, Name FROM Payment_Term__c WHERE Name = '2 P' AND RecordType.DeveloperName = 'Supplier' LIMIT 1];
        STEM_Extra_Cost__c cost = TestDataFactory.createTestStemExtraCost(stem.Id, line.Id, 100, 31, 31, 31, 31, 31, 'Product Charge', false);
        cost.Supplier__c = matchingSupplier ? targetSupplier.Id : otherSupplier.Id;
        cost.Payment_Term__c = paymentTerm.Name;
        insert cost;

        Special_Term__c clause = TestDataFactory.createTestSpecialTerm('FCOS Scope Fixture Term', 'Synthetic test text', false);
        insert clause;
        Special_Term_Rule__c rule = TestDataFactory.createSpecialTermRule(clause.Id, null, null, supplierScoped ? targetSupplier.Id : null, null, 'Supplier', false);
        rule.Supplier_Payment_Term__c = paymentTerm.Id;
        // Seed the synthetic rule without relying on the deployment user’s field permissions.
        insert as system rule;
        System.assertEquals(0, [SELECT COUNT() FROM Enquiry_Special_Term__c WHERE Special_Term__c = :clause.Id], 'Unexpected fixture write before invoking the handler');

        if (!matchingTerm) cost.Payment_Term__c = '7';
        Test.startTest();
        StemExtraCostTriggerHandler.applyEnquirySpecialTerms(new List<STEM_Extra_Cost__c>{ cost });
        Test.stopTest();

        System.assertEquals(expected, [SELECT COUNT() FROM Enquiry_Special_Term__c WHERE Special_Term__c = :clause.Id],
            'Supplier account and payment-term scope must both match when configured');
    }
}
