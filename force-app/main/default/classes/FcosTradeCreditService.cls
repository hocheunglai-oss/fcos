/** Full native-currency credits retain the original document and immutable line/rate evidence. */
public with sharing class FcosTradeCreditService {
    public class CreditReview {
        @AuraEnabled public String originalReference;
        @AuraEnabled public String currencyCode;
        @AuraEnabled public Decimal nativeTotal;
        @AuraEnabled public Decimal usdTotal;
        @AuraEnabled public Decimal rate;
        @AuraEnabled public String rateId;
        @AuraEnabled public Datetime confirmedAt;
        @AuraEnabled public String fingerprint;
        @AuraEnabled public List<FcosTradeDocumentService.Line> lines;
        public Id sideId;
    }
    private static void requireEntry() {
        if(!FcosCompanyFxRateService.enabled() || !FeatureManagement.checkPermission('Fcos_Trading_FX_Entry')) throw new AuraHandledException('Native credit entry is not enabled for this user.');
    }
    private static SObject source(Id invoiceId,Boolean lockRecord) {
        if(invoiceId==null || (invoiceId.getSObjectType()!=Invoice__c.SObjectType && invoiceId.getSObjectType()!=Supplier_Invoice__c.SObjectType)) throw new AuraHandledException('Select the original buyer or supplier invoice.');
        Boolean buyer=invoiceId.getSObjectType()==Invoice__c.SObjectType;
        String extra=buyer?'Amount__c,File__c,Original_Invoice__c,Reissue_Of_Invoice__c,Delivery_Date__c,Invoice_Due_Date__c,Proforma__c,Deprecated__c':'Proforma__c,Invoice_Amount__c,Invoice_File__c,Original_Supplier_Invoice__c,Reissue_Of_Supplier_Invoice__c,Supplier__c,Supplier_Delivery_Date__c,Payment_Term__c,Bank_Details__c';
        return Database.query('SELECT Id,Name,STEM__c,Invoice_Date__c,Credit_Reason__c,Document_Presentation_JSON__c,Document_Currency__c,Document_HKD_Amount__c,Document_FX_Rate__c,Document_FX_Revision__c,Document_FX_Confirmed_At__c,Document_FX_Side__c,Document_FX_Fingerprint__c,'+extra+' FROM '+invoiceId.getSObjectType().getDescribe().getName()+' WHERE Id=:invoiceId'+(lockRecord?' FOR UPDATE':''));
    }
    @AuraEnabled
    public static CreditReview preview(Id originalInvoiceId) {
        requireEntry();return review(source(originalInvoiceId,false));
    }
    private static CreditReview review(SObject original) {
        Boolean buyer=original.getSObjectType()==Invoice__c.SObjectType;
        String originalField=buyer?'Original_Invoice__c':'Original_Supplier_Invoice__c';
        if(!FcosTradeDocumentService.isManagedDocument(original) || original.get(originalField)!=null || original.get(buyer?'File__c':'Invoice_File__c')==null
            || original.get('Document_FX_Confirmed_At__c')==null || (original.get('Proforma__c')==true || (buyer && original.get('Deprecated__c')==true))) throw new AuraHandledException('Select an issued original native invoice with confirmed evidence.');
        Id originalId=original.Id;
        String cashParent=buyer?'Buyer_Invoice__c':'Supplier_Invoice__c';
        List<Payment__c> cashApplications=FcosTradeSettlementStore.payments(new Set<Id>{originalId},!buyer);
        Decimal appliedNative=0;
        for(SObject application:cashApplications) if(application.get('Cash_Event__c')!=null) appliedNative+=(Decimal)application.get(original.get('Document_Currency__c')=='HKD'?'Payment_HKD_Amount__c':'Amount__c');
        if(appliedNative!=0) throw new AuraHandledException('Reverse the prepayment allocations before crediting this invoice. The original cash remains available for reallocation or refund.');
        List<SObject> credits=Database.query('SELECT Id FROM '+original.getSObjectType().getDescribe().getName()+' WHERE '+originalField+'=:originalId');
        if(!credits.isEmpty()) throw new AuraHandledException('A credit already references this original invoice. Open that credit instead of creating another reversal.');
        CreditReview result=new CreditReview();result.originalReference=(String)original.get('Name');result.currencyCode=(String)original.get('Document_Currency__c');
        Boolean usd=result.currencyCode=='USD';
        Decimal amount=(Decimal)original.get(usd?(buyer?'Amount__c':'Invoice_Amount__c'):'Document_HKD_Amount__c');result.rate=(Decimal)original.get('Document_FX_Rate__c');
        if(amount==null || amount<=0 || (!usd && (result.rate==null || result.rate<=0)) || (usd && (result.rate!=null || original.get('Document_HKD_Amount__c')!=null || original.get('Document_FX_Revision__c')!=null))) throw new AuraHandledException('The original native invoice amount and rate must be valid.');
        result.nativeTotal=-amount;result.usdTotal=-(Decimal)original.get(buyer?'Amount__c':'Invoice_Amount__c');
        if(result.usdTotal!=(usd?result.nativeTotal:(result.nativeTotal/result.rate).setScale(2,RoundingMode.HALF_UP))) throw new AuraHandledException('The original native and USD totals do not reconcile.');
        result.rateId=(String)original.get('Document_FX_Revision__c');result.confirmedAt=(Datetime)original.get('Document_FX_Confirmed_At__c');result.sideId=(Id)original.get('Document_FX_Side__c');
        result.lines=new List<FcosTradeDocumentService.Line>();
        Decimal total=0;
        for(Trade_Document_Line__c stored:FcosTradeDocumentLineService.readForAuthorizedDocument(originalId)) {
            if(stored.Currency__c!=result.currencyCode || (usd && stored.Native_Amount__c!=stored.Accounting_USD__c) || stored.FX_Rate__c!=result.rate || stored.FX_Revision__c!=result.rateId) throw new AuraHandledException('Original document line evidence does not match its rate snapshot.');
            FcosTradeDocumentService.Line line=new FcosTradeDocumentService.Line();line.originalLineId=stored.Id;line.id=Id.valueOf(stored.Source_Record_Id__c);
            line.name=stored.Description__c;line.unit=stored.Unit__c;line.quantity=stored.Quantity__c;line.nativeUnitPrice=-stored.Native_Unit_Price__c;line.nativeAmount=-FcosTradeDocumentLineService.nativeAmount(stored);line.usdAmount=-stored.Accounting_USD__c;
            line.pricingMode=stored.Pricing_Mode__c;line.nativeMinimum=stored.Native_Minimum__c==null?null:-stored.Native_Minimum__c;line.nativeLumpsum=stored.Native_Lumpsum__c==null?null:-stored.Native_Lumpsum__c;
            total+=line.nativeAmount;result.lines.add(line);
        }
        if(result.lines.isEmpty() || total.setScale(2,RoundingMode.HALF_UP)!=result.nativeTotal) throw new AuraHandledException('Complete immutable original document lines are required for a native credit.');
        result.fingerprint=EncodingUtil.convertToHex(Crypto.generateDigest('SHA-256',Blob.valueOf(originalId+'|'+JSON.serialize(result))));return result;
    }
    @AuraEnabled
    public static Id recordCredit(Id originalInvoiceId,String reviewedFingerprint,Date creditDate,String reason) {
        requireEntry();
        if(creditDate==null || String.isBlank(reason) || reason.trim().length()<5) throw new AuraHandledException('Enter the credit date and a specific reason.');
        SObject original=source(originalInvoiceId,true);CreditReview reviewed=review(original);
        if(String.isBlank(reviewedFingerprint) || reviewed.fingerprint!=reviewedFingerprint) throw new AuraHandledException('The original invoice or its credit evidence changed. Review it again.');
        Boolean buyer=original.getSObjectType()==Invoice__c.SObjectType;
        SObject credit=buyer?(SObject)new Invoice__c(STEM__c=(Id)original.get('STEM__c'),Amount__c=reviewed.usdTotal,Original_Invoice__c=originalInvoiceId,
            Invoice_Date__c=creditDate,Invoice_Due_Date__c=creditDate,Delivery_Date__c=(Date)original.get('Delivery_Date__c'),Proforma__c=false,Deprecated__c=false)
            :(SObject)new Supplier_Invoice__c(STEM__c=(Id)original.get('STEM__c'),Supplier__c=(Id)original.get('Supplier__c'),Invoice_Amount__c=reviewed.usdTotal,
                Original_Supplier_Invoice__c=originalInvoiceId,Bank_Details__c=(String)original.get('Bank_Details__c'),Invoice_Date__c=creditDate,Supplier_Delivery_Date__c=(Date)original.get('Supplier_Delivery_Date__c'),Payment_Term__c=(String)original.get('Payment_Term__c'));
        String originalName=(String)original.get('Name');credit.put('Name',originalName.left(70)+'-CN-1');credit.put('Credit_Reason__c',reason.trim());
        FcosTradeDocumentService.DocumentReview document=new FcosTradeDocumentService.DocumentReview();document.currencyCode=reviewed.currencyCode;document.nativeTotal=reviewed.nativeTotal;document.usdTotal=reviewed.usdTotal;
        document.rate=reviewed.rate;document.rateId=reviewed.rateId;document.confirmedAt=reviewed.confirmedAt;document.sideId=reviewed.sideId;document.fingerprint=reviewed.fingerprint;document.lines=reviewed.lines;
        credit.put('Document_Presentation_JSON__c',original.get('Document_Presentation_JSON__c'));
        FcosTradeDocumentService.applySnapshot(credit,document);
        // The reviewed original and snapshot authorization above are the only
        // authority for a credit insert; API users do not receive document CRUD.
        Database.insert(credit,true,AccessLevel.SYSTEM_MODE);
        FcosTradeDocumentLineService.persist(credit,document);return credit.Id;
    }
    @AuraEnabled
    public static String generateCreditPdf(Id creditId) {
        requireEntry();SObject credit=source(creditId,false);Boolean buyer=credit.getSObjectType()==Invoice__c.SObjectType;
        if(credit.get(buyer?'Original_Invoice__c':'Original_Supplier_Invoice__c')==null) throw new AuraHandledException('Select a native credit linked to its original invoice.');
        String existing=(String)credit.get(buyer?'File__c':'Invoice_File__c');if(!String.isBlank(existing)) return existing;
        PageReference page=Page.FcosNativeCredit;page.getParameters().put('id',String.valueOf(creditId));
        Blob pdf=Test.isRunningTest()?Blob.valueOf('Native credit test PDF'):page.getContentAsPDF();
        // Rendering is a callout; acquire the serialization lock afterwards and recheck idempotency.
        credit=source(creditId,true);
        existing=(String)credit.get(buyer?'File__c':'Invoice_File__c');if(!String.isBlank(existing)) return existing;
        ContentVersion file=new ContentVersion(Title=(String)credit.get('Name'),PathOnClient=(String)credit.get('Name')+'.pdf',VersionData=pdf,FirstPublishLocationId=creditId);insert file;
        file=[SELECT ContentDocumentId FROM ContentVersion WHERE Id=:file.Id];String url=URL.getOrgDomainURL().toExternalForm()+'/'+file.ContentDocumentId;
        SObject fileUpdate=credit.getSObjectType().newSObject(creditId);fileUpdate.put(buyer?'File__c':'Invoice_File__c',url);
        Database.update(fileUpdate,true,AccessLevel.SYSTEM_MODE);return url;
    }
}
