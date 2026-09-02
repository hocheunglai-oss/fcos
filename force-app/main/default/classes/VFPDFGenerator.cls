public class VFPDFGenerator {

    public static void generatePDFInNewContext(Map<String, String> nominationIdAndRecordTypeToStemId) {
        generatePDF(nominationIdAndRecordTypeToStemId);
    }

    public static void generatePDF(Map<String, String> nominationIdAndRecordTypeToStemId) {
        Map<String, ContentVersion> nominationIdToDocument = new Map<String, ContentVersion>();
        for (String nominationIdAndRecordType : nominationIdAndRecordTypeToStemId.keySet()) {
            List<String> nominationData = nominationIdAndRecordType.split(',');
            PageReference vfPage = null;
            String fileTitle;
            if (nominationData[1] == FCBStatic.NOMINATION_BUYER_RT_IT){
                vfPage = Page.ConfirmationToBuyer;
                fileTitle = 'ConfirmationToBuyer.pdf';
            } else if(nominationData[1] == FCBStatic.NOMINATION_SUPPLIER_RT_IT){
                vfPage = Page.NominationToSupplier;
                fileTitle = 'NominationToSupplier.pdf';
            }

            vfPage.getParameters().put('stemId', nominationIdAndRecordTypeToStemId.get(nominationIdAndRecordType));
            vfPage.getParameters().put('nominationId', nominationData[0]);

            Blob body;
            if (!Test.isRunningTest()) {
                body = vfPage.getContentAsPDF();
            } else {
                body = Blob.valueOf('TestString');
            }

            ContentVersion contentVersion = new ContentVersion();
            contentVersion.PathOnClient = '/' + fileTitle;
            contentVersion.Title = fileTitle;
            contentVersion.VersionData = body;
            contentVersion.FirstPublishLocationId = nominationData[0];
            nominationIdToDocument.put(nominationData[0], contentVersion);
        }

        insert nominationIdToDocument.values();

        List<Nomination__c> nominationForUpdate = new List<Nomination__c>();
        List<ContentDocumentLink> contentDocumentLinks = [SELECT Id, LinkedEntityId, ContentDocumentId FROM ContentDocumentLink WHERE LinkedEntityId IN :nominationIdToDocument.keySet()];
        for (ContentDocumentLink contentDocumentLink : contentDocumentLinks) {
            nominationForUpdate.add(new Nomination__c(Id = contentDocumentLink.LinkedEntityId, File__c = URL.getSalesforceBaseUrl().toExternalForm() + '/' + contentDocumentLink.ContentDocumentId));
        }
        update nominationForUpdate;
    }

    @future(callout=true)
    public static void generateNewPDFVersion(List<Id> nominationIds) {
        List<Nomination__c> nominationList = [SELECT Id, STEM__c, RecordTypeId, File__c FROM Nomination__c WHERE Id In: nominationIds];
        List<ContentVersion> regeneratedPdfVersions = new List<ContentVersion>();
        for (Nomination__c nomination : nominationList) {
            PageReference vfPage = null;
            String fileTitle;
            if (nomination.RecordTypeId == FCBStatic.NOMINATION_BUYER_RT_IT) {
                vfPage = Page.ConfirmationToBuyer;
                fileTitle = 'ConfirmationToBuyer.pdf';
            } else if (nomination.RecordTypeId == FCBStatic.NOMINATION_SUPPLIER_RT_IT) {
                vfPage = Page.NominationToSupplier;
                fileTitle = 'NominationToSupplier.pdf';
            }
            vfPage.getParameters().put('stemId', nomination.STEM__c);
            vfPage.getParameters().put('nominationId', nomination.Id);

            Blob body;
            if (!Test.isRunningTest()) {
                body = vfPage.getContentAsPDF();
            } else {
                body = Blob.valueOf('TestString');
            }

            ContentVersion contentVersion = new ContentVersion();
            contentVersion.PathOnClient = '/' + fileTitle;
            contentVersion.Title = fileTitle;
            contentVersion.VersionData = body;
            List<String> parsedURL = nomination.File__c.split('/');
            String nominationDocumentId = parsedURL.get(parsedURL.size() - 1);
            contentVersion.ContentDocumentId = nominationDocumentId;
            regeneratedPdfVersions.add(contentVersion);
        }
        insert regeneratedPdfVersions;
    }
}