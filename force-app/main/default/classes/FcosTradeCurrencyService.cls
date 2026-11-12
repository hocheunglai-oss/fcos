/** Side-level currencyCode consistency. All snapshot changes pass through a reviewed server action. */
public with sharing class FcosTradeCurrencyService {
    public class TradeFxException extends Exception {}
    @TestVisible private static Boolean managedWrite = false;
    private static final Set<String> TYPES = new Set<String>{'Supplier_Bid__c','Supplier_Bid_Extra_Cost__c','QuoteLineItem','STEM_Line_Item__c','STEM_Extra_Cost__c'};
    public class Context {
        public SObject row;
        public String objectName;
        public String scopeType;
        public Id scopeId;
        public Id partyId;
        public Id portId;
        public String portName;
        public String portCountry;
        public String direction;
        public String key;
        public String priceField;
        public Boolean formulaPrice = false;
    }
    public class Review {
        @AuraEnabled public Boolean enabled;
        @AuraEnabled public String currencyCode;
        @AuraEnabled public String direction;
        @AuraEnabled public String fingerprint;
        @AuraEnabled public Decimal nativeUnitPrice;
        @AuraEnabled public Decimal usdUnitPrice;
        @AuraEnabled public Decimal rate;
        @AuraEnabled public String rateId;
        @AuraEnabled public Datetime confirmedAt;
        @AuraEnabled public Boolean hongKong;
        @AuraEnabled public Boolean needsConfirmation;
    }
    private static String prefix(String direction) {
        if (direction != 'Buy' && direction != 'Sell') throw new TradeFxException('Choose the buyer or supplier side.');
        return direction + '_';
    }
    private static String fields(String direction) {
        String p = prefix(direction);
        return p+'USD_Unit_Price_Precise__c,'+p+'Currency__c,'+p+'HKD_Unit_Price__c,'+p+'HKD_Minimum__c,'+p+'HKD_Lumpsum__c,'+p+'FX_Rate__c,'+p+'FX_Revision__c,'+p+'FX_Confirmed_At__c,'+p+'FX_Side__c';
    }
    public static Context context(Id recordId, String direction) {
        prefix(direction);
        String objectName = recordId.getSObjectType().getDescribe().getName();
        if (!TYPES.contains(objectName) || ((objectName == 'Supplier_Bid__c' || objectName == 'Supplier_Bid_Extra_Cost__c') && direction != 'Buy')) throw new TradeFxException('This record does not support this trading side.');
        String selectFields = 'Id,'+fields(direction);
        if (objectName == 'Supplier_Bid__c') selectFields += ',Supplier__c,Port__c,Port__r.Name,Port__r.Country__c,Supplier_Unit_Price__c';
        else if(objectName=='Supplier_Bid_Extra_Cost__c') selectFields+=',Supplier_Bid__c,Quote__c,Supplier__c,Port__c,Port__r.Name,Port__r.Country__c,Unit_Cost__c,Minimum__c,Lumpsum_Cost__c';
        else if (objectName == 'QuoteLineItem') selectFields += ',QuoteId,Quote.Quote_Buyer__c,Supplier__c,Port__c,Port__r.Name,Port__r.Country__c,UnitPrice,Supplier_Unit_Price__c';
        else if (objectName == 'STEM_Line_Item__c') selectFields += ',STEM__c,STEM__r.Account__c,STEM__r.Port__c,STEM__r.Port__r.Name,STEM__r.Port__r.Country__c,Original_Supplier__c,Unit_Buy_At__c,Unit_Sell_At__c,Master_Contract_Source__c,Buyer_Invoice__c,Supplier_Invoice__c';
        else selectFields += ',STEM__c,STEM__r.Account__c,STEM__r.Port__c,STEM__r.Port__r.Name,STEM__r.Port__r.Country__c,Supplier__c,Unit_Cost__c,Unit_Price__c,Buyer_Invoice__c,Supplier_Invoice__c';
        Boolean stemHasPrincipal = objectName.startsWith('STEM_') && STEM__c.SObjectType.getDescribe().fields.getMap().containsKey('CurrencyIsoCode');
        if(stemHasPrincipal) selectFields += ',STEM__r.CurrencyIsoCode';
        if(objectName=='QuoteLineItem' && Quote.SObjectType.getDescribe().fields.getMap().containsKey('CurrencyIsoCode')) selectFields+=',Quote.CurrencyIsoCode';
        List<SObject> records = Database.query('SELECT '+selectFields+' FROM '+objectName+' WHERE Id = :recordId');
        if (records.isEmpty()) throw new TradeFxException('The trading record is unavailable.');
        Context ctx = new Context(); ctx.row = records[0]; ctx.objectName = objectName; ctx.direction = direction;
        if (objectName.startsWith('STEM_')) {
            ctx.scopeType = 'STEM'; ctx.scopeId = (Id)ctx.row.get('STEM__c');
            SObject stem = ctx.row.getSObject('STEM__r');
            ctx.partyId = direction == 'Sell' ? (Id)stem.get('Account__c') : (Id)ctx.row.get(objectName == 'STEM_Line_Item__c' ? 'Original_Supplier__c' : 'Supplier__c');
            ctx.portId = (Id)stem.get('Port__c');
            ctx.portName = stem.getSObject('Port__r') == null ? '' : (String)stem.getSObject('Port__r').get('Name');
            ctx.portCountry = stem.getSObject('Port__r') == null ? '' : (String)stem.getSObject('Port__r').get('Country__c');
            ctx.priceField = objectName == 'STEM_Line_Item__c' ? (direction == 'Buy' ? 'Unit_Buy_At__c' : 'Unit_Sell_At__c') : (direction == 'Buy' ? 'Unit_Cost__c' : 'Unit_Price__c');
            ctx.formulaPrice = objectName == 'STEM_Line_Item__c' && ctx.row.get('Master_Contract_Source__c') == true;
            if(stemHasPrincipal && stem.get('CurrencyIsoCode') != 'USD') throw new TradeFxException('The STEM principal currency must be USD before managed trading can be recorded.');
        } else {
            ctx.scopeType = objectName == 'Supplier_Bid__c' || objectName=='Supplier_Bid_Extra_Cost__c' ? 'Bid' : 'Offer';
            ctx.scopeId = objectName == 'Supplier_Bid__c' ? recordId : objectName=='Supplier_Bid_Extra_Cost__c' ? (Id)ctx.row.get('Supplier_Bid__c') : (Id)ctx.row.get('QuoteId');
            ctx.partyId = direction == 'Buy' ? (Id)ctx.row.get('Supplier__c') : (Id)ctx.row.getSObject('Quote').get('Quote_Buyer__c');
            ctx.portId = (Id)ctx.row.get('Port__c');
            ctx.portName = ctx.row.getSObject('Port__r') == null ? '' : (String)ctx.row.getSObject('Port__r').get('Name');
            ctx.portCountry = ctx.row.getSObject('Port__r') == null ? '' : (String)ctx.row.getSObject('Port__r').get('Country__c');
            ctx.priceField = objectName=='Supplier_Bid_Extra_Cost__c' ? 'Unit_Cost__c' : direction == 'Buy' ? 'Supplier_Unit_Price__c' : 'UnitPrice';
        }
        if(objectName=='QuoteLineItem' && Quote.SObjectType.getDescribe().fields.getMap().containsKey('CurrencyIsoCode') && ctx.row.getSObject('Quote').get('CurrencyIsoCode')!='USD') throw new TradeFxException('The Offer principal currency must be USD before native HKD trading can be recorded.');
        if (ctx.scopeId == null || ctx.partyId == null || ctx.portId == null) throw new TradeFxException('Set the delivery port and trading counterparty first.');
        ctx.key = ctx.scopeType + ':' + ctx.scopeId + ':' + ctx.portId + ':' + direction + ':' + ctx.partyId;
        return ctx;
    }
    public static Boolean hongKong(String portName) {
        return portName != null && (portName.trim().toLowerCase() == 'hong kong' || portName.trim().toLowerCase() == 'hk');
    }
    private static Trade_Currency_Side__c side(Context ctx, Boolean lockRecord) {
        String sideKey = ctx.key;
        List<Trade_Currency_Side__c> rows = FcosTradeEvidenceStore.sidesByKeys(new Set<String>{sideKey},lockRecord);
        return rows.isEmpty() ? null : rows[0];
    }
    public static Boolean hongKong(String portName,String country) {
        return hongKong(portName) || hongKong(country);
    }
    private static Decimal amount(SObject row, String field) { return row.get(field) == null ? 0 : (Decimal)row.get(field); }
    public static Decimal usdUnitPrice(SObject row,String direction,String legacyField) {
        Decimal precise=(Decimal)row.get(direction+'_USD_Unit_Price_Precise__c');
        return precise==null?amount(row,legacyField):precise;
    }
    public static Review review(Id recordId, String direction, FcosCompanyFxRateService.Snapshot currentRate) {
        Context ctx = context(recordId, direction);
        Trade_Currency_Side__c leg = side(ctx, false);
        String p = prefix(direction);
        Review result = new Review(); result.enabled = FcosCompanyFxRateService.enabled(); result.direction = direction;
        result.currencyCode = leg == null ? (String)ctx.row.get(p+'Currency__c') : leg.Currency__c;
        if (String.isBlank(result.currencyCode)) result.currencyCode = 'USD';
        result.confirmedAt = leg == null ? null : leg.Confirmed_At__c;
        result.hongKong = hongKong(ctx.portName,ctx.portCountry) && !ctx.formulaPrice;
        result.rate = result.confirmedAt != null ? leg.FX_Rate__c : currentRate == null ? null : currentRate.usdHkdRate;
        result.rateId = result.confirmedAt != null ? leg.FX_Revision__c : currentRate == null ? null : currentRate.rateId;
        result.usdUnitPrice = usdUnitPrice(ctx.row,direction,ctx.priceField);
        result.nativeUnitPrice = result.currencyCode == 'HKD' ? amount(ctx.row,p+'HKD_Unit_Price__c') : result.usdUnitPrice;
        if (result.currencyCode == 'HKD' && result.rate != null && result.rate > 0) result.usdUnitPrice=result.nativeUnitPrice/result.rate;
        result.fingerprint = fingerprint(ctx, leg, result.rateId);
        result.needsConfirmation = result.confirmedAt == null || leg.Review_Fingerprint__c != result.fingerprint;
        return result;
    }
    private static String fingerprint(Context ctx, Trade_Currency_Side__c leg, String rateId) {
        List<SObject> rows = sideRows(ctx);
        List<String> values = new List<String>{ctx.key, leg != null && leg.Currency__c=='HKD' ? rateId : null, leg == null ? 'USD' : leg.Currency__c, leg == null ? '1' : String.valueOf(leg.Version__c)};
        for (SObject row : rows) {
            Map<String,Object> financial = row.getPopulatedFieldsAsMap().clone();
            financial.remove('Buyer_Invoice__c'); financial.remove('Supplier_Invoice__c');
            // Counterparty prices do not invalidate this side's independent confirmation.
            for (String opposite : ctx.direction == 'Buy'
                ? new List<String>{'UnitPrice','Unit_Sell_At__c','Unit_Price__c','Minimum_Sell_At__c','Lumpsum_Price__c','Lumpsum_Sell_At__c'}
                : new List<String>{'Supplier_Unit_Price__c','Unit_Buy_At__c','Unit_Cost__c','Minimum_Buy_At__c','Lumpsum_Cost__c','Lumpsum_Buy_At__c'}) financial.remove(opposite);
            List<String> keys=new List<String>(financial.keySet());keys.sort();
            for(String field:keys) values.add(field+'='+JSON.serialize(financial.get(field)));
        }
        return EncodingUtil.convertToHex(Crypto.generateDigest('SHA-256', Blob.valueOf(String.join(values,'|'))));
    }
    private static List<SObject> sideRows(Context ctx) {
        Id scopeId = ctx.scopeId, partyId = ctx.partyId, portId = ctx.portId;
        String p = prefix(ctx.direction);
        List<SObject> rows = new List<SObject>();
        if (ctx.scopeType == 'Bid') {
            rows.addAll(Database.query('SELECT Id,'+fields(ctx.direction)+',Supplier_Unit_Price__c FROM Supplier_Bid__c WHERE Id = :scopeId ORDER BY Id'));
            rows.addAll(Database.query('SELECT Id,'+fields(ctx.direction)+',Unit_Cost__c,Minimum__c,Lumpsum_Cost__c,Quantity__c,Fixed__c,Unit_of_Measure__c FROM Supplier_Bid_Extra_Cost__c WHERE Supplier_Bid__c=:scopeId ORDER BY Id'));
        } else if (ctx.scopeType == 'Offer') {
            rows.addAll(Database.query('SELECT Id,'+fields(ctx.direction)+',Quantity,UnitPrice,Supplier_Unit_Price__c,Minimum_Buy_At__c,Minimum_Sell_At__c,Lumpsum_Buy_At__c,Lumpsum_Sell_At__c FROM QuoteLineItem WHERE QuoteId = :scopeId AND Port__c = :portId'+(ctx.direction == 'Buy' ? ' AND Supplier__c = :partyId' : '')+' ORDER BY Id'));
        } else {
            rows.addAll(Database.query('SELECT Id,'+fields(ctx.direction)+',Quantity__c,Quantity_Delivered_Per_BDN__c,Unit_of_Measure__c,Unit_Buy_At__c,Unit_Sell_At__c,Buyer_Invoice__c,Supplier_Invoice__c,Master_Contract_Source__c FROM STEM_Line_Item__c WHERE STEM__c = :scopeId AND Cancelled__c = false'+(ctx.direction == 'Buy' ? ' AND Original_Supplier__c = :partyId' : '')+' ORDER BY Id'));
            rows.addAll(Database.query('SELECT Id,'+fields(ctx.direction)+',Quantity__c,Quantity_Delivered_Per_BDN__c,Unit_of_Measure__c,Fixed__c,Nundination_Type__c,Unit_Cost__c,Unit_Price__c,Minimum_Buy_At__c,Minimum_Sell_At__c,Lumpsum_Cost__c,Lumpsum_Price__c,Buyer_Invoice__c,Supplier_Invoice__c FROM STEM_Extra_Cost__c WHERE STEM__c = :scopeId AND Cancelled__c = false'+(ctx.direction == 'Buy' ? ' AND Supplier__c = :partyId' : '')+' ORDER BY Id'));
        }
        return rows;
    }
    private static String priceField(SObject row, String direction) {
        String name = row.getSObjectType().getDescribe().getName();
        if (name == 'STEM_Line_Item__c') return direction == 'Buy' ? 'Unit_Buy_At__c' : 'Unit_Sell_At__c';
        if(name=='Supplier_Bid_Extra_Cost__c') return 'Unit_Cost__c';
        if (name == 'STEM_Extra_Cost__c') return direction == 'Buy' ? 'Unit_Cost__c' : 'Unit_Price__c';
        return direction == 'Buy' ? 'Supplier_Unit_Price__c' : 'UnitPrice';
    }
    public static Review save(Id recordId, String direction, String currencyCode, Decimal nativeUnitPrice, String reviewedFingerprint, FcosCompanyFxRateService.Snapshot currentRate, Boolean confirmSide) {
        return saveReviewed(recordId,direction,currencyCode,nativeUnitPrice,reviewedFingerprint,currentRate,confirmSide,null);
    }
    public static Review amend(Id recordId,String direction,String currencyCode,Decimal nativeUnitPrice,String reviewedFingerprint,FcosCompanyFxRateService.Snapshot currentRate,String reason) {
        if (!FeatureManagement.checkPermission('Fcos_Trading_FX_Amend') || String.isBlank(reason) || reason.trim().length()<5) throw new TradeFxException('An authorized amendment and specific reason are required.');
        return saveReviewed(recordId,direction,currencyCode,nativeUnitPrice,reviewedFingerprint,currentRate,false,reason.trim());
    }
    private static Review saveReviewed(Id recordId, String direction, String currencyCode, Decimal nativeUnitPrice, String reviewedFingerprint, FcosCompanyFxRateService.Snapshot currentRate, Boolean confirmSide,String amendmentReason) {
        if (!FcosCompanyFxRateService.enabled() || !FeatureManagement.checkPermission('Fcos_Trading_FX_Entry')) throw new TradeFxException('HKD trading entry is not enabled for this user.');
        if (currencyCode != 'USD' && currencyCode != 'HKD') throw new TradeFxException('Choose USD or HKD.');
        if (nativeUnitPrice == null || nativeUnitPrice < 0 || nativeUnitPrice!=nativeUnitPrice.setScale(8,RoundingMode.HALF_UP)) throw new TradeFxException('Enter a non-negative trading price with at most eight decimal places.');
        Context ctx = context(recordId, direction);
        if (currencyCode == 'HKD' && (!hongKong(ctx.portName,ctx.portCountry) || ctx.formulaPrice)) throw new TradeFxException('HKD is available only for fixed-price Hong Kong deliveries.');
        // Serialize all side edits under the same parent, including creation of a previously absent side.
        Id scopeId = ctx.scopeId;
        Database.query('SELECT Id FROM '+scopeId.getSObjectType().getDescribe().getName()+' WHERE Id = :scopeId FOR UPDATE');
        Trade_Currency_Side__c leg = side(ctx, true);
        String reviewedRateId = leg != null && leg.Confirmed_At__c != null ? leg.FX_Revision__c : currentRate == null ? null : currentRate.rateId;
        if (String.isBlank(reviewedFingerprint) || fingerprint(ctx,leg,reviewedRateId) != reviewedFingerprint) throw new TradeFxException('Prices, currency, or the company rate changed. Review the side again.');
        if (leg != null && leg.Confirmed_At__c != null && currencyCode != leg.Currency__c && amendmentReason == null) throw new TradeFxException('Changing confirmed currency requires an explicit amendment.');
        if (leg == null) leg = new Trade_Currency_Side__c(External_Key__c=ctx.key,Scope_Id__c=String.valueOf(ctx.scopeId),Scope_Type__c=ctx.scopeType,Party__c=ctx.partyId,Port__c=ctx.portId,Direction__c=direction,Version__c=1);
        Trade_Currency_Side__c previousSide;
        if (amendmentReason != null && leg.Id != null) {
            previousSide=leg;
            leg=new Trade_Currency_Side__c(External_Key__c=ctx.key,Scope_Id__c=String.valueOf(ctx.scopeId),Scope_Type__c=ctx.scopeType,Party__c=ctx.partyId,Port__c=ctx.portId,Direction__c=direction,
                Version__c=previousSide.Version__c+1,Source_Side__c=previousSide.Id,Amendment_Reason__c=amendmentReason);
        }
        Decimal rate = leg.Confirmed_At__c != null ? leg.FX_Rate__c : currentRate == null ? null : currentRate.usdHkdRate;
        if (currencyCode == 'HKD' && (rate == null || rate <= 0)) throw new TradeFxException('The authoritative company rate is unavailable.');
        List<SObject> rows = sideRows(ctx);
        String p = prefix(direction);
        for (SObject row : rows) {
            if (isInvoiced(row,direction)) {
                String oldCurrency=(String)row.get(p+'Currency__c');
                Decimal oldNative=oldCurrency=='HKD'?amount(row,p+'HKD_Unit_Price__c'):usdUnitPrice(row,direction,priceField(row,direction));
                if (amendmentReason!=null || oldCurrency!=currencyCode || (row.Id==recordId && oldNative!=nativeUnitPrice))
                    throw new TradeFxException('Use the credit and reissue workflow for invoiced lines.');
            }
            if (currencyCode == 'HKD' && row.getSObjectType() == STEM_Line_Item__c.SObjectType && row.get('Master_Contract_Source__c') == true) throw new TradeFxException('Formula-linked fuel remains in USD.');
        }
        leg.Currency__c = currencyCode;
        if (leg.Confirmed_At__c == null) {
            leg.FX_Rate__c = currencyCode == 'HKD' ? rate : null;
            leg.FX_Revision__c = currencyCode == 'HKD' ? currentRate.rateId : null;
            leg.FX_Effective_At__c = currencyCode == 'HKD' ? currentRate.effectiveAt : null;
        }
        if (confirmSide && leg.Confirmed_At__c == null) leg.Confirmed_At__c = System.now();
        managedWrite = true;
        try {
            if(previousSide != null) { previousSide.External_Key__c=ctx.key+':v'+String.valueOf(previousSide.Version__c); FcosTradeEvidenceStore.updateSide(previousSide); }
            FcosTradeEvidenceStore.saveSide(leg);
            List<SObject> editableRows=new List<SObject>();
            for (SObject row : rows) {
                if (isInvoiced(row,direction)) continue;
                editableRows.add(row);
                String usdField = priceField(row,direction);
                String oldCurrency = (String)row.get(p+'Currency__c');
                Decimal oldRate = (Decimal)row.get(p+'FX_Rate__c');
                Decimal economicUsd = oldCurrency == 'HKD' && oldRate != null && oldRate > 0 ? amount(row,p+'HKD_Unit_Price__c')/oldRate : usdUnitPrice(row,direction,usdField);
                Decimal nativePrice = row.Id == recordId ? nativeUnitPrice : currencyCode == 'HKD' ? (oldCurrency == 'HKD' ? amount(row,p+'HKD_Unit_Price__c') : economicUsd*rate) : economicUsd;
                if (row.getSObjectType() == STEM_Extra_Cost__c.SObjectType || row.getSObjectType()==Supplier_Bid_Extra_Cost__c.SObjectType || row.getSObjectType()==QuoteLineItem.SObjectType) {
                    Map<String,String> extraFields = row.getSObjectType()==Supplier_Bid_Extra_Cost__c.SObjectType ? new Map<String,String>{'Minimum'=>'Minimum__c','Lumpsum'=>'Lumpsum_Cost__c'} : new Map<String,String>{'Minimum' => direction == 'Buy' ? 'Minimum_Buy_At__c' : 'Minimum_Sell_At__c', 'Lumpsum' => row.getSObjectType()==QuoteLineItem.SObjectType ? (direction=='Buy'?'Lumpsum_Buy_At__c':'Lumpsum_Sell_At__c') : direction == 'Buy' ? 'Lumpsum_Cost__c' : 'Lumpsum_Price__c'};
                    for (String kind : extraFields.keySet()) {
                        String usdExtra = extraFields.get(kind), nativeExtra = p+'HKD_'+kind+'__c';
                        Decimal extraUsd = oldCurrency == 'HKD' && oldRate != null && oldRate > 0 ? (row.get(nativeExtra) == null ? null : (Decimal)row.get(nativeExtra)/oldRate) : (Decimal)row.get(usdExtra);
                        Decimal nativeExtraValue=currencyCode == 'HKD' ? (oldCurrency == 'HKD' ? (Decimal)row.get(nativeExtra) : extraUsd == null ? null : extraUsd*rate) : null;
                        row.put(nativeExtra,nativeExtraValue);
                        row.put(usdExtra,currencyCode == 'HKD' && nativeExtraValue != null ? nativeExtraValue/rate : extraUsd);
                    }
                }
                setUsdPrincipal(row);
                row.put(p+'Currency__c',currencyCode);
                row.put(p+'USD_Unit_Price_Precise__c',currencyCode=='USD'?nativePrice.setScale(8,RoundingMode.HALF_UP):null);
                row.put(p+'HKD_Unit_Price__c', currencyCode == 'HKD' ? nativePrice : null);
                row.put(usdField, currencyCode == 'HKD' ? nativePrice/rate : nativePrice);
                row.put(p+'FX_Rate__c',leg.FX_Rate__c); row.put(p+'FX_Revision__c',leg.FX_Revision__c);
                row.put(p+'FX_Confirmed_At__c',leg.Confirmed_At__c); row.put(p+'FX_Side__c',leg.Id);
            }
            if (!editableRows.isEmpty()) update editableRows;
            if (direction=='Sell' && ctx.scopeType=='STEM') update new STEM__c(Id=ctx.scopeId,Sell_Currency__c=currencyCode,Sell_FX_Side__c=leg.Id);
            else if(direction=='Sell' && ctx.scopeType=='Offer') update new Quote(Id=ctx.scopeId,Sell_Currency__c=currencyCode,Sell_FX_Side__c=leg.Id);
            if (confirmSide) {
                leg.Review_Fingerprint__c = fingerprint(ctx,leg,leg.FX_Revision__c);
                FcosTradeEvidenceStore.updateSide(leg);
            }
        } finally { managedWrite = false; }
        return review(recordId,direction,currentRate);
    }
    private static Boolean isInvoiced(SObject row,String direction) {
        return row.getSObjectType().getDescribe().getName().startsWith('STEM_')
            && row.get(direction=='Buy'?'Supplier_Invoice__c':'Buyer_Invoice__c')!=null;
    }
    // Internal trigger admission only; no Aura/REST exposure and no caller-supplied snapshot API.
    public static Map<String,Trade_Currency_Side__c> persistInheritedSides(List<Trade_Currency_Side__c> sides) {
        Map<String,Trade_Currency_Side__c> persisted=new Map<String,Trade_Currency_Side__c>();
        if (sides==null || sides.isEmpty()) return persisted;
        Boolean previous=managedWrite; managedWrite=true;
        try { FcosTradeEvidenceStore.insertSides(sides); } finally { managedWrite=previous; }
        for(Trade_Currency_Side__c side:sides) persisted.put(side.External_Key__c,side);
        return persisted;
    }
    public static void setUsdPrincipal(SObject row) {
        Schema.SObjectField currencyField=row.getSObjectType().getDescribe().fields.getMap().get('CurrencyIsoCode');
        // QuoteLineItem inherits its read-only principal currency from Quote.
        // Managed custom records are server-stamped regardless of the caller's FLS.
        if(currencyField!=null && row.getSObjectType()!=QuoteLineItem.SObjectType) row.put('CurrencyIsoCode','USD');
    }
    /**
     * Creation-only proof for an HKD proposal. This re-queries the persisted
     * candidate; the marker is guarded on insert and cannot be revived by a
     * client update. It deliberately does not infer currency from old USD rows.
     */
    public static Boolean isInitialAgentHkdDefault(Id recordId, String direction) {
        if (recordId == null || direction != 'Buy' || recordId.getSObjectType() != STEM_Extra_Cost__c.SObjectType) return false;
        List<STEM_Extra_Cost__c> rows = [
            SELECT Id, STEM__c, Supplier__c, Cancelled__c, Buy_Agent_Currency_Pending__c,
                Buy_Currency__c, Buy_USD_Unit_Price_Precise__c, Buy_HKD_Unit_Price__c,
                Buy_HKD_Minimum__c, Buy_HKD_Lumpsum__c, Buy_FX_Rate__c,
                Buy_FX_Revision__c, Buy_FX_Confirmed_At__c, Buy_FX_Side__c,
                STEM__r.Port__c, STEM__r.Port__r.Name,STEM__r.Port__r.Country__c,
                Supplier__r.Is_Agent__c, Supplier__r.Agency_Fee_Currency__c
            FROM STEM_Extra_Cost__c WHERE Id = :recordId LIMIT 1
        ];
        if (rows.isEmpty()) return false;
        STEM_Extra_Cost__c row = rows[0];
        if (row.Buy_Agent_Currency_Pending__c != true || row.Cancelled__c == true
            || row.STEM__c == null || row.Supplier__c == null || row.STEM__r == null
            || !hongKong(row.STEM__r.Port__r == null ? null : row.STEM__r.Port__r.Name,row.STEM__r.Port__r == null ? null : row.STEM__r.Port__r.Country__c)
            || row.Supplier__r == null || row.Supplier__r.Is_Agent__c != true
            || row.Supplier__r.Agency_Fee_Currency__c != 'HKD'
            || hasInitialBuyEvidence(row)) return false;
        String scopeId = String.valueOf(row.STEM__c);
        Id stemId = row.STEM__c, supplierId = row.Supplier__c;
        if (!FcosTradeEvidenceStore.buySidesForScopes(new Set<String>{scopeId},new Set<Id>{supplierId}).isEmpty()) return false;
        if ([SELECT COUNT() FROM STEM_Line_Item__c
             WHERE STEM__c = :stemId AND Original_Supplier__c = :supplierId
               AND Cancelled__c = false] != 0) return false;
        for (STEM_Extra_Cost__c other : [
            SELECT Id, Buy_Agent_Currency_Pending__c, Buy_Currency__c,
                Buy_HKD_Unit_Price__c, Buy_FX_Rate__c, Buy_FX_Revision__c, Buy_FX_Side__c
            FROM STEM_Extra_Cost__c
            WHERE STEM__c = :stemId AND Supplier__c = :supplierId AND Cancelled__c = false AND Id != :recordId
        ]) {
            if (other.Buy_Agent_Currency_Pending__c != true && !hasValidNativeBuyEvidence(other)) return false;
        }
        return true;
    }
    private static Boolean hasValidNativeBuyEvidence(STEM_Extra_Cost__c row) {
        return row.Buy_Currency__c == 'HKD' && row.Buy_HKD_Unit_Price__c != null
            && row.Buy_FX_Rate__c != null && row.Buy_FX_Rate__c > 0
            && !String.isBlank(row.Buy_FX_Revision__c) && row.Buy_FX_Side__c != null;
    }
    private static Boolean hasInitialBuyEvidence(STEM_Extra_Cost__c row) {
        return row.Buy_Currency__c == 'HKD' || row.Buy_USD_Unit_Price_Precise__c != null
            || row.Buy_HKD_Unit_Price__c != null || row.Buy_HKD_Minimum__c != null
            || row.Buy_HKD_Lumpsum__c != null || row.Buy_FX_Rate__c != null
            || !String.isBlank(row.Buy_FX_Revision__c) || row.Buy_FX_Confirmed_At__c != null
            || row.Buy_FX_Side__c != null;
    }
    public static Boolean isManagedWrite() { return managedWrite; }
    public static void guardSideMutation(List<Trade_Currency_Side__c> rows) {
        if (managedWrite) return;
        for (Trade_Currency_Side__c row : rows) row.addError('Use the reviewed trading-currency action to amend or confirm this side.');
    }
}
