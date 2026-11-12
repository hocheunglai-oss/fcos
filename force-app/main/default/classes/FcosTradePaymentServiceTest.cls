@IsTest
private class FcosTradePaymentServiceTest {
    private static Id fakeId(Schema.SObjectType objectType) {
        return Id.valueOf(objectType.getDescribe().getKeyPrefix()+'000000000001');
    }
    private static Payment__c hkdPayment() {
        Payment__c row=new Payment__c(Id=fakeId(Payment__c.SObjectType),Payment_Currency__c='HKD',Bank__c='DBS',Amount__c=975,
            Payment_HKD_Amount__c=7800,Invoice_Carrying_USD__c=1000,Payment_FX_Rate__c=8,Payment_FX_Revision__c='rate-1',
            RecordTypeId=Payment__c.SObjectType.getDescribe().getRecordTypeInfosByDeveloperName().get('Receivable').getRecordTypeId());
        if(Payment__c.SObjectType.getDescribe().fields.getMap().containsKey('CurrencyIsoCode')) row.put('CurrencyIsoCode','USD');
        return row;
    }
    private static void validate(Payment__c row,Payment__c oldRow,Set<Id> hkdStems) {
        FcosTradePaymentService.validateRows(new List<Payment__c>{row},oldRow==null?null:new Map<Id,Payment__c>{oldRow.Id=>oldRow},
            new Map<Id,Invoice__c>(),new Map<Id,Supplier_Invoice__c>(),hkdStems);
    }
    @IsTest static void protectsRecordTypeBankAndPrincipalCurrency() {
        Payment__c original=hkdPayment();
        Payment__c same=original.clone(true,false,false,false);validate(same,original,new Set<Id>());
        System.assertEquals(false,same.hasErrors(),'Unchanged financial evidence must be allowed.');
        Payment__c changedBank=original.clone(true,false,false,false);changedBank.Bank__c='UBS';validate(changedBank,original,new Set<Id>());
        System.assert(changedBank.hasErrors(),'Changing bank must require reversal.');
        Payment__c changedType=original.clone(true,false,false,false);
        changedType.RecordTypeId=Payment__c.SObjectType.getDescribe().getRecordTypeInfosByDeveloperName().get('Payable').getRecordTypeId();
        validate(changedType,original,new Set<Id>());System.assert(changedType.hasErrors(),'Record type must not move the amount between settlement rollups.');
        if(Payment__c.SObjectType.getDescribe().fields.getMap().containsKey('CurrencyIsoCode')) {
            Payment__c changedCurrency=original.clone(true,false,false,false);changedCurrency.put('CurrencyIsoCode','HKD');
            validate(changedCurrency,original,new Set<Id>());System.assert(changedCurrency.hasErrors());
        }
    }
    @IsTest static void stemOnlyLegacyAllocationsCannotBypassNativeInvoices() {
        Id stemId=fakeId(STEM__c.SObjectType);
        for(String recordTypeName:new List<String>{'Receivable','Bank_Charge','Write_Off'}) {
            Payment__c row=new Payment__c(STEM__c=stemId,Payment_Currency__c='USD',Amount__c=100,
                RecordTypeId=Payment__c.SObjectType.getDescribe().getRecordTypeInfosByDeveloperName().get(recordTypeName).getRecordTypeId());
            validate(row,null,new Set<Id>{stemId});System.assert(row.hasErrors(),recordTypeName+' needs exact native allocation.');
        }
        Payment__c ordinary=new Payment__c(STEM__c=stemId,Payment_Currency__c='USD',Amount__c=100,
            RecordTypeId=Payment__c.SObjectType.getDescribe().getRecordTypeInfosByDeveloperName().get('Receivable').getRecordTypeId());
        validate(ordinary,null,new Set<Id>());System.assertEquals(false,ordinary.hasErrors(),'Legacy USD-only STEMs remain supported.');
        Payment__c payable=new Payment__c(STEM__c=stemId,Payment_Currency__c='USD',Amount__c=100,
            RecordTypeId=Payment__c.SObjectType.getDescribe().getRecordTypeInfosByDeveloperName().get('Payable').getRecordTypeId());
        validate(payable,null,new Set<Id>{stemId});System.assertEquals(false,payable.hasErrors(),'A supplier USD side is independent from an HKD buyer side.');
    }
    @IsTest static void oldInvoiceReferenceIsStillProtectedAfterItIsCleared() {
        Id invoiceId=fakeId(Invoice__c.SObjectType);
        Payment__c original=hkdPayment();original.Payment_Currency__c='USD';original.Buyer_Invoice__c=invoiceId;
        Payment__c amended=original.clone(true,false,false,false);amended.Buyer_Invoice__c=null;
        FcosTradePaymentService.validateRows(new List<Payment__c>{amended},new Map<Id,Payment__c>{original.Id=>original},
            new Map<Id,Invoice__c>{invoiceId=>new Invoice__c(Id=invoiceId,Document_Currency__c='HKD')},new Map<Id,Supplier_Invoice__c>(),new Set<Id>());
        System.assert(amended.hasErrors(),'Clearing the invoice lookup must not remove the old currency protection.');
    }
    @IsTest static void validatesActualBankAmountAndRefundMagnitude() {
        FcosTradePaymentService.validateBankEvidence(7800,'DBS','HKD',7800,'statement-line-1');
        FcosTradePaymentService.validateBankEvidence(-7800,'DBS','HKD',7800,'refund-line-1');
        FcosTradePaymentService.validateBankEvidence(7800,'DBS','USD',970,'actual bank FX differs from company rate');
        for(Decimal invalid:new List<Decimal>{null,0,-1,10.001}) {
            Boolean rejected=false;
            try { FcosTradePaymentService.validateBankEvidence(7800,'DBS','USD',invalid,'statement-line-1'); }
            catch(AuraHandledException expected) { rejected=true; }
            System.assert(rejected,'Invalid bank amount must be rejected.');
        }
        Boolean mismatch=false;
        try { FcosTradePaymentService.validateBankEvidence(7800,'DBS','HKD',7790,'statement-line-1'); }
        catch(AuraHandledException expected) { mismatch=true; }
        System.assert(mismatch,'Same-currency fees cannot be hidden inside native allocations.');
    }
    @IsTest static void postedNativeEvidenceCannotBeDeleted() {
        Payment__c nativeRow=hkdPayment();Payment__c usdRow=new Payment__c(Payment_Currency__c='USD');
        FcosTradePaymentService.guardDelete(new List<Payment__c>{nativeRow,usdRow});
        System.assert(nativeRow.hasErrors());System.assertEquals(false,usdRow.hasErrors());
    }
    @IsTest static void settlementRequiresIssuedActiveInvoiceOrCredit() {
        for(Decimal nativeTotal:new List<Decimal>{780,-780}) {
            Invoice__c buyer=new Invoice__c(Document_Currency__c='HKD',Document_HKD_Amount__c=nativeTotal,
                Proforma__c=false,Deprecated__c=false);
            Supplier_Invoice__c supplier=new Supplier_Invoice__c(Document_Currency__c='HKD',Document_HKD_Amount__c=nativeTotal);
            for(SObject unissued:new List<SObject>{buyer,supplier}) {
                Boolean rejected=false;
                try {FcosTradePaymentService.requireIssuedInvoice(unissued,unissued.getSObjectType()==Supplier_Invoice__c.SObjectType);}
                catch(AuraHandledException expected) {rejected=true;}
                System.assert(rejected,'Both invoices and credit refunds must require the issued document.');
            }
            buyer.File__c='https://example.invalid/issued.pdf';supplier.Invoice_File__c='https://example.invalid/issued.pdf';
            FcosTradePaymentService.requireIssuedInvoice(buyer,false);
            FcosTradePaymentService.requireIssuedInvoice(supplier,true);
            for(String field:new List<String>{'Proforma__c','Deprecated__c'}) {
                Invoice__c blocked=buyer.clone(false,false,false,false);blocked.put(field,true);
                Boolean rejected=false;
                try {FcosTradePaymentService.requireIssuedInvoice(blocked,false);}
                catch(AuraHandledException expected) {rejected=true;}
                System.assert(rejected,field+' cannot be settled even when its PDF exists.');
            }
        }
    }

