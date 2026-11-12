@IsTest
private class FcosTradeCurrencyServiceTest {
    @TestSetup
    static void fixtures() {
        User actor = new User(Alias='fxtest',LastName='TradeFxIntegration',Email='tradefx@example.com',
            Username='tradefx.'+UserInfo.getOrganizationId()+'.'+Datetime.now().getTime()+'@example.com',
            EmailEncodingKey='UTF-8',LanguageLocaleKey='en_US',LocaleSidKey='en_US',
            TimeZoneSidKey='Asia/Hong_Kong',ProfileId=traderProfileId());
        insert actor;
        insert new PermissionSetAssignment(AssigneeId=actor.Id,
            PermissionSetId=[SELECT Id FROM PermissionSet WHERE Name='Fcos_Trading_FX_Access' LIMIT 1].Id);
        insert new PermissionSetAssignment(AssigneeId=actor.Id,PermissionSetId=[SELECT Id FROM PermissionSet WHERE Name='Fcos_Trading_FX_Amend_Access' LIMIT 1].Id);
        insert new PermissionSetAssignment(AssigneeId=actor.Id,PermissionSetId=[SELECT Id FROM PermissionSet WHERE Name='FCOS_Variable_Charges_User' LIMIT 1].Id);
        Test.startTest();
        try {
            System.runAs(actor) {
                // Use the established complete enquiry/offer/STEM fixture, including its nominations.
                System.assert(Limits.getQueries()<15,'The currency fixture must begin with a fresh query budget.');
                TestDataFactory.prepareDataForNominationConfirmationFlow();
                Set<Id> ports=new Set<Id>();for(STEM__c stem:[SELECT Port__c FROM STEM__c]) ports.add(stem.Port__c);
                List<Port__c> hongKongPorts=new List<Port__c>();for(Id port:ports) hongKongPorts.add(new Port__c(Id=port,Name='Hong Kong',Port_Area__c='Hong Kong',Country__c='HONG KONG'));
                ContextManager.skipTriggers=true;
                try { update hongKongPorts; }
                finally { ContextManager.skipTriggers=false; }
            }
        } finally { Test.stopTest(); }
    }
    private static Id traderProfileId() {
        List<Profile> profiles=[SELECT Id FROM Profile WHERE Name='FCB Trader' AND UserLicense.LicenseDefinitionKey='SFDC' AND PermissionsModifyAllData=false LIMIT 1];
        System.assertEquals(false,profiles.isEmpty(),'The restricted FCB Trader Salesforce profile is required to verify trader field access.');
        return profiles[0].Id;
    }
    private static User actor() { return [SELECT Id FROM User WHERE LastName='TradeFxIntegration' LIMIT 1]; }
    private static Id lineId() { return [SELECT Id FROM STEM_Line_Item__c WHERE Cancelled__c=false LIMIT 1].Id; }
    private static String nonUsdPrincipal() {
        if(!STEM_Line_Item__c.SObjectType.getDescribe().fields.getMap().containsKey('CurrencyIsoCode')) return null;
        List<SObject> currencies=Database.query('SELECT IsoCode FROM CurrencyType WHERE IsActive=true AND IsoCode != \'USD\' ORDER BY IsoCode LIMIT 1');
        return currencies.isEmpty()?null:(String)currencies[0].get('IsoCode');
    }
    private static String linePrincipal(Id line) {
        List<SObject> rows=Database.query('SELECT CurrencyIsoCode FROM STEM_Line_Item__c WHERE Id=:line');
        return (String)rows[0].get('CurrencyIsoCode');
    }
    private static FcosTradeCurrencyService.Review saveManagedUsdFromLegacyPrincipal(Id line,String principal) {
        STEM_Line_Item__c legacy=new STEM_Line_Item__c(Id=line);legacy.put('CurrencyIsoCode',principal);update legacy;
        FcosCompanyFxRateService.settingsOverride=new Fcos_Trading_FX_Setting__c(Enabled__c=true);
        FcosTradeCurrencyService.Review reviewed=FcosTradeCurrencyService.review(line,'Buy',null);
        return FcosTradeCurrencyService.save(line,'Buy','USD',reviewed.nativeUnitPrice,reviewed.fingerprint,null,true);
    }
    private static FcosCompanyFxRateService.Snapshot rate(String revision,Decimal value) {
        FcosCompanyFxRateService.settingsOverride=new Fcos_Trading_FX_Setting__c(Enabled__c=true);
        FcosCompanyFxRateService.Snapshot snapshot=new FcosCompanyFxRateService.Snapshot();
        snapshot.rateId=revision;snapshot.revision=revision;snapshot.usdHkdRate=value;
        snapshot.effectiveAt=Datetime.newInstanceGmt(2026,9,1,0,0,0);
        return snapshot;
    }
    private static FcosTradeCurrencyService.Review saveSide(Id line,String direction,String currencyCode,Decimal price,FcosCompanyFxRateService.Snapshot snapshot,Boolean confirmSide) {
        FcosTradeCurrencyService.Context ctx=FcosTradeCurrencyService.context(line,direction);
        System.assertEquals(true,FcosTradeCurrencyService.hongKong(ctx.portName,ctx.portCountry),'HKD fixture location: '+ctx.portName+' / '+ctx.portCountry);
        System.assertEquals(false,ctx.formulaPrice,'HKD fixture must use a non-formula STEM fuel line.');
        System.assertEquals(true,FcosCompanyFxRateService.enabled(),'The explicit test FX setting must enable HKD entry.');
        System.assertEquals(true,FeatureManagement.checkPermission('Fcos_Trading_FX_Entry'),'The trader fixture must hold the separate FX-entry custom permission.');
        FcosTradeCurrencyService.Review reviewed=FcosTradeCurrencyService.review(line,direction,snapshot);
        return FcosTradeCurrencyService.save(line,direction,currencyCode,price,reviewed.fingerprint,snapshot,confirmSide);
    }
    private static void combination(String buy,String sell) {
        System.runAs(actor()) {
            Id line=lineId();
            FcosCompanyFxRateService.Snapshot first=rate('buy-rate',7.8);
            Test.startTest();
            FcosTradeCurrencyService.Review buyConfirmed=saveSide(line,'Buy',buy,buy=='HKD'?780:100,first,true);
            FcosCompanyFxRateService.Snapshot second=rate('sell-rate',8);
            FcosTradeCurrencyService.Review sellConfirmed=saveSide(line,'Sell',sell,sell=='HKD'?1600:200,second,true);
            FcosTradeCurrencyService.Review buyAfter=FcosTradeCurrencyService.review(line,'Buy',second);
            Test.stopTest();
            System.assertEquals(buy,buyAfter.currencyCode);
            System.assertEquals(sell,sellConfirmed.currencyCode);
            System.assertEquals(buyConfirmed.fingerprint,buyAfter.fingerprint,'Independent sell confirmation must retain the buy review.');
            System.assertEquals(false,buyAfter.needsConfirmation);
            System.assertEquals(false,sellConfirmed.needsConfirmation);
            System.assertNotEquals(null,buyAfter.confirmedAt);
            System.assertNotEquals(null,sellConfirmed.confirmedAt);
            if(buy=='HKD') {System.assertEquals(Decimal.valueOf('7.8'),buyAfter.rate);System.assertEquals('buy-rate',buyAfter.rateId);}
            if(sell=='HKD') {System.assertEquals(Decimal.valueOf('8'),sellConfirmed.rate);System.assertEquals('sell-rate',sellConfirmed.rateId);}
            STEM_Line_Item__c stored=[SELECT Unit_Buy_At__c,Unit_Sell_At__c FROM STEM_Line_Item__c WHERE Id=:line];
            System.assertEquals(Decimal.valueOf('100'),stored.Unit_Buy_At__c);
            System.assertEquals(Decimal.valueOf('200'),stored.Unit_Sell_At__c);
        }
    }
    @IsTest static void usdUsd() { combination('USD','USD'); }
    @IsTest static void hkdUsd() { combination('HKD','USD'); }
    @IsTest static void usdHkd() { combination('USD','HKD'); }
    @IsTest static void hkdHkd() { combination('HKD','HKD'); }

