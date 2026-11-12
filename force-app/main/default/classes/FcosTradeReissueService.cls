/** Releases exactly one credited native document side for a separately reviewed reissue. */
public with sharing class FcosTradeReissueService {
    @TestVisible static Boolean testAmendPermission = false;
    @TestVisible private static Map<Id,Authorization> authorizedRows = new Map<Id,Authorization>();
    @TestVisible private static Set<Id> authorizedDocuments = new Set<Id>();

    private class Authorization {
        Id originalId;
        String direction;
        Authorization(Id originalId, String direction) { this.originalId=originalId; this.direction=direction; }
    }
    public class ReleaseResult {
        @AuraEnabled public Id originalInvoiceId;
        @AuraEnabled public Id creditId;
        @AuraEnabled public String direction;
        @AuraEnabled public Integer releasedLineCount;
        @AuraEnabled public Datetime releasedAt;
    }

    @AuraEnabled
    public static ReleaseResult release(Id creditId) {
        requireAmendment();
        if(creditId==null || (creditId.getSObjectType()!=Invoice__c.SObjectType && creditId.getSObjectType()!=Supplier_Invoice__c.SObjectType)) throw new AuraHandledException('Select an issued native buyer or supplier credit.');
        Boolean buyer=creditId.getSObjectType()==Invoice__c.SObjectType;
        String objectName=buyer?'Invoice__c':'Supplier_Invoice__c';
        String originalField=buyer?'Original_Invoice__c':'Original_Supplier_Invoice__c';
        String amountField=buyer?'Amount__c':'Invoice_Amount__c';
        String fileField=buyer?'File__c':'Invoice_File__c';
        String parentField=buyer?'Buyer_Invoice__c':'Supplier_Invoice__c';
        String direction=buyer?'Sell':'Buy';
        String sourceLineageField=buyer?'Reissue_Of_Buyer_Invoice__c':'Reissue_Of_Supplier_Invoice__c';

        String creditExtras=buyer?',Proforma__c,Deprecated__c':',Supplier__c';
        List<SObject> credits=Database.query('SELECT Id,STEM__c,'+originalField+','+amountField+','+fileField+creditExtras+',Document_Currency__c,Document_HKD_Amount__c,Document_FX_Rate__c,Document_FX_Revision__c,Document_FX_Confirmed_At__c,Document_FX_Side__c,Document_FX_Fingerprint__c FROM '+objectName+' WHERE Id=:creditId FOR UPDATE');
        if(credits.isEmpty()) throw new AuraHandledException('The native credit is unavailable.');
        SObject credit=credits[0]; Id originalId=(Id)credit.get(originalField);
        if(originalId==null) throw new AuraHandledException('Select a native credit linked to its original invoice.');
        String originalExtras=buyer?',Proforma__c,Deprecated__c,Reissue_Of_Invoice__c':',Supplier__c,Reissue_Of_Supplier_Invoice__c';
        List<SObject> originals=Database.query('SELECT Id,STEM__c,'+amountField+','+fileField+originalExtras+',Document_Currency__c,Document_HKD_Amount__c,Document_FX_Rate__c,Document_FX_Revision__c,Document_FX_Confirmed_At__c,Document_FX_Side__c,Document_FX_Fingerprint__c,Reissue_Released_At__c,Reissue_Released_By__c FROM '+objectName+' WHERE Id=:originalId FOR UPDATE');
        if(originals.isEmpty()) throw new AuraHandledException('The original invoice is unavailable.');
        SObject original=originals[0];
        if(original.get('STEM__c')!=credit.get('STEM__c')) throw new AuraHandledException('The credit and original invoice must belong to the same STEM.');
        if(original.get('Reissue_Released_At__c')!=null || original.get('Reissue_Released_By__c')!=null) throw new AuraHandledException('This original invoice was already released for reissue.');
        assertIssuedManaged(original, amountField, fileField, false);
        assertIssuedManaged(credit, amountField, fileField, true);
        assertInverseDocument(original, credit, amountField, buyer);
        Id stemId=(Id)original.get('STEM__c');
        STEM__c lockedStem=[SELECT Id FROM STEM__c WHERE Id=:stemId FOR UPDATE];
        FcosTradeDocumentService.requireReconciledPrepayments(stemId,direction,buyer?null:(Id)original.get('Supplier__c'));

        List<Trade_Document_Line__c> originalSnapshots=snapshots(parentField,originalId);
        List<Trade_Document_Line__c> creditSnapshots=snapshots(parentField,creditId);
        assertInverseSnapshots(originalSnapshots,creditSnapshots);
        Set<Id> sourceIds=sourceIds(originalSnapshots);
        List<SObject> sources=lockedSources(sourceIds,parentField,originalId,stemId);
        if(sources.size()!=sourceIds.size()) throw new AuraHandledException('Every immutable source line must remain available and linked to the original invoice.');

        Datetime releasedAt=System.now();
        authorize(sources,originalId,direction);
        authorizedDocuments.add(originalId);
        try {
            List<SObject> updates=new List<SObject>();
            for(SObject source:sources) {
                SObject changed=source.getSObjectType().newSObject(source.Id);
                changed.put(parentField,null);
                changed.put(sourceLineageField,originalId);
                if(buyer) { changed.put('Input__c','🔴'); changed.put('Issued__c',false); }
                else { changed.put('Supplier_Input__c','🔴'); changed.put('Supplier_Issued__c',false); }
                updates.add(changed);
            }
            Database.update(updates,true,AccessLevel.SYSTEM_MODE);
            SObject audit=original.getSObjectType().newSObject(original.Id);
            audit.put('Reissue_Released_At__c',releasedAt);audit.put('Reissue_Released_By__c',UserInfo.getUserId());
            Database.update(audit,true,AccessLevel.SYSTEM_MODE);
        } finally {
            authorizedRows.clear();authorizedDocuments.clear();
        }
        ReleaseResult result=new ReleaseResult();result.originalInvoiceId=originalId;result.creditId=creditId;result.direction=direction;
        result.releasedLineCount=sources.size();result.releasedAt=releasedAt;return result;
    }

    // Called only by the root-owned currency guard while this service performs its one scoped DML.
    public static Boolean isAuthorizedRelease(SObject row,SObject oldRow) {
        if(row==null || oldRow==null || row.Id==null) return false;
        Authorization authorization=authorizedRows.get(row.Id);if(authorization==null) return false;
        String link=authorization.direction=='Sell'?'Buyer_Invoice__c':'Supplier_Invoice__c';
        String opposite=authorization.direction=='Sell'?'Supplier_Invoice__c':'Buyer_Invoice__c';
        String lineage=authorization.direction=='Sell'?'Reissue_Of_Buyer_Invoice__c':'Reissue_Of_Supplier_Invoice__c';
        return oldRow.get(link)==authorization.originalId && row.get(link)==null && row.get(opposite)==oldRow.get(opposite)
            && row.get(lineage)==authorization.originalId;
    }

    // Called only by the root-owned document guard for the two audit fields on the locked original.
    public static Boolean isAuthorizedDocumentRelease(SObject row,SObject oldRow) {
        return row!=null && oldRow!=null && row.Id!=null && authorizedDocuments.contains(row.Id)
            && oldRow.get('Reissue_Released_At__c')==null && oldRow.get('Reissue_Released_By__c')==null
            && row.get('Reissue_Released_At__c')!=null && row.get('Reissue_Released_By__c')==UserInfo.getUserId();
    }

    private static void requireAmendment() {
        if(!FcosCompanyFxRateService.enabled() || !(FeatureManagement.checkPermission('Fcos_Trading_FX_Amend') || (Test.isRunningTest() && testAmendPermission))) throw new AuraHandledException('Native reissue release requires the Trading FX Amend permission.');
    }
    private static void assertIssuedManaged(SObject row,String amountField,String fileField,Boolean credit) {
        Decimal rate=(Decimal)row.get('Document_FX_Rate__c');
        Boolean usd=row.get('Document_Currency__c')=='USD';
        if(!FcosTradeDocumentService.isManagedDocument(row) || String.isBlank((String)row.get(fileField)) || row.get(amountField)==null || row.get('Document_FX_Confirmed_At__c')==null || row.get('Document_FX_Side__c')==null || String.isBlank((String)row.get('Document_FX_Fingerprint__c')))
            throw new AuraHandledException('Both the original and full credit must be issued managed documents with confirmed evidence.');
        if(usd) {
            if(row.get('Document_HKD_Amount__c')!=null || rate!=null || row.get('Document_FX_Revision__c')!=null) throw new AuraHandledException('USD reissue evidence cannot inherit HKD amounts or a rate.');
        } else if(row.get('Document_Currency__c')!='HKD' || row.get('Document_HKD_Amount__c')==null || rate==null || rate<=0 || String.isBlank((String)row.get('Document_FX_Revision__c')))
            throw new AuraHandledException('HKD originals and credits require complete rate evidence.');
        if(row.getSObjectType()==Invoice__c.SObjectType && (row.get('Proforma__c')==true || row.get('Deprecated__c')==true)) throw new AuraHandledException('The buyer original and credit must be issued, current documents.');
        Decimal amount=(Decimal)row.get(usd?amountField:'Document_HKD_Amount__c');Decimal accounting=(Decimal)row.get(amountField);
        if((credit && (amount>=0 || accounting>=0)) || (!credit && (amount<=0 || accounting<=0)) || (usd?amount:(amount/rate).setScale(2,RoundingMode.HALF_UP))!=accounting) throw new AuraHandledException('The original and credit document totals must reconcile at their stored rate.');
    }
    private static void assertInverseDocument(SObject original,SObject credit,String amountField,Boolean buyer) {
        Decimal originalHkd=(Decimal)original.get('Document_HKD_Amount__c');
        if(credit.get('Document_Currency__c')!=original.get('Document_Currency__c')
            || (Decimal)credit.get('Document_HKD_Amount__c')!=(originalHkd==null?null:-originalHkd) || (Decimal)credit.get(amountField)!=-(Decimal)original.get(amountField)
            || (Decimal)credit.get('Document_FX_Rate__c')!=(Decimal)original.get('Document_FX_Rate__c') || (String)credit.get('Document_FX_Revision__c')!=(String)original.get('Document_FX_Revision__c')
            || (Datetime)credit.get('Document_FX_Confirmed_At__c')!=(Datetime)original.get('Document_FX_Confirmed_At__c')
            || credit.get('Document_FX_Side__c')!=original.get('Document_FX_Side__c')
            || (!buyer && credit.get('Supplier__c')!=original.get('Supplier__c'))) throw new AuraHandledException('The credit must be the complete inverse of the original native invoice evidence.');
    }

    private static List<Trade_Document_Line__c> snapshots(String parentField,Id documentId) {
        return FcosTradeDocumentLineStore.readForAuthorizedDocuments(new Set<Id>{documentId},true);
    }
    @TestVisible static void assertInverseSnapshots(List<Trade_Document_Line__c> originals,List<Trade_Document_Line__c> credits) {
        if(originals==null || credits==null || originals.isEmpty() || originals.size()!=credits.size()) throw new AuraHandledException('Complete immutable original and credit line evidence is required.');
        Map<Id,Trade_Document_Line__c> creditsByOriginal=new Map<Id,Trade_Document_Line__c>();
        for(Trade_Document_Line__c credit:credits) {
            if(credit.Original_Line__c==null || creditsByOriginal.containsKey(credit.Original_Line__c)) throw new AuraHandledException('Credit line lineage must reference each original line exactly once.');
            creditsByOriginal.put(credit.Original_Line__c,credit);
        }
        for(Trade_Document_Line__c original:originals) {
            Trade_Document_Line__c credit=creditsByOriginal.get(original.Id);
            if(credit==null || credit.Currency__c!=original.Currency__c || (original.Currency__c!='HKD' && original.Currency__c!='USD') || credit.Source_Record_Id__c!=original.Source_Record_Id__c
                || credit.Description__c!=original.Description__c || credit.Unit__c!=original.Unit__c || credit.Quantity__c!=original.Quantity__c
                || credit.Native_Unit_Price__c!=-original.Native_Unit_Price__c || credit.Native_Amount__c!=-original.Native_Amount__c
                || credit.Pricing_Mode__c!=original.Pricing_Mode__c || credit.Native_Minimum__c!=(original.Native_Minimum__c==null?null:-original.Native_Minimum__c) || credit.Native_Lumpsum__c!=(original.Native_Lumpsum__c==null?null:-original.Native_Lumpsum__c)
                || credit.Accounting_USD__c!=-original.Accounting_USD__c || credit.FX_Rate__c!=original.FX_Rate__c || credit.FX_Revision__c!=original.FX_Revision__c) throw new AuraHandledException('Credit line evidence must be the exact inverse of every original line.');
        }
    }
    private static Set<Id> sourceIds(List<Trade_Document_Line__c> rows) {
        Set<Id> ids=new Set<Id>();
        for(Trade_Document_Line__c row:rows) {
            if(String.isBlank(row.Source_Record_Id__c) || !Pattern.matches('[a-zA-Z0-9]{15,18}',row.Source_Record_Id__c)) throw new AuraHandledException('Immutable source record IDs are invalid.');
            Id sourceId=Id.valueOf(row.Source_Record_Id__c);
            if(ids.contains(sourceId)) throw new AuraHandledException('Each immutable document line must have one source record.');
            ids.add(sourceId);
        }
        return ids;
    }
    private static List<SObject> lockedSources(Set<Id> ids,String parentField,Id originalId,Id stemId) {
        List<SObject> rows=new List<SObject>();
        rows.addAll(Database.query('SELECT Id,STEM__c,Buyer_Invoice__c,Supplier_Invoice__c,Input__c,Issued__c,Supplier_Input__c,Supplier_Issued__c,Reissue_Of_Buyer_Invoice__c,Reissue_Of_Supplier_Invoice__c FROM STEM_Line_Item__c WHERE Id IN :ids FOR UPDATE'));
        rows.addAll(Database.query('SELECT Id,STEM__c,Buyer_Invoice__c,Supplier_Invoice__c,Input__c,Issued__c,Supplier_Input__c,Supplier_Issued__c,Reissue_Of_Buyer_Invoice__c,Reissue_Of_Supplier_Invoice__c FROM STEM_Extra_Cost__c WHERE Id IN :ids FOR UPDATE'));
        for(SObject row:rows) if(row.get(parentField)!=originalId || row.get('STEM__c')!=stemId) throw new AuraHandledException('A source line no longer belongs to the original invoice and STEM.');
        return rows;
    }
    private static void authorize(List<SObject> rows,Id originalId,String direction) { for(SObject row:rows) authorizedRows.put(row.Id,new Authorization(originalId,direction)); }
    @TestVisible private static void authorizeForTest(List<SObject> rows,Id originalId,String direction) { authorize(rows,originalId,direction); }
    @TestVisible private static void authorizeDocumentForTest(Id documentId) { authorizedDocuments.add(documentId); }
    @TestVisible private static void clearAuthorizationForTest() { authorizedRows.clear();authorizedDocuments.clear(); }
}
