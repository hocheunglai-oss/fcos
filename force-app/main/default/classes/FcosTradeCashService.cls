/** Actual bank cash, invoice applications and application reversals are distinct immutable evidence. */
public with sharing class FcosTradeCashService {
    private static Boolean managedLedgerWrite=false;
    private static Map<String,Payment__c> authorizedPayments=new Map<String,Payment__c>();
    public class CashRequest {
        public Id tradeRecordId; public String direction; public Id proformaId; public Id originalCashId;
        public String kind; public Decimal nativeAmount; public Date paymentDate; public String reviewedRateId;
        public String bankName; public String bankCurrencyCode; public Decimal bankNativeAmount; public String bankEvidence; public String reference;
    }
    public class CashReview {
        @AuraEnabled public String currencyCode;
        @AuraEnabled public String direction;
        @AuraEnabled public String kind;
        @AuraEnabled public Decimal nativeAmount;
        @AuraEnabled public Decimal cashUsd;
        @AuraEnabled public Decimal originalCarryingUsd;
        @AuraEnabled public Decimal settlementFxUsd;
        @AuraEnabled public Decimal rate;
        @AuraEnabled public String rateId;
        @AuraEnabled public Datetime effectiveAt;
        @AuraEnabled public Decimal availableNative;
        @AuraEnabled public String fingerprint;
        public Id stemId; public Id partyId; public Id sideId; public String tradeFingerprint; public Decimal originalBankAllocation;
        private Id priorOperationId;
    }
    public class AllocationReview {
        @AuraEnabled public Id cashEventId;
        @AuraEnabled public Id invoiceId;
        @AuraEnabled public String currencyCode;
        @AuraEnabled public Decimal nativeAmount;
        @AuraEnabled public Decimal availableCashNative;
        @AuraEnabled public Decimal invoiceRemainingNative;
        @AuraEnabled public Decimal cashUsd;
        @AuraEnabled public Decimal carryingUsd;
        @AuraEnabled public Decimal bankAmount;
        @AuraEnabled public Decimal settlementFxUsd;
        @AuraEnabled public String fingerprint;
    }
    public class CashPosition {
        @AuraEnabled public Decimal nativeRemaining=0;
        @AuraEnabled public Decimal cashUsdRemaining=0;
        @AuraEnabled public Decimal bankRemaining=0;
        @AuraEnabled public List<Trade_Cash_Allocation__c> allocations;
        @AuraEnabled public List<Trade_Cash_Event__c> refunds;
    }
    public class SideOption {
        @AuraEnabled public String value;
        @AuraEnabled public String label;
        @AuraEnabled public Id tradeRecordId;
        @AuraEnabled public String direction;
        @AuraEnabled public String currencyCode;
        @AuraEnabled public Boolean needsConfirmation;
    }
    public class EntryContext {
        @AuraEnabled public Id stemId;
        @AuraEnabled public String hongKongDate;
        @AuraEnabled public List<SideOption> sides=new List<SideOption>();
        @AuraEnabled public List<Map<String,String>> banks=new List<Map<String,String>>();
        @AuraEnabled public List<SObject> invoices=new List<SObject>();
        @AuraEnabled public List<Trade_Cash_Event__c> events;
    }
    @AuraEnabled
    public static EntryContext entryContext(Id recordId) {
        requireEntry();
        if(recordId==null) throw new AuraHandledException('Select a business STEM or its invoice.');
        Id stemId=recordId;
        String objectName=recordId.getSObjectType().getDescribe().getName();
        if(objectName!='STEM__c') {
            if(!new Set<String>{'STEM_Line_Item__c','STEM_Extra_Cost__c','Invoice__c','Supplier_Invoice__c'}.contains(objectName)) throw new AuraHandledException('Unsupported cash entry context.');
            SObject source=Database.query('SELECT STEM__c FROM '+objectName+' WHERE Id=:recordId');stemId=(Id)source.get('STEM__c');
        }
        assertStemAccess(stemId);
        STEM__c stem=[SELECT Id,Account__c,Account__r.Name,Port__c FROM STEM__c WHERE Id=:stemId];
        EntryContext result=new EntryContext();result.stemId=stemId;result.hongKongDate=Datetime.now().format('yyyy-MM-dd','Asia/Hong_Kong');
        Map<String,SideOption> choices=new Map<String,SideOption>();Set<String> keys=new Set<String>();
        List<SObject> rows=new List<SObject>();
        rows.addAll([SELECT Id,Original_Supplier__c,Original_Supplier__r.Name FROM STEM_Line_Item__c WHERE STEM__c=:stemId AND Cancelled__c=false ORDER BY Id]);
        rows.addAll([SELECT Id,Supplier__c,Supplier__r.Name FROM STEM_Extra_Cost__c WHERE STEM__c=:stemId AND Cancelled__c=false ORDER BY Id]);
        for(SObject row:rows) for(String direction:new List<String>{'Sell','Buy'}) {
            Boolean fuel=row.getSObjectType()==STEM_Line_Item__c.SObjectType;
            Id party=direction=='Sell'?stem.Account__c:(Id)row.get(fuel?'Original_Supplier__c':'Supplier__c');
            if(party==null) continue;
            String key='STEM:'+stemId+':'+stem.Port__c+':'+direction+':'+party;
            if(choices.containsKey(key)) continue;
            SideOption option=new SideOption();option.value=String.valueOf(row.Id)+'|'+direction;option.tradeRecordId=row.Id;option.direction=direction;
            SObject account=direction=='Sell'?stem.Account__r:row.getSObject(fuel?'Original_Supplier__r':'Supplier__r');
            option.label=(direction=='Sell'?'Buyer: ':'Supplier: ')+(account==null?'':(String)account.get('Name'));
            option.currencyCode='USD';option.needsConfirmation=true;choices.put(key,option);keys.add(key);
        }
        for(Trade_Currency_Side__c side:FcosTradeEvidenceStore.sidesByKeys(keys,false)) {
            SideOption option=choices.get(side.External_Key__c);option.currencyCode=side.Currency__c;option.needsConfirmation=side.Confirmed_At__c==null;
        }
        List<String> ordered=new List<String>(choices.keySet());ordered.sort();
        for(String key:ordered) {SideOption option=choices.get(key);option.label+=' ('+option.currencyCode+')';result.sides.add(option);}
        for(Schema.PicklistEntry bank:Payment__c.Bank__c.getDescribe().getPicklistValues()) if(bank.isActive()) result.banks.add(new Map<String,String>{'label'=>bank.getLabel(),'value'=>bank.getValue()});
        result.invoices.addAll([SELECT Id,Name,STEM__c,Document_Currency__c,Document_HKD_Amount__c,Amount__c,Document_FX_Rate__c,Document_FX_Revision__c
            FROM Invoice__c WHERE STEM__c=:stemId AND Proforma__c=false AND Deprecated__c=false AND Original_Invoice__c=null AND File__c!=null AND Document_FX_Side__c!=null ORDER BY Invoice_Date__c,Id]);
        result.invoices.addAll([SELECT Id,Name,STEM__c,Supplier__c,Document_Currency__c,Document_HKD_Amount__c,Invoice_Amount__c,Document_FX_Rate__c,Document_FX_Revision__c
            FROM Supplier_Invoice__c WHERE STEM__c=:stemId AND Proforma__c=false AND Original_Supplier_Invoice__c=null AND Invoice_File__c!=null AND Document_FX_Side__c!=null ORDER BY Invoice_Date__c,Id]);
        result.events=FcosTradeCashStore.events(stemId);return result;
    }
    public static Boolean enabled() {
        Fcos_Trading_FX_Setting__c setting=Fcos_Trading_FX_Setting__c.getOrgDefaults();
        return FcosCompanyFxRateService.enabled() && setting!=null && setting.Cash_Enabled__c==true;
    }
    private static void requireEntry() {
        if(!enabled()) throw new AuraHandledException('The native cash and proforma workflow is not enabled.');
        requireAccess();
    }
    private static void requireAccess() {
        if(!FeatureManagement.checkPermission('Fcos_Trading_FX_Settlement')) throw new AuraHandledException('Finance settlement permission is required.');
    }
    public static void assertStemAccess(Id stemId) {
        requireAccess();
        if(stemId==null || [SELECT COUNT() FROM STEM__c WHERE Id=:stemId]!=1) throw new AuraHandledException('The cash record business STEM is unavailable.');
    }
    private static String digest(Object value) {return EncodingUtil.convertToHex(Crypto.generateDigest('SHA-256',Blob.valueOf(JSON.serialize(value))));}
    private static Decimal cents(Decimal value) {return value.setScale(2,RoundingMode.HALF_UP);}
    private static void positiveCents(Decimal value) {
        if(value==null || value<=0 || value!=cents(value)) throw new AuraHandledException('Enter a positive amount to two decimal places.');
    }
    private static String operationId(String value) {
        if(String.isBlank(value) || !Pattern.matches('[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}',value)) throw new AuraHandledException('A stable operation ID is required.');
        return value.toLowerCase();
    }
    private static CashRequest parse(String requestJson) {
        if(String.isBlank(requestJson) || requestJson.length()>6000) throw new AuraHandledException('A complete cash review is required.');
        CashRequest request=(CashRequest)JSON.deserializeStrict(requestJson,CashRequest.class);
        positiveCents(request.nativeAmount);positiveCents(request.bankNativeAmount);
        if(request.paymentDate==null || request.paymentDate>Date.valueOf(Datetime.now().format('yyyy-MM-dd','Asia/Hong_Kong')))
            throw new AuraHandledException('Use the actual Hong Kong bank payment date, not a future planned date.');
        if((request.kind!='Payment' && request.kind!='Refund') || String.isBlank(request.bankName) || request.bankName.length()>80
            || (request.bankCurrencyCode!='USD' && request.bankCurrencyCode!='HKD') || String.isBlank(request.bankEvidence) || request.bankEvidence.length()>255
            || (request.reference!=null && request.reference.length()>255)) throw new AuraHandledException('Retain the bank, bank currency, actual amount and statement evidence.');
        Set<String> banks=new Set<String>();
        for(Schema.PicklistEntry bank:Payment__c.Bank__c.getDescribe().getPicklistValues()) if(bank.isActive()) banks.add(bank.getValue());
        if(!banks.isEmpty() && !banks.contains(request.bankName)) throw new AuraHandledException('Select a configured payment bank.');
        if((request.kind=='Refund')!=(request.originalCashId!=null)) throw new AuraHandledException('A refund must identify the original cash receipt or payment.');
        return request;
    }
    private static Decimal nativeCash(Trade_Cash_Event__c row) {return row.Currency__c=='HKD'?row.Cash_HKD_Amount__c:row.Cash_USD_Amount__c;}
    private static Decimal nativeAllocation(Trade_Cash_Allocation__c row) {return row.Currency__c=='HKD'?row.Allocated_HKD__c:row.Allocated_Cash_USD__c;}
    private static FcosCompanyFxRateService.Snapshot rateFor(CashRequest request,String currencyCode) {
        if(currencyCode=='USD') {
            if(!String.isBlank(request.reviewedRateId) && request.reviewedRateId!='USD') throw new AuraHandledException('A USD cash event cannot carry an HKD rate.');
            return null;
        }
        FcosCompanyFxRateService.Snapshot rate=FcosCompanyFxRateService.forPaymentDate(request.paymentDate);
        if(!String.isBlank(request.reviewedRateId) && request.reviewedRateId!=rate.rateId) throw new AuraHandledException('The payment-date rate changed. Review the cash event again.');
        return rate;
    }
    @AuraEnabled
    public static CashReview previewCash(String requestJson) {
        requireEntry();return cashReview(parse(requestJson),false,null,null);
    }
    private static CashReview cashReview(CashRequest request,Boolean lockOriginal,String operationId,String requestFingerprint) {
        CashReview review=new CashReview();review.kind=request.kind;review.nativeAmount=request.nativeAmount;
        String sourceFingerprint;
        Trade_Cash_Event__c original;
        if(request.kind=='Refund') {
            original=FcosTradeCashStore.event(request.originalCashId,false);
            if(original.Kind__c!='Payment' || request.proformaId!=null || request.tradeRecordId!=null)
                throw new AuraHandledException('Refund the exact original cash event, independently of later trade amendments.');
            review.stemId=original.STEM__c;review.partyId=original.Party__c;review.direction=original.Direction__c;review.sideId=original.Trade_FX_Side__c;review.currencyCode=original.Currency__c;
            if(request.direction!=review.direction) throw new AuraHandledException('The refund must retain the original buyer or supplier side.');
        } else {
            if(request.tradeRecordId==null) throw new AuraHandledException('Select a confirmed trading side.');
            FcosTradeCurrencyService.Context context=FcosTradeCurrencyService.context(request.tradeRecordId,request.direction);
            if(context.scopeType!='STEM') throw new AuraHandledException('Record cash against a confirmed STEM side.');
            assertStemAccess(context.scopeId);
            FcosTradeCurrencyService.Review confirmed=FcosTradeCurrencyService.review(request.tradeRecordId,request.direction,null);
            if(confirmed.needsConfirmation || confirmed.confirmedAt==null) throw new AuraHandledException('Confirm the current agreed currency and prices before recording cash.');
            if(confirmed.currencyCode=='HKD' && !confirmed.hongKong) throw new AuraHandledException('HKD cash requires a fixed-price Hong Kong trading side.');
            List<Trade_Currency_Side__c> sides=FcosTradeEvidenceStore.sidesByKeys(new Set<String>{context.key},false);
            if(sides.size()!=1) throw new AuraHandledException('The confirmed currency side is unavailable.');
            review.stemId=context.scopeId;review.partyId=context.partyId;review.direction=context.direction;review.sideId=sides[0].Id;review.currencyCode=confirmed.currencyCode;
            sourceFingerprint=confirmed.fingerprint;review.tradeFingerprint=confirmed.fingerprint;
            if(request.proformaId!=null) sourceFingerprint+='|'+proformaFingerprint(request.proformaId,review);
        }
        if(review.currencyCode!='USD' && review.currencyCode!='HKD') throw new AuraHandledException('Select a supported agreed currency.');
        if(request.bankCurrencyCode==review.currencyCode && request.bankNativeAmount!=request.nativeAmount)
            throw new AuraHandledException('Same-currency bank cash must equal the event amount. Record fees separately.');
        // Fetch before taking any row lock: the company-rate HTTP call releases Salesforce locks.
        FcosCompanyFxRateService.Snapshot rate=rateFor(request,review.currencyCode);
        review.cashUsd=review.currencyCode=='USD'?request.nativeAmount:cents(request.nativeAmount/rate.usdHkdRate);
        if(rate!=null) {review.rate=rate.usdHkdRate;review.rateId=rate.rateId;review.effectiveAt=rate.effectiveAt;}
        review.settlementFxUsd=0;
        if(original!=null) {
            if(lockOriginal) {
                original=FcosTradeCashStore.event(original.Id,true);
                // The rate call above must precede this lock. Once serialized on
                // the original cash event, recover an overlapping exact retry
                // before the first request's refund makes the review look stale.
                if(operationId!=null) {
                    SObject prior=FcosTradeCashStore.operation('Trade_Cash_Event__c',operationId,requestFingerprint);
                    if(prior!=null) {review.priorOperationId=prior.Id;return review;}
                }
            }
            CashPosition available=position(original);
            review.availableNative=available.nativeRemaining;
            if(request.nativeAmount>available.nativeRemaining) throw new AuraHandledException('Reverse invoice allocations before refunding cash that is already applied.');
            review.originalCarryingUsd=request.nativeAmount==available.nativeRemaining?available.cashUsdRemaining:cents(request.nativeAmount*original.Cash_USD_Amount__c/nativeCash(original));
            if(review.originalCarryingUsd>available.cashUsdRemaining) throw new AuraHandledException('Reconcile the original cash carrying balance before refunding.');
            review.originalBankAllocation=request.nativeAmount==available.nativeRemaining?available.bankRemaining:cents(request.nativeAmount*original.Bank_Native_Amount__c/nativeCash(original));
            if(review.originalBankAllocation>available.bankRemaining) throw new AuraHandledException('Reconcile original bank evidence allocations before refunding.');
            review.settlementFxUsd=review.direction=='Buy'?review.cashUsd-review.originalCarryingUsd:review.originalCarryingUsd-review.cashUsd;
            sourceFingerprint=digest(new List<Object>{original,available});
        }
        review.fingerprint=digest(new List<Object>{request,review,sourceFingerprint});return review;
    }
    private static String proformaFingerprint(Id proformaId,CashReview cash) {
        Boolean supplier=cash.direction=='Buy';
        if(proformaId.getSObjectType()!=(supplier?Supplier_Invoice__c.SObjectType:Invoice__c.SObjectType)) throw new AuraHandledException('The proforma must belong to the same trading side.');
        String objectName=supplier?'Supplier_Invoice__c':'Invoice__c';
        SObject row=Database.query('SELECT Id,STEM__c,STEM__r.Account__c,Proforma__c,Document_Currency__c,Document_FX_Side__c,Document_FX_Fingerprint__c,'+(supplier?'Supplier__c,Invoice_File__c':'File__c,Deprecated__c')+' FROM '+objectName+' WHERE Id=:proformaId');
        if(row.get('Proforma__c')!=true || row.get('STEM__c')!=cash.stemId || row.get('Document_Currency__c')!=cash.currencyCode || row.get('Document_FX_Side__c')!=cash.sideId
            || (supplier?row.get('Supplier__c'):row.getSObject('STEM__r').get('Account__c'))!=cash.partyId || String.isBlank((String)row.get(supplier?'Invoice_File__c':'File__c'))
            || (!supplier && row.get('Deprecated__c')==true)) throw new AuraHandledException('Select an issued proforma for the exact counterparty, currency and trading side.');
        return digest(row);
    }
    @AuraEnabled
    public static Id recordCash(String requestJson,String reviewedFingerprint,String operationId) {
        requireEntry();CashRequest request=parse(requestJson);operationId=operationId(operationId);
        String requestFingerprint=digest(new List<Object>{request,reviewedFingerprint});
        SObject prior=FcosTradeCashStore.operation('Trade_Cash_Event__c',operationId,requestFingerprint);if(prior!=null) return prior.Id;
        CashReview review=cashReview(request,true,operationId,requestFingerprint);
        if(review.priorOperationId!=null) return review.priorOperationId;
        if(String.isBlank(reviewedFingerprint) || review.fingerprint!=reviewedFingerprint) throw new AuraHandledException('Cash, proforma or rate evidence changed. Review the cash event again.');
        // A new payment locks its STEM only after the rate callout; recheck the side fingerprint under this lock.
        if(request.kind=='Payment') {
            STEM__c locked=[SELECT Id FROM STEM__c WHERE Id=:review.stemId FOR UPDATE];
            FcosTradeCurrencyService.Review confirmed=FcosTradeCurrencyService.review(request.tradeRecordId,request.direction,null);
            if(confirmed.needsConfirmation || confirmed.currencyCode!=review.currencyCode || confirmed.fingerprint!=review.tradeFingerprint) throw new AuraHandledException('The trading side changed. Review this cash event again.');
        }
        prior=FcosTradeCashStore.operation('Trade_Cash_Event__c',operationId,requestFingerprint);if(prior!=null) return prior.Id;
        Trade_Cash_Event__c event=new Trade_Cash_Event__c(STEM__c=review.stemId,Party__c=review.partyId,Direction__c=review.direction,Currency__c=review.currencyCode,Kind__c=request.kind,
            Cash_HKD_Amount__c=review.currencyCode=='HKD'?request.nativeAmount:null,Cash_USD_Amount__c=review.cashUsd,FX_Rate__c=review.rate,FX_Revision__c=review.rateId,FX_Effective_At__c=review.effectiveAt,
            Payment_Date__c=request.paymentDate,Bank__c=request.bankName,Bank_Currency__c=request.bankCurrencyCode,Bank_Native_Amount__c=request.bankNativeAmount,Bank_Evidence__c=request.bankEvidence,Reference__c=request.reference,
            Trade_FX_Side__c=review.sideId,Original_Cash_Event__c=request.originalCashId,Original_Carrying_USD__c=review.originalCarryingUsd,Original_Bank_Allocation__c=review.originalBankAllocation,Settlement_FX_USD__c=review.settlementFxUsd,
            Operation_Id__c=operationId,Request_Fingerprint__c=requestFingerprint);
        if(request.proformaId!=null) event.put(review.direction=='Buy'?'Supplier_Proforma__c':'Buyer_Proforma__c',request.proformaId);
        managedLedgerWrite=true;
        try {Database.insert(event,true,AccessLevel.SYSTEM_MODE);}
        catch(DmlException error) {
            if(error.getDmlStatusCode(0)==String.valueOf(StatusCode.DUPLICATE_VALUE)) {
                SObject existing=FcosTradeCashStore.operation('Trade_Cash_Event__c',operationId,requestFingerprint);
                if(existing!=null) return existing.Id;
            }
            throw error;
        } finally {managedLedgerWrite=false;}
        return event.Id;
    }
    private static CashPosition position(Trade_Cash_Event__c event) {
        if(event.Kind__c!='Payment') throw new AuraHandledException('Only an original cash receipt or payment can be allocated.');
        CashPosition result=new CashPosition();result.nativeRemaining=nativeCash(event);result.cashUsdRemaining=event.Cash_USD_Amount__c;result.bankRemaining=event.Bank_Native_Amount__c;
        result.allocations=FcosTradeCashStore.allocations(event.Id);result.refunds=new List<Trade_Cash_Event__c>();
        for(Trade_Cash_Allocation__c allocation:result.allocations) {
            if(allocation.Currency__c!=event.Currency__c) throw new AuraHandledException('The cash allocation currency requires reconciliation.');
            result.nativeRemaining-=nativeAllocation(allocation);result.cashUsdRemaining-=allocation.Allocated_Cash_USD__c;result.bankRemaining-=allocation.Bank_Native_Allocation__c;
        }
        for(Trade_Cash_Event__c refund:FcosTradeCashStore.events(event.STEM__c)) if(refund.Original_Cash_Event__c==event.Id) {
            if(refund.Kind__c!='Refund' || refund.Currency__c!=event.Currency__c || refund.Original_Carrying_USD__c==null || refund.Original_Bank_Allocation__c==null) throw new AuraHandledException('The cash refund history requires reconciliation.');
            result.refunds.add(refund);result.nativeRemaining-=nativeCash(refund);result.cashUsdRemaining-=refund.Original_Carrying_USD__c;
            // This is an allocation of original bank evidence, never the refund bank's actual rate.
            result.bankRemaining-=refund.Original_Bank_Allocation__c;
        }
        if(result.nativeRemaining<0 || result.cashUsdRemaining<0 || result.bankRemaining<0 || (result.nativeRemaining==0 && result.cashUsdRemaining!=0)) throw new AuraHandledException('Cash applications exceed the original event or leave an unresolved USD balance.');
        if(result.nativeRemaining==0) result.bankRemaining=0;
        return result;
    }
    @AuraEnabled
    public static CashPosition cashPosition(Id cashEventId) {requireAccess();return position(FcosTradeCashStore.event(cashEventId,false));}
    private static SObject invoice(Id invoiceId,Boolean lockRow) {
        if(invoiceId==null || (invoiceId.getSObjectType()!=Invoice__c.SObjectType && invoiceId.getSObjectType()!=Supplier_Invoice__c.SObjectType)) throw new AuraHandledException('Select a final buyer or supplier invoice.');
        Boolean supplier=invoiceId.getSObjectType()==Supplier_Invoice__c.SObjectType;
        SObject row=Database.query('SELECT Id,STEM__c,STEM__r.Account__c,Proforma__c,Document_Currency__c,Document_HKD_Amount__c,Document_FX_Side__c,Document_FX_Rate__c,Document_FX_Revision__c,Document_FX_Confirmed_At__c,Document_FX_Fingerprint__c,'+(supplier?'Supplier__c,Invoice_Amount__c,Invoice_File__c,Original_Supplier_Invoice__c':'Amount__c,File__c,Deprecated__c,Original_Invoice__c')+' FROM '+invoiceId.getSObjectType().getDescribe().getName()+' WHERE Id=:invoiceId'+(lockRow?' FOR UPDATE':''));
        if(row.get('Proforma__c')==true || (!supplier && row.get('Deprecated__c')==true) || String.isBlank((String)row.get(supplier?'Invoice_File__c':'File__c'))
            || row.get(supplier?'Original_Supplier_Invoice__c':'Original_Invoice__c')!=null || !FcosTradeDocumentService.isManagedDocument(row))
            throw new AuraHandledException('Allocate cash only to an active issued final invoice, not a proforma or credit note.');
        assertStemAccess((Id)row.get('STEM__c'));return row;
    }
    private static AllocationReview allocationReview(Trade_Cash_Event__c event,SObject bill,Decimal nativeAmount) {
        positiveCents(nativeAmount);Boolean supplier=bill.getSObjectType()==Supplier_Invoice__c.SObjectType;
        if(event.Kind__c!='Payment' || event.STEM__c!=bill.get('STEM__c') || event.Currency__c!=bill.get('Document_Currency__c')
            || event.Direction__c!=(supplier?'Buy':'Sell') || event.Party__c!=(supplier?bill.get('Supplier__c'):bill.getSObject('STEM__r').get('Account__c')))
            throw new AuraHandledException('Cash and invoice must have the same STEM, counterparty, direction and currency.');
        Id invoiceId=bill.Id;
        String originalField=supplier?'Original_Supplier_Invoice__c':'Original_Invoice__c';
        if(!Database.query('SELECT Id FROM '+bill.getSObjectType().getDescribe().getName()+' WHERE '+originalField+'=:invoiceId LIMIT 1').isEmpty()) throw new AuraHandledException('This invoice is credited. Allocate to its active reissue instead.');
        CashPosition cash=position(event);Boolean hkd=event.Currency__c=='HKD';
        Decimal face=(Decimal)bill.get(hkd?'Document_HKD_Amount__c':supplier?'Invoice_Amount__c':'Amount__c');
        Decimal carrying=(Decimal)bill.get(supplier?'Invoice_Amount__c':'Amount__c');
        if(face==null || face<=0 || carrying==null || carrying<0) throw new AuraHandledException('The invoice original native and USD balances are invalid.');
        Decimal due=face,carryingDue=carrying;
        String parent=supplier?'Supplier_Invoice__c':'Buyer_Invoice__c';
        List<Payment__c> payments=FcosTradeSettlementStore.payments(new Set<Id>{invoiceId},supplier);
        for(SObject payment:payments) {
            Decimal nativePaid=(Decimal)payment.get(hkd?'Payment_HKD_Amount__c':'Amount__c'),usdPaid=(Decimal)payment.get('Invoice_Carrying_USD__c');
            if(payment.get('Payment_Currency__c')!=event.Currency__c || nativePaid==null || usdPaid==null || payment.getSObject('RecordType').get('DeveloperName')!=(supplier?'Payable':'Receivable')
                || (nativePaid<0 && payment.get('Cash_Event__c')==null)) throw new AuraHandledException('Reconcile existing payments before applying cash.');
            due-=nativePaid;carryingDue-=usdPaid;
        }
        if(nativeAmount>cash.nativeRemaining || nativeAmount>due || carryingDue<0) throw new AuraHandledException('The allocation exceeds available cash or the invoice balance.');
        AllocationReview result=new AllocationReview();result.cashEventId=event.Id;result.invoiceId=bill.Id;result.currencyCode=event.Currency__c;result.nativeAmount=nativeAmount;
        result.availableCashNative=cash.nativeRemaining;result.invoiceRemainingNative=due;
        result.cashUsd=nativeAmount==cash.nativeRemaining?cash.cashUsdRemaining:cents(nativeAmount*event.Cash_USD_Amount__c/nativeCash(event));
        result.carryingUsd=nativeAmount==due?carryingDue:cents(nativeAmount*carrying/face);
        result.bankAmount=nativeAmount==cash.nativeRemaining?cash.bankRemaining:cents(nativeAmount*event.Bank_Native_Amount__c/nativeCash(event));
        if(result.cashUsd>cash.cashUsdRemaining || result.carryingUsd>carryingDue || result.bankAmount<0 || result.bankAmount>cash.bankRemaining) throw new AuraHandledException('Reconcile rounding remainders before allocating cash.');
        result.settlementFxUsd=supplier?result.carryingUsd-result.cashUsd:result.cashUsd-result.carryingUsd;
        result.fingerprint=digest(new List<Object>{event,bill,cash,payments,result});return result;
    }
    @AuraEnabled
    public static AllocationReview previewAllocation(Id cashEventId,Id invoiceId,Decimal nativeAmount) {
        requireEntry();return allocationReview(FcosTradeCashStore.event(cashEventId,false),invoice(invoiceId,false),nativeAmount);
    }
    @AuraEnabled
    public static Id allocate(Id cashEventId,Id invoiceId,Decimal nativeAmount,String reviewedFingerprint,String operationId) {
        requireEntry();operationId=operationId(operationId);
        String fingerprint=digest(new List<Object>{cashEventId,invoiceId,nativeAmount,reviewedFingerprint,'Applied'});
        SObject prior=FcosTradeCashStore.operation('Trade_Cash_Allocation__c',operationId,fingerprint);if(prior!=null) return prior.Id;
        // All invoice/cash operations use this lock order, including credit preparation.
        SObject bill=invoice(invoiceId,true);Trade_Cash_Event__c event=FcosTradeCashStore.event(cashEventId,true);
        prior=FcosTradeCashStore.operation('Trade_Cash_Allocation__c',operationId,fingerprint);if(prior!=null) return prior.Id;
        AllocationReview review=allocationReview(event,bill,nativeAmount);
        if(String.isBlank(reviewedFingerprint) || review.fingerprint!=reviewedFingerprint) throw new AuraHandledException('Cash or invoice balances changed. Review the allocation again.');
        return writeAllocation(event,bill,review,'Applied',null,operationId,fingerprint);
    }
    private static String reversalFingerprint(Trade_Cash_Allocation__c original,SObject bill,CashPosition cash) {
        if(original.Kind__c!='Applied') throw new AuraHandledException('Select an applied cash allocation to reverse.');
        for(Trade_Cash_Allocation__c row:cash.allocations) if(row.Reverses_Allocation__c==original.Id) throw new AuraHandledException('This allocation has already been reversed.');
        return digest(new List<Object>{original,bill,cash,'Reversal'});
    }
    @AuraEnabled
    public static String previewReversal(Id allocationId) {
        requireEntry();Trade_Cash_Allocation__c original=FcosTradeCashStore.allocation(allocationId);
        return reversalFingerprint(original,invoice(original.Buyer_Invoice__c==null?original.Supplier_Invoice__c:original.Buyer_Invoice__c,false),position(FcosTradeCashStore.event(original.Cash_Event__c,false)));
    }
    @AuraEnabled
    public static Id reverseAllocation(Id allocationId,String reviewedFingerprint,String operationId) {
        requireEntry();operationId=operationId(operationId);
        String fingerprint=digest(new List<Object>{allocationId,reviewedFingerprint,'Reversal'});
        SObject prior=FcosTradeCashStore.operation('Trade_Cash_Allocation__c',operationId,fingerprint);if(prior!=null) return prior.Id;
        Trade_Cash_Allocation__c original=FcosTradeCashStore.allocation(allocationId);
        SObject bill=invoice(original.Buyer_Invoice__c==null?original.Supplier_Invoice__c:original.Buyer_Invoice__c,true);
        Trade_Cash_Event__c event=FcosTradeCashStore.event(original.Cash_Event__c,true);
        prior=FcosTradeCashStore.operation('Trade_Cash_Allocation__c',operationId,fingerprint);if(prior!=null) return prior.Id;
        if(String.isBlank(reviewedFingerprint) || reviewedFingerprint!=reversalFingerprint(original,bill,position(event))) throw new AuraHandledException('The cash application changed. Review its reversal again.');
        AllocationReview review=new AllocationReview();review.nativeAmount=-nativeAllocation(original);review.cashUsd=-original.Allocated_Cash_USD__c;review.carryingUsd=-original.Invoice_Carrying_USD__c;
        review.bankAmount=-original.Bank_Native_Allocation__c;review.settlementFxUsd=-original.Settlement_FX_USD__c;
        return writeAllocation(event,bill,review,'Reversal',original.Id,operationId,fingerprint);
    }
    private static Id writeAllocation(Trade_Cash_Event__c event,SObject bill,AllocationReview review,String kind,Id reverses,String operationId,String fingerprint) {
        Boolean supplier=bill.getSObjectType()==Supplier_Invoice__c.SObjectType;
        Payment__c payment=new Payment__c(STEM__c=event.STEM__c,Account__c=event.Party__c,Cash_Event__c=event.Id,
            RecordTypeId=Payment__c.SObjectType.getDescribe().getRecordTypeInfosByDeveloperName().get(supplier?'Payable':'Receivable').getRecordTypeId(),
            Amount__c=review.cashUsd,Payment_Currency__c=event.Currency__c,Payment_HKD_Amount__c=event.Currency__c=='HKD'?review.nativeAmount:null,
            Payment_FX_Rate__c=event.FX_Rate__c,Payment_FX_Revision__c=event.FX_Revision__c,Payment_FX_Effective_At__c=event.FX_Effective_At__c,
            Invoice_Carrying_USD__c=review.carryingUsd,Settlement_FX_USD__c=review.settlementFxUsd,Date__c=event.Payment_Date__c,
            Bank__c=event.Bank__c,Bank_Currency__c=event.Bank_Currency__c,Bank_Native_Amount__c=review.bankAmount.abs(),Bank_FX_Evidence__c=event.Bank_Evidence__c,
            Payment_Operation_Id__c=operationId,Payment_Request_Fingerprint__c=fingerprint);
        payment.put(supplier?'Supplier_Invoice__c':'Buyer_Invoice__c',bill.Id);
        if(Payment__c.SObjectType.getDescribe().fields.getMap().containsKey('CurrencyIsoCode')) payment.put('CurrencyIsoCode','USD');
        Savepoint allocationStart=Database.setSavepoint();
        try {
            authorizedPayments.put(operationId,payment.clone(false,true,false,false));
            try {Database.insert(payment,true,AccessLevel.SYSTEM_MODE);} finally {authorizedPayments.remove(operationId);}
            Trade_Cash_Allocation__c allocation=new Trade_Cash_Allocation__c(Cash_Event__c=event.Id,Payment__c=payment.Id,Currency__c=event.Currency__c,Kind__c=kind,
                Reverses_Allocation__c=reverses,Allocation_Date__c=Date.valueOf(Datetime.now().format('yyyy-MM-dd','Asia/Hong_Kong')),
                Allocated_HKD__c=event.Currency__c=='HKD'?review.nativeAmount:null,Allocated_Cash_USD__c=review.cashUsd,Invoice_Carrying_USD__c=review.carryingUsd,
                Bank_Native_Allocation__c=review.bankAmount,Settlement_FX_USD__c=review.settlementFxUsd,Operation_Id__c=operationId,Request_Fingerprint__c=fingerprint);
            allocation.put(supplier?'Supplier_Invoice__c':'Buyer_Invoice__c',bill.Id);
            managedLedgerWrite=true;try {Database.insert(allocation,true,AccessLevel.SYSTEM_MODE);} finally {managedLedgerWrite=false;}
            return allocation.Id;
        } catch(DmlException error) {
            Database.rollback(allocationStart);
            if(error.getDmlStatusCode(0)==String.valueOf(StatusCode.DUPLICATE_VALUE)) {
                SObject existing=FcosTradeCashStore.operation('Trade_Cash_Allocation__c',operationId,fingerprint);
                if(existing!=null) return existing.Id;
            }
            throw error;
        }
    }
    public static Boolean isAuthorizedPayment(Payment__c row) {
        if(row.Id!=null || row.Cash_Event__c==null) return false;
        Payment__c expected=authorizedPayments.get(row.Payment_Operation_Id__c);
        if(expected==null) return false;
        // Typed comparisons preserve exact values across Salesforce decimal scale normalization.
        for(String field:new List<String>{'Cash_Event__c','STEM__c','Account__c','RecordTypeId','Amount__c','Payment_Currency__c','Payment_HKD_Amount__c','Payment_FX_Rate__c','Payment_FX_Revision__c','Payment_FX_Effective_At__c','Invoice_Carrying_USD__c','Settlement_FX_USD__c','Date__c','Bank__c','Bank_Currency__c','Bank_Native_Amount__c','Bank_FX_Evidence__c','Payment_Operation_Id__c','Payment_Request_Fingerprint__c','Buyer_Invoice__c','Supplier_Invoice__c','Remittance__c'})
            if(row.get(field)!=expected.get(field)) return false;
        if(row.Is_Deposit__c==true || row.Auto_Planned_Deposit__c==true) return false;
        return !Payment__c.SObjectType.getDescribe().fields.getMap().containsKey('CurrencyIsoCode') || row.get('CurrencyIsoCode')==expected.get('CurrencyIsoCode');
    }
    public static void guardLedger(List<SObject> rows,Boolean inserting) {
        if(inserting && managedLedgerWrite) return;
        for(SObject row:rows) row.addError('Cash and allocation evidence is immutable. Use the reviewed cash, allocation, reversal or refund workflow.');
    }
}
