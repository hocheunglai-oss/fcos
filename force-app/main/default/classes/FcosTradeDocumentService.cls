/** Authoritative agreed-currency document projection. No historical HKD is reconstructed from USD. */
public with sharing class FcosTradeDocumentService {
    public static Boolean buyerSideIsHkd(Id stemId) {
        STEM__c stem=[SELECT Account__c,Port__c FROM STEM__c WHERE Id=:stemId];
        String key='STEM:'+stemId+':'+stem.Port__c+':Sell:'+stem.Account__c;
        List<Trade_Currency_Side__c> sides=FcosTradeEvidenceStore.sidesByKeys(new Set<String>{key},false);
        return !sides.isEmpty() && sides[0].Currency__c=='HKD';
    }
    public static Boolean buyerSideIsManaged(Id stemId) {
        STEM__c stem=[SELECT Account__c,Port__c FROM STEM__c WHERE Id=:stemId];
        String key='STEM:'+stemId+':'+stem.Port__c+':Sell:'+stem.Account__c;
        List<Trade_Currency_Side__c> sides=FcosTradeEvidenceStore.sidesByKeys(new Set<String>{key},false);
        return !sides.isEmpty() && (sides[0].Currency__c=='HKD'
            || (sides[0].Currency__c=='USD' && sides[0].Confirmed_At__c!=null));
    }
    public static Boolean hasReissueSelection(Id stemId,String direction,List<String> selectedIds) {
        if(selectedIds==null || selectedIds.isEmpty()) return false;
        String field=direction=='Sell'?'Reissue_Of_Buyer_Invoice__c':'Reissue_Of_Supplier_Invoice__c';
        for(String objectName:new List<String>{'STEM_Line_Item__c','STEM_Extra_Cost__c'})
            if(!Database.query('SELECT Id FROM '+objectName+' WHERE STEM__c=:stemId AND Id IN :selectedIds AND '+field+' != null LIMIT 1').isEmpty()) return true;
        return false;
    }
    public static Boolean isManagedDocument(SObject row) {
        if(row==null) return false;
        Map<String,Object> values=row.getPopulatedFieldsAsMap();
        if(values.get('Document_Currency__c')=='HKD') return true;
        if(values.get('Document_Currency__c')=='USD' && values.get('Document_FX_Side__c')!=null
            && values.get('Document_FX_Confirmed_At__c')!=null && !String.isBlank((String)values.get('Document_FX_Fingerprint__c'))) return true;
        for(String field:new List<String>{'Reissue_Of_Invoice__c','Reissue_Of_Supplier_Invoice__c','Original_Invoice__c','Original_Supplier_Invoice__c','Final_Of_Proforma__c'})
            if(values.get(field)!=null) return true;
        return false;
    }
    private static Map<String,String> authorizedSnapshots=new Map<String,String>();
    private static final List<String> SNAPSHOT_FIELDS=new List<String>{'Document_Currency__c','Document_HKD_Amount__c','Document_FX_Rate__c','Document_FX_Revision__c','Document_FX_Confirmed_At__c','Document_FX_Side__c','Document_FX_Fingerprint__c'};
    private static String snapshotKey(SObject row) { return row.getSObjectType().getDescribe().getName()+':'+row.Id; }
    private static String snapshotDigest(SObject row) {
        List<String> values=new List<String>();
        for(String field:SNAPSHOT_FIELDS) values.add(field+'='+String.valueOf(row.get(field)));
        Map<String,Schema.SObjectField> fields=row.getSObjectType().getDescribe().fields.getMap();
        for(String field:new List<String>{'Original_Invoice__c','Original_Supplier_Invoice__c','Credit_Reason__c','Reissue_Of_Invoice__c','Reissue_Of_Supplier_Invoice__c','Final_Of_Proforma__c','Document_Presentation_JSON__c','Document_Operation_Id__c','Document_Request_Fingerprint__c','Proforma__c','Deposit_Requested_HKD__c','Deposit_Requested_USD__c','Deposit_Due_Date__c'}) if(fields.containsKey(field)) values.add(field+'='+String.valueOf(row.getPopulatedFieldsAsMap().get(field)));
        if(row.getPopulatedFieldsAsMap().get('Document_Currency__c')=='USD')
            for(String field:new List<String>{'Amount__c','Invoice_Amount__c'}) if(fields.containsKey(field)) values.add(field+'='+String.valueOf(row.getPopulatedFieldsAsMap().get(field)));
        return EncodingUtil.convertToHex(Crypto.generateDigest('SHA-256',Blob.valueOf(String.join(values,'|'))));
    }
    public static void guardDocuments(List<SObject> rows,Map<Id,SObject> oldRows,Boolean deleting) {
        for(SObject row:rows) {
            SObject oldRow=oldRows==null?null:oldRows.get(row.Id);
            Boolean hkd=row.get('Document_Currency__c')=='HKD' || (oldRow!=null && oldRow.get('Document_Currency__c')=='HKD');
            Boolean managedDocument=hkd || isManagedDocument(row) || isManagedDocument(oldRow);
            if(!managedDocument) continue;
            if(row.getSObjectType()==Nomination__c.SObjectType) {
                Boolean contentChanged=oldRow==null;
                if(oldRow!=null) for(String field:new List<String>{'Saved_Inputs__c','Saved_Remarks__c','Document_Content_Fingerprint__c'}) if(row.get(field)!=oldRow.get(field)) contentChanged=true;
                if(contentChanged && !FcosNativeConfirmationService.isPreparing((Nomination__c)row)) row.addError('Native confirmation content must come from the reviewed server preparation and remains immutable.');
            }
            if(deleting) { row.addError('Retain the issued HKD document and use credit and reissue.'); continue; }
            Map<String,Schema.SObjectField> fields=row.getSObjectType().getDescribe().fields.getMap();
            if(fields.containsKey('CurrencyIsoCode') && row.get('CurrencyIsoCode')!='USD') { row.addError('Salesforce principal document currency must remain USD.'); continue; }
            if(oldRow!=null) for(String field:new List<String>{'Reissue_Released_At__c','Reissue_Released_By__c'}) {
                if(fields.containsKey(field) && row.get(field)!=oldRow.get(field) && !FcosTradeReissueService.isAuthorizedDocumentRelease(row,oldRow)) row.addError('Reissue release evidence can only be set once by the reviewed credit workflow.');
            }
            if(oldRow==null) for(String field:new List<String>{'Reissue_Released_At__c','Reissue_Released_By__c'}) if(fields.containsKey(field) && row.get(field)!=null) row.addError('A new document cannot already be released for reissue.');
            Boolean authorized=authorizedSnapshots.get(snapshotKey(row))==snapshotDigest(row);
            Boolean changed=oldRow==null;
            if(oldRow!=null) {
                for(String field:SNAPSHOT_FIELDS) if(row.get(field)!=oldRow.get(field)) changed=true;
                for(String field:new List<String>{'Original_Invoice__c','Original_Supplier_Invoice__c','Credit_Reason__c','Reissue_Of_Invoice__c','Reissue_Of_Supplier_Invoice__c','Final_Of_Proforma__c','Document_Presentation_JSON__c','Document_Operation_Id__c','Document_Request_Fingerprint__c','Proforma__c','Deposit_Requested_HKD__c','Deposit_Requested_USD__c','Deposit_Due_Date__c'}) if(fields.containsKey(field) && row.get(field)!=oldRow.get(field)) changed=true;
            }
            if(changed && !authorized) { row.addError('Document currency and rate evidence must come from the reviewed document workflow.'); continue; }
            if(oldRow!=null && isManagedDocument(oldRow) && changed) { row.addError('An existing HKD document snapshot is immutable. Use credit and reissue.'); continue; }
            if(oldRow!=null) for(String fileField:new List<String>{'File__c','Invoice_File__c'}) {
                if(fields.containsKey(fileField) && !String.isBlank((String)oldRow.get(fileField)) && row.get(fileField)!=oldRow.get(fileField))
                    row.addError('The issued native document file is immutable. Use credit and reissue.');
            }
            Decimal nativeAmount=(Decimal)row.get('Document_HKD_Amount__c'),rate=(Decimal)row.get('Document_FX_Rate__c');
            Boolean usd=row.get('Document_Currency__c')=='USD';
            if(usd) {
                if(nativeAmount!=null || rate!=null || row.get('Document_FX_Revision__c')!=null) {row.addError('A USD reissue cannot carry HKD amounts or an inherited exchange rate.');continue;}
                if(row.get('Document_FX_Confirmed_At__c')==null || row.get('Document_FX_Side__c')==null || String.isBlank((String)row.get('Document_FX_Fingerprint__c'))) {row.addError('A confirmed USD reissue snapshot is required.');continue;}
            } else if(row.get('Document_Currency__c')!='HKD' || nativeAmount==null || rate==null || rate<=0 || row.get('Document_FX_Confirmed_At__c')==null || row.get('Document_FX_Side__c')==null || String.isBlank((String)row.get('Document_FX_Revision__c'))) { row.addError('A complete confirmed native document snapshot is required.'); continue; }
            String amountField=row.getSObjectType()==Supplier_Invoice__c.SObjectType?'Invoice_Amount__c':'Amount__c';
            if(!usd && fields.containsKey(amountField) && row.getSObjectType()!=Nomination__c.SObjectType && row.get(amountField)!=(nativeAmount/rate).setScale(2,RoundingMode.HALF_UP)) row.addError('Document USD amount must equal the native total at its original confirmed rate.');
            if(oldRow!=null && isManagedDocument(oldRow)) for(String field:new List<String>{'STEM__c','Account__c','Supplier__c','RecordTypeId','Proforma__c','Deprecated__c','Name','Bank_Details__c','Refcode_Index__c','Invoice_Date__c','Invoice_Due_Date__c','Delivery_Date__c','Supplier_Delivery_Date__c','Amount__c','Invoice_Amount__c','Final_Of_Proforma__c','Document_Operation_Id__c','Document_Request_Fingerprint__c','Deposit_Requested_HKD__c','Deposit_Requested_USD__c','Deposit_Due_Date__c'}) {
                if(fields.containsKey(field) && oldRow.get(field)!=row.get(field)) row.addError('An issued HKD document cannot change its accounting counterparty or type. Use credit and reissue.');
            }
        }
    }
    public class Line {
        @AuraEnabled public Id id;
        @AuraEnabled public Id originalLineId;
        @AuraEnabled public String name;
        @AuraEnabled public String unit;
        @AuraEnabled public Decimal quantity;
        @AuraEnabled public Decimal nativeUnitPrice;
        @AuraEnabled public Decimal nativeAmount;
        @AuraEnabled public Decimal usdAmount;
        @AuraEnabled public Decimal nativeMinimum;
        @AuraEnabled public Decimal nativeLumpsum;
        @AuraEnabled public String pricingMode;
    }
    public class DocumentReview {
        @AuraEnabled public String currencyCode;
        @AuraEnabled public Decimal nativeTotal;
        @AuraEnabled public Decimal usdTotal;
        @AuraEnabled public Decimal rate;
        @AuraEnabled public String rateId;
        @AuraEnabled public Datetime confirmedAt;
        @AuraEnabled public Id sideId;
        @AuraEnabled public Id reissueOfId;
        @AuraEnabled public String fingerprint;
        @AuraEnabled public List<Line> lines = new List<Line>();
    }
    private static String fxFields(String direction) {
        String p=direction+'_';
        return p+'USD_Unit_Price_Precise__c,'+p+'Currency__c,'+p+'HKD_Unit_Price__c,'+p+'HKD_Minimum__c,'+p+'HKD_Lumpsum__c,'+p+'FX_Rate__c,'+p+'FX_Revision__c,'+p+'FX_Confirmed_At__c,'+p+'FX_Side__c';
    }
    private static Decimal value(SObject row,String field) { return row.get(field)==null ? 0 : (Decimal)row.get(field); }
    public static void requireReconciledPrepayments(Id stemId,String direction,Id partyId) {
        String unallocated=direction=='Buy'?'Supplier_Invoice__c = null AND Account__c = :partyId AND RecordType.DeveloperName = \'Payable\'':'Buyer_Invoice__c = null AND RecordType.DeveloperName IN (\'Receivable\',\'Bank_Charge\',\'Write_Off\')';
        List<SObject> payments=Database.query('SELECT Id FROM Payment__c WHERE STEM__c=:stemId AND Amount__c != 0 AND '+unallocated+' LIMIT 1');
        if(!payments.isEmpty()) throw new AuraHandledException('Reconcile the existing unallocated payment with its original currency, date rate and bank evidence before issuing an HKD document.');
    }
    @AuraEnabled
    public static DocumentReview preview(Id stemId,String direction,Id supplierId,List<Id> lineIds) {
        return previewInternal(stemId,direction,supplierId,lineIds,false);
    }
    /** Proforma/final review accepts CIA only when the caller separately fingerprints explicit deposit terms. */
    public static DocumentReview previewWithDepositTerms(Id stemId,String direction,Id supplierId,List<Id> lineIds) {
        return previewInternal(stemId,direction,supplierId,lineIds,true);
    }
    public static DocumentReview previewForLegacyController(Id stemId,String direction,Id supplierId,List<Id> lineIds) {
        if (lineIds==null || lineIds.isEmpty()) throw new AuraHandledException('Select the document lines.');
        return previewInternal(stemId,direction,supplierId,lineIds,false,true,direction=='Buy');
    }

    private static DocumentReview previewInternal(Id stemId,String direction,Id supplierId,List<Id> lineIds,Boolean hasReviewedDepositTerms) {
        return previewInternal(stemId,direction,supplierId,lineIds,hasReviewedDepositTerms,false,false);
    }

    private static DocumentReview previewInternal(Id stemId,String direction,Id supplierId,List<Id> lineIds,
            Boolean hasReviewedDepositTerms,Boolean legacyController,Boolean legacySupplierReceipt) {
        if (direction!='Buy' && direction!='Sell') throw new AuraHandledException('Select one buyer or supplier document side.');
        STEM__c stem=[SELECT Id,Account__c,Port__c,Partial_CIA__c FROM STEM__c WHERE Id=:stemId];
        Id partyId=direction=='Buy'?supplierId:stem.Account__c;
        if (partyId==null) throw new AuraHandledException('The document counterparty is required.');
        String key='STEM:'+stemId+':'+stem.Port__c+':'+direction+':'+partyId;
        String selected=lineIds==null?'':' AND Id IN :lineIds';
        String lineageField=direction=='Sell'?'Reissue_Of_Buyer_Invoice__c':'Reissue_Of_Supplier_Invoice__c';
        List<SObject> rows=new List<SObject>();
        rows.addAll(Database.query('SELECT Id,Partial_CIA__c,Product__r.Name,Unit_of_Measure__c,Quantity__c,Quantity_Delivered_Per_BDN__c,Unit_Buy_At__c,Unit_Sell_At__c,Total_Price__c,Total_Cost__c,'+fxFields(direction)+','+lineageField+' FROM STEM_Line_Item__c WHERE STEM__c=:stemId AND Cancelled__c=false'+(direction=='Buy'?' AND Original_Supplier__c=:partyId':'')+selected+' ORDER BY Id'));
        rows.addAll(Database.query('SELECT Id,Product2Id__r.Name,Unit_of_Measure__c,Quantity__c,Quantity_Delivered_Per_BDN__c,Unit_Cost__c,Unit_Price__c,Minimum_Buy_At__c,Minimum_Sell_At__c,Lumpsum_Cost__c,Lumpsum_Price__c,Line_Total__c,Line_Total_Buy__c,Fixed__c,Nundination_Type__c,'+fxFields(direction)+','+lineageField+' FROM STEM_Extra_Cost__c WHERE STEM__c=:stemId AND Cancelled__c=false'+(direction=='Buy'?' AND Supplier__c=:partyId':'')+selected+' ORDER BY Id'));
        if (lineIds!=null && new Set<Id>(lineIds).size()!=rows.size()) throw new AuraHandledException('Every document line must belong to this trading side.');
        if (rows.isEmpty()) throw new AuraHandledException('Select the document lines.');
        // Only the exact canonical snapshot is privileged; selected business rows were sharing-checked above.
        List<Trade_Currency_Side__c> sides=FcosTradeEvidenceStore.sidesByKeys(new Set<String>{key},false);
        Trade_Currency_Side__c side=sides.isEmpty()?null:sides[0];
        Set<Id> originals=new Set<Id>();
        for (SObject row : rows) if (row.get(lineageField)!=null) originals.add((Id)row.get(lineageField));
        if (legacyController && (side!=null || !originals.isEmpty())
                && !FeatureManagement.checkPermission('Fcos_Trading_FX_Entry')) {
            throw new AuraHandledException('This document requires the Trading FX permission.');
        }
        if (legacyController && side==null && originals.isEmpty()) return legacyUsdReview(rows,direction,legacySupplierReceipt);
        DocumentReview result=new DocumentReview(); result.currencyCode=side==null?'USD':side.Currency__c;
        if (side!=null) { result.sideId=side.Id;result.rate=side.FX_Rate__c;result.rateId=side.FX_Revision__c;result.confirmedAt=side.Confirmed_At__c; }

        if (result.currencyCode=='HKD') {
            requireReconciledPrepayments(stemId,direction,partyId);
            if(!hasReviewedDepositTerms && direction=='Sell' && stem.Partial_CIA__c==true) throw new AuraHandledException('Review the native cash-in-advance terms before generating an HKD document.');
            if(!hasReviewedDepositTerms && direction=='Buy') for(SObject row:rows) if(row.getSObjectType()==STEM_Line_Item__c.SObjectType && row.get('Partial_CIA__c')==true) throw new AuraHandledException('Review this supplier side native cash-in-advance terms before generating an HKD document.');
            FcosTradeCurrencyService.Review confirmation=FcosTradeCurrencyService.review(rows[0].Id,direction,null);
            if (confirmation.needsConfirmation || result.confirmedAt==null || result.rate==null || result.rate<=0 || String.isBlank(result.rateId)) throw new AuraHandledException('Confirm the current native prices before generating this document.');
        }
        else if(side!=null) {
            FcosTradeCurrencyService.Review confirmation=FcosTradeCurrencyService.review(rows[0].Id,direction,null);
            if(confirmation.needsConfirmation || result.confirmedAt==null) throw new AuraHandledException('Confirm the current USD prices before generating this managed document.');
        }
        if(originals.size()>1) throw new AuraHandledException('Reissue each original invoice separately.');
        Map<Id,Id> originalLineBySource=new Map<Id,Id>();
        if(!originals.isEmpty()) {
            result.reissueOfId=new List<Id>(originals)[0];
            FcosTradeCurrencyService.Review confirmedReissue=FcosTradeCurrencyService.review(rows[0].Id,direction,null);
            if(confirmedReissue.needsConfirmation || result.confirmedAt==null) throw new AuraHandledException('Confirm the amended trading side before reissuing its invoice.');
            originalLineBySource=FcosTradeDocumentLineService.originalLineIdsBySourceForAuthorizedDocuments(originals);
        }
        Decimal nativeTotal=0,usdTotal=0;
        String p=direction+'_';
        for (SObject row:rows) {
            Boolean fuel=row.getSObjectType()==STEM_Line_Item__c.SObjectType;
            String rowCurrency=(String)row.get(p+'Currency__c'); if(String.isBlank(rowCurrency)) rowCurrency='USD';
            if (rowCurrency!=result.currencyCode) throw new AuraHandledException('Document lines cannot combine HKD and USD.');
            if (side!=null && (row.get(p+'FX_Side__c')!=result.sideId || row.get(p+'FX_Rate__c')!=result.rate || row.get(p+'FX_Revision__c')!=result.rateId)) throw new AuraHandledException('Document lines must use their confirmed side evidence.');
            Line line=new Line();line.id=row.Id;
            if(row.get(lineageField)!=null) {line.originalLineId=originalLineBySource.get(row.Id);if(line.originalLineId==null) throw new AuraHandledException('Original document line evidence is required for reissue.');}
            SObject product=row.getSObject(fuel?'Product__r':'Product2Id__r');line.name=product==null?'Charge':(String)product.get('Name');line.unit=(String)row.get('Unit_of_Measure__c');
            Decimal delivered=(Decimal)row.get('Quantity_Delivered_Per_BDN__c');line.quantity=delivered==null || (fuel && delivered==0)?value(row,'Quantity__c'):delivered;
            line.usdAmount=value(row,fuel?(direction=='Buy'?'Total_Cost__c':'Total_Price__c'):(direction=='Buy'?'Line_Total_Buy__c':'Line_Total__c'));
            line.nativeUnitPrice=rowCurrency=='HKD'?value(row,p+'HKD_Unit_Price__c'):FcosTradeCurrencyService.usdUnitPrice(row,direction,fuel?(direction=='Buy'?'Unit_Buy_At__c':'Unit_Sell_At__c'):(direction=='Buy'?'Unit_Cost__c':'Unit_Price__c'));
            line.nativeMinimum = rowCurrency=='HKD' ? (Decimal)row.get(p+'HKD_Minimum__c') : fuel?null:(Decimal)row.get(direction=='Buy'?'Minimum_Buy_At__c':'Minimum_Sell_At__c');
            line.nativeLumpsum = rowCurrency=='HKD' ? (Decimal)row.get(p+'HKD_Lumpsum__c') : fuel?null:(Decimal)row.get(direction=='Buy'?'Lumpsum_Cost__c':'Lumpsum_Price__c');
            line.pricingMode='Unit';
            if (rowCurrency=='USD') {
                line.nativeAmount=line.usdAmount;
                if(!fuel) {
                    if((direction=='Buy' && row.get('Nundination_Type__c')=='Sell') || (direction=='Sell' && row.get('Nundination_Type__c')=='Buy')) line.pricingMode='Excluded';
                    else if(row.get('Fixed__c')==true) line.pricingMode='Lumpsum';
                    else if(line.nativeMinimum!=null && line.nativeMinimum>line.quantity*line.nativeUnitPrice) line.pricingMode='Minimum';
                }
            }
            else if (fuel) line.nativeAmount=line.quantity*line.nativeUnitPrice;
            else if ((direction=='Buy' && row.get('Nundination_Type__c')=='Sell') || (direction=='Sell' && row.get('Nundination_Type__c')=='Buy')) {line.nativeAmount=0;line.pricingMode='Excluded';}
            else if (row.get('Fixed__c')==true) {line.nativeAmount=value(row,p+'HKD_Lumpsum__c');line.pricingMode='Lumpsum';}
            else { line.nativeAmount=line.quantity*line.nativeUnitPrice;Decimal minimum=(Decimal)row.get(p+'HKD_Minimum__c');if(minimum!=null && minimum>line.nativeAmount) {line.nativeAmount=minimum;line.pricingMode='Minimum';} }
            nativeTotal+=line.nativeAmount;usdTotal+=line.usdAmount;result.lines.add(line);
        }
        result.nativeTotal=nativeTotal.setScale(2,RoundingMode.HALF_UP);
        result.usdTotal=result.currencyCode=='HKD'?(result.nativeTotal/result.rate).setScale(2,RoundingMode.HALF_UP):usdTotal.setScale(2,RoundingMode.HALF_UP);
        result.fingerprint=EncodingUtil.convertToHex(Crypto.generateDigest('SHA-256',Blob.valueOf(JSON.serialize(result))));
        return result;
    }

    private static DocumentReview legacyUsdReview(List<SObject> rows,String direction,Boolean supplierReceipt) {
        // Existing screens use their own USD inputs. The supplier form also compares
        // the amount and source revisions it reviewed before saving.
        DocumentReview result=new DocumentReview();
        result.currencyCode='USD';
        Set<Id> fuelIds=new Set<Id>(), chargeIds=new Set<Id>();
        for (SObject row : rows) {
            String rowCurrency=(String)row.get(direction+'_Currency__c');
            if ((String.isNotBlank(rowCurrency) && rowCurrency!='USD') || row.get(direction+'_FX_Side__c')!=null
                    || row.get(direction+'_FX_Rate__c')!=null || row.get(direction+'_FX_Revision__c')!=null) {
                throw new AuraHandledException('The selected lines require their reviewed Trading FX evidence.');
            }
            if (row.getSObjectType()==STEM_Line_Item__c.SObjectType) fuelIds.add(row.Id);
            else chargeIds.add(row.Id);
        }
        List<SObject> visibleRows=new List<SObject>();
        String fuelFields=supplierReceipt?'Id,Total_Cost__c,SystemModstamp':'Id';
        String chargeFields=supplierReceipt?'Id,Line_Total_Buy__c,SystemModstamp':'Id';
        if (!fuelIds.isEmpty()) {
            visibleRows.addAll(Database.query('SELECT '+fuelFields+' FROM STEM_Line_Item__c WHERE Id IN :fuelIds WITH USER_MODE'));
        }
        if (!chargeIds.isEmpty()) {
            visibleRows.addAll(Database.query('SELECT '+chargeFields+' FROM STEM_Extra_Cost__c WHERE Id IN :chargeIds WITH USER_MODE'));
        }
        if (visibleRows.size()!=rows.size()) throw new AuraHandledException('The selected document lines must be readable.');
        if (supplierReceipt) {
            Decimal total=0;
            List<String> evidence=new List<String>();
            for (SObject row : visibleRows) {
                Decimal amount=value(row,fuelIds.contains(row.Id)?'Total_Cost__c':'Line_Total_Buy__c');
                total+=amount;
                evidence.add(row.Id+':'+amount+':'+String.valueOf(row.get('SystemModstamp')));
            }
            evidence.sort();
            result.usdTotal=total.setScale(2,RoundingMode.HALF_UP);
            result.fingerprint=EncodingUtil.convertToHex(Crypto.generateDigest('SHA-256',Blob.valueOf(String.join(evidence,'|'))));
        }
        return result;
    }

    @AuraEnabled
    public static DocumentReview nomination(Id nominationId) {
        return nominationInternal(nominationId,false);
    }

    public static DocumentReview nominationForLegacyController(Id nominationId) {
        return nominationInternal(nominationId,true);
    }

    private static DocumentReview nominationInternal(Id nominationId,Boolean legacyController) {
        Nomination__c nomination=[SELECT Id,STEM__c,Account__c,RecordTypeId,Payment_Term__c FROM Nomination__c WHERE Id=:nominationId];
        Boolean buyer=nomination.RecordTypeId==FCBStatic.NOMINATION_BUYER_RT_IT;
        if (legacyController && !buyer && nomination.RecordTypeId!=FCBStatic.NOMINATION_SUPPLIER_RT_IT) {
            throw new AuraHandledException('Select a buyer confirmation or supplier nomination.');
        }
        List<Id> selected;
        if (!buyer) {
            selected=new List<Id>();
            for (STEM_Line_Item__c line:[SELECT Id FROM STEM_Line_Item__c WHERE STEM__c=:nomination.STEM__c AND Original_Supplier__c=:nomination.Account__c AND Payment_Term__c=:nomination.Payment_Term__c AND Cancelled__c=false]) selected.add(line.Id);
            for (STEM_Extra_Cost__c line:[SELECT Id FROM STEM_Extra_Cost__c WHERE STEM__c=:nomination.STEM__c AND Supplier__c=:nomination.Account__c AND Payment_Term__c=:nomination.Payment_Term__c AND Cancelled__c=false]) selected.add(line.Id);
        }
        return previewInternal(nomination.STEM__c,buyer?'Sell':'Buy',buyer?null:nomination.Account__c,selected,false,legacyController,false);
    }
    @AuraEnabled
    public static Id recordSupplierInvoice(Id stemId,Id supplierId,List<Id> lineIds,String reviewedFxFingerprint,Map<String,Object> invoiceFields) {
        if(!FcosCompanyFxRateService.enabled() || !FeatureManagement.checkPermission('Fcos_Trading_FX_Entry')) throw new AuraHandledException('HKD supplier invoice entry is not enabled.');
        if(lineIds==null || lineIds.isEmpty()) throw new AuraHandledException('Select the supplier invoice lines.');
        STEM__c locked=[SELECT Id FROM STEM__c WHERE Id=:stemId FOR UPDATE];
        DocumentReview review=preview(stemId,'Buy',supplierId,lineIds);
        if((review.currencyCode!='HKD' && !(review.currencyCode=='USD' && review.sideId!=null && review.confirmedAt!=null)) || String.isBlank(reviewedFxFingerprint) || review.fingerprint!=reviewedFxFingerprint) throw new AuraHandledException('Review the current native invoice totals and confirmed rate before saving.');
        List<STEM_Line_Item__c> fuel=[SELECT Id,STEM__c,Original_Supplier__c,Supplier_Invoice__c,Payment_Term__c FROM STEM_Line_Item__c WHERE Id IN:lineIds];
        List<STEM_Extra_Cost__c> extras=[SELECT Id,STEM__c,Supplier__c,Supplier_Invoice__c,Payment_Term__c FROM STEM_Extra_Cost__c WHERE Id IN:lineIds];
        Set<String> terms=new Set<String>();
        for(STEM_Line_Item__c line:fuel) { if(line.Supplier_Invoice__c!=null) throw new AuraHandledException('An invoiced line requires credit and reissue.');terms.add(line.Payment_Term__c); }
        for(STEM_Extra_Cost__c line:extras) { if(line.Supplier_Invoice__c!=null) throw new AuraHandledException('An invoiced charge requires credit and reissue.');terms.add(line.Payment_Term__c); }
        if(terms.size()!=1 || terms.contains(null)) throw new AuraHandledException('Select lines with one supplier payment term.');
        Supplier_Invoice__c invoice=new Supplier_Invoice__c(STEM__c=stemId,Supplier__c=supplierId,Invoice_Amount__c=review.usdTotal,Payment_Term__c=new List<String>(terms)[0]);
        Map<String,Schema.SObjectField> metadata=Supplier_Invoice__c.SObjectType.getDescribe().fields.getMap();
        for(String field:new List<String>{'Name','Bank_Details__c','FCBS_Reference__c','Supplier_Delivery_Date__c','Invoice_Date__c','Partial_CIA__c','Partial_Amount__c','Partial_Invoice_Due_Date__c'}) {
            if(invoiceFields!=null && invoiceFields.containsKey(field)) {
                Object value=invoiceFields.get(field);
                if(value!=null && metadata.get(field).getDescribe().getType()==Schema.DisplayType.Date) value=Date.valueOf(String.valueOf(value));
                invoice.put(field,value);
            }
        }
        if(String.isBlank(invoice.Name) || invoice.Invoice_Date__c==null || invoice.Supplier_Delivery_Date__c==null) throw new AuraHandledException('Enter the supplier invoice reference, invoice date and delivery date.');
        if(invoice.Partial_CIA__c==true) throw new AuraHandledException('Reconcile the existing Partial CIA deposit in native currency before issuing this HKD invoice.');
        invoice.Document_Presentation_JSON__c=FcosNativeCreditController.captureSupplierPresentation(stemId,supplierId);
        applySnapshot(invoice,review);insert invoice;FcosTradeDocumentLineService.persist(invoice,review);
        for(STEM_Line_Item__c line:fuel) { line.Supplier_Invoice__c=invoice.Id;line.Supplier_Input__c='🟢';line.Supplier_Issued__c=true; }
        for(STEM_Extra_Cost__c line:extras) { line.Supplier_Invoice__c=invoice.Id;line.Supplier_Input__c='🟢';line.Supplier_Issued__c=true; }
        if(!fuel.isEmpty()) update fuel;if(!extras.isEmpty()) update extras;
        return invoice.Id;
    }
    public static void applySnapshot(SObject document,DocumentReview review) {
        Map<String,Schema.SObjectField> documentFields=document.getSObjectType().getDescribe().fields.getMap();
        // Supplier Proforma__c has an org default. Canonicalize it before the
        // authorization digest so the before-insert value is byte-equivalent.
        if(documentFields.containsKey('Proforma__c') && document.get('Proforma__c')==null) document.put('Proforma__c',false);
        if ((review.currencyCode=='HKD' || review.reissueOfId!=null || isManagedDocument(document)) && document.getSObjectType().getDescribe().fields.getMap().containsKey('CurrencyIsoCode')) document.put('CurrencyIsoCode','USD');
        if(review.reissueOfId!=null) {
            String lineage=document.getSObjectType()==Invoice__c.SObjectType?'Reissue_Of_Invoice__c':document.getSObjectType()==Supplier_Invoice__c.SObjectType?'Reissue_Of_Supplier_Invoice__c':null;
            if(lineage!=null) document.put(lineage,review.reissueOfId);
        }
        document.put('Document_Currency__c',review.currencyCode);
        document.put('Document_HKD_Amount__c',review.currencyCode=='HKD'?review.nativeTotal:null);
        document.put('Document_FX_Rate__c',review.rate);document.put('Document_FX_Revision__c',review.rateId);
        document.put('Document_FX_Confirmed_At__c',review.confirmedAt);document.put('Document_FX_Side__c',review.sideId);
        document.put('Document_FX_Fingerprint__c',review.fingerprint);
        authorizedSnapshots.put(snapshotKey(document),snapshotDigest(document));

    }
}
