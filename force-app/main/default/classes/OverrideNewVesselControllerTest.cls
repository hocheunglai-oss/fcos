@IsTest
private class OverrideNewVesselControllerTest {
    @IsTest
    static void createsOptionalNrtAndRetiresAnExactImoDuplicate() {
        Vessel__c first = OverrideNewVesselController.createVessel(
            new Vessel__c(Name = 'NRT TEST ONE', IMO__c = '1234567', NRT__c = 7000),
            new List<Id>()
        );
        System.assertEquals(Decimal.valueOf(7000), [SELECT NRT__c FROM Vessel__c WHERE Id = :first.Id].NRT__c);
        Vessel__c second = OverrideNewVesselController.createVessel(
            new Vessel__c(Name = 'NRT TEST TWO', IMO__c = '1234567'),
            new List<Id>{ first.Id }
        );
        System.assertNotEquals(null, second.Id);
        System.assertEquals(true, [SELECT Inactive__c FROM Vessel__c WHERE Id = :first.Id].Inactive__c);
        System.assertEquals(2, OverrideNewVesselController.checkVesselsByIMO('1234567').size());
        System.assertEquals(0, OverrideNewVesselController.checkVesselsByIMO('').size());
        OverrideNewVesselController.updateExistingVessels(second.Id, second.IMO__c);
        OverrideNewVesselController.updateExistingVessels(second.Id, '');
    }

    @IsTest
    static void rejectsInvalidNrt() {
        try {
            OverrideNewVesselController.createVessel(
                new Vessel__c(Name = 'INVALID NRT', IMO__c = '1234567', NRT__c = 0),
                new List<Id>()
            );
            System.assert(false, 'Expected invalid NRT to be rejected.');
        } catch (AuraHandledException expected) {
            System.assert(expected.getMessage().contains('positive whole number'));
        }
    }
}