    @IsTest static void changedDraftRateRejectsConfirmation() {
        System.runAs(actor()) {
            Id line=lineId();FcosCompanyFxRateService.Snapshot first=rate('reviewed',7.8);
            Test.startTest();
            FcosTradeCurrencyService.Review draft=saveSide(line,'Buy','HKD',780,first,false);
            try {
                FcosTradeCurrencyService.save(line,'Buy','HKD',780,draft.fingerprint,rate('changed',8),true);
                System.assert(false,'A stale draft rate must reject confirmation.');
            } catch(FcosTradeCurrencyService.TradeFxException error) {System.assert(error.getMessage().contains('changed'));}
            Test.stopTest();
            System.assertEquals(null,[SELECT Buy_FX_Confirmed_At__c FROM STEM_Line_Item__c WHERE Id=:line].Buy_FX_Confirmed_At__c);
        }
    }
    @IsTest static void outsideHongKongRejectsNativeEntry() {
        System.runAs(actor()) {
            Id line=lineId();STEM_Line_Item__c source=[SELECT STEM__r.Port__c FROM STEM_Line_Item__c WHERE Id=:line];
            ContextManager.skipTriggers=true;
            try {update new Port__c(Id=source.STEM__r.Port__c,Name='Singapore',Port_Area__c='Singapore',Country__c='SINGAPORE');}
            finally {ContextManager.skipTriggers=false;}
            Test.startTest();
            try {
                FcosCompanyFxRateService.Snapshot current=rate('current',7.8);
                FcosTradeCurrencyService.Review reviewed=FcosTradeCurrencyService.review(line,'Buy',current);
                FcosTradeCurrencyService.save(line,'Buy','HKD',780,reviewed.fingerprint,current,true);
                System.assert(false,'HKD must reject outside Hong Kong.');
            }
            catch(FcosTradeCurrencyService.TradeFxException error) {System.assert(error.getMessage().contains('Hong Kong'));}
            Test.stopTest();
            System.assertEquals(0,[SELECT COUNT() FROM Trade_Currency_Side__c]);
        }
    }
    @IsTest static void laterQuantityAndPriceUseLockedRate() {
        System.runAs(actor()) {
            Id line=lineId();FcosCompanyFxRateService.Snapshot first=rate('locked',7.8);
            saveSide(line,'Buy','HKD',780,first,true);
            update new STEM_Line_Item__c(Id=line,Quantity__c=120,Quantity_Delivered_Per_BDN__c=120);
            // Repricing is a separate reviewed server action after the line edit.
            Test.startTest();
            FcosTradeCurrencyService.Review amendedPrice=saveSide(line,'Buy','HKD',1560,rate('later',8),true);
            Test.stopTest();
            System.assertEquals('locked',amendedPrice.rateId);
            System.assertEquals(Decimal.valueOf('7.8'),amendedPrice.rate);
            STEM_Line_Item__c stored=[SELECT Quantity__c,Buy_HKD_Unit_Price__c,Unit_Buy_At__c FROM STEM_Line_Item__c WHERE Id=:line];
            System.assertEquals(Decimal.valueOf('120'),stored.Quantity__c);
            System.assertEquals(Decimal.valueOf('1560'),stored.Buy_HKD_Unit_Price__c);
            System.assertEquals(Decimal.valueOf('200'),stored.Unit_Buy_At__c);
        }
    }
    @IsTest static void explicitRateAmendmentRetainsNativePriceAndRequiresConfirmation() {
        System.runAs(actor()) {
            Id line=lineId();FcosCompanyFxRateService.Snapshot first=rate('original',7.8);
            Test.startTest();
            FcosTradeCurrencyService.Review confirmed=saveSide(line,'Buy','HKD',780,first,true);
            Id originalSide=[SELECT Buy_FX_Side__c FROM STEM_Line_Item__c WHERE Id=:line].Buy_FX_Side__c;
            FcosCompanyFxRateService.Snapshot replacement=rate('amended',8);
            FcosTradeCurrencyService.Review draft=FcosTradeCurrencyService.amend(line,'Buy','HKD',780,
                confirmed.fingerprint,replacement,'Agreed revised settlement rate');
            Test.stopTest();
            System.assertEquals(null,draft.confirmedAt);
            System.assertEquals(true,draft.needsConfirmation);
            System.assertEquals(Decimal.valueOf('780'),draft.nativeUnitPrice);
            System.assertEquals(Decimal.valueOf('97.5'),draft.usdUnitPrice);
            System.assertEquals('amended',draft.rateId);
            Trade_Currency_Side__c oldSide=[SELECT FX_Rate__c,FX_Revision__c,Confirmed_At__c FROM Trade_Currency_Side__c WHERE Id=:originalSide];
            System.assertEquals(Decimal.valueOf('7.8'),oldSide.FX_Rate__c);
            System.assertEquals('original',oldSide.FX_Revision__c);
            System.assertNotEquals(null,oldSide.Confirmed_At__c);
            System.assertNotEquals(originalSide,[SELECT Buy_FX_Side__c FROM STEM_Line_Item__c WHERE Id=:line].Buy_FX_Side__c);
        }
    }

