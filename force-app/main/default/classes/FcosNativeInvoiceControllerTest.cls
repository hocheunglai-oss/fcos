@IsTest
private class FcosNativeInvoiceControllerTest {
    private static Invoice__c document() {
        return new Invoice__c(Document_Currency__c='HKD',Document_HKD_Amount__c=780.12,Amount__c=100.02,
            Document_FX_Rate__c=7.8,Document_FX_Revision__c='r1',Document_FX_Confirmed_At__c=System.now(),Proforma__c=false,Deprecated__c=false);
    }
    private static Trade_Document_Line__c line() {
        return new Trade_Document_Line__c(Pricing_Mode__c='Unit',Description__c='Fuel',Unit__c='MT',Quantity__c=10,
            Native_Unit_Price__c=78.01234567,Native_Amount__c=780.1234567,Currency__c='HKD',FX_Rate__c=7.8,FX_Revision__c='r1');
    }
    @IsTest static void immutableProjectionPreservesEightDecimalPrice() {
        List<FcosNativeInvoiceController.DisplayLine> rows=FcosNativeInvoiceController.project(document(),new List<Trade_Document_Line__c>{line()});
        System.assertEquals('78.01234567',rows[0].unitPrice);
        System.assertEquals('780.12',rows[0].amount);
        System.assertEquals('10.000000 MT',rows[0].quantity);
    }
    @IsTest static void driftAndMissingEvidenceRejectRendering() {
        for(String revision:new List<String>{null,'changed'}) {
            Trade_Document_Line__c changed=line();changed.FX_Revision__c=revision;
            Boolean rejected=false;
            try {FcosNativeInvoiceController.project(document(),new List<Trade_Document_Line__c>{changed});}
            catch(FcosNativeInvoiceController.NativeInvoiceException expected) {rejected=true;}
            System.assert(rejected);
        }
        Invoice__c changed=document();changed.Amount__c=200;
        Boolean rejected=false;
        try {FcosNativeInvoiceController.project(changed,new List<Trade_Document_Line__c>{line()});}
        catch(FcosNativeInvoiceController.NativeInvoiceException expected) {rejected=true;}
        System.assert(rejected,'PDF must not hide a mismatch between native and USD totals.');
    }
    @IsTest static void missingPresentationCannotUseLiveHeaderFallback() {
        Boolean rejected=false;
        try {FcosNativeInvoiceController.readPresentation(null);}
        catch(FcosNativeInvoiceController.NativeInvoiceException expected) {rejected=true;}
        System.assert(rejected);
    }
    @IsTest static void finalNativeRoundingAndCreditsReconcileAtOriginalRate() {
        for(Decimal sign:new List<Decimal>{1,-1}) {
            Invoice__c saved=document();saved.Document_HKD_Amount__c=sign*0.04;saved.Amount__c=sign*0.01;
            Trade_Document_Line__c detail=line();detail.Native_Amount__c=sign*0.0389;detail.Quantity__c=0.123456;
            detail.Native_Unit_Price__c=sign*0.31509202;
            List<FcosNativeInvoiceController.DisplayLine> projected=FcosNativeInvoiceController.project(saved,new List<Trade_Document_Line__c>{detail});
            System.assertEquals('0.123456 MT',projected[0].quantity);
            System.assertEquals(sign>0?'0.04':'-0.04',projected[0].amount);
        }
    }

    @IsTest static void sixDecimalStorageMustNotMoveFinalRoundingBoundary() {
        for(Decimal sign:new List<Decimal>{1,-1}) {
            Invoice__c saved=document();saved.Document_HKD_Amount__c=sign*1;saved.Amount__c=sign*0.13;
            Trade_Document_Line__c detail=line();detail.Quantity__c=1;
            detail.Native_Unit_Price__c=sign*1.00499960;detail.Native_Amount__c=sign*1.005000;
            System.assertEquals(sign>0?'1.00':'-1.00',FcosNativeInvoiceController.project(saved,new List<Trade_Document_Line__c>{detail})[0].amount);
            saved.Document_HKD_Amount__c=sign*2;saved.Amount__c=sign*0.26;
            detail.Native_Unit_Price__c=sign*1.00249980;detail.Native_Amount__c=sign*1.002500;
            System.assertEquals(2,FcosNativeInvoiceController.project(saved,new List<Trade_Document_Line__c>{detail,detail.clone(false,false,false,false)}).size(),
                'Sum exact immutable line amounts before final rounding, including reversal signs.');
        }
    }

