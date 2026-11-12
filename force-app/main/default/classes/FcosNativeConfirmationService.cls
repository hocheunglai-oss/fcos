/** Prepares one immutable, server-derived HKD confirmation snapshot for Visualforce rendering. */
public with sharing class FcosNativeConfirmationService {
    private static final String HK_SELLER='FRATELLI COSULICH BUNKERS (HK) LTD.';
    private static final String SG_TRUSTEE_SELLER='FRATELLI COSULICH BUNKERS (S) PTE LTD.';
    private static final String FCBS_NAME='FRATELLI COSULICH BUNKERS (S) PTE LTD';
    private static final String TRUSTEE_SERVICE='TRUSTEE SERVICE';
    @TestVisible static Boolean testEntryPermission=false;
    @TestVisible private static Map<Id,String> preparingFingerprints=new Map<Id,String>();

    public class PreparationResult {
        @AuraEnabled public Id nominationId;
        @AuraEnabled public String reviewedFxFingerprint;
        @AuraEnabled public String contentFingerprint;
        @AuraEnabled public String currencyCode;
        @AuraEnabled public Boolean alreadyPrepared;
        @AuraEnabled public String savedInputs;
        @AuraEnabled public String savedRemarks;
    }

    @AuraEnabled
    public static PreparationResult prepare(Id nominationId,String reviewedFxFingerprint) {
        return prepareSnapshot(nominationId,reviewedFxFingerprint,null);
    }

    @AuraEnabled
    public static PreparationResult prepareWithRemarks(Id nominationId,String reviewedFxFingerprint,String reviewedRemarks) {
        return prepareSnapshot(nominationId,reviewedFxFingerprint,reviewedRemarks);
    }

    private static PreparationResult prepareSnapshot(Id nominationId,String reviewedFxFingerprint,String reviewedRemarks) {
        requireEntry();
        if(!Nomination__c.SObjectType.getDescribe().isAccessible() || !Nomination__c.Saved_Inputs__c.getDescribe().isAccessible()
            || !Nomination__c.Saved_Remarks__c.getDescribe().isAccessible()) throw new AuraHandledException('Native confirmation content is not readable for this user.');
        if(nominationId==null || String.isBlank(reviewedFxFingerprint)) throw new AuraHandledException('Review the current native confirmation before preparing it.');
        Nomination__c pointer=[SELECT Id,STEM__c FROM Nomination__c WHERE Id=:nominationId LIMIT 1];
        if(pointer.STEM__c==null) throw new AuraHandledException('The confirmation must belong to a STEM.');
        STEM__c lockedStem=[SELECT Id FROM STEM__c WHERE Id=:pointer.STEM__c FOR UPDATE];
        Nomination__c nomination=[SELECT Id,Name,STEM__c,Account__c,Account__r.Name,Account__r.Attn_Override__c,Account__r.Attn__c,Contact__c,Contact__r.Name,Contact__r.Salutation,
            Payment_Term__c,RefCode__c,Supplier_RefCode__c,Sent_Nomination__c,RecordTypeId,Remarks__c,Saved_Inputs__c,Saved_Remarks__c,
            Document_Content_Fingerprint__c,Document_FX_Fingerprint__c,Document_Currency__c
            FROM Nomination__c WHERE Id=:nominationId FOR UPDATE];
        if(nomination.STEM__c!=lockedStem.Id) throw new AuraHandledException('The confirmation STEM changed. Review it again.');
        Boolean buyer=nomination.RecordTypeId==FCBStatic.NOMINATION_BUYER_RT_IT;
        Boolean supplier=nomination.RecordTypeId==FCBStatic.NOMINATION_SUPPLIER_RT_IT;
        if(!buyer && !supplier) throw new AuraHandledException('Only buyer confirmations and supplier nominations can be prepared as native documents.');

        FcosTradeDocumentService.DocumentReview review=FcosTradeDocumentService.nomination(nominationId);
        if(review.currencyCode!='HKD' || review.fingerprint!=reviewedFxFingerprint) throw new AuraHandledException('The native confirmation changed. Review it again.');
        if(String.isNotBlank(nomination.Document_Content_Fingerprint__c)) {
            if(reviewedRemarks!=null && reviewedRemarks!=nomination.Saved_Remarks__c)
                throw new AuraHandledException('The native confirmation remarks have already been frozen. Reopen the nomination.');
            return existingPreparation(nomination,review);
        }
        if(nomination.Document_Currency__c=='HKD' || String.isNotBlank(nomination.Document_FX_Fingerprint__c)) throw new AuraHandledException('The native confirmation snapshot is incomplete and cannot be replaced.');
        if(reviewedRemarks!=null && (!Nomination__c.SObjectType.getDescribe().isUpdateable() || !Nomination__c.Saved_Remarks__c.getDescribe().isUpdateable()))
            throw new AuraHandledException('Native confirmation remarks are not editable for this user.');

        STEM__c stem=[SELECT Id,Account__c,Account__r.Name,Account__r.Attn_Override__c,Account__r.Attn__c,Vessel__r.Name,Vessel__r.IMO__c,
            Port__r.Name,Location_Details__c,Payment_Term__c,Expected_Delivery_Date__c,Agent__c,Partial_CIA__c,Partial_Lumpsum_Sell_At__c
            FROM STEM__c WHERE Id=:lockedStem.Id];
        String paymentTermName=buyer?stem.Payment_Term__c:nomination.Payment_Term__c;
        List<Payment_Term__c> terms=String.isBlank(paymentTermName)?new List<Payment_Term__c>():[SELECT Name,Description__c FROM Payment_Term__c WHERE Name=:paymentTermName LIMIT 1];
        if(terms.isEmpty()) throw new AuraHandledException('The native confirmation requires its configured payment term.');
        String savedInputs=JSON.serialize(canonicalRows(nomination,stem,review,buyer,terms[0],hasTrusteeService(stem.Id)));
        if(savedInputs.length()>32768) throw new AuraHandledException('The prepared native confirmation exceeds the Saved Inputs storage limit.');
        String savedRemarks=reviewedRemarks==null?nomination.Saved_Remarks__c:reviewedRemarks;
        validateRemarks(savedRemarks);
        String contentFingerprint=contentFingerprint(reviewedFxFingerprint,savedInputs,savedRemarks);

        FcosTradeDocumentService.applySnapshot(nomination,review);
        nomination.Saved_Inputs__c=savedInputs;
        nomination.Saved_Remarks__c=savedRemarks;
        nomination.Document_Content_Fingerprint__c=contentFingerprint;
        preparingFingerprints.put(nomination.Id,contentFingerprint);
        try {
            update nomination;
            FcosTradeDocumentLineService.persist(nomination,review);
        } finally {
            preparingFingerprints.remove(nomination.Id);
        }
        return result(nomination,false);
    }

    @AuraEnabled
    public static PreparationResult readPrepared(Id nominationId,String reviewedFxFingerprint) {
        if(nominationId==null || String.isBlank(reviewedFxFingerprint)) throw new AuraHandledException('Review the current native confirmation before reopening it.');
        List<Nomination__c> rows=[SELECT Id,Document_Currency__c,Document_FX_Fingerprint__c,Document_Content_Fingerprint__c,Saved_Inputs__c,Saved_Remarks__c
            FROM Nomination__c WHERE Id=:nominationId WITH USER_MODE LIMIT 1];
        if(rows.isEmpty()) throw new AuraHandledException('The native confirmation is not readable.');
        Nomination__c nomination=rows[0];
        if(nomination.Document_Currency__c!='HKD' && String.isBlank(nomination.Document_FX_Fingerprint__c)
            && String.isBlank(nomination.Document_Content_Fingerprint__c)) return null;
        assertPrepared(nomination,reviewedFxFingerprint);
        return result(nomination,true);
    }

    // Called by the root-owned nomination guard only during this service's scoped DML.
    public static Boolean isPreparing(Nomination__c nomination) {
        if(nomination==null || nomination.Id==null) return false;
        String expected=preparingFingerprints.get(nomination.Id);
        return expected!=null && expected==nomination.Document_Content_Fingerprint__c
            && expected==contentFingerprint(nomination.Document_FX_Fingerprint__c,nomination.Saved_Inputs__c,nomination.Saved_Remarks__c);
    }

    public static void assertPrepared(Nomination__c nomination,String fxFingerprint) {
        if(nomination.Document_Currency__c!='HKD' || nomination.Document_FX_Fingerprint__c!=fxFingerprint || String.isBlank(nomination.Document_Content_Fingerprint__c)
            || nomination.Document_Content_Fingerprint__c!=contentFingerprint(fxFingerprint,nomination.Saved_Inputs__c,nomination.Saved_Remarks__c)) throw new AuraHandledException('Prepare the current native confirmation before generating its document.');
    }
    private static PreparationResult existingPreparation(Nomination__c nomination,FcosTradeDocumentService.DocumentReview review) {
        if(nomination.Document_Currency__c!='HKD' || nomination.Document_FX_Fingerprint__c!=review.fingerprint
            || String.isBlank(nomination.Saved_Inputs__c)) throw new AuraHandledException('The existing native confirmation snapshot is incomplete.');
        String actual=contentFingerprint(nomination.Document_FX_Fingerprint__c,nomination.Saved_Inputs__c,nomination.Saved_Remarks__c);
        if(actual!=nomination.Document_Content_Fingerprint__c) throw new AuraHandledException('The existing native confirmation content is not intact.');
        return result(nomination,true);
    }

    private static PreparationResult result(Nomination__c nomination,Boolean alreadyPrepared) {
        PreparationResult result=new PreparationResult();
        result.nominationId=nomination.Id;result.reviewedFxFingerprint=nomination.Document_FX_Fingerprint__c;
        result.contentFingerprint=nomination.Document_Content_Fingerprint__c;result.currencyCode='HKD';
        result.alreadyPrepared=alreadyPrepared;result.savedInputs=nomination.Saved_Inputs__c;result.savedRemarks=nomination.Saved_Remarks__c;
        return result;
    }

    private static void requireEntry() {
        if(!FcosCompanyFxRateService.enabled() || !(FeatureManagement.checkPermission('Fcos_Trading_FX_Entry') || (Test.isRunningTest() && testEntryPermission)))
            throw new AuraHandledException('Native confirmation preparation is not enabled for this user.');
    }

    private static Boolean hasTrusteeService(Id stemId) {
        for(STEM_Extra_Cost__c cost:[SELECT Product2Id__r.Name,Supplier__r.Name FROM STEM_Extra_Cost__c WHERE STEM__c=:stemId AND Cancelled__c=false]) {
            if(cost.Product2Id__r!=null && cost.Supplier__r!=null && cost.Product2Id__r.Name==TRUSTEE_SERVICE && cost.Supplier__r.Name==FCBS_NAME) return true;
        }
        return false;
    }

    @TestVisible
    private static List<Object> canonicalRows(Nomination__c nomination,STEM__c stem,FcosTradeDocumentService.DocumentReview review,Boolean buyer,Payment_Term__c term,Boolean trusteeSeller) {
        List<Object> rows=new List<Object>();
        String counterparty=nomination.Account__r==null?'':nomination.Account__r.Name;
        String attention=attention(nomination,stem,buyer);
        row(rows,'TO',counterparty,false);
        if(!String.isBlank(attention)) row(rows,'ATTN',attention.toUpperCase(),false);
        row(rows,'DATE',dateText(Date.today()),false);
        String reference=buyer?nomination.RefCode__c:nomination.Supplier_RefCode__c;
        if(buyer && nomination.Sent_Nomination__c==true && !String.isBlank(reference)) reference+=' <REVISED COPY>';
        if(!String.isBlank(reference)) row(rows,'REF',reference,false);
        heading(rows,buyer?'WE ARE PLEASED TO CONFIRM HAVING ARRANGED FOLLOWING SUPPLY IN ACCORDANCE WITH YOUR INSTRUCTIONS':'PLEASE ARRANGE AND CONFIRM FOLLOWING SUPPLY ON OUR ACCOUNT:');
        String vessel=stem.Vessel__r==null?'UNKNOWN VESSEL':stem.Vessel__r.Name;
        if(stem.Vessel__r!=null && !String.isBlank(stem.Vessel__r.IMO__c)) vessel+=' (IMO: '+stem.Vessel__r.IMO__c+')';
        row(rows,'VESSEL',vessel,false);
        String port=stem.Port__r==null?'':stem.Port__r.Name;
        if(!String.isBlank(stem.Location_Details__c)) port+=' ('+stem.Location_Details__c+')';
        row(rows,'PORT',port,false);
        if(stem.Expected_Delivery_Date__c!=null) row(rows,'READINESS',dateText(stem.Expected_Delivery_Date__c),false);
        separator(rows);
        for(FcosTradeDocumentService.Line line:review.lines) addNativeLine(rows,line,buyer);
        if(buyer) row(rows,'SELLER',trusteeSeller?SG_TRUSTEE_SELLER:HK_SELLER,false);
        String payment=(term.Name+' '+(term.Description__c==null?'':term.Description__c)).trim().toUpperCase();
        row(rows,buyer?'PAYMENT TERM':'PAYMENT',payment,false);
        if(!buyer) row(rows,'AGENT',String.isBlank(stem.Agent__c)?'TO BE ADVISED':stem.Agent__c,false);
        return rows;
    }

    private static void addNativeLine(List<Object> rows,FcosTradeDocumentService.Line line,Boolean buyer) {
        if(line==null || String.isBlank(line.name) || line.quantity==null || String.isBlank(line.unit) || line.nativeUnitPrice==null || line.nativeAmount==null)
            throw new AuraHandledException('Every native confirmation line requires immutable quantity, unit, price and amount evidence.');
        row(rows,'GRADE',line.name,false);
        row(rows,'QUANTITY',decimalText(line.quantity,3)+' '+line.unit,false);
        row(rows,'PRICE','HKD '+decimalText(line.nativeUnitPrice,8)+'/'+line.unit,false);
        if(line.nativeMinimum!=null) row(rows,'MINIMUM','HKD '+decimalText(line.nativeMinimum,2),false);
        if(line.nativeLumpsum!=null) row(rows,'LUMPSUM','HKD '+decimalText(line.nativeLumpsum,2),false);
        row(rows,'AMOUNT','HKD '+decimalText(line.nativeAmount,2),false);
        separator(rows);
    }

    private static String attention(Nomination__c nomination,STEM__c stem,Boolean buyer) {
        if(buyer && stem.Account__r!=null && stem.Account__r.Attn_Override__c==true) return stem.Account__r.Attn__c;
        if(!buyer && nomination.Account__r!=null && nomination.Account__r.Attn_Override__c==true) return nomination.Account__r.Attn__c;
        if(nomination.Contact__r==null) return '';
        return (nomination.Contact__r.Salutation==null?'':nomination.Contact__r.Salutation+' ')+nomination.Contact__r.Name;
    }
    private static void row(List<Object> rows,Object label,String value,Boolean hidden) {
        Map<String,Object> output=new Map<String,Object>();output.put('label',label);output.put('value',value==null?'':value);if(hidden) output.put('isHidden',true);rows.add(output);
    }
    private static void heading(List<Object> rows,String content) {
        Map<String,Object> label=new Map<String,Object>();label.put('content',content);label.put('colSpan',3);row(rows,label,'',true);
    }
    private static void separator(List<Object> rows) { row(rows,'--','',true); }
    @TestVisible private static String contentFingerprint(String fxFingerprint,String savedInputs,String savedRemarks) {
        return EncodingUtil.convertToHex(Crypto.generateDigest('SHA-256',Blob.valueOf('v1|'+String.valueOf(fxFingerprint)+'|'+String.valueOf(savedInputs)+'|'+String.valueOf(savedRemarks))));
    }
    private static void validateRemarks(String savedRemarks) {
        if(String.isBlank(savedRemarks)) return;
        try {
            Object parsed=JSON.deserializeUntyped(savedRemarks);
            if(!(parsed instanceof Map<String,Object>)) throw new AuraHandledException('Saved confirmation remarks must be a template remarks object.');
        } catch(JSONException error) {
            throw new AuraHandledException('Saved confirmation remarks are invalid and cannot be frozen into a native document.');
        }
    }
    @TestVisible private static String decimalText(Decimal value,Integer scale) { return value==null?'':String.valueOf(value.setScale(scale,RoundingMode.HALF_UP)); }
    @TestVisible private static String dateText(Date value) {
        return value==null?'':twoDigits(value.day())+'/'+twoDigits(value.month())+'/'+String.valueOf(value.year());
    }
    private static String twoDigits(Integer value) { return value<10?'0'+String.valueOf(value):String.valueOf(value); }
    @TestVisible private static void authorizeForTest(Id nominationId,String contentFingerprint) { preparingFingerprints.put(nominationId,contentFingerprint); }
    @TestVisible private static void clearAuthorizationForTest() { preparingFingerprints.clear(); }
}