    private static void runCreditWorkflow(Boolean buyer) {
        System.runAs(actor()) {
            Id line=lineId();String direction=buyer?'Sell':'Buy';
            FcosCompanyFxRateService.Snapshot locked=rate('original-credit-rate',7.8);
            System.assertEquals(true,Schema.SObjectType.STEM__c.isAccessible(),'The trader fixture requires effective STEM read access for invoice readiness.');
            saveSide(line,direction,'HKD',780,locked,true);
            STEM_Line_Item__c source=[SELECT STEM__c,Original_Supplier__c FROM STEM_Line_Item__c WHERE Id=:line];
            FcosTradeDocumentService.DocumentReview document=FcosTradeDocumentService.preview(source.STEM__c,direction,buyer?null:source.Original_Supplier__c,new List<Id>{line});
            SObject invoice=buyer?(SObject)new Invoice__c(Name='FX-INV-1',STEM__c=source.STEM__c,Invoice_Date__c=Date.today(),Delivery_Date__c=Date.today(),Invoice_Due_Date__c=Date.today(),Amount__c=document.usdTotal,Proforma__c=false,Deprecated__c=false)
                :(SObject)new Supplier_Invoice__c(Name='FX-BILL-1',Bank_Details__c='Synthetic original supplier bank instructions',STEM__c=source.STEM__c,Supplier__c=source.Original_Supplier__c,Invoice_Date__c=Date.today(),Supplier_Delivery_Date__c=Date.today(),Invoice_Amount__c=document.usdTotal);
            invoice.put('Document_Presentation_JSON__c',JSON.serialize(new Map<String,String>{'version'=>'1','legalEntity'=>'Synthetic test company',(buyer?'buyerName':'supplierName')=>'Synthetic test counterparty'}));
            FcosTradeDocumentService.applySnapshot(invoice,document);insert invoice;
            FcosTradeDocumentLineService.persist(invoice,document);
            ContentVersion originalPdf=new ContentVersion(Title='FX-INV-original',PathOnClient='original.pdf',VersionData=Blob.valueOf('test original'),FirstPublishLocationId=invoice.Id);insert originalPdf;
            originalPdf=[SELECT ContentDocumentId FROM ContentVersion WHERE Id=:originalPdf.Id];
            insert new ContentDocumentLink(ContentDocumentId=originalPdf.ContentDocumentId,LinkedEntityId=line,ShareType='V');
            invoice.put(buyer?'File__c':'Invoice_File__c',URL.getOrgDomainURL().toExternalForm()+'/'+originalPdf.ContentDocumentId);update invoice;
            STEM_Line_Item__c linked=new STEM_Line_Item__c(Id=line);linked.put(buyer?'Buyer_Invoice__c':'Supplier_Invoice__c',invoice.Id);update linked;
            // A later settings revision must not alter the original credit basis.
            rate('later-credit-rate',8);
            FcosTradeCreditService.CreditReview reviewed=FcosTradeCreditService.preview(invoice.Id);
            Id creditId=FcosTradeCreditService.recordCredit(invoice.Id,reviewed.fingerprint,Date.today(),'Full reversal of incorrect invoice');
            String link=FcosTradeCreditService.generateCreditPdf(creditId);
            System.assertNotEquals(null,link);
            SObject credit=Database.query('SELECT Document_HKD_Amount__c,Document_FX_Rate__c,Document_FX_Revision__c,'+(buyer?'Amount__c,Original_Invoice__c':'Invoice_Amount__c,Original_Supplier_Invoice__c')+' FROM '+invoice.getSObjectType().getDescribe().getName()+' WHERE Id=:creditId');
            System.assertEquals(-document.nativeTotal,credit.get('Document_HKD_Amount__c'));
            System.assertEquals(-document.usdTotal,credit.get(buyer?'Amount__c':'Invoice_Amount__c'));
            System.assertEquals(Decimal.valueOf('7.8'),credit.get('Document_FX_Rate__c'));
            System.assertEquals('original-credit-rate',credit.get('Document_FX_Revision__c'));
            System.assertEquals(invoice.Id,credit.get(buyer?'Original_Invoice__c':'Original_Supplier_Invoice__c'));
            String parent=FcosTradeDocumentLineService.parentField(invoice.getSObjectType());
            List<Trade_Document_Line__c> creditLines=Database.query('SELECT Original_Line__c,Source_Record_Id__c,Native_Amount__c FROM Trade_Document_Line__c WHERE '+parent+'=:creditId');
            System.assertEquals(1,creditLines.size());System.assertNotEquals(null,creditLines[0].Original_Line__c);System.assertEquals(String.valueOf(line),creditLines[0].Source_Record_Id__c);
            Trade_Document_Line__c retained=[SELECT Native_Amount__c FROM Trade_Document_Line__c WHERE Id=:creditLines[0].Original_Line__c];
            System.assertEquals(-retained.Native_Amount__c,creditLines[0].Native_Amount__c);
            try {FcosTradeCreditService.recordCredit(invoice.Id,reviewed.fingerprint,Date.today(),'Duplicate reversal attempt');System.assert(false,'An original cannot be reversed twice.');}
            catch(AuraHandledException expected) {System.assertNotEquals(null,expected.getMessage());}
            FcosTradeReissueService.ReleaseResult release=FcosTradeReissueService.release(creditId);
            System.assertEquals(1,release.releasedLineCount);
            STEM_Line_Item__c released=[SELECT Buyer_Invoice__c,Supplier_Invoice__c,Reissue_Of_Buyer_Invoice__c,Reissue_Of_Supplier_Invoice__c FROM STEM_Line_Item__c WHERE Id=:line];
            System.assertEquals(null,released.get(buyer?'Buyer_Invoice__c':'Supplier_Invoice__c'));
            System.assertEquals(invoice.Id,released.get(buyer?'Reissue_Of_Buyer_Invoice__c':'Reissue_Of_Supplier_Invoice__c'));
            FcosTradeDocumentService.DocumentReview reissue=FcosTradeDocumentService.preview(source.STEM__c,direction,buyer?null:source.Original_Supplier__c,new List<Id>{line});
            System.assertEquals(invoice.Id,reissue.reissueOfId);System.assertEquals(creditLines[0].Original_Line__c,reissue.lines[0].originalLineId);
            try {FcosTradeReissueService.release(creditId);System.assert(false,'A released original cannot be released again.');}
            catch(AuraHandledException expected) {System.assertNotEquals(null,expected.getMessage());}
        }
    }
    private class CreditWorkflow implements Queueable {
        private Boolean buyer;
        CreditWorkflow(Boolean buyer) {this.buyer=buyer;}
        public void execute(QueueableContext context) {runCreditWorkflow(buyer);}
    }
    private static void creditRetainsOriginal(Boolean buyer) {
        // This end-to-end test combines separate confirmation, issue, credit,
        // render and release actions; each production action has its own limits.
        Test.startTest();System.enqueueJob(new CreditWorkflow(buyer));Test.stopTest();
    }
    @IsTest static void buyerCreditRetainsOriginalRateAndLines() {creditRetainsOriginal(true);}
    @IsTest static void supplierCreditRetainsOriginalRateAndLines() {creditRetainsOriginal(false);}

