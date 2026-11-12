/**
 * Reviewed native proforma and finalization workflow. A proforma is immutable
 * non-posting evidence; only its separately reviewed final may claim source lines.
 */
public with sharing class FcosTradeProformaService {
    public class ProformaException extends Exception {}
    public class Context {
        @AuraEnabled public String mode;
        @AuraEnabled public Id stemId;
        @AuraEnabled public String direction;
        @AuraEnabled public Id supplierId;
        @AuraEnabled public String reference;
        @AuraEnabled public Date documentDate;
        @AuraEnabled public Date deliveryDate;
        @AuraEnabled public Date dueDate;
        @AuraEnabled public Decimal depositNative;
        @AuraEnabled public Date depositDueDate;
    }
    public class Review {
        @AuraEnabled public Id proformaId;
        @AuraEnabled public Id stemId;
        @AuraEnabled public String direction;
        @AuraEnabled public Id supplierId;
        @AuraEnabled public String reference;
        @AuraEnabled public Date documentDate;
        @AuraEnabled public Date deliveryDate;
        @AuraEnabled public Date dueDate;
        @AuraEnabled public Date depositDueDate;
        @AuraEnabled public Decimal depositNative;
        @AuraEnabled public Decimal depositHKD;
        @AuraEnabled public Decimal depositUSD;
        @AuraEnabled public String currencyCode;
        @AuraEnabled public Decimal nativeTotal;
        @AuraEnabled public Decimal usdTotal;
        @AuraEnabled public Decimal rate;
        @AuraEnabled public String rateId;
        @AuraEnabled public Datetime confirmedAt;
        @AuraEnabled public Id sideId;
        @AuraEnabled public String documentFingerprint;
        @AuraEnabled public String fingerprint;
        @AuraEnabled public List<FcosTradeDocumentService.Line> lines;
        public String presentationJson;
        public List<Id> sourceLineIds;
    }

    private static void requireAccess() {
        if(!FcosTradeCashService.enabled() || !FeatureManagement.checkPermission('Fcos_Trading_FX_Entry'))
            throw new AuraHandledException('Native proforma entry is not enabled.');
    }
    private static String normalizeOperationId(String operationId) {
        if(String.isBlank(operationId) || !Pattern.matches('(?i)[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}',operationId))
            throw new AuraHandledException('A stable version 4 operation UUID is required.');
        return operationId.toLowerCase();
    }
    private static String hash(Object value) {
        return EncodingUtil.convertToHex(Crypto.generateDigest('SHA-256',Blob.valueOf(JSON.serialize(value))));
    }
    private static List<Id> sortedIds(List<Id> ids) {
        List<String> values=new List<String>();
        if(ids!=null) for(Id value:ids) if(value!=null) values.add(String.valueOf(value));
        values.sort();
        List<Id> result=new List<Id>();for(String value:values) result.add(Id.valueOf(value));return result;
    }
    private static void validateInputs(String direction,String reference,Date documentDate,Date deliveryDate,Date dueDate,Decimal depositNative,Date depositDueDate) {
        if(direction!='Buy' && direction!='Sell') throw new AuraHandledException('Select Buyer or Supplier.');
        if(String.isBlank(reference) || documentDate==null || deliveryDate==null || dueDate==null)
            throw new AuraHandledException('Reference, document date, delivery date and due date are required.');
        if(depositNative==null || depositNative<=0 || depositNative!=depositNative.setScale(2,RoundingMode.HALF_UP) || depositDueDate==null)
            throw new AuraHandledException('Enter an explicit positive native deposit request to two decimal places and its due date.');
    }
    private static String presentation(Id stemId,String direction,Id supplierId) {
        if(direction=='Sell') return FcosNativeInvoiceController.capturePresentation(stemId,true);
        return FcosNativeCreditController.captureSupplierPresentation(stemId,supplierId);
    }
    private static Review build(Id proformaId,Id stemId,String direction,Id supplierId,List<Id> lineIds,String reference,
        Date documentDate,Date deliveryDate,Date dueDate,Decimal depositNative,Date depositDueDate,String existingPresentation) {
        validateInputs(direction,reference,documentDate,deliveryDate,dueDate,depositNative,depositDueDate);
        List<Id> selected=sortedIds(lineIds);
        if(selected.isEmpty()) throw new AuraHandledException('Select the proforma source lines.');
        FcosTradeDocumentService.DocumentReview document=FcosTradeDocumentService.previewWithDepositTerms(stemId,direction,supplierId,selected);
        if(document.reissueOfId!=null) throw new AuraHandledException('Credit reissue lines cannot be used for a proforma.');
        if(document.sideId==null || document.confirmedAt==null || String.isBlank(document.fingerprint))
            throw new AuraHandledException('Confirm the selected currency side before reviewing a proforma.');
        Decimal gross=document.currencyCode=='HKD'?document.nativeTotal:document.usdTotal;
        Decimal requested=depositNative.setScale(2,RoundingMode.HALF_UP);
        if(proformaId==null && requested>gross) throw new AuraHandledException('The requested deposit cannot exceed the gross proforma total.');
        Review review=new Review();review.proformaId=proformaId;review.stemId=stemId;review.direction=direction;review.supplierId=supplierId;
        review.reference=reference.trim();review.documentDate=documentDate;review.deliveryDate=deliveryDate;review.dueDate=dueDate;
        review.depositDueDate=depositDueDate;review.depositNative=requested;review.currencyCode=document.currencyCode;
        review.depositHKD=document.currencyCode=='HKD'?requested:null;
        review.depositUSD=document.currencyCode=='HKD'?(requested/document.rate).setScale(2,RoundingMode.HALF_UP):requested;
        review.nativeTotal=document.nativeTotal;review.usdTotal=document.usdTotal;review.rate=document.rate;review.rateId=document.rateId;
        review.confirmedAt=document.confirmedAt;review.sideId=document.sideId;review.documentFingerprint=document.fingerprint;
        review.lines=document.lines;review.sourceLineIds=selected;
        review.presentationJson=String.isBlank(existingPresentation)?presentation(stemId,direction,supplierId):existingPresentation;
        Map<String,Object> evidence=new Map<String,Object>{'version'=>1,'type'=>proformaId==null?'PROFORMA':'FINAL','proformaId'=>proformaId,
            'stemId'=>stemId,'direction'=>direction,'supplierId'=>supplierId,'sourceLineIds'=>selected,'reference'=>review.reference,
            'documentDate'=>documentDate,'deliveryDate'=>deliveryDate,'dueDate'=>dueDate,'depositNative'=>requested,'depositDueDate'=>depositDueDate,
            'currency'=>document.currencyCode,'rate'=>document.rate,'rateId'=>document.rateId,'sideId'=>document.sideId,
            'confirmedAt'=>document.confirmedAt,'documentFingerprint'=>document.fingerprint,'presentationFingerprint'=>hash(review.presentationJson)};
        review.fingerprint=hash(evidence);
        return review;
    }

    @AuraEnabled(cacheable=true)
    public static Context describeContext(Id recordId) {
        requireAccess();
        if(recordId==null) throw new AuraHandledException('Open this action from a STEM or proforma.');
        Context result=new Context();
        if(recordId.getSObjectType()==STEM__c.SObjectType) {result.mode='CREATE';result.stemId=recordId;result.documentDate=Date.today();return result;}
        Boolean buyer=recordId.getSObjectType()==Invoice__c.SObjectType;
        if(!buyer && recordId.getSObjectType()!=Supplier_Invoice__c.SObjectType) throw new AuraHandledException('Open this action from a STEM or proforma.');
        String amountField=buyer?'Amount__c':'Invoice_Amount__c';
        String supplierFields=buyer?'':'Supplier__c,';
        SObject row=Database.query('SELECT Id,STEM__c,'+supplierFields+'Name,Invoice_Date__c,'+(buyer?'Delivery_Date__c,Invoice_Due_Date__c,':'Supplier_Delivery_Date__c,')+
            'Proforma__c,Deposit_Requested_HKD__c,Deposit_Requested_USD__c,Deposit_Due_Date__c,Document_Currency__c,'+amountField+' FROM '+recordId.getSObjectType().getDescribe().getName()+' WHERE Id=:recordId');
        if(row.get('Proforma__c')!=true) throw new AuraHandledException('Select an immutable native proforma.');
        result.mode='FINALIZE';result.stemId=(Id)row.get('STEM__c');result.direction=buyer?'Sell':'Buy';result.supplierId=buyer?null:(Id)row.get('Supplier__c');
        result.reference=(String)row.get('Name');result.documentDate=Date.today();result.deliveryDate=(Date)row.get(buyer?'Delivery_Date__c':'Supplier_Delivery_Date__c');
        result.dueDate=buyer?(Date)row.get('Invoice_Due_Date__c'):Date.today();result.depositDueDate=(Date)row.get('Deposit_Due_Date__c');
        result.depositNative=(Decimal)row.get(row.get('Document_Currency__c')=='HKD'?'Deposit_Requested_HKD__c':'Deposit_Requested_USD__c');
        return result;
    }

    @AuraEnabled(cacheable=true)
    public static List<FcosTradeDocumentService.Line> candidates(Id stemId,String direction,Id supplierId) {
        requireAccess();
        if(direction!='Buy' && direction!='Sell') return new List<FcosTradeDocumentService.Line>();
        List<Id> ids=new List<Id>();
        if(direction=='Sell') {
            for(STEM_Line_Item__c row:[SELECT Id FROM STEM_Line_Item__c WHERE STEM__c=:stemId AND Cancelled__c=false AND Buyer_Invoice__c=null]) ids.add(row.Id);
            for(STEM_Extra_Cost__c row:[SELECT Id FROM STEM_Extra_Cost__c WHERE STEM__c=:stemId AND Cancelled__c=false AND Buyer_Invoice__c=null]) ids.add(row.Id);
        } else {
            if(supplierId==null) throw new AuraHandledException('Select the supplier.');
            for(STEM_Line_Item__c row:[SELECT Id FROM STEM_Line_Item__c WHERE STEM__c=:stemId AND Original_Supplier__c=:supplierId AND Cancelled__c=false AND Supplier_Invoice__c=null]) ids.add(row.Id);
            for(STEM_Extra_Cost__c row:[SELECT Id FROM STEM_Extra_Cost__c WHERE STEM__c=:stemId AND Supplier__c=:supplierId AND Cancelled__c=false AND Supplier_Invoice__c=null]) ids.add(row.Id);
        }
        if(ids.isEmpty()) return new List<FcosTradeDocumentService.Line>();
        return FcosTradeDocumentService.previewWithDepositTerms(stemId,direction,supplierId,ids).lines;
    }

    @AuraEnabled
    public static Review previewProforma(Id stemId,String direction,Id supplierId,List<Id> lineIds,String reference,
        Date documentDate,Date deliveryDate,Date dueDate,Decimal depositNative,Date depositDueDate) {
        requireAccess();return build(null,stemId,direction,supplierId,lineIds,reference,documentDate,deliveryDate,dueDate,depositNative,depositDueDate,null);
    }

    private static SObject operationRecord(String operationId) {
        List<Invoice__c> buyers=[SELECT Id,Document_Request_Fingerprint__c FROM Invoice__c WHERE Document_Operation_Id__c=:operationId LIMIT 1];
        List<Supplier_Invoice__c> suppliers=[SELECT Id,Document_Request_Fingerprint__c FROM Supplier_Invoice__c WHERE Document_Operation_Id__c=:operationId LIMIT 1];
        if(!buyers.isEmpty() && !suppliers.isEmpty()) throw new AuraHandledException('The document operation id is ambiguous.');
        if(!buyers.isEmpty()) return (SObject)buyers[0];
        if(!suppliers.isEmpty()) return (SObject)suppliers[0];
        return null;
    }
    private static Id exactRetry(String operationId,String requestFingerprint) {
        SObject existing=operationRecord(operationId);if(existing==null) return null;
        if(existing.get('Document_Request_Fingerprint__c')!=requestFingerprint) throw new AuraHandledException('This operation id was already used for a different document request.');
        return existing.Id;
    }
    private static String proformaRequestFingerprint(Id stemId,String direction,Id supplierId,List<Id> lineIds,String reference,Date documentDate,
        Date deliveryDate,Date dueDate,Decimal depositNative,Date depositDueDate,String reviewedFingerprint) {
        return hash(new Map<String,Object>{'version'=>1,'type'=>'PROFORMA','stemId'=>stemId,'direction'=>direction,'supplierId'=>supplierId,
            'lineIds'=>sortedIds(lineIds),'reference'=>reference==null?null:reference.trim(),'documentDate'=>documentDate,'deliveryDate'=>deliveryDate,
            'dueDate'=>dueDate,'depositNative'=>depositNative,'depositDueDate'=>depositDueDate,'reviewedFingerprint'=>reviewedFingerprint});
    }
    private static String finalRequestFingerprint(Id proformaId,String reference,Date invoiceDate,Date deliveryDate,Date dueDate,String reviewedFingerprint) {
        return hash(new Map<String,Object>{'version'=>1,'type'=>'FINAL','proformaId'=>proformaId,'reference'=>reference==null?null:reference.trim(),
            'invoiceDate'=>invoiceDate,'deliveryDate'=>deliveryDate,'dueDate'=>dueDate,'reviewedFingerprint'=>reviewedFingerprint});
    }
    private static FcosTradeDocumentService.DocumentReview documentReview(Review review) {
        FcosTradeDocumentService.DocumentReview result=new FcosTradeDocumentService.DocumentReview();result.currencyCode=review.currencyCode;
        result.nativeTotal=review.nativeTotal;result.usdTotal=review.usdTotal;result.rate=review.rate;result.rateId=review.rateId;
        result.confirmedAt=review.confirmedAt;result.sideId=review.sideId;result.fingerprint=review.documentFingerprint;result.lines=review.lines;return result;
    }
    private static Set<String> supplierTerms(List<Id> lineIds) {
        Set<String> terms=new Set<String>();
        for(STEM_Line_Item__c row:[SELECT Payment_Term__c FROM STEM_Line_Item__c WHERE Id IN:lineIds]) terms.add(row.Payment_Term__c);
        for(STEM_Extra_Cost__c row:[SELECT Payment_Term__c FROM STEM_Extra_Cost__c WHERE Id IN:lineIds]) terms.add(row.Payment_Term__c);
        if(terms.size()!=1 || terms.contains(null)) throw new AuraHandledException('Select supplier lines with one payment term.');return terms;
    }
    private static void applyReviewedFields(SObject document,Review review,String operationId,String requestFingerprint,Boolean proforma,Id finalOf) {
        document.put('Proforma__c',proforma);document.put('Document_Operation_Id__c',operationId);document.put('Document_Request_Fingerprint__c',requestFingerprint);
        document.put('Document_Presentation_JSON__c',review.presentationJson);document.put('Deposit_Requested_HKD__c',review.depositHKD);
        document.put('Deposit_Requested_USD__c',review.depositUSD);document.put('Deposit_Due_Date__c',review.depositDueDate);
        if(finalOf!=null) document.put('Final_Of_Proforma__c',finalOf);
        FcosTradeDocumentService.applySnapshot(document,documentReview(review));
    }
    private static Id insertDocument(Review review,String operationId,String requestFingerprint,Boolean proforma,Id finalOf) {
        if(review.direction=='Sell') {
            Invoice__c row=new Invoice__c(Name=review.reference,STEM__c=review.stemId,Invoice_Date__c=review.documentDate,Delivery_Date__c=review.deliveryDate,
                Invoice_Due_Date__c=review.dueDate,Amount__c=review.usdTotal,Deprecated__c=false);
            applyReviewedFields(row,review,operationId,requestFingerprint,proforma,finalOf);insert row;FcosTradeDocumentLineService.persist(row,documentReview(review));return row.Id;
        }
        String term=new List<String>(supplierTerms(review.sourceLineIds))[0];
        Account supplier=[SELECT Bank_Details__c FROM Account WHERE Id=:review.supplierId];
        Supplier_Invoice__c row=new Supplier_Invoice__c(Name=review.reference,STEM__c=review.stemId,Supplier__c=review.supplierId,
            Invoice_Date__c=review.documentDate,Supplier_Delivery_Date__c=review.deliveryDate,Invoice_Amount__c=review.usdTotal,Payment_Term__c=term,
            Bank_Details__c=String.isBlank(supplier.Bank_Details__c)?'Not Provided':supplier.Bank_Details__c);
        applyReviewedFields(row,review,operationId,requestFingerprint,proforma,finalOf);insert row;FcosTradeDocumentLineService.persist(row,documentReview(review));return row.Id;
    }

    @AuraEnabled
    public static Id recordProforma(Id stemId,String direction,Id supplierId,List<Id> lineIds,String reference,Date documentDate,Date deliveryDate,
        Date dueDate,Decimal depositNative,Date depositDueDate,String reviewedFingerprint,String operationId) {
        requireAccess();operationId=normalizeOperationId(operationId);
        String requestFingerprint=proformaRequestFingerprint(stemId,direction,supplierId,lineIds,reference,documentDate,deliveryDate,dueDate,depositNative,depositDueDate,reviewedFingerprint);
        Id retry=exactRetry(operationId,requestFingerprint);if(retry!=null)return retry;
        List<STEM__c> lock=[SELECT Id FROM STEM__c WHERE Id=:stemId FOR UPDATE];
        retry=exactRetry(operationId,requestFingerprint);if(retry!=null)return retry;
        Review review=build(null,stemId,direction,supplierId,lineIds,reference,documentDate,deliveryDate,dueDate,depositNative,depositDueDate,null);
        if(String.isBlank(reviewedFingerprint) || review.fingerprint!=reviewedFingerprint) throw new AuraHandledException('The proforma terms or confirmed trading side changed. Review again.');
        return insertDocument(review,operationId,requestFingerprint,true,null);
    }

    private static Review finalReview(Id proformaId,String reference,Date invoiceDate,Date deliveryDate,Date dueDate) {
        Boolean buyer=proformaId.getSObjectType()==Invoice__c.SObjectType;
        if(!buyer && proformaId.getSObjectType()!=Supplier_Invoice__c.SObjectType) throw new AuraHandledException('Select a native proforma.');
        String objectName=proformaId.getSObjectType().getDescribe().getName();String amount=buyer?'Amount__c':'Invoice_Amount__c';
        String supplier=buyer?'':'Supplier__c,';String delivery=buyer?'Delivery_Date__c':'Supplier_Delivery_Date__c';
        String fileField=buyer?'File__c':'Invoice_File__c';String activeFields=buyer?'Deprecated__c,':'';
        SObject row=Database.query('SELECT Id,STEM__c,'+supplier+'Name,Proforma__c,'+fileField+','+amount+','+delivery+',Document_Currency__c,Document_HKD_Amount__c,'+
            'Document_FX_Rate__c,Document_FX_Revision__c,Document_FX_Confirmed_At__c,Document_FX_Side__c,Document_FX_Fingerprint__c,Document_Presentation_JSON__c,'+
            'Document_Operation_Id__c,Document_Request_Fingerprint__c,'+activeFields+'Deposit_Requested_HKD__c,Deposit_Requested_USD__c,Deposit_Due_Date__c FROM '+objectName+' WHERE Id=:proformaId');
        if(row.get('Proforma__c')!=true || !FcosTradeDocumentService.isManagedDocument(row) || (buyer && row.get('Deprecated__c')==true)
            || String.isBlank((String)row.get('Document_Operation_Id__c')) || String.isBlank((String)row.get('Document_Request_Fingerprint__c')))
            throw new AuraHandledException('Select an active immutable native proforma.');
        if(String.isBlank((String)row.get(fileField))) throw new AuraHandledException('Generate and retain the immutable proforma before finalizing it.');
        List<SObject> priorFinal=Database.query('SELECT Id FROM '+objectName+' WHERE Final_Of_Proforma__c=:proformaId LIMIT 1');
        if(!priorFinal.isEmpty()) throw new AuraHandledException('This proforma already has its one final document.');
        List<Trade_Document_Line__c> evidence=FcosTradeDocumentLineService.readForAuthorizedDocument(proformaId);List<Id> lineIds=new List<Id>();
        for(Trade_Document_Line__c line:evidence) {if(String.isBlank(line.Source_Record_Id__c))throw new AuraHandledException('The proforma source-line evidence is incomplete.');lineIds.add(Id.valueOf(line.Source_Record_Id__c));}
        String direction=buyer?'Sell':'Buy';Id supplierId=buyer?null:(Id)row.get('Supplier__c');Decimal deposit=(Decimal)row.get(row.get('Document_Currency__c')=='HKD'?'Deposit_Requested_HKD__c':'Deposit_Requested_USD__c');
        Review review=build(proformaId,(Id)row.get('STEM__c'),direction,supplierId,lineIds,reference,invoiceDate,deliveryDate,dueDate,deposit,(Date)row.get('Deposit_Due_Date__c'),(String)row.get('Document_Presentation_JSON__c'));
        Map<Id,Id> proformaLineBySource=new Map<Id,Id>();for(Trade_Document_Line__c line:evidence)proformaLineBySource.put(Id.valueOf(line.Source_Record_Id__c),line.Id);
        for(FcosTradeDocumentService.Line line:review.lines){line.originalLineId=proformaLineBySource.get(line.id);if(line.originalLineId==null)throw new AuraHandledException('The final line cannot be traced to its immutable proforma evidence.');}
        if(review.currencyCode!=row.get('Document_Currency__c') || review.sideId!=row.get('Document_FX_Side__c') || review.rate!=row.get('Document_FX_Rate__c') || review.rateId!=row.get('Document_FX_Revision__c'))
            throw new AuraHandledException('Currency or rate changed after the proforma. Create a new proforma.');
        return review;
    }
    @AuraEnabled
    public static Review previewFinal(Id proformaId,String reference,Date invoiceDate,Date deliveryDate,Date dueDate) {
        requireAccess();return finalReview(proformaId,reference,invoiceDate,deliveryDate,dueDate);
    }
    private static void claimFinal(Review review,Id documentId) {
        if(review.direction=='Sell') {
            List<STEM_Line_Item__c> fuel=[SELECT Id,Buyer_Invoice__c FROM STEM_Line_Item__c WHERE Id IN:review.sourceLineIds FOR UPDATE];
            List<STEM_Extra_Cost__c> extras=[SELECT Id,Buyer_Invoice__c FROM STEM_Extra_Cost__c WHERE Id IN:review.sourceLineIds FOR UPDATE];
            for(STEM_Line_Item__c row:fuel){if(row.Buyer_Invoice__c!=null)throw new AuraHandledException('A selected line is already on a final invoice.');row.Buyer_Invoice__c=documentId;row.Input__c='🟢';row.Issued__c=true;}
            for(STEM_Extra_Cost__c row:extras){if(row.Buyer_Invoice__c!=null)throw new AuraHandledException('A selected charge is already on a final invoice.');row.Buyer_Invoice__c=documentId;row.Input__c='🟢';row.Issued__c=true;}
            if(!fuel.isEmpty())update fuel;if(!extras.isEmpty())update extras;
        } else {
            List<STEM_Line_Item__c> fuel=[SELECT Id,Supplier_Invoice__c FROM STEM_Line_Item__c WHERE Id IN:review.sourceLineIds FOR UPDATE];
            List<STEM_Extra_Cost__c> extras=[SELECT Id,Supplier_Invoice__c FROM STEM_Extra_Cost__c WHERE Id IN:review.sourceLineIds FOR UPDATE];
            for(STEM_Line_Item__c row:fuel){if(row.Supplier_Invoice__c!=null)throw new AuraHandledException('A selected line is already on a final supplier invoice.');row.Supplier_Invoice__c=documentId;row.Supplier_Input__c='🟢';row.Supplier_Issued__c=true;}
            for(STEM_Extra_Cost__c row:extras){if(row.Supplier_Invoice__c!=null)throw new AuraHandledException('A selected charge is already on a final supplier invoice.');row.Supplier_Invoice__c=documentId;row.Supplier_Input__c='🟢';row.Supplier_Issued__c=true;}
            if(!fuel.isEmpty())update fuel;if(!extras.isEmpty())update extras;
        }
    }
    @AuraEnabled
    public static Id recordFinal(Id proformaId,String reference,Date invoiceDate,Date deliveryDate,Date dueDate,String reviewedFingerprint,String operationId) {
        requireAccess();operationId=normalizeOperationId(operationId);
        String requestFingerprint=finalRequestFingerprint(proformaId,reference,invoiceDate,deliveryDate,dueDate,reviewedFingerprint);
        Id retry=exactRetry(operationId,requestFingerprint);if(retry!=null)return retry;
        String objectName=proformaId.getSObjectType().getDescribe().getName();
        List<SObject> visible=Database.query('SELECT Id,STEM__c FROM '+objectName+' WHERE Id=:proformaId');
        if(visible.isEmpty()) throw new AuraHandledException('The proforma is unavailable.');
        Id stemId=(Id)visible[0].get('STEM__c');List<STEM__c> stemLock=[SELECT Id FROM STEM__c WHERE Id=:stemId FOR UPDATE];
        List<SObject> locked=Database.query('SELECT Id,STEM__c FROM '+objectName+' WHERE Id=:proformaId FOR UPDATE');
        retry=exactRetry(operationId,requestFingerprint);if(retry!=null)return retry;
        List<SObject> existing=Database.query('SELECT Id,Document_Operation_Id__c,Document_Request_Fingerprint__c FROM '+objectName+' WHERE Final_Of_Proforma__c=:proformaId LIMIT 1');
        if(!existing.isEmpty()) throw new AuraHandledException('This proforma already has its one final document.');
        Review review=finalReview(proformaId,reference,invoiceDate,deliveryDate,dueDate);
        if(String.isBlank(reviewedFingerprint) || review.fingerprint!=reviewedFingerprint) throw new AuraHandledException('The final document terms or reconfirmed lines changed. Review again.');
        Id finalId=insertDocument(review,operationId,requestFingerprint,false,proformaId);claimFinal(review,finalId);return finalId;
    }

    @AuraEnabled
    public static String generateDocument(Id documentId) {
        requireAccess();Boolean buyer=documentId.getSObjectType()==Invoice__c.SObjectType;
        if(!buyer && documentId.getSObjectType()!=Supplier_Invoice__c.SObjectType) throw new AuraHandledException('Select a native proforma or final document.');
        String fileField=buyer?'File__c':'Invoice_File__c';String objectName=documentId.getSObjectType().getDescribe().getName();
        String query='SELECT Id,Name,'+fileField+',Proforma__c,Final_Of_Proforma__c,Document_Currency__c,Document_FX_Side__c,Document_FX_Confirmed_At__c,Document_FX_Fingerprint__c FROM '+objectName+' WHERE Id=:documentId';
        SObject row=Database.query(query);
        if(!FcosTradeDocumentService.isManagedDocument(row)) throw new AuraHandledException('A complete managed document snapshot is required.');
        if(!String.isBlank((String)row.get(fileField))) return (String)row.get(fileField);
        PageReference page=buyer?Page.FcosNativeInvoice:Page.FcosNativeCredit;page.getParameters().put('id',String.valueOf(documentId));
        Blob body=Test.isRunningTest()?Blob.valueOf('Native proforma integration PDF'):page.getContentAsPDF();
        // Rendering is a callout and must complete before the serialization lock.
        row=Database.query(query+' FOR UPDATE');
        if(!FcosTradeDocumentService.isManagedDocument(row)) throw new AuraHandledException('A complete managed document snapshot is required.');
        if(!String.isBlank((String)row.get(fileField))) return (String)row.get(fileField);
        ContentVersion version=new ContentVersion(Title=(String)row.get('Name'),PathOnClient=(String)row.get('Name')+'.pdf',VersionData=body,FirstPublishLocationId=documentId);insert version;
        version=[SELECT ContentDocumentId FROM ContentVersion WHERE Id=:version.Id];String url=URL.getOrgDomainURL().toExternalForm()+'/'+version.ContentDocumentId;
        SObject updateRow=documentId.getSObjectType().newSObject(documentId);updateRow.put(fileField,url);update updateRow;return url;
    }
}