    @IsTest static void nativeHalfCentRoundingMatchesCompanyConversionAndReversals() {
        for(Decimal sign:new List<Decimal>{1,-1}) {
            Invoice__c saved=document();saved.Document_HKD_Amount__c=sign*1.01;saved.Amount__c=sign*0.13;
            Trade_Document_Line__c detail=line();detail.Quantity__c=1;
            detail.Native_Unit_Price__c=sign*1.005;detail.Native_Amount__c=sign*1.005;
            System.assertEquals(sign>0?'1.01':'-1.01',FcosNativeInvoiceController.project(saved,new List<Trade_Document_Line__c>{detail})[0].amount);
            detail.Native_Unit_Price__c=sign*1.0000005;detail.Native_Amount__c=sign*1.000001;
            System.assertEquals(sign*1.0000005,FcosTradeDocumentLineService.nativeAmount(detail));
        }
    }

    @IsTest static void nativePricingEvidenceRejectsUnsupportedOrInconsistentProjection() {
        for(String drift:new List<String>{'amount','quantity','price','mode','minimum','lumpsum'}) {
            Trade_Document_Line__c detail=line();
            if(drift=='amount') detail.Native_Amount__c=999;
            if(drift=='quantity') detail.Quantity__c=null;
            if(drift=='price') detail.Native_Unit_Price__c=null;
            if(drift=='mode') detail.Pricing_Mode__c=null;
            if(drift=='minimum') detail.Pricing_Mode__c='Minimum';
            if(drift=='lumpsum') detail.Pricing_Mode__c='Lumpsum';
            Boolean rejected=false;
            try {FcosTradeDocumentLineService.nativeAmount(detail);}
            catch(AuraHandledException expected) {rejected=true;}
            System.assert(rejected,drift+' must not be inferred from a rounded amount.');
        }
    }

    @IsTest static void minimumLumpsumAndExclusionHaveExplicitImmutablePricingBasis() {
        for(String mode:new List<String>{'Minimum','Lumpsum'}) {
            Invoice__c saved=document();saved.Document_HKD_Amount__c=780;saved.Amount__c=100;
            Trade_Document_Line__c detail=line();detail.Pricing_Mode__c=mode;
            detail.Quantity__c=10;detail.Native_Unit_Price__c=1;detail.Native_Amount__c=780;
            detail.Native_Minimum__c=mode=='Minimum'?780:null;detail.Native_Lumpsum__c=mode=='Lumpsum'?780:null;
            FcosNativeInvoiceController.DisplayLine projected=FcosNativeInvoiceController.project(saved,new List<Trade_Document_Line__c>{detail})[0];
            System.assert(projected.pricingBasis.contains('780.00000000'));
            System.assertEquals('10.000000 MT',projected.quantity);
            System.assertEquals('1.00000000',projected.unitPrice);
            System.assertEquals('780.00',projected.amount);
            detail.Native_Minimum__c=null;detail.Native_Lumpsum__c=null;
            Boolean rejected=false;
            try {FcosNativeInvoiceController.project(saved,new List<Trade_Document_Line__c>{detail});}
            catch(FcosNativeInvoiceController.NativeInvoiceException expected) {rejected=true;}
            System.assert(rejected,'Do not infer missing minimum or lumpsum evidence from the amount.');
        }
        Invoice__c zero=document();zero.Document_HKD_Amount__c=0;zero.Amount__c=0;
        Trade_Document_Line__c excluded=line();excluded.Pricing_Mode__c='Excluded';excluded.Native_Amount__c=0;
        System.assertEquals('Excluded from this trading side',FcosNativeInvoiceController.project(zero,new List<Trade_Document_Line__c>{excluded})[0].pricingBasis);
    }

    @IsTest static void proformaUsesTheSameFrozenNativeProjection() {
        Invoice__c proforma=document();proforma.Proforma__c=true;
        List<FcosNativeInvoiceController.DisplayLine> projected=FcosNativeInvoiceController.project(proforma,new List<Trade_Document_Line__c>{line()});
        System.assertEquals(1,projected.size(),'A proforma renders only from its immutable native evidence; the persisted constructor selects the proforma heading.');
    }

