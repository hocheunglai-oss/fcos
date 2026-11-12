@IsTest
private class FcosNativeConfirmationServiceTest {
    private static Id fakeId(Schema.SObjectType type) {
        return Id.valueOf(type.getDescribe().getKeyPrefix()+'000000000001');
    }
    private static FcosTradeDocumentService.DocumentReview review() {
        FcosTradeDocumentService.DocumentReview review=new FcosTradeDocumentService.DocumentReview();
        review.currencyCode='HKD';review.fingerprint='review-fingerprint';review.rate=7.8;review.rateId='rate-1';
        review.confirmedAt=Datetime.newInstanceGMT(2026,9,10,0,0,0);
        FcosTradeDocumentService.Line fuel=new FcosTradeDocumentService.Line();
        fuel.id=fakeId(STEM_Line_Item__c.SObjectType);fuel.name='VLSFO';fuel.quantity=10;fuel.unit='MT';
        fuel.nativeUnitPrice=780;fuel.nativeAmount=7800;
        FcosTradeDocumentService.Line fixedCharge=new FcosTradeDocumentService.Line();
        fixedCharge.id=fakeId(STEM_Extra_Cost__c.SObjectType);fixedCharge.name='Delivery charge';fixedCharge.quantity=1;fixedCharge.unit='LS';
        fixedCharge.nativeUnitPrice=50;fixedCharge.nativeMinimum=50;fixedCharge.nativeLumpsum=50;fixedCharge.nativeAmount=50;
        review.lines.add(fuel);review.lines.add(fixedCharge);return review;
    }
    private static Nomination__c nomination() {
        Nomination__c row=new Nomination__c(Id=fakeId(Nomination__c.SObjectType),RefCode__c='CON-1');
        row.putSObject('Account__r',new Account(Name='Buyer Limited'));
        return row;
    }
    private static STEM__c stem() {
        STEM__c row=new STEM__c(Id=fakeId(STEM__c.SObjectType),Expected_Delivery_Date__c=Date.newInstance(2026,9,10));
        return row;
    }

    @IsTest static void canonicalRowsUseOnlyTheServerReviewNativeFinancials() {
        List<Object> rows=FcosNativeConfirmationService.canonicalRows(nomination(),stem(),review(),true,
            new Payment_Term__c(Name='30 DAYS',Description__c='FROM DELIVERY'),false);
        String saved=JSON.serialize(rows);
        System.assert(saved.contains('Buyer Limited'));
        System.assert(saved.contains('HKD 780.00000000/MT'),'Native unit price must retain eight decimal places.');
        System.assert(saved.contains('HKD 7800.00'),'Native amount must retain two decimal places.');
        System.assert(saved.contains('HKD 50.00'),'Native minimum and lump sum must retain two decimal places.');
        System.assert(saved.contains('FRATELLI COSULICH BUNKERS (HK) LTD.'));
        System.assert(saved.contains('PAYMENT TERM'));
        System.assertEquals(false,saved.contains('USD '),'The native confirmation rows cannot fabricate USD financial display values.');
    }

    @IsTest static void trusteeSellerAndFrozenContentFingerprintAreDeterministic() {
        List<Object> rows=FcosNativeConfirmationService.canonicalRows(nomination(),stem(),review(),true,
            new Payment_Term__c(Name='CIA',Description__c='IN ADVANCE'),true);
        String saved=JSON.serialize(rows);
        System.assert(saved.contains('FRATELLI COSULICH BUNKERS (S) PTE LTD.'));
        String initial=FcosNativeConfirmationService.contentFingerprint('review-fingerprint',saved,'{"label":"REMARKS","value":"NIL"}');
        String amendedRemarks=FcosNativeConfirmationService.contentFingerprint('review-fingerprint',saved,'{"label":"REMARKS","value":"Changed"}');
        System.assertNotEquals(initial,amendedRemarks,'User-authored remarks are part of the frozen server content fingerprint.');
        System.assertEquals('10.000',FcosNativeConfirmationService.decimalText(10,3));
        System.assertEquals('07/09/2026',FcosNativeConfirmationService.dateText(Date.newInstance(2026,9,7)));
    }

    @IsTest static void scopedPreparationAuthorizationRequiresTheExactContentFingerprint() {
        Nomination__c row=nomination();
        row.Document_FX_Fingerprint__c='review-fingerprint';
        row.Saved_Inputs__c='[{"label":"PRICE","value":"HKD 780.00000000/MT"}]';
        row.Saved_Remarks__c='{"label":"REMARKS","value":"NIL"}';
        row.Document_Content_Fingerprint__c=FcosNativeConfirmationService.contentFingerprint(row.Document_FX_Fingerprint__c,row.Saved_Inputs__c,row.Saved_Remarks__c);
        FcosNativeConfirmationService.authorizeForTest(row.Id,row.Document_Content_Fingerprint__c);
        System.assertEquals(true,FcosNativeConfirmationService.isPreparing(row));
        row.Saved_Inputs__c='[{"label":"PRICE","value":"HKD 1.00000000/MT"}]';
        System.assertEquals(false,FcosNativeConfirmationService.isPreparing(row),'The scoped guard must reject a mismatched financial payload.');
        FcosNativeConfirmationService.clearAuthorizationForTest();
    }
}