    @IsTest static void nativeTotalsRetainPrecisionBeforeFinalRounding() {
        System.runAs(actor()) {
            Id line=lineId();FcosCompanyFxRateService.Snapshot locked=rate('precision-rate',7.8);
            update new STEM_Line_Item__c(Id=line,Quantity__c=1000,Quantity_Delivered_Per_BDN__c=1000);
            saveSide(line,'Buy','HKD',Decimal.valueOf('780.12345678'),locked,true);
            STEM_Line_Item__c stored=[SELECT STEM__c,Original_Supplier__c,Unit_Buy_At__c,Total_Cost__c,Buy_HKD_Unit_Price__c FROM STEM_Line_Item__c WHERE Id=:line];
            // Document preview is a separate Apex request after the side is confirmed.
            Test.startTest();
            FcosTradeDocumentService.DocumentReview doc=FcosTradeDocumentService.preview(stored.STEM__c,'Buy',stored.Original_Supplier__c,new List<Id>{line});
            Test.stopTest();
            System.assertEquals(Decimal.valueOf('780.12345678'),stored.Buy_HKD_Unit_Price__c);
            System.assertEquals((Decimal.valueOf('780.12345678')*1000/Decimal.valueOf('7.8')).setScale(2),stored.Total_Cost__c);
            System.assertNotEquals((stored.Unit_Buy_At__c.setScale(2)*1000).setScale(2),stored.Total_Cost__c,'Accounting cannot multiply the rounded USD unit price.');
            System.assertEquals(Decimal.valueOf('780123.46'),doc.nativeTotal);
            System.assertEquals((doc.nativeTotal/Decimal.valueOf('7.8')).setScale(2),doc.usdTotal);
        }
    }