    @IsTest static void operationFingerprintDistinguishesRequestAndMatchesOnlyExactRetry() {
        Id invoice=fakeId(Invoice__c.SObjectType);
        String original=FcosTradePaymentService.paymentRequestFingerprint(invoice,780,Date.today(),'r1','DBS','USD',100,'line1');
        String equivalent=FcosTradePaymentService.paymentRequestFingerprint(invoice,780.00,Date.today(),'r1','DBS','USD',100.00,'line1');
        System.assertEquals(original,equivalent);
        Payment__c posted=new Payment__c(Id=fakeId(Payment__c.SObjectType),Payment_Request_Fingerprint__c=original);
        System.assertEquals(posted.Id,FcosTradePaymentService.matchingOperation(posted,equivalent));
        for(String changed:new List<String>{
            FcosTradePaymentService.paymentRequestFingerprint(invoice,781,Date.today(),'r1','DBS','USD',100,'line1'),
            FcosTradePaymentService.paymentRequestFingerprint(invoice,780,Date.today(),'r2','DBS','USD',100,'line1'),
            FcosTradePaymentService.paymentRequestFingerprint(invoice,780,Date.today(),'r1','DBS','USD',100,'line2')}) {
            Boolean rejected=false;
            try {FcosTradePaymentService.matchingOperation(posted,changed);} catch(AuraHandledException expected) {rejected=true;}
            System.assert(rejected,'Reusing an operation for changed financial evidence must reject.');
        }
    }

}