    @IsTest static void freshlyReviewedSourceCannotReplaceAnOlderSavedInvoiceSnapshot() {
        Invoice__c saved=document();saved.Document_FX_Fingerprint__c='saved-A';
        Invoice__c locked=saved.clone(false,false,false,false);
        FcosTradeDocumentService.DocumentReview current=new FcosTradeDocumentService.DocumentReview();
        current.currencyCode='HKD';current.fingerprint='reviewed-B';
        Boolean rejected=false;
        try {InvoiceController.assertNativeGenerationReview(saved,locked,current,'reviewed-B',false);}
        catch(AuraHandledException expected) {rejected=true;}
        System.assert(rejected,'A new review token must not issue a PDF rendered from an older saved native snapshot.');
        current.fingerprint='saved-A';
        InvoiceController.assertNativeGenerationReview(saved,locked,current,'saved-A',false);
    }
    @IsTest static void generationRejectsConcurrentSnapshotTypeCurrencyAndClientReviewDrift() {
        Invoice__c saved=document();saved.Document_FX_Fingerprint__c='saved-A';
        for(String drift:new List<String>{'lockedSnapshot','documentType','currency','clientReview'}) {
            Invoice__c locked=saved.clone(false,false,false,false);
            FcosTradeDocumentService.DocumentReview current=new FcosTradeDocumentService.DocumentReview();
            current.currencyCode=drift=='currency'?'USD':'HKD';current.fingerprint='saved-A';
            if(drift=='lockedSnapshot') locked.Document_FX_Fingerprint__c='changed-under-lock';
            if(drift=='documentType') locked.Proforma__c=true;
            Boolean rejected=false;
            try {InvoiceController.assertNativeGenerationReview(saved,locked,current,drift=='clientReview'?'stale-client':'saved-A',false);}
            catch(AuraHandledException expected) {rejected=true;}
            System.assert(rejected,drift+' must fail before issued content and line links are written.');
        }
    }

    @IsTest static void managedUsdReissueHasNoSyntheticFxAndRejectsMixedEvidence() {
        Invoice__c saved=new Invoice__c(Document_Currency__c='USD',Amount__c=100.12,
            Reissue_Of_Invoice__c=(Id)(Invoice__c.SObjectType.getDescribe().getKeyPrefix()+'000000000001'),
            Document_FX_Side__c=(Id)(Trade_Currency_Side__c.SObjectType.getDescribe().getKeyPrefix()+'000000000001'),
            Document_FX_Fingerprint__c='usd-review',Document_FX_Confirmed_At__c=System.now(),Proforma__c=false,Deprecated__c=false);
        Trade_Document_Line__c detail=new Trade_Document_Line__c(Currency__c='USD',Pricing_Mode__c='Minimum',
            Quantity__c=10,Unit__c='MT',Native_Unit_Price__c=1.01234567,Native_Minimum__c=100.12,
            Native_Amount__c=100.12,Accounting_USD__c=100.12);
        FcosNativeInvoiceController.DisplayLine row=FcosNativeInvoiceController.project(saved,new List<Trade_Document_Line__c>{detail})[0];
        System.assertEquals('100.12',row.amount);System.assert(row.pricingBasis.contains('USD'));
        for(String drift:new List<String>{'legacy','documentRate','nativeHkd','lineRate','lineCurrency','accounting'}) {
            Invoice__c doc=saved.clone(false,false,false,false);Trade_Document_Line__c item=detail.clone(false,false,false,false);
            if(drift=='legacy') {doc.Reissue_Of_Invoice__c=null;doc.Document_FX_Side__c=null;doc.Document_FX_Confirmed_At__c=null;doc.Document_FX_Fingerprint__c=null;}
            if(drift=='documentRate') doc.Document_FX_Rate__c=1;
            if(drift=='nativeHkd') doc.Document_HKD_Amount__c=100.12;
            if(drift=='lineRate') item.FX_Rate__c=1;
            if(drift=='lineCurrency') item.Currency__c='HKD';
            if(drift=='accounting') item.Accounting_USD__c=100;
            Boolean rejected=false;
            try {FcosNativeInvoiceController.project(doc,new List<Trade_Document_Line__c>{item});}
            catch(FcosNativeInvoiceController.NativeInvoiceException expected) {rejected=true;}
            System.assert(rejected,drift+' must not render as a managed USD reissue.');
        }
    }
}
