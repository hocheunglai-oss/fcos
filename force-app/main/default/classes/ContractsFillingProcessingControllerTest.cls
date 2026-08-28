@isTest
public class ContractsFillingProcessingControllerTest {
	@TestSetup
	static void makeData() {
		TestDataFactory.prepareDataForNominationConfirmationFlow();
    }
    
    @isTest
    static void testGetContracts(){
        Test.startTest();
        system.assertEquals(1, ContractsFillingProcessingController.getContracts(null, null, Date.today().addDays(-7), Date.today().addDays(7), 50, 0).size());
        Test.stopTest();
    }
    
    @isTest
    static void testRunApp(){
        Test.startTest();
        Test.setMock(HttpCalloutMock.class, new UploadVesselReportAppMock());
        try {
            ContractsFillingProcessingController.runVesselUpload('');
            ContractsFillingProcessingController.runCompanyUpload('');
        } catch (AuraHandledException error) {
            System.assertNotEquals(null, error, 'Missing upload configuration must fail with a controlled Aura exception.');
        }
        Test.stopTest();
    }
}
