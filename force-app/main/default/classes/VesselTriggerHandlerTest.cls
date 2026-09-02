@IsTest
private class VesselTriggerHandlerTest {
    @IsTest
    static void validatesImoAndNrtAndNormalizesName() {
        Vessel__c valid = new Vessel__c(Name = 'mixed Case', IMO__c = '9898785', NRT__c = 7000);
        insert valid;
        Vessel__c saved = [SELECT Name, IMO__c, NRT__c FROM Vessel__c WHERE Id = :valid.Id];
        System.assertEquals('MIXED CASE', saved.Name);
        System.assertEquals(Decimal.valueOf(7000), saved.NRT__c);

        Database.SaveResult invalid = Database.insert(
            new Vessel__c(Name = 'bad nrt', IMO__c = '9898785', NRT__c = 0),
            false
        );
        System.assertEquals(false, invalid.isSuccess());
        System.assert(invalid.getErrors()[0].getMessage().contains('positive whole number'));
    }
}