    @IsTest static void managedUsdSaveAndExactRetryForceCustomPrincipalUsd() {
        String principal=nonUsdPrincipal();if(principal==null) return;
        System.runAs(actor()) {
            Id line=lineId();FcosTradeCurrencyService.Review saved=saveManagedUsdFromLegacyPrincipal(line,principal);
            Id savedSide=[SELECT Buy_FX_Side__c FROM STEM_Line_Item__c WHERE Id=:line].Buy_FX_Side__c;
            System.assertEquals('USD',linePrincipal(line),'The reviewed save must normalize the custom record principal.');
            Test.startTest();
            FcosTradeCurrencyService.save(
                line,'Buy','USD',saved.nativeUnitPrice,saved.fingerprint,null,true);
            Test.stopTest();
            System.assertEquals(savedSide,[SELECT Buy_FX_Side__c FROM STEM_Line_Item__c WHERE Id=:line].Buy_FX_Side__c,
                'An exact reviewed save retry must retain its canonical side.');
            System.assertEquals('USD',linePrincipal(line));
        }
    }

    @IsTest static void directApiCannotMoveManagedUsdCustomRecordPrincipal() {
        String principal=nonUsdPrincipal();if(principal==null) return;
        System.runAs(actor()) {
            Id line=lineId();saveManagedUsdFromLegacyPrincipal(line,principal);
            STEM_Line_Item__c changed=new STEM_Line_Item__c(Id=line);changed.put('CurrencyIsoCode',principal);
            Test.startTest();Database.SaveResult result=Database.update(changed,false);Test.stopTest();
            System.assertEquals(true,result.isSuccess(),'The managed guard may normalize a principal-only API update.');
            System.assertEquals('USD',linePrincipal(line),
                'A direct API change cannot move a reviewed USD side away from USD accounting.');
        }
    }

