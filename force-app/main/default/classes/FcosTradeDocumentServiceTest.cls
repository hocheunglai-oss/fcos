@IsTest
private class FcosTradeDocumentServiceTest {
    private static Id fakeId(Schema.SObjectType objectType) {
        return Id.valueOf(objectType.getDescribe().getKeyPrefix()+'000000000001');
    }
    private static void principalUsd(SObject row) {
        if (row.getSObjectType().getDescribe().fields.getMap().containsKey('CurrencyIsoCode')) row.put('CurrencyIsoCode','USD');
    }
    private static Invoice__c hkdInvoice() {
        Invoice__c row=new Invoice__c(Id=fakeId(Invoice__c.SObjectType),Amount__c=1000,
            Document_Currency__c='HKD',Document_HKD_Amount__c=7800,Document_FX_Rate__c=7.8,
            Document_FX_Revision__c='rate-1',Document_FX_Confirmed_At__c=Datetime.newInstanceGMT(2026,9,10,0,0,0),
            Document_FX_Side__c=fakeId(Trade_Currency_Side__c.SObjectType),Document_FX_Fingerprint__c='document-fingerprint');
        principalUsd(row);
        return row;
    }
    private static FcosTradeDocumentService.DocumentReview hkdReview(Boolean complete) {
        FcosTradeDocumentService.DocumentReview review=new FcosTradeDocumentService.DocumentReview();
        review.currencyCode='HKD';review.nativeTotal=7800;review.rate=7.8;
        review.rateId=complete?'rate-1':null;review.confirmedAt=Datetime.newInstanceGMT(2026,9,10,0,0,0);
        review.sideId=fakeId(Trade_Currency_Side__c.SObjectType);review.fingerprint='review-fingerprint';
        return review;
    }
    private static Invoice__c authorizedInvoice(Boolean complete) {
        Invoice__c row=hkdInvoice();
        FcosTradeDocumentService.applySnapshot(row,hkdReview(complete));
        return row;
    }
    private static Supplier_Invoice__c authorizedSupplierInvoice() {
        Supplier_Invoice__c row=new Supplier_Invoice__c(Id=fakeId(Supplier_Invoice__c.SObjectType),Invoice_Amount__c=1000,
            Document_Currency__c='HKD',Document_HKD_Amount__c=7800,Document_FX_Rate__c=7.8,
            Document_FX_Revision__c='rate-1',Document_FX_Confirmed_At__c=Datetime.newInstanceGMT(2026,9,10,0,0,0),
            Document_FX_Side__c=fakeId(Trade_Currency_Side__c.SObjectType),Document_FX_Fingerprint__c='document-fingerprint');
        principalUsd(row);
        FcosTradeDocumentService.applySnapshot(row,hkdReview(true));
        return row;
    }
    private static void guard(SObject row,SObject oldRow,Boolean deleting) {
        FcosTradeDocumentService.guardDocuments(new List<SObject>{row},oldRow==null?null:new Map<Id,SObject>{oldRow.Id=>oldRow},deleting);
    }
    private static void assertError(SObject row,String expected) {
        System.assert(row.hasErrors(),'Expected document guard to reject the operation.');
        System.assert(row.getErrors()[0].getMessage().contains(expected),row.getErrors()[0].getMessage());
    }

    @IsTest static void rejectsUnreviewedNativeCreateAndSnapshotIntegrityFailures() {
        Invoice__c unreviewed=hkdInvoice();
        guard(unreviewed,null,false);
        assertError(unreviewed,'reviewed document workflow');

        Invoice__c incomplete=authorizedInvoice(false);
        guard(incomplete,null,false);
        assertError(incomplete,'complete confirmed native document snapshot');
    }

    @IsTest static void rejectsUnreviewedHkdSnapshotUpdates() {
        Invoice__c oldRow=hkdInvoice();
        Invoice__c amended=oldRow.clone(true,false,false,false);
        amended.Document_FX_Rate__c=8;
        guard(amended,oldRow,false);
        assertError(amended,'reviewed document workflow');
    }

