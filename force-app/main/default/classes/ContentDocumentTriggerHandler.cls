public class ContentDocumentTriggerHandler {
    public static void updatePsprsStatus(Map<Id, ContentDocument> contentDocumentMap){
        List<String> psprsContentDocumentIds = new List<String>();
        for(ContentDocument contentDocument: contentDocumentMap.values()){
            if(contentDocument.Title.contains('PSPRS')){
                psprsContentDocumentIds.add(contentDocument.Id);
            }
        }
        if(!psprsContentDocumentIds.isEmpty()){
            List<ContentDocumentLink> contentDocumentLinks = [SELECT Id, LinkedEntityId
                                                                FROM ContentDocumentLink
                                                                WHERE ContentDocumentId IN: psprsContentDocumentIds ALL ROWS];
            List<String> supplierInvoiceIds = new List<String>();
            for(ContentDocumentLink contentDocumentLink: contentDocumentLinks){
                supplierInvoiceIds.add(contentDocumentLink.LinkedEntityId);
            }
            List<Supplier_Invoice__c> supplierInvoices = [SELECT Id, PSPRS__c, Payment_Term__c FROM Supplier_Invoice__c WHERE Id IN: supplierInvoiceIds];
            for(Supplier_Invoice__c supplierInvoice: supplierInvoices){
                if(supplierInvoice.Payment_Term__c.contains('P')){
                    supplierInvoice.PSPRS__c = 'Missing';
                } else if(!supplierInvoice.Payment_Term__c.contains('P')){
                    supplierInvoice.PSPRS__c = 'NOT Required';
                }
            }
            update supplierInvoices;
        }
    }
}