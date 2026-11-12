/** Keeps invoice carrying value, company-valued cash, and actual bank evidence separate. */
public with sharing class FcosTradePaymentService {
    @TestVisible private static Boolean managedWrite = false;
    private static final List<String> SNAPSHOT_FIELDS = new List<String>{'Cash_Event__c','Remittance__c','Is_Deposit__c','Auto_Planned_Deposit__c','Payment_Currency__c','Payment_HKD_Amount__c','Payment_FX_Rate__c','Payment_FX_Revision__c','Payment_FX_Effective_At__c','Invoice_Carrying_USD__c','Settlement_FX_USD__c','Bank_Currency__c','Bank_Native_Amount__c','Bank_FX_Evidence__c','Buyer_Invoice__c','Supplier_Invoice__c','Amount__c','Date__c','STEM__c','Account__c','RecordTypeId','CurrencyIsoCode','Bank__c','Payment_Operation_Id__c','Payment_Request_Fingerprint__c'};
    public class PaymentReview {
        @AuraEnabled public String rateId;
        @AuraEnabled public Decimal usdHkdRate;
        @AuraEnabled public Datetime effectiveAt;
        @AuraEnabled public Date paymentDate;
    }
    @AuraEnabled
    public static PaymentReview previewPayment(Date paymentDate) {
        requireEntry();
        validateActualPaymentDate(paymentDate);
        FcosCompanyFxRateService.Snapshot snapshot = FcosCompanyFxRateService.forPaymentDate(paymentDate);
        PaymentReview review = new PaymentReview(); review.rateId=snapshot.rateId;review.usdHkdRate=snapshot.usdHkdRate;
        review.effectiveAt=snapshot.effectiveAt;review.paymentDate=paymentDate;return review;
    }
    public class PaymentAllocationReview {
        @AuraEnabled public String currencyCode;
        @AuraEnabled public Decimal invoiceNativeTotal;
        @AuraEnabled public Decimal remainingNative;
        @AuraEnabled public Decimal invoiceUsdTotal;
        @AuraEnabled public Decimal remainingCarryingUsd;
        @AuraEnabled public Decimal nativeAmount;
        @AuraEnabled public Decimal cashUsd;
        @AuraEnabled public Decimal carryingUsd;
        @AuraEnabled public Decimal settlementFxUsd;
        @AuraEnabled public Decimal usdHkdRate;
        @AuraEnabled public String rateId;
        @AuraEnabled public Datetime effectiveAt;
        @AuraEnabled public Date paymentDate;
    }
    @AuraEnabled
    public static PaymentAllocationReview previewAllocation(Id invoiceId,Decimal nativeAmount,Date paymentDate) {
        requireEntry();
        if(paymentDate!=null) validateActualPaymentDate(paymentDate);
        FcosCompanyFxRateService.Snapshot rate;
        if(invoiceId==null || (invoiceId.getSObjectType()!=Invoice__c.SObjectType && invoiceId.getSObjectType()!=Supplier_Invoice__c.SObjectType)) throw new AuraHandledException('Select a buyer or supplier invoice.');
        Boolean supplier=invoiceId.getSObjectType()==Supplier_Invoice__c.SObjectType;
        String objectName=supplier?'Supplier_Invoice__c':'Invoice__c',amountField=supplier?'Invoice_Amount__c':'Amount__c';
        SObject invoice=Database.query('SELECT Id,STEM__c,'+amountField+',Document_Currency__c,Document_HKD_Amount__c,Document_FX_Rate__c,Document_FX_Revision__c,Document_FX_Confirmed_At__c,Document_FX_Side__c,Document_FX_Fingerprint__c,Final_Of_Proforma__c'+(supplier?',Proforma__c,Supplier__c,Invoice_File__c,Reissue_Of_Supplier_Invoice__c,Original_Supplier_Invoice__c':',File__c,Proforma__c,Deprecated__c,Reissue_Of_Invoice__c,Original_Invoice__c')+' FROM '+objectName+' WHERE Id=:invoiceId LIMIT 1');
        requireIssuedInvoice(invoice,supplier);
        Boolean usd=invoice.get('Document_Currency__c')=='USD' && FcosTradeDocumentService.isManagedDocument(invoice);
        if((!usd && (invoice.get('Document_Currency__c')!='HKD' || invoice.get('Document_HKD_Amount__c')==null)) || invoice.get('Document_FX_Confirmed_At__c')==null) throw new AuraHandledException('The invoice has no confirmed native HKD snapshot.');
        PaymentAllocationReview result=new PaymentAllocationReview();result.currencyCode=usd?'USD':'HKD';
        result.invoiceNativeTotal=(Decimal)invoice.get(usd?amountField:'Document_HKD_Amount__c');result.invoiceUsdTotal=(Decimal)invoice.get(amountField);
        SettlementPosition position=settlementPosition(invoice,supplier,usd,false);
        result.remainingNative=position.nativeRemaining;result.remainingCarryingUsd=position.carryingRemaining;
        if(!usd && paymentDate!=null && position.nativeRemaining!=0) rate=FcosCompanyFxRateService.forPaymentDate(paymentDate);
        result.nativeAmount=nativeAmount;result.paymentDate=paymentDate;
        if(rate!=null) { result.usdHkdRate=rate.usdHkdRate;result.rateId=rate.rateId;result.effectiveAt=rate.effectiveAt; }
        if(nativeAmount!=null) {
            if(paymentDate==null || (!usd && rate==null)) throw new AuraHandledException('Select the payment date to retrieve its approved company rate.');
            if(nativeAmount==0 || nativeAmount!=nativeAmount.setScale(2,RoundingMode.HALF_UP) || result.remainingNative*nativeAmount<=0 || nativeAmount.abs()>result.remainingNative.abs()) throw new AuraHandledException('Enter a two-decimal allocation within the remaining invoice or credit balance.');
            result.cashUsd=usd?nativeAmount:(nativeAmount/rate.usdHkdRate).setScale(2,RoundingMode.HALF_UP);
            result.carryingUsd=nativeAmount==result.remainingNative?result.remainingCarryingUsd:(nativeAmount*result.invoiceUsdTotal/result.invoiceNativeTotal).setScale(2,RoundingMode.HALF_UP);
            result.settlementFxUsd=supplier?result.carryingUsd-result.cashUsd:result.cashUsd-result.carryingUsd;
        }
        return result;
    }
    @TestVisible private static void requireIssuedInvoice(SObject invoice,Boolean supplier) {
        if (invoice.get('Proforma__c') == true || (!supplier && invoice.get('Deprecated__c') == true))
            throw new AuraHandledException('Payments and credit refunds require an active issued invoice; proforma and deprecated documents cannot be settled.');
        String fileField=supplier?'Invoice_File__c':'File__c';
        if (String.isBlank((String)invoice.get(fileField)))
            throw new AuraHandledException('Issue the invoice or credit note and attach its document before recording a payment or refund.');
    }
    private static void requireEntry() {
        if (!FcosCompanyFxRateService.enabled() || !FeatureManagement.checkPermission('Fcos_Trading_FX_Entry')) throw new AuraHandledException('HKD payment entry is not enabled for this user.');
    }
    @TestVisible private static void validateActualPaymentDate(Date paymentDate) {
        Date hongKongToday=Date.valueOf(Datetime.now().format('yyyy-MM-dd','Asia/Hong_Kong'));
        if(paymentDate==null || paymentDate>hongKongToday)
            throw new AuraHandledException('Use the actual Hong Kong bank payment date, not a future planned date.');
    }
    @AuraEnabled
    public static Id recordPayment(Id invoiceId, Decimal nativeAmount, Date paymentDate, String reviewedRateId, String bankName, String bankCurrencyCode, Decimal bankNativeAmount, String bankEvidence, String operationId) {
        requireEntry();
        if (invoiceId == null || nativeAmount == null || nativeAmount == 0 || nativeAmount != nativeAmount.setScale(2,RoundingMode.HALF_UP)) throw new AuraHandledException('Enter the native HKD allocation to two decimal places.');
        validateActualPaymentDate(paymentDate);
        if(String.isBlank(operationId) || !Pattern.matches('[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}',operationId)) throw new AuraHandledException('A stable payment operation ID is required.');
        operationId=operationId.toLowerCase();
        validateBankEvidence(nativeAmount,bankName,bankCurrencyCode,bankNativeAmount,bankEvidence);
        String requestFingerprint=paymentRequestFingerprint(invoiceId,nativeAmount,paymentDate,reviewedRateId,bankName,bankCurrencyCode,bankNativeAmount,bankEvidence);
        Id priorOperation=findOperation(operationId,requestFingerprint);
        if(priorOperation!=null) return priorOperation;
        FcosCompanyFxRateService.Snapshot rate = FcosCompanyFxRateService.forPaymentDate(paymentDate);
        if (rate.rateId != reviewedRateId) throw new AuraHandledException('The payment-date company rate changed. Review this payment again.');
        Boolean supplier = invoiceId.getSObjectType() == Supplier_Invoice__c.SObjectType;
        if (!supplier && invoiceId.getSObjectType() != Invoice__c.SObjectType) throw new AuraHandledException('Select a buyer or supplier invoice.');
        String objectName = supplier ? 'Supplier_Invoice__c' : 'Invoice__c';
        String amountField = supplier ? 'Invoice_Amount__c' : 'Amount__c';
        List<SObject> invoices = Database.query('SELECT Id,STEM__c,STEM__r.Account__c,'+amountField+',Document_Currency__c,Document_HKD_Amount__c,Document_FX_Rate__c,Document_FX_Revision__c,Document_FX_Confirmed_At__c,Document_FX_Side__c,Document_FX_Fingerprint__c,Final_Of_Proforma__c'+(supplier?',Proforma__c,Supplier__c,Invoice_File__c,Original_Supplier_Invoice__c':',File__c,Proforma__c,Deprecated__c,Original_Invoice__c')+' FROM '+objectName+' WHERE Id = :invoiceId FOR UPDATE');
        if (invoices.isEmpty()) throw new AuraHandledException('The invoice is unavailable.');
        priorOperation=findOperation(operationId,requestFingerprint);
        if(priorOperation!=null) return priorOperation;
        SObject invoice = invoices[0];
        requireIssuedInvoice(invoice,supplier);
        if (invoice.get('Document_Currency__c') != 'HKD' || invoice.get('Document_FX_Confirmed_At__c') == null || invoice.get('Document_HKD_Amount__c') == null || invoice.get('Document_FX_Revision__c') == null) throw new AuraHandledException('The invoice has no confirmed native HKD snapshot.');
        Decimal invoiceNative = (Decimal)invoice.get('Document_HKD_Amount__c'), invoiceUsd = (Decimal)invoice.get(amountField);
        String invoiceField = supplier ? 'Supplier_Invoice__c' : 'Buyer_Invoice__c';
        SettlementPosition position=settlementPosition(invoice,supplier,false,true);
        Decimal remaining=position.nativeRemaining;
        if (remaining == 0 || remaining*nativeAmount <= 0 || nativeAmount.abs() > remaining.abs()) throw new AuraHandledException('The allocation exceeds the remaining invoice or refundable cash balance.');
        Decimal carryingUsd = nativeAmount == remaining ? position.carryingRemaining : (nativeAmount*invoiceUsd/invoiceNative).setScale(2,RoundingMode.HALF_UP);
        Decimal cashUsd = (nativeAmount/rate.usdHkdRate).setScale(2,RoundingMode.HALF_UP);
        Payment__c payment = new Payment__c(STEM__c=(Id)invoice.get('STEM__c'),Account__c=supplier?(Id)invoice.get('Supplier__c'):(Id)invoice.getSObject('STEM__r').get('Account__c'),
            RecordTypeId=Schema.SObjectType.Payment__c.getRecordTypeInfosByDeveloperName().get(supplier?'Payable':'Receivable').getRecordTypeId(),
            Date__c=paymentDate,Bank__c=bankName,Amount__c=cashUsd,Payment_Currency__c='HKD',Payment_HKD_Amount__c=nativeAmount,
            Payment_FX_Rate__c=rate.usdHkdRate,Payment_FX_Revision__c=rate.rateId,Payment_FX_Effective_At__c=rate.effectiveAt,
            Invoice_Carrying_USD__c=carryingUsd,Settlement_FX_USD__c=supplier?carryingUsd-cashUsd:cashUsd-carryingUsd,
            Bank_Currency__c=bankCurrencyCode,Bank_Native_Amount__c=bankNativeAmount,Bank_FX_Evidence__c=bankEvidence,
            Payment_Operation_Id__c=operationId,Payment_Request_Fingerprint__c=requestFingerprint);
        payment.put(invoiceField,invoiceId);
        if (Payment__c.SObjectType.getDescribe().fields.getMap().containsKey('CurrencyIsoCode')) payment.put('CurrencyIsoCode','USD');
        managedWrite=true;
        try { insert payment; }
        catch(DmlException error) {
            // Unique operation IDs arbitrate concurrent requests even across different invoice locks.
            if(error.getDmlStatusCode(0)==String.valueOf(StatusCode.DUPLICATE_VALUE)) {
                Id existing=findOperation(operationId,requestFingerprint);
                if(existing!=null) return existing;
            }
            throw error;
        } finally { managedWrite=false; }
        return payment.Id;
    }
    @TestVisible private static String paymentRequestFingerprint(Id invoiceId,Decimal nativeAmount,Date paymentDate,String reviewedRateId,String bankName,String bankCurrencyCode,Decimal bankNativeAmount,String bankEvidence) {
        List<String> values=new List<String>{String.valueOf(invoiceId),nativeAmount==null?null:String.valueOf(nativeAmount.setScale(2,RoundingMode.HALF_UP)),
            String.valueOf(paymentDate),reviewedRateId,bankName,bankCurrencyCode,
            bankNativeAmount==null?null:String.valueOf(bankNativeAmount.setScale(2,RoundingMode.HALF_UP)),bankEvidence};
        return EncodingUtil.convertToHex(Crypto.generateDigest('SHA-256',Blob.valueOf(JSON.serialize(values))));
    }
    private static Id findOperation(String operationId,String requestFingerprint) {
        List<Payment__c> prior=[SELECT Id,Payment_Request_Fingerprint__c FROM Payment__c WHERE Payment_Operation_Id__c=:operationId LIMIT 1];
        if(prior.isEmpty()) return null;
        return matchingOperation(prior[0],requestFingerprint);
    }
    @TestVisible private static Id matchingOperation(Payment__c prior,String requestFingerprint) {
        if(prior.Payment_Request_Fingerprint__c!=requestFingerprint) throw new AuraHandledException('This payment operation ID was already used for different payment details.');
        return prior.Id;
    }
    /** Exact USD allocation for an issued managed final invoice or credit, including a corrected reissue. */
    @AuraEnabled
    public static Id recordUsdReissuePayment(Id invoiceId,Decimal nativeAmount,Date paymentDate,String bankName,String bankCurrencyCode,Decimal bankNativeAmount,String bankEvidence,String operationId) {
        requireEntry();
        if(invoiceId==null || (invoiceId.getSObjectType()!=Invoice__c.SObjectType && invoiceId.getSObjectType()!=Supplier_Invoice__c.SObjectType)
            || paymentDate==null || nativeAmount==null || nativeAmount==0 || nativeAmount!=nativeAmount.setScale(2,RoundingMode.HALF_UP)) throw new AuraHandledException('Select the exact USD invoice or credit, payment date and two-decimal allocation.');
        validateActualPaymentDate(paymentDate);
        if(String.isBlank(operationId) || !Pattern.matches('[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}',operationId)) throw new AuraHandledException('A stable payment operation ID is required.');
        operationId=operationId.toLowerCase();
        if(String.isBlank(bankName) || (bankCurrencyCode!='USD' && bankCurrencyCode!='HKD') || String.isBlank(bankEvidence)
            || bankNativeAmount==null || bankNativeAmount<=0 || bankNativeAmount!=bankNativeAmount.setScale(2,RoundingMode.HALF_UP)) throw new AuraHandledException('Retain the positive two-decimal bank amount, bank currency and actual statement evidence.');
        if(bankCurrencyCode=='USD' && bankNativeAmount!=nativeAmount.abs()) throw new AuraHandledException('The USD bank amount must equal the allocation magnitude. Record bank fees separately.');
        String fingerprint=paymentRequestFingerprint(invoiceId,nativeAmount,paymentDate,'USD',bankName,bankCurrencyCode,bankNativeAmount,bankEvidence);
        Id prior=findOperation(operationId,fingerprint);if(prior!=null) return prior;
        Boolean supplier=invoiceId.getSObjectType()==Supplier_Invoice__c.SObjectType;
        String amountField=supplier?'Invoice_Amount__c':'Amount__c',invoiceField=supplier?'Supplier_Invoice__c':'Buyer_Invoice__c';
        String details=supplier?'Proforma__c,Supplier__c,Invoice_File__c,Reissue_Of_Supplier_Invoice__c,Original_Supplier_Invoice__c':'File__c,Proforma__c,Deprecated__c,Reissue_Of_Invoice__c,Original_Invoice__c';
        SObject invoice=Database.query('SELECT Id,STEM__c,STEM__r.Account__c,'+amountField+','+details+',Document_Currency__c,Document_HKD_Amount__c,Document_FX_Rate__c,Document_FX_Revision__c,Document_FX_Confirmed_At__c,Document_FX_Side__c,Document_FX_Fingerprint__c,Final_Of_Proforma__c FROM '+invoiceId.getSObjectType().getDescribe().getName()+' WHERE Id=:invoiceId FOR UPDATE');
        prior=findOperation(operationId,fingerprint);if(prior!=null) return prior;
        requireIssuedInvoice(invoice,supplier);
        if(!FcosTradeDocumentService.isManagedDocument(invoice) || invoice.get('Document_Currency__c')!='USD' || invoice.get('Document_HKD_Amount__c')!=null
            || invoice.get('Document_FX_Rate__c')!=null || invoice.get('Document_FX_Revision__c')!=null || invoice.get('Document_FX_Confirmed_At__c')==null)
            throw new AuraHandledException('The exact invoice must be an issued, confirmed managed USD final invoice or credit.');
        SettlementPosition position=settlementPosition(invoice,supplier,true,true);
        Decimal remaining=position.nativeRemaining;
        if(remaining==null || remaining*nativeAmount<=0 || nativeAmount.abs()>remaining.abs()) throw new AuraHandledException('The allocation exceeds the remaining USD invoice or refundable cash balance.');
        Payment__c payment=new Payment__c(STEM__c=(Id)invoice.get('STEM__c'),Account__c=supplier?(Id)invoice.get('Supplier__c'):(Id)invoice.getSObject('STEM__r').get('Account__c'),
            RecordTypeId=Schema.SObjectType.Payment__c.getRecordTypeInfosByDeveloperName().get(supplier?'Payable':'Receivable').getRecordTypeId(),
            Date__c=paymentDate,Bank__c=bankName,Amount__c=nativeAmount,Payment_Currency__c='USD',Invoice_Carrying_USD__c=nativeAmount,Settlement_FX_USD__c=0,
            Bank_Currency__c=bankCurrencyCode,Bank_Native_Amount__c=bankNativeAmount,Bank_FX_Evidence__c=bankEvidence,
            Payment_Operation_Id__c=operationId,Payment_Request_Fingerprint__c=fingerprint);
        payment.put(invoiceField,invoiceId);
        if(Payment__c.SObjectType.getDescribe().fields.getMap().containsKey('CurrencyIsoCode')) payment.put('CurrencyIsoCode','USD');
        managedWrite=true;
        try {insert payment;}
        catch(DmlException error) {
            if(error.getDmlStatusCode(0)==String.valueOf(StatusCode.DUPLICATE_VALUE)) {Id existing=findOperation(operationId,fingerprint);if(existing!=null) return existing;}
            throw error;
        } finally {managedWrite=false;}
        return payment.Id;
    }
    private class SettlementPosition {
        Decimal nativeRemaining=0;
        Decimal carryingRemaining=0;
    }
    /** Full credit cancels unpaid debt; only actual original cash can be refunded. */
    private static SettlementPosition settlementPosition(SObject invoice,Boolean supplier,Boolean usd,Boolean lockOriginal) {
        String objectName=supplier?'Supplier_Invoice__c':'Invoice__c';
        String amountField=supplier?'Invoice_Amount__c':'Amount__c';
        String parentField=supplier?'Supplier_Invoice__c':'Buyer_Invoice__c';
        String originalField=supplier?'Original_Supplier_Invoice__c':'Original_Invoice__c';
        Id invoiceId=invoice.Id,originalId=(Id)invoice.get(originalField);
        Decimal face=(Decimal)invoice.get(usd?amountField:'Document_HKD_Amount__c');
        Decimal carrying=(Decimal)invoice.get(amountField);
        if(face==null || face==0 || carrying==null || (face<0)!=(originalId!=null)) throw new AuraHandledException('Reconcile the invoice and original-credit lineage before settlement.');
        SettlementPosition result=new SettlementPosition();
        Set<Id> ids=new Set<Id>{invoiceId};
        if(originalId==null) {
            // The caller locks this invoice before a write. Credit creation takes
            // the same lock, so a payment cannot race past a full reversal.
            if(!Database.query('SELECT Id FROM '+objectName+' WHERE '+originalField+'=:invoiceId LIMIT 1').isEmpty())
                throw new AuraHandledException('This invoice has been fully credited. Settle its reissue or refund the credit against actual original cash.');
            result.nativeRemaining=face;result.carryingRemaining=carrying;
        } else {
            ids.add(originalId);
            String extras=supplier?',Proforma__c,Supplier__c,Invoice_File__c':',File__c,Proforma__c,Deprecated__c';
            List<SObject> originals=Database.query('SELECT Id,STEM__c,'+amountField+','+originalField+',Document_Currency__c,Document_HKD_Amount__c,Document_FX_Rate__c,Document_FX_Revision__c,Document_FX_Confirmed_At__c,Document_FX_Side__c,Document_FX_Fingerprint__c,Final_Of_Proforma__c'+extras+' FROM '+objectName+' WHERE Id=:originalId'+(lockOriginal?' FOR UPDATE':''));
            if(originals.isEmpty()) throw new AuraHandledException('The original invoice is unavailable for refund review.');
            SObject original=originals[0];requireIssuedInvoice(original,supplier);
            Decimal originalFace=(Decimal)original.get(usd?amountField:'Document_HKD_Amount__c');
            if(original.get(originalField)!=null || originalFace==null || originalFace<=0 || face!=-originalFace
                || carrying!=-(Decimal)original.get(amountField) || original.get('STEM__c')!=invoice.get('STEM__c')
                || (supplier && original.get('Supplier__c')!=invoice.get('Supplier__c'))
                || original.get('Document_Currency__c')!=invoice.get('Document_Currency__c')
                || original.get('Document_FX_Rate__c')!=invoice.get('Document_FX_Rate__c')
                || original.get('Document_FX_Revision__c')!=invoice.get('Document_FX_Revision__c')
                || original.get('Document_FX_Confirmed_At__c')!=invoice.get('Document_FX_Confirmed_At__c'))
                throw new AuraHandledException('The credit must retain its exact original invoice amount, currency and rate.');
        }
        Decimal originalPaid=0,originalCarrying=0;
        for(SObject payment:FcosTradeSettlementStore.payments(ids,supplier)) {
            Boolean originalCash=originalId!=null && payment.get(parentField)==originalId;
            Boolean refund=originalId!=null && !originalCash;
            Boolean applicationReversal=payment.get('Cash_Event__c')!=null && (Decimal)payment.get(usd?'Amount__c':'Payment_HKD_Amount__c')<0 && !refund;
            String code=(String)payment.get('Payment_Currency__c');
            Decimal allocationNative=(Decimal)payment.get(usd?'Amount__c':'Payment_HKD_Amount__c');
            Decimal cash=(Decimal)payment.get('Amount__c');
            Decimal paymentCarrying=usd?cash:(Decimal)payment.get('Invoice_Carrying_USD__c');
            SObject paymentType=payment.getSObject('RecordType');
            if((usd && (code!='USD' || payment.get('Payment_HKD_Amount__c')!=null || payment.get('Invoice_Carrying_USD__c')!=cash))
                || (!usd && code!='HKD') || allocationNative==null || allocationNative==0 || paymentCarrying==null || cash==null
                || (allocationNative<0)!=(refund || applicationReversal) || ((refund || applicationReversal)?(paymentCarrying>0 || cash>0):(paymentCarrying<0 || cash<0))
                || paymentType==null || paymentType.get('DeveloperName')!=(supplier?'Payable':'Receivable'))
                throw new AuraHandledException('Reconcile the existing cash allocations and refunds before native settlement.');
            // On a credit, original cash is a negative refundable entitlement;
            // prior negative refunds consume it. No unpaid debt becomes cash.
            if(originalCash) {originalPaid+=allocationNative;originalCarrying+=paymentCarrying;}
            result.nativeRemaining-=allocationNative;result.carryingRemaining-=paymentCarrying;
        }
        if(originalId!=null) {
            if(originalPaid>face.abs() || originalCarrying>carrying.abs() || result.nativeRemaining>0 || result.carryingRemaining>0)
                throw new AuraHandledException('The credit cash and refund history require reconciliation.');
        } else if(result.nativeRemaining<0 || result.carryingRemaining<0)
            throw new AuraHandledException('The invoice allocations exceed its original balance.');
        if(result.nativeRemaining==0 && result.carryingRemaining!=0) throw new AuraHandledException('The settled native amount has an unresolved USD carrying balance.');
        return result;
    }
    public static Decimal carryingAmount(Payment__c payment) {
        return payment.Payment_Currency__c == 'HKD' ? payment.Invoice_Carrying_USD__c : payment.Amount__c;
    }
    @TestVisible private static void validateBankEvidence(Decimal nativeAmount,String bankName,String bankCurrencyCode,Decimal bankNativeAmount,String bankEvidence) {
        if (String.isBlank(bankName) || (bankCurrencyCode != 'USD' && bankCurrencyCode != 'HKD') || String.isBlank(bankEvidence)) throw new AuraHandledException('Retain the bank amount, currency and evidence for this payment.');
        if (bankNativeAmount == null || bankNativeAmount <= 0 || bankNativeAmount != bankNativeAmount.setScale(2,RoundingMode.HALF_UP)) throw new AuraHandledException('Enter the positive bank amount magnitude to two decimal places, including for a refund.');
        if (bankCurrencyCode == 'HKD' && (nativeAmount == null || bankNativeAmount != nativeAmount.abs())) throw new AuraHandledException('The HKD bank amount must equal the native allocation magnitude. Record bank fees separately.');
    }
    @TestVisible private static Boolean buyerAllocation(Payment__c row) {
        if (row == null) return false;
        for (String name : new List<String>{'Receivable','Bank_Charge','Write_Off'}) {
            Schema.RecordTypeInfo info=Payment__c.SObjectType.getDescribe().getRecordTypeInfosByDeveloperName().get(name);
            if (info != null && row.RecordTypeId == info.getRecordTypeId()) return true;
        }
        return false;
    }
    public static void guard(List<Payment__c> rows, Map<Id,Payment__c> oldRows) {
        if (managedWrite) return;
        List<Payment__c> remaining=new List<Payment__c>();
        for(Payment__c row:rows) if(!FcosTradeCashService.isAuthorizedPayment(row)) remaining.add(row);
        rows=remaining;if(rows.isEmpty()) return;
        for(Payment__c row:rows) {
            Payment__c previous=oldRows==null?null:oldRows.get(row.Id);
            if((previous==null?row.Auto_Planned_Deposit__c==true:row.Auto_Planned_Deposit__c!=previous.Auto_Planned_Deposit__c)
                && !DepositCalculationService.isPlanningDeposit() && !SupplierInvoiceTriggerHandler.isPlanningDeposit())
                row.addError('Only the deposit planning service may identify a newly created planned obligation.');
            if(previous==null ? (row.Cash_Event__c!=null || !String.isBlank(row.Payment_Operation_Id__c) || !String.isBlank(row.Payment_Request_Fingerprint__c))
                : row.Cash_Event__c!=previous.Cash_Event__c || row.Payment_Operation_Id__c!=previous.Payment_Operation_Id__c || row.Payment_Request_Fingerprint__c!=previous.Payment_Request_Fingerprint__c)
                row.addError('Payment operation evidence can only be created by the reviewed payment action and cannot be amended.');
        }
        // Keep the specific rejection and avoid extra invoice queries for already rejected rows.
        remaining=new List<Payment__c>();
        for(Payment__c row:rows) if(!row.hasErrors()) remaining.add(row);
        rows=remaining;if(rows.isEmpty()) return;
        Boolean hasRecordCurrency = Payment__c.SObjectType.getDescribe().fields.getMap().containsKey('CurrencyIsoCode');
        Set<Id> buyerIds = new Set<Id>(), supplierIds = new Set<Id>(), stemIds = new Set<Id>();
        List<Payment__c> evidenceRows=new List<Payment__c>();evidenceRows.addAll(rows);
        if(oldRows!=null) evidenceRows.addAll(oldRows.values());
        Set<String> protectedSides=managedUnallocatedSides(evidenceRows);
        for(Payment__c row:rows) {
            Payment__c previous=oldRows==null?null:oldRows.get(row.Id);
            if(!protectedSides.contains(unallocatedSideKey(row)) && (previous==null || !protectedSides.contains(unallocatedSideKey(previous)))) continue;
            Boolean changed=previous==null;
            if (previous != null) {
                for (String field : SNAPSHOT_FIELDS) {
                    if (field == 'CurrencyIsoCode' && !hasRecordCurrency) continue;
                    if (row.get(field) != previous.get(field)) changed = true;
                }
            }
            if(changed) row.addError('This confirmed currency side uses actual cash events and exact final-invoice allocations. Reconcile historical unallocated payments separately.');
        }
        for (Payment__c row : evidenceRows) {
            if(row.Buyer_Invoice__c!=null) buyerIds.add(row.Buyer_Invoice__c);
            if(row.Supplier_Invoice__c!=null) supplierIds.add(row.Supplier_Invoice__c);
            if(buyerAllocation(row) && row.Buyer_Invoice__c==null && row.STEM__c!=null) stemIds.add(row.STEM__c);
        }
        Map<Id,Invoice__c> buyers=new Map<Id,Invoice__c>();
        if(!buyerIds.isEmpty()) buyers=new Map<Id,Invoice__c>([SELECT Id,Document_Currency__c,Document_FX_Side__c,Document_FX_Confirmed_At__c,Document_FX_Fingerprint__c,Final_Of_Proforma__c,Reissue_Of_Invoice__c,Original_Invoice__c FROM Invoice__c WHERE Id IN :buyerIds]);
        Map<Id,Supplier_Invoice__c> suppliers=new Map<Id,Supplier_Invoice__c>();
        if(!supplierIds.isEmpty()) suppliers=new Map<Id,Supplier_Invoice__c>([SELECT Id,Document_Currency__c,Document_FX_Side__c,Document_FX_Confirmed_At__c,Document_FX_Fingerprint__c,Final_Of_Proforma__c,Reissue_Of_Supplier_Invoice__c,Original_Supplier_Invoice__c FROM Supplier_Invoice__c WHERE Id IN :supplierIds]);
        Set<Id> hkdStems=new Set<Id>();
        if(!stemIds.isEmpty()) {
            for(Invoice__c invoice:[SELECT STEM__c FROM Invoice__c WHERE STEM__c IN :stemIds AND (Document_Currency__c='HKD' OR Document_FX_Side__c!=null) AND Deprecated__c=false AND Proforma__c=false]) hkdStems.add(invoice.STEM__c);
        }
        validateRows(rows,oldRows,buyers,suppliers,hkdStems);
    }
    @TestVisible private static Boolean touchesHkd(Payment__c row,Map<Id,Invoice__c> buyers,Map<Id,Supplier_Invoice__c> suppliers,Set<Id> hkdStems) {
        return row!=null && ((row.Cash_Event__c!=null || row.Payment_Currency__c=='HKD' || !String.isBlank(row.Payment_Operation_Id__c))
            || (buyers.containsKey(row.Buyer_Invoice__c) && FcosTradeDocumentService.isManagedDocument(buyers.get(row.Buyer_Invoice__c)))
            || (suppliers.containsKey(row.Supplier_Invoice__c) && FcosTradeDocumentService.isManagedDocument(suppliers.get(row.Supplier_Invoice__c)))
            || (buyerAllocation(row) && row.Buyer_Invoice__c==null && hkdStems.contains(row.STEM__c)));
    }
    @TestVisible private static void validateRows(List<Payment__c> rows,Map<Id,Payment__c> oldRows,Map<Id,Invoice__c> buyers,Map<Id,Supplier_Invoice__c> suppliers,Set<Id> hkdStems) {
        Map<String,Schema.SObjectField> fields=Payment__c.SObjectType.getDescribe().fields.getMap();
        for (Payment__c row : rows) {
            Payment__c oldRow=oldRows == null ? null : oldRows.get(row.Id);
            if (!touchesHkd(row,buyers,suppliers,hkdStems) && !touchesHkd(oldRow,buyers,suppliers,hkdStems)) continue;
            if (oldRow == null) { row.addError('Use the reviewed HKD payment action to lock the payment-date rate and invoice allocation.'); continue; }
            if(fields.containsKey('CurrencyIsoCode') && row.get('CurrencyIsoCode')!='USD') { row.addError('Salesforce principal payment currency must remain USD.'); continue; }
            for (String field : SNAPSHOT_FIELDS) if (fields.containsKey(field) && row.get(field) != oldRow.get(field)) { row.addError('HKD payment amounts, allocations, bank details and rate snapshots are immutable. Use the reviewed reversal workflow.'); break; }
        }
    }
    public static void guardDelete(List<Payment__c> rows) {
        Set<String> protectedSides=managedUnallocatedSides(rows);
        for(Payment__c row:rows) if(protectedSides.contains(unallocatedSideKey(row)) && !(row.Auto_Planned_Deposit__c==true && row.Is_Deposit__c==true && row.Remittance__c==null && String.isBlank(row.Payment_Operation_Id__c)))
            row.addError('Retain historical unallocated cash until its original bank and currency evidence is reconciled.');
        for(Payment__c row:rows) if(row.Cash_Event__c!=null || row.Payment_Currency__c=='HKD' || !String.isBlank(row.Payment_Operation_Id__c)) row.addError('Posted HKD payment evidence cannot be deleted. Use the reviewed reversal workflow.');
    }
    private static String unallocatedSideKey(Payment__c row) {
        if(row==null || row.STEM__c==null) return null;
        if(buyerAllocation(row) && row.Buyer_Invoice__c==null) return row.STEM__c+':Sell';
        Schema.RecordTypeInfo payable=Payment__c.SObjectType.getDescribe().getRecordTypeInfosByDeveloperName().get('Payable');
        if(payable!=null && row.RecordTypeId==payable.getRecordTypeId() && row.Supplier_Invoice__c==null && row.Account__c!=null) return row.STEM__c+':Buy:'+row.Account__c;
        return null;
    }
    private static Set<String> managedUnallocatedSides(List<Payment__c> rows) {
        Set<Id> stemIds=new Set<Id>();for(Payment__c row:rows) if(unallocatedSideKey(row)!=null) stemIds.add(row.STEM__c);
        Set<String> result=new Set<String>();if(stemIds.isEmpty()) return result;
        Map<Id,STEM__c> stems=new Map<Id,STEM__c>([SELECT Id,Port__c,Account__c FROM STEM__c WHERE Id IN:stemIds]);
        if(stems.size()!=stemIds.size()) throw new AuraHandledException('The payment STEM is unavailable to this user.');
        Map<String,String> sideKeys=new Map<String,String>();
        for(Payment__c row:rows) if(unallocatedSideKey(row)!=null && stems.containsKey(row.STEM__c)) {
            STEM__c stem=stems.get(row.STEM__c);Boolean buyer=buyerAllocation(row);
            sideKeys.put('STEM:'+stem.Id+':'+stem.Port__c+':'+(buyer?'Sell:'+stem.Account__c:'Buy:'+row.Account__c),unallocatedSideKey(row));
        }
        for(Trade_Currency_Side__c side:FcosTradeEvidenceStore.sidesByKeys(sideKeys.keySet(),false)) result.add(sideKeys.get(side.External_Key__c));
        return result;
    }
}
