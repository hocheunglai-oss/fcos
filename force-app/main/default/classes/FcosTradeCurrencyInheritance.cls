/**
 * Draft-lineage propagation only. This class accepts new rows only, never calls the rate service, and never DMLs a currency side.
 * The caller must authorize side upsert, then pass the persisted sides to apply while using the managed-write guard.
 */
public with sharing class FcosTradeCurrencyInheritance {
    public class Plan {
        public List<Trade_Currency_Side__c> newSides = new List<Trade_Currency_Side__c>();
        public List<RowBinding> rowsToStamp = new List<RowBinding>();
    }
    public class RowBinding {
        public SObject row;
        public Integer rowIndex;
        public String direction;
        public String sideKey;
        public Trade_Currency_Side__c side;
        public SObject source;
        public Boolean isNewSide;
    }
    private class Candidate {
        public SObject row;
        public Integer rowIndex;
        public String direction;
        public Id scopeId;
        public String scopeType;
        public Id partyId;
        public Id portId;
        public SObject source;
        public Id sourcePortId;
        public String key;
        public Boolean principalUsd = true;
    }

    public static Plan prepare(List<SObject> rows, Boolean fxEnabled) {
        if (!fxEnabled || rows == null || rows.isEmpty()) return new Plan();
        Set<Id> bidIds = new Set<Id>(), bidExtraIds = new Set<Id>(), offerIds = new Set<Id>(), quoteIds = new Set<Id>(), stemIds = new Set<Id>();
        for (Integer rowIndex = 0; rowIndex < rows.size(); rowIndex++) {
            SObject row = rows[rowIndex];
            String type = row.getSObjectType().getDescribe().getName();
            if (type == 'QuoteLineItem') {
                if (row.get('Supplier_Bid__c') != null) bidIds.add((Id)row.get('Supplier_Bid__c'));
                if (row.get('Supplier_Bid_Extra_Cost__c') != null) bidExtraIds.add((Id)row.get('Supplier_Bid_Extra_Cost__c'));
                if (row.get('QuoteId') != null) quoteIds.add((Id)row.get('QuoteId'));
            } else if (type == 'Supplier_Bid_Extra_Cost__c') {
                if (row.get('Supplier_Bid__c') != null) bidIds.add((Id)row.get('Supplier_Bid__c'));
            } else if (type == 'STEM_Line_Item__c' || type == 'STEM_Extra_Cost__c') {
                if (row.get('Offer_Line_Item__c') != null) offerIds.add((Id)row.get('Offer_Line_Item__c'));
                if (row.get('STEM__c') != null) stemIds.add((Id)row.get('STEM__c'));
            }
        }
        Map<Id, SObject> parents = new Map<Id, SObject>();
        if (!bidIds.isEmpty()) for (Supplier_Bid__c row : [SELECT Id,Port__c,Supplier__c,
            Buy_Currency__c,Buy_USD_Unit_Price_Precise__c,Buy_HKD_Unit_Price__c,Buy_HKD_Minimum__c,Buy_HKD_Lumpsum__c,
            Buy_FX_Rate__c,Buy_FX_Revision__c,Buy_FX_Confirmed_At__c,Buy_FX_Side__c
            FROM Supplier_Bid__c WHERE Id IN :bidIds]) parents.put(row.Id, row);
        if (!bidExtraIds.isEmpty()) for (Supplier_Bid_Extra_Cost__c row : [SELECT Id,Supplier_Bid__c,Port__c,Supplier__c,
            Buy_Currency__c,Buy_USD_Unit_Price_Precise__c,Buy_HKD_Unit_Price__c,Buy_HKD_Minimum__c,Buy_HKD_Lumpsum__c,
            Buy_FX_Rate__c,Buy_FX_Revision__c,Buy_FX_Confirmed_At__c,Buy_FX_Side__c
            FROM Supplier_Bid_Extra_Cost__c WHERE Id IN :bidExtraIds]) parents.put(row.Id, row);
        if (!offerIds.isEmpty()) for (QuoteLineItem row : [SELECT Id,QuoteId,Port__c,Supplier__c,
            Buy_Currency__c,Buy_USD_Unit_Price_Precise__c,Buy_HKD_Unit_Price__c,Buy_HKD_Minimum__c,Buy_HKD_Lumpsum__c,
            Buy_FX_Rate__c,Buy_FX_Revision__c,Buy_FX_Confirmed_At__c,Buy_FX_Side__c,
            Sell_Currency__c,Sell_USD_Unit_Price_Precise__c,Sell_HKD_Unit_Price__c,Sell_HKD_Minimum__c,Sell_HKD_Lumpsum__c,
            Sell_FX_Rate__c,Sell_FX_Revision__c,Sell_FX_Confirmed_At__c,Sell_FX_Side__c
            FROM QuoteLineItem WHERE Id IN :offerIds]) parents.put(row.Id, row);
        Map<Id, Quote> quotes = new Map<Id, Quote>();
        if (!quoteIds.isEmpty()) {
            for (SObject quoteRow : Database.query('SELECT Id,Quote_Buyer__c' +
                (hasField(Schema.getGlobalDescribe().get('Quote'), 'CurrencyIsoCode') ? ',CurrencyIsoCode' : '') +
                ' FROM Quote WHERE Id IN :quoteIds')) {
                quotes.put((Id)quoteRow.get('Id'), (Quote)quoteRow);
            }
        }
        Map<Id, STEM__c> stems = new Map<Id, STEM__c>();
        if(!stemIds.isEmpty()) for(SObject stem:Database.query('SELECT Id,Account__c,Port__c'
            +(hasField(STEM__c.SObjectType,'CurrencyIsoCode')?',CurrencyIsoCode':'')+' FROM STEM__c WHERE Id IN :stemIds')) {
            stems.put((Id)stem.get('Id'),(STEM__c)stem);
        }
        List<Candidate> candidates = candidates(rows, parents, quotes, stems);
        Set<Id> sourceSideIds = new Set<Id>(), portIds = new Set<Id>();
        for (Candidate candidate : candidates) {
            if (candidate.portId != null) portIds.add(candidate.portId);
            if (candidate.sourcePortId != null) portIds.add(candidate.sourcePortId);
            if (candidate.source != null && candidate.source.get(candidate.direction + '_FX_Side__c') != null) {
                sourceSideIds.add((Id)candidate.source.get(candidate.direction + '_FX_Side__c'));
            }
        }
        // Parent/source rows above remain sharing-scoped. Their visible
        // contexts produce these exact canonical side IDs for verification.
        Map<Id, Trade_Currency_Side__c> sourceSides = new Map<Id, Trade_Currency_Side__c>();
        for (Trade_Currency_Side__c side : FcosTradeEvidenceStore.sidesByIds(sourceSideIds)) sourceSides.put(side.Id,side);
        Set<String> keys = new Set<String>();
        for (Candidate candidate : candidates) if (candidate.key != null) keys.add(candidate.key);
        Map<String, Trade_Currency_Side__c> existingByKey = new Map<String, Trade_Currency_Side__c>();
        for (Trade_Currency_Side__c side : FcosTradeEvidenceStore.sidesByKeys(keys,false)) {
            existingByKey.put(side.External_Key__c, side);
        }
        Map<Id, String> portNames = new Map<Id, String>(), portCountries = new Map<Id, String>();
        if (!portIds.isEmpty()) for (Port__c port : [SELECT Id,Name,Country__c FROM Port__c WHERE Id IN :portIds]) {
            portNames.put(port.Id, port.Name);
            portCountries.put(port.Id, port.Country__c);
        }
        return plan(candidates, sourceSides, existingByKey, portNames, portCountries);
    }

    @TestVisible
    static Plan planForTest(List<SObject> rows, Map<Id, SObject> parents, Map<Id, Quote> quotes, Map<Id, STEM__c> stems,
        Map<Id, Trade_Currency_Side__c> sourceSides, Map<String, Trade_Currency_Side__c> existingByKey, Map<Id, String> portNames) {
        return plan(candidates(rows, parents, quotes, stems), sourceSides, existingByKey, portNames, new Map<Id, String>());
    }

    private static List<Candidate> candidates(List<SObject> rows, Map<Id, SObject> parents, Map<Id, Quote> quotes, Map<Id, STEM__c> stems) {
        List<Candidate> result = new List<Candidate>();
        for (Integer rowIndex = 0; rowIndex < rows.size(); rowIndex++) {
            SObject row = rows[rowIndex];
            // Conversion is admission-only. Existing records retain their historical native evidence unchanged.
            if (row == null || row.Id != null) continue;
            String type = row.getSObjectType().getDescribe().getName();
            if (type == 'QuoteLineItem') {
                Quote quote = quotes.get((Id)row.get('QuoteId'));
                if (!isUsdQuote(quote)) {
                    row.addError('HKD lineage requires a USD-denominated Quote parent.');
                    continue;
                }
                SObject bid = parents.get((Id)row.get('Supplier_Bid__c'));
                SObject bidExtra = parents.get((Id)row.get('Supplier_Bid_Extra_Cost__c'));
                SObject source = bidExtra == null ? bid : bidExtra;
                addCandidate(result, row, rowIndex, 'Buy', (Id)row.get('QuoteId'), 'Offer', (Id)row.get('Supplier__c'),
                    (Id)row.get('Port__c'), source, source == null ? null : (Id)source.get('Port__c'));
                addCandidate(result, row, rowIndex, 'Sell', (Id)row.get('QuoteId'), 'Offer', quote == null ? null : quote.Quote_Buyer__c,
                    (Id)row.get('Port__c'), null, null);
            } else if (type == 'Supplier_Bid_Extra_Cost__c') {
                SObject bid = parents.get((Id)row.get('Supplier_Bid__c'));
                addCandidate(result, row, rowIndex, 'Buy', bid == null ? null : bid.Id, 'Bid',
                    bid == null ? null : (Id)bid.get('Supplier__c'), bid == null ? null : (Id)bid.get('Port__c'),
                    bid, bid == null ? null : (Id)bid.get('Port__c'));
            } else if (type == 'STEM_Line_Item__c' || type == 'STEM_Extra_Cost__c') {
                STEM__c stem = stems.get((Id)row.get('STEM__c'));
                SObject offer = parents.get((Id)row.get('Offer_Line_Item__c'));
                Id supplier = type == 'STEM_Line_Item__c' ? (Id)row.get('Original_Supplier__c') : (Id)row.get('Supplier__c');
                Id portId = stem == null ? null : stem.Port__c;
                Integer firstCandidate = result.size();
                addCandidate(result, row, rowIndex, 'Buy', (Id)row.get('STEM__c'), 'STEM', supplier, portId, offer,
                    offer == null ? null : (Id)offer.get('Port__c'));
                addCandidate(result, row, rowIndex, 'Sell', (Id)row.get('STEM__c'), 'STEM', stem == null ? null : stem.Account__c,
                    portId, offer, offer == null ? null : (Id)offer.get('Port__c'));
                for(Integer candidateIndex=firstCandidate;candidateIndex<result.size();candidateIndex++) result[candidateIndex].principalUsd=isUsdStem(stem);
            }
        }
        return result;
    }

    private static void addCandidate(List<Candidate> rows, SObject row, Integer rowIndex, String direction, Id scopeId, String scopeType,
        Id partyId, Id portId, SObject source, Id sourcePortId) {
        if (scopeId == null || partyId == null || portId == null) return;
        Candidate candidate = new Candidate();
        candidate.row = row; candidate.rowIndex = rowIndex; candidate.direction = direction; candidate.scopeId = scopeId; candidate.scopeType = scopeType;
        candidate.partyId = partyId; candidate.portId = portId; candidate.source = source; candidate.sourcePortId = sourcePortId;
        candidate.key = scopeType + ':' + scopeId + ':' + portId + ':' + direction + ':' + partyId;
        rows.add(candidate);
    }

    private static Plan plan(List<Candidate> candidates, Map<Id, Trade_Currency_Side__c> sourceSides,
        Map<String, Trade_Currency_Side__c> existingByKey, Map<Id, String> portNames, Map<Id, String> portCountries) {
        Plan result = new Plan();
        Map<String, Trade_Currency_Side__c> proposed = new Map<String, Trade_Currency_Side__c>();
        for (Candidate candidate : candidates) {
            Trade_Currency_Side__c existing = existingByKey.get(candidate.key);
            Boolean bidExtra = candidate.row.getSObjectType().getDescribe().getName() == 'Supplier_Bid_Extra_Cost__c';
            Trade_Currency_Side__c sourceSide = verifiedHkdSource(candidate.source, candidate.direction, sourceSides, bidExtra);
            Trade_Currency_Side__c sourceUsdSide = verifiedUsdSource(candidate.source, candidate.direction, sourceSides);
            Boolean sourceHkd = sourceSide != null;
            Boolean sourceUsd = sourceUsdSide != null;
            Boolean existingHkd = existing != null && existing.Currency__c == 'HKD';
            Boolean existingUsd = isCanonicalUsd(existing,candidate);
            Boolean ownUsd = existingUsd && (bidExtra || (!sourceHkd && !sourceUsd));
            Boolean sourceClaimsHkd = candidate.source != null && candidate.source.get(candidate.direction + '_Currency__c') == 'HKD';
            if (sourceClaimsHkd && !sourceHkd) {
                candidate.row.addError('The source HKD evidence is incomplete or no longer matches its confirmed trading side.');
                continue;
            }
            if(existing!=null && existing.Currency__c=='USD' && !existingUsd) {
                candidate.row.addError('The existing USD trading side is not valid for this scope.');
                continue;
            }
            if (!sourceHkd && !sourceUsd && !existingHkd && !ownUsd) continue;
            if(candidate.scopeType=='STEM' && !candidate.principalUsd) {
                candidate.row.addError('Managed currency lineage requires a USD-denominated STEM parent.');
                continue;
            }
            if ((sourceHkd && !FcosTradeCurrencyService.hongKong(portNames.get(candidate.portId), portCountries.get(candidate.portId))) ||
                ((sourceHkd || sourceUsd) && candidate.sourcePortId != candidate.portId)) {
                candidate.row.addError(sourceHkd
                    ? 'HKD lineage requires the matching Hong Kong delivery port.'
                    : 'USD precision lineage requires the matching delivery port.');
                continue;
            }
            if (candidate.row.getSObjectType().getDescribe().fields.getMap().containsKey('Master_Contract_Source__c')
                && candidate.row.get('Master_Contract_Source__c') == true && !ownUsd) {
                candidate.row.addError('Formula-linked Master Contract records remain in USD.');
                continue;
            }
            if(ownUsd && hasConflictingOwnUsdEvidence(candidate.row,candidate.direction,existing)) {
                candidate.row.addError('A new USD line cannot carry unverified native-currency evidence.');
                continue;
            }
            // Extra costs own their price. Parent-bid evidence supplies only the
            // canonical HKD side, never a fuel unit price or precise USD amount.
            if (bidExtra && !existingHkd && !ownUsd) {
                if (sourceHkd && existing == null) {
                    candidate.row.addError('The parent Supplier Bid trading side must exist before its extra cost can inherit HKD evidence.');
                }
                continue;
            }
            if (existingUsd && (sourceHkd || sourceUsd || ownUsd)) {
                // The existing USD side is canonical. A source-less line keeps its own USD terms.
                RowBinding usdBinding = new RowBinding();
                usdBinding.row = candidate.row; usdBinding.rowIndex = candidate.rowIndex; usdBinding.direction = candidate.direction;
                usdBinding.sideKey = candidate.key; usdBinding.side = existing; usdBinding.source = ownUsd ? null : candidate.source; usdBinding.isNewSide = false;
                result.rowsToStamp.add(usdBinding);
                continue;
            }
            Trade_Currency_Side__c side = existing;
            Boolean isNew = false;
            if (side == null) {
                side = proposed.get(candidate.key);
                if (side == null) {
                    side = new Trade_Currency_Side__c(External_Key__c = candidate.key, Scope_Id__c = String.valueOf(candidate.scopeId),
                        Scope_Type__c = candidate.scopeType, Party__c = candidate.partyId, Port__c = candidate.portId,
                        Direction__c = candidate.direction, Currency__c = sourceHkd ? 'HKD' : 'USD',
                        FX_Rate__c = sourceHkd ? sourceSide.FX_Rate__c : null,
                        FX_Revision__c = sourceHkd ? sourceSide.FX_Revision__c : null,
                        FX_Effective_At__c = sourceHkd ? sourceSide.FX_Effective_At__c : null,
                        Source_Side__c = sourceHkd ? sourceSide.Id : sourceUsdSide.Id, Version__c = 1, Confirmed_At__c = null);
                    proposed.put(candidate.key, side);
                    result.newSides.add(side);
                }
                isNew = true;
            }
            RowBinding binding = new RowBinding();
            binding.row = candidate.row; binding.rowIndex = candidate.rowIndex; binding.direction = candidate.direction; binding.sideKey = candidate.key;
            binding.side = side; binding.source = candidate.source; binding.isNewSide = isNew;
            result.rowsToStamp.add(binding);
        }
        return result;
    }

    /**
     * Stamps only the supplied in-memory child records. Sides must already have been authorized and upserted by the caller.
     */
    public static void apply(Plan plan, Map<String, Trade_Currency_Side__c> persistedByKey) {
        if (plan == null || plan.rowsToStamp == null) return;
        for (RowBinding binding : plan.rowsToStamp) {
            Trade_Currency_Side__c side = persistedByKey == null ? binding.side : persistedByKey.get(binding.sideKey);
            if (side == null) side = binding.side;
            if (side != null && side.Currency__c == 'USD') {
                stampUsdFromVerifiedSource(binding, side);
                continue;
            }
            if (side == null || side.Id == null || side.Currency__c != 'HKD' || side.FX_Rate__c == null || side.FX_Rate__c <= 0
                || String.isBlank(side.FX_Revision__c)) {
                binding.row.addError('A verified HKD trading side is required before the line can be created.');
                continue;
            }
            stamp(binding, side);
        }
    }

    private static void stamp(RowBinding binding, Trade_Currency_Side__c side) {
        SObject row = binding.row;
        String p = binding.direction + '_';
        Decimal rate = side.FX_Rate__c;
        Map<String, String> usdFields = usdFields(row, binding.direction);
        for (String kind : new List<String>{'Unit_Price','Minimum','Lumpsum'}) {
            String nativeField = p + 'HKD_' + kind + '__c';
            Decimal nativeValue;
            Boolean ownNative = row.getSObjectType().getDescribe().getName() == 'Supplier_Bid_Extra_Cost__c';
            if (binding.isNewSide && !ownNative) nativeValue = decimalValue(binding.source, nativeField);
            else nativeValue = decimalValue(row, nativeField);
            if (nativeValue == null && !binding.isNewSide && !ownNative) nativeValue = decimalValue(binding.source, nativeField);
            String usdField = usdFields.get(kind);
            if (nativeValue == null && usdField != null) nativeValue = decimalValue(row, usdField) == null ? null : decimalValue(row, usdField) * rate;
            putIfWritable(row, nativeField, nativeValue);
            if (usdField != null) putIfWritable(row, usdField, nativeValue == null ? null : nativeValue / rate);
        }
        putIfWritable(row, p + 'Currency__c', 'HKD');
        putIfWritable(row, p + 'FX_Rate__c', side.FX_Rate__c);
        putIfWritable(row, p + 'FX_Revision__c', side.FX_Revision__c);
        putIfWritable(row, p + 'FX_Confirmed_At__c', side.Confirmed_At__c);
        putIfWritable(row, p + 'FX_Side__c', side.Id);
        putIfWritable(row, p + 'USD_Unit_Price_Precise__c', null);
        putIfWritable(row, 'CurrencyIsoCode', 'USD');
    }

    private static void stampUsdFromVerifiedSource(RowBinding binding, Trade_Currency_Side__c side) {
        SObject row = binding.row;
        String p = binding.direction + '_';
        Boolean ownUsd = binding.source == null;
        Map<String, String> usdFields = usdFields(row, binding.direction);
        Boolean sourceHkd = binding.source != null && binding.source.get(p + 'Currency__c') == 'HKD';
        Decimal rate = decimalValue(binding.source, p + 'FX_Rate__c');
        if (sourceHkd && (rate == null || rate <= 0)) {
            row.addError('The source HKD evidence has no valid confirmed rate.');
            return;
        }
        Decimal ownPrecise=ownUsd?decimalValue(row,p+'USD_Unit_Price_Precise__c'):null;
        Decimal ownUnit=ownUsd?decimalValue(row,usdFields.get('Unit_Price')):null;
        String ownLumpField=ownUsd?usdFields.get('Lumpsum'):null;
        Boolean fixedLump=ownUsd && hasField(row,'Fixed__c') && row.get('Fixed__c')==true
            && ownLumpField!=null && decimalValue(row,ownLumpField)!=null;
        Decimal preciseUsd = sourceHkd
            ? decimalValue(binding.source, p + 'HKD_Unit_Price__c') / rate
            : ownUsd ? (ownPrecise!=null?ownPrecise:ownUnit!=null?ownUnit:fixedLump?0:null)
            : decimalValue(binding.source, p + 'USD_Unit_Price_Precise__c');
        if (preciseUsd == null || preciseUsd < 0) {
            row.addError('The source USD precision evidence is unavailable.');
            return;
        }
        Map<String, String> sourceUsdFields = ownUsd ? new Map<String,String>() : usdFields(binding.source, binding.direction);
        for (String kind : new List<String>{'Unit_Price','Minimum','Lumpsum'}) {
            String nativeField = p + 'HKD_' + kind + '__c';
            Boolean ownNative = row.getSObjectType().getDescribe().getName() == 'Supplier_Bid_Extra_Cost__c';
            Decimal nativeValue = ownNative ? decimalValue(row, nativeField) : decimalValue(binding.source, nativeField);
            String usdField = usdFields.get(kind);
            Decimal usdValue;
            if (kind == 'Unit_Price') usdValue = preciseUsd.setScale(8,RoundingMode.HALF_UP);
            else if (sourceHkd) usdValue = nativeValue == null ? null : nativeValue / rate;
            else if(ownUsd) usdValue=usdField==null?null:decimalValue(row,usdField);
            else usdValue = decimalValue(binding.source, sourceUsdFields.get(kind));
            putIfWritable(row, nativeField, null);
            if (usdField != null && (ownUsd || !ownNative || nativeValue != null)) putIfWritable(row, usdField, usdValue);
        }
        putIfWritable(row, p + 'Currency__c', 'USD');
        putIfWritable(row, p + 'FX_Rate__c', null);
        putIfWritable(row, p + 'FX_Revision__c', null);
        putIfWritable(row, p + 'FX_Confirmed_At__c', side.Confirmed_At__c);
        putIfWritable(row, p + 'FX_Side__c', side.Id);
        putIfWritable(row, p + 'USD_Unit_Price_Precise__c', preciseUsd.setScale(8,RoundingMode.HALF_UP));
        putIfWritable(row, 'CurrencyIsoCode', 'USD');
    }

    private static Map<String, String> usdFields(SObject row, String direction) {
        String type = row.getSObjectType().getDescribe().getName();
        if (type == 'QuoteLineItem') return new Map<String, String>{
            'Unit_Price' => direction == 'Buy' ? 'Supplier_Unit_Price__c' : 'UnitPrice',
            'Minimum' => direction == 'Buy' ? 'Minimum_Buy_At__c' : 'Minimum_Sell_At__c',
            'Lumpsum' => direction == 'Buy' ? 'Lumpsum_Buy_At__c' : 'Lumpsum_Sell_At__c'
        };
        if (type == 'STEM_Line_Item__c') return new Map<String, String>{
            'Unit_Price' => direction == 'Buy' ? 'Unit_Buy_At__c' : 'Unit_Sell_At__c'
        };
        if (type == 'Supplier_Bid_Extra_Cost__c') return new Map<String, String>{
            'Unit_Price' => 'Unit_Cost__c',
            'Minimum' => 'Minimum__c',
            'Lumpsum' => 'Lumpsum_Cost__c'
        };
        return new Map<String, String>{
            'Unit_Price' => direction == 'Buy' ? 'Unit_Cost__c' : 'Unit_Price__c',
            'Minimum' => direction == 'Buy' ? 'Minimum_Buy_At__c' : 'Minimum_Sell_At__c',
            'Lumpsum' => direction == 'Buy' ? 'Lumpsum_Cost__c' : 'Lumpsum_Price__c'
        };
    }

    private static Trade_Currency_Side__c verifiedHkdSource(SObject source, String direction,
        Map<Id, Trade_Currency_Side__c> sourceSides, Boolean allowDraft) {
        if (source == null || source.get(direction + '_Currency__c') != 'HKD') return null;
        Id sideId = (Id)source.get(direction + '_FX_Side__c');
        Trade_Currency_Side__c side = sourceSides.get(sideId);
        String p = direction + '_';
        if (side == null || side.Currency__c != 'HKD' || side.FX_Rate__c == null || side.FX_Rate__c <= 0
            || String.isBlank(side.FX_Revision__c) || side.FX_Effective_At__c == null || (!allowDraft && side.Confirmed_At__c == null)) return null;
        Decimal nativeUnitPrice = decimalValue(source, p + 'HKD_Unit_Price__c');
        if (nativeUnitPrice == null || nativeUnitPrice < 0
            || decimalValue(source, p + 'FX_Rate__c') != side.FX_Rate__c
            || (String)source.get(p + 'FX_Revision__c') != side.FX_Revision__c
            || (Datetime)source.get(p + 'FX_Confirmed_At__c') != side.Confirmed_At__c) return null;
        return side;
    }

    private static Trade_Currency_Side__c verifiedUsdSource(SObject source, String direction,
        Map<Id, Trade_Currency_Side__c> sourceSides) {
        if (source == null || source.get(direction + '_Currency__c') != 'USD') return null;
        String p = direction + '_';
        Id sideId = (Id)source.get(p + 'FX_Side__c');
        Trade_Currency_Side__c side = sourceSides.get(sideId);
        Decimal precise = decimalValue(source, p + 'USD_Unit_Price_Precise__c');
        if (side == null || side.Currency__c != 'USD' || precise == null || precise < 0
            || source.get(p + 'FX_Rate__c') != null || source.get(p + 'FX_Revision__c') != null
            || (Datetime)source.get(p + 'FX_Confirmed_At__c') != side.Confirmed_At__c) return null;
        return side;
    }

    private static Boolean isUsdQuote(Quote quote) {
        if (quote == null) return false;
        if (!hasField(Schema.getGlobalDescribe().get('Quote'), 'CurrencyIsoCode')) return true;
        return quote.get('CurrencyIsoCode') == 'USD';
    }
    private static Boolean isUsdStem(STEM__c stem) {
        if(stem == null) return false;
        if(!hasField(STEM__c.SObjectType,'CurrencyIsoCode')) return true;
        return stem.get('CurrencyIsoCode')=='USD';
    }
    private static Boolean isCanonicalUsd(Trade_Currency_Side__c side,Candidate candidate) {
        return side!=null && side.Id!=null && side.Currency__c=='USD' && side.External_Key__c==candidate.key
            && side.FX_Rate__c==null && String.isBlank(side.FX_Revision__c) && side.FX_Effective_At__c==null;
    }
    private static Boolean hasConflictingOwnUsdEvidence(SObject row,String direction,Trade_Currency_Side__c side) {
        String p=direction+'_';
        if(row.get(p+'Currency__c')!=null && row.get(p+'Currency__c')!='USD') return true;
        if(row.get(p+'FX_Side__c')!=null && row.get(p+'FX_Side__c')!=side.Id) return true;
        if(row.get(p+'FX_Rate__c')!=null || !String.isBlank((String)row.get(p+'FX_Revision__c'))) return true;
        if(row.get(p+'FX_Confirmed_At__c')!=null && row.get(p+'FX_Confirmed_At__c')!=side.Confirmed_At__c) return true;
        for(String kind:new List<String>{'Unit_Price','Minimum','Lumpsum'}) if(decimalValue(row,p+'HKD_'+kind+'__c')!=null) return true;
        return false;
    }
    private static Boolean hasField(Schema.SObjectType objectType, String field) {
        return objectType.getDescribe().fields.getMap().containsKey(field);
    }
    private static Boolean hasField(SObject row, String field) {
        return row != null && hasField(row.getSObjectType(), field);
    }
    private static void putIfWritable(SObject row, String field, Object value) {
        if (!hasField(row, field)) return;
        // QuoteLineItem principal currency belongs to its USD-validated Quote.
        // Custom-record snapshots are server-owned and do not depend on user FLS.
        if(field=='CurrencyIsoCode' && row.getSObjectType()==QuoteLineItem.SObjectType) return;
        row.put(field, value);
    }
    private static Decimal decimalValue(SObject row, String field) {
        return row == null || !hasField(row, field) || row.get(field) == null ? null : (Decimal)row.get(field);
    }
}
