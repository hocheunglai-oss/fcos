@IsTest
private class Pricebook2TriggerTest {
    @IsTest
    static void updatePricebookExecutesTrigger() {
        Pricebook2 pricebook = new Pricebook2(Name = 'FCOS Trigger Coverage', IsActive = true);
        insert pricebook;

        Test.startTest();
        pricebook.Description = 'Updated';
        update pricebook;
        Test.stopTest();

        System.assertEquals('Updated', [SELECT Description FROM Pricebook2 WHERE Id = :pricebook.Id].Description);
    }
}