    @IsTest static void managedStemAdmissionRejectsNonUsdParent() {
        String principal=nonUsdPrincipal();if(principal==null || !STEM__c.SObjectType.getDescribe().fields.getMap().containsKey('CurrencyIsoCode')) return;
        System.runAs(actor()) {
            Id line=lineId();Id stemId=[SELECT STEM__c FROM STEM_Line_Item__c WHERE Id=:line].STEM__c;
            STEM__c stem=new STEM__c(Id=stemId);stem.put('CurrencyIsoCode',principal);update stem;
            try {
                FcosTradeCurrencyService.review(line,'Buy',null);
                System.assert(false,'Managed trading must not enter a non-USD accounting parent.');
            } catch(FcosTradeCurrencyService.TradeFxException expected) {
                System.assert(expected.getMessage().contains('STEM principal currency'));
            }
        }
    }

    @IsTest static void traderChangesRevokeReadonlyVariableChargeEvidence() {
        Id sourceId=lineId();STEM_Line_Item__c line=[SELECT STEM__c,Original_Supplier__c,Quantity__c FROM STEM_Line_Item__c WHERE Id=:sourceId];
        STEM_Variable_Charge_Supplier__c stage=new STEM_Variable_Charge_Supplier__c(OwnerId=actor().Id,STEM__c=line.STEM__c,Supplier__c=line.Original_Supplier__c,Manual_Review_Required__c=true,
            Supplier_Status__c='Verified',Verified_At__c=System.now(),Verified_By_Email__c='review@example.invalid',Reviewed_Source_Fingerprint__c='prior-source',
            Buyer_Charge_Status__c='Verified',Buyer_Charge_Confirmed_At__c=System.now(),Buyer_Charge_Confirmed_By_Email__c='review@example.invalid',Buyer_Charge_Reviewed_Source_Fingerprint__c='prior-buyer');
        insert stage;
        System.runAs(actor()) {
            System.assertEquals(false,FeatureManagement.checkPermission('Fcos_Variable_Charge_Evidence'),'The trader cannot hold the service evidence permission.');
            Datetime originalVerification=stage.Verified_At__c;
            Database.SaveResult denied=Database.update(new STEM_Variable_Charge_Supplier__c(Id=stage.Id,Verified_At__c=System.now().addMinutes(1)),false,AccessLevel.USER_MODE);
            System.assertEquals(false,denied.isSuccess(),'The server guard must reject forged evidence even when the profile can edit readonly fields.');
            System.assert(denied.getErrors()[0].getMessage().contains('service-managed'));
            System.assertEquals(originalVerification,[SELECT Verified_At__c FROM STEM_Variable_Charge_Supplier__c WHERE Id=:stage.Id].Verified_At__c);
            Test.startTest();update new STEM_Line_Item__c(Id=sourceId,Quantity__c=line.Quantity__c+1);Test.stopTest();
            stage=[SELECT Supplier_Status__c,Verified_At__c,Buyer_Charge_Status__c,Buyer_Charge_Confirmed_At__c FROM STEM_Variable_Charge_Supplier__c WHERE Id=:stage.Id];
            System.assertEquals('Invalidated',stage.Supplier_Status__c);System.assertEquals(null,stage.Verified_At__c);
            System.assertEquals('Invalidated',stage.Buyer_Charge_Status__c);System.assertEquals(null,stage.Buyer_Charge_Confirmed_At__c);
        }
    }

}