    @IsTest static void keepsPrincipalCurrencyUsdWhenTheFieldExists() {
        if (!Invoice__c.SObjectType.getDescribe().fields.getMap().containsKey('CurrencyIsoCode')) return;
        Invoice__c wrongPrincipalCurrency=hkdInvoice();
        wrongPrincipalCurrency.put('CurrencyIsoCode','HKD');
        guard(wrongPrincipalCurrency,null,false);
        assertError(wrongPrincipalCurrency,'principal document currency must remain USD');
    }

    @IsTest static void rejectsUsdAmountsThatDoNotMatchTheAuthorizedNativeSnapshot() {
        Invoice__c mismatched=authorizedInvoice(true);
        mismatched.Amount__c=999;
        guard(mismatched,null,false);
        assertError(mismatched,'USD amount must equal the native total');

        Supplier_Invoice__c supplierMismatched=authorizedSupplierInvoice();
        supplierMismatched.Invoice_Amount__c=999;
        guard(supplierMismatched,null,false);
        assertError(supplierMismatched,'USD amount must equal the native total');
    }

    @IsTest static void allowsAnUnchangedAuthorizedHkdDocument() {
        Invoice__c original=authorizedInvoice(true);
        Invoice__c unchanged=original.clone(true,false,false,false);
        guard(unchanged,original,false);
        System.assertEquals(false,unchanged.hasErrors(),'An unchanged authorized HKD snapshot must remain valid.');
    }

    @IsTest static void blocksDeletionOfNativeDocuments() {
        Invoice__c issued=hkdInvoice();
        guard(issued,new Invoice__c(Id=issued.Id,Document_Currency__c='HKD'),true);
        assertError(issued,'Retain the issued HKD document');
    }
    @IsTest static void rejectsCreditLineageAndDateTampering() {
        Invoice__c original=hkdInvoice();original.Invoice_Date__c=Date.newInstance(2026,9,10);
        Invoice__c changed=original.clone(true,false,false,false);
        changed.Original_Invoice__c=fakeId(Invoice__c.SObjectType);
        guard(changed,original,false);assertError(changed,'reviewed document workflow');
        changed=original.clone(true,false,false,false);changed.Credit_Reason__c='Invented reversal';
        guard(changed,original,false);assertError(changed,'reviewed document workflow');
        changed=original.clone(true,false,false,false);changed.Invoice_Date__c=Date.newInstance(2026,9,11);
        guard(changed,original,false);assertError(changed,'cannot change');
    }

    @IsTest static void savedNativeDocumentPresentationCannotDrift() {
        Invoice__c original=hkdInvoice();original.Name='HK-INV-1';
        original.Invoice_Due_Date__c=Date.newInstance(2026,9,30);original.Refcode_Index__c='PO-1';
        for(String field:new List<String>{'Name','Invoice_Due_Date__c','Refcode_Index__c'}) {
            Invoice__c edited=original.clone(true,false,false,false);
            if(field=='Invoice_Due_Date__c') edited.put(field,Date.newInstance(2026,10,1));
            else edited.put(field,'amended');
            guard(edited,original,false);
            assertError(edited,'Use credit and reissue');
        }
    }
    @IsTest static void issuedNativeFileCannotBeReplacedOrCleared() {
        Invoice__c original=hkdInvoice();original.File__c='https://example.invalid/issued-original.pdf';
        Invoice__c replacement=original.clone(true,false,false,false);replacement.File__c='https://example.invalid/replacement.pdf';
        guard(replacement,original,false);assertError(replacement,'issued native document file is immutable');
        Invoice__c cleared=original.clone(true,false,false,false);cleared.File__c=null;
        guard(cleared,original,false);assertError(cleared,'issued native document file is immutable');
    }
}
