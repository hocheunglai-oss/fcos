public class EnquiryProgressBarController {
    @AuraEnabled
    public static String getKoreaDeskChoices(Id recordId, String recordType) {
        return JSON.serialize(KoreaDeskCloseService.getChoices(recordId, recordType));
    }

    @AuraEnabled
    public static void closeKoreaDeskWon(Id recordId, String recordType, String choicesJson, String message) {
        KoreaDeskCloseService.closeWon(recordId, recordType, choicesJson, message);
    }
    @AuraEnabled
    public static void updateQuoteStatuses(String enquiryId, String status){
        List<Quote> quotes = new List<Quote>();
        if(status != FCBStatic.CREATE_NOMINATION_STAGE){
             quotes = [SELECT Id, Status FROM Quote WHERE OpportunityId =: enquiryId];
        }else{
             quotes = [SELECT Id, Status FROM Quote WHERE OpportunityId =: enquiryId AND Status !=: status];
        }
        for(Quote quote: quotes){
            quote.Status = status;
        }
        update quotes;
    }
}
