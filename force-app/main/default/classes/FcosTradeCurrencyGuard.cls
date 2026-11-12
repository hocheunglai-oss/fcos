/** Direct writes prove every snapshot against its side; issued native-currency rows retain their financial evidence. */
public with sharing class FcosTradeCurrencyGuard {
    private static final List<String> INVOICE_FIELDS = new List<String>{'Buyer_Invoice__c','Supplier_Invoice__c'};
    private static final List<String> FINANCIAL_FIELDS = new List<String>{
        'Quantity','Quantity__c','Quantity_Delivered_Per_BDN__c','Quantity_Max__c','Quantity_Range_Max__c',
        'Is_Quantity_Range__c','Fixed__c','Type__c','Charge_Type__c','Cancelled__c','RecordTypeId','Nomination_Type__c',
        'Unit_of_Measure__c','Payment_Term__c',
        'STEM__c','STEM_Line_Item__c','Offer_Line_Item__c','Supplier_Bid__c','Supplier__c','Original_Supplier__c','Port__c'
    };

    public static Decimal accountingValue(SObject row, String direction, String nativeKind, String usdField) {
        if (row.get(direction+'_Currency__c') != 'HKD') return nativeKind=='Unit_Price'?FcosTradeCurrencyService.usdUnitPrice(row,direction,usdField):(Decimal)row.get(usdField);
        Decimal rate = (Decimal)row.get(direction+'_FX_Rate__c');
        if (rate == null || rate <= 0) throw new FcosTradeCurrencyService.TradeFxException('HKD requires the saved company rate.');
        Decimal nativeValue = (Decimal)row.get(direction+'_HKD_'+nativeKind+'__c');
        return nativeValue == null ? null : nativeValue/rate;
    }

    public static void beforeSave(List<SObject> rows, Map<Id,SObject> oldRows, List<String> directions) {
        if (rows == null || rows.isEmpty()) return;
        Boolean inserting = oldRows == null || oldRows.isEmpty();
        for(SObject row:rows) {
            SObject previous=oldRows==null?null:oldRows.get(row.Id);
            for(String field:new List<String>{'Reissue_Of_Buyer_Invoice__c','Reissue_Of_Supplier_Invoice__c'}) {
                if(hasField(row,field) && (previous==null?row.get(field)!=null:row.get(field)!=previous.get(field)) && !FcosTradeReissueService.isAuthorizedRelease(row,previous)) row.addError('Only the reviewed credit release can establish reissue lineage.');
            }
        }
        Boolean fxEnabled = FcosCompanyFxRateService.enabled();
        Boolean chargePriceWriter=fxEnabled && FeatureManagement.checkPermission('Fcos_Trading_FX_Charge_Price');
        if(!FcosTradeCurrencyService.isManagedWrite()) for(SObject row:rows) for(String direction:directions)
            guardPreciseUsdCharge(row,oldRows==null?null:oldRows.get(row.Id),direction,chargePriceWriter);
        manageInitialAgentHkdMarkers(rows, oldRows, fxEnabled);
        if (!fxEnabled && !hasAnyHkdRows(rows, oldRows, directions)
            && !hasUsdSideOrReissueEvidence(rows, oldRows, directions)) return;
        Set<String> admitted = inserting && fxEnabled ? inheritDraftRows(rows) : new Set<String>();
        Set<Id> sideIds = new Set<Id>(), stemIds = new Set<Id>(), quoteIds = new Set<Id>(), bidIds = new Set<Id>();
        for (SObject row : rows) {
            SObject oldRow = oldRows == null ? null : oldRows.get(row.Id);
            String name = row.getSObjectType().getDescribe().getName();
            if (name.startsWith('STEM_') && row.get('STEM__c') != null) stemIds.add((Id)row.get('STEM__c'));
            else if (name == 'QuoteLineItem' && row.get('QuoteId') != null) quoteIds.add((Id)row.get('QuoteId'));
            else if (name == 'Supplier_Bid_Extra_Cost__c' && row.get('Supplier_Bid__c') != null) bidIds.add((Id)row.get('Supplier_Bid__c'));
            for (String direction : directions) {
                String field = direction+'_FX_Side__c';
                if (row.get(field) != null) sideIds.add((Id)row.get(field));
                if (oldRow != null && oldRow.get(field) != null) sideIds.add((Id)oldRow.get(field));
            }
        }
        Map<Id,STEM__c> stems = new Map<Id,STEM__c>();
        if(!stemIds.isEmpty()) for(SObject stem:Database.query('SELECT Id,Account__c,Port__c,Port__r.Name,Port__r.Country__c'
            +(STEM__c.SObjectType.getDescribe().fields.getMap().containsKey('CurrencyIsoCode')?',CurrencyIsoCode':'')
            +' FROM STEM__c WHERE Id IN :stemIds')) stems.put((Id)stem.get('Id'),(STEM__c)stem);
        Map<Id,Quote> quotes=new Map<Id,Quote>();
        if(!quoteIds.isEmpty()) for(SObject quote:Database.query('SELECT Id,Quote_Buyer__c'+(Quote.SObjectType.getDescribe().fields.getMap().containsKey('CurrencyIsoCode')?',CurrencyIsoCode':'')+' FROM Quote WHERE Id IN :quoteIds')) quotes.put(quote.Id,(Quote)quote);
        Map<Id,Supplier_Bid__c> bids = bidIds.isEmpty() ? new Map<Id,Supplier_Bid__c>() : new Map<Id,Supplier_Bid__c>([
            SELECT Id,Port__c,Supplier__c FROM Supplier_Bid__c WHERE Id IN :bidIds
        ]);
        Map<Id,Trade_Currency_Side__c> sides = new Map<Id,Trade_Currency_Side__c>(FcosTradeEvidenceStore.sidesByIds(sideIds));
        for (Integer index = 0; index < rows.size(); index++) {
            SObject oldRow = oldRows == null ? null : oldRows.get(rows[index].Id);
            for (String direction : directions) validate(rows[index], oldRow, index, direction, admitted, fxEnabled, sides, stems, quotes, bids);
        }
    }

    // FCOS may explicitly amend an extra-charge price, including a change that
    // rounds to the same principal USD cents. Fuel price entry stays in Salesforce.
    @TestVisible private static void guardPreciseUsdCharge(SObject row,SObject previous,String direction,Boolean allowed) {
        String field=direction+'_USD_Unit_Price_Precise__c',legacy=usdField(row,direction,'Unit_Price');
        Boolean explicitChange=previous==null?row.get(field)!=null:row.get(field)!=previous.get(field);
        if(explicitChange) {
            if(!allowed || row.getSObjectType()!=STEM_Extra_Cost__c.SObjectType || row.get(direction+'_Currency__c')=='HKD') {
                row.addError('Use the reviewed currency action to set a precise USD unit price.');return;
            }
            Decimal precise=(Decimal)row.get(field),principal=(Decimal)row.get(legacy);
            if(precise==null?principal!=null:precise<0 || precise!=precise.setScale(8,RoundingMode.HALF_UP) || principal!=precise.setScale(2,RoundingMode.HALF_UP))
                row.addError('The explicit USD charge unit price must retain at most eight decimals and match its rounded principal USD value.');
        } else if(previous!=null && changed(row,previous,legacy)) row.put(field,null);
    }

    public static void beforeDelete(List<SObject> rows, List<String> directions) {
        if (rows == null) return;
        for (SObject row : rows) for (String direction : directions) {
            String lineage=direction=='Sell'?'Reissue_Of_Buyer_Invoice__c':'Reissue_Of_Supplier_Invoice__c';
            String invoice=direction=='Sell'?'Buyer_Invoice__c':'Supplier_Invoice__c';
            Boolean issuedUsd=row.get(direction+'_FX_Side__c')!=null && hasField(row,invoice) && row.get(invoice)!=null;
            if (row.get(direction+'_Currency__c') == 'HKD' || issuedUsd || (hasField(row,lineage) && row.get(lineage)!=null)) {
                row.addError('Retain native trading and reissue source evidence. Use the reviewed cancellation or credit workflow.');
                break;
            }
        }
    }

    /**
     * Only this before-insert guard can create the pending marker. The marker is
     * a proposal gate, never a currency snapshot: it records that the new row
     * was created for an HKD-configured agent and had no matching fuel or prior
     * Buy-side evidence. A reviewed currency save consumes it.
     */
    private static void manageInitialAgentHkdMarkers(List<SObject> rows, Map<Id,SObject> oldRows, Boolean fxEnabled) {
        Boolean inserting = oldRows == null || oldRows.isEmpty();
        List<STEM_Extra_Cost__c> candidates = new List<STEM_Extra_Cost__c>();
        for (SObject row : rows) {
            if (row.getSObjectType() != STEM_Extra_Cost__c.SObjectType) continue;
            STEM_Extra_Cost__c extra = (STEM_Extra_Cost__c)row;
            STEM_Extra_Cost__c previous = oldRows == null ? null : (STEM_Extra_Cost__c)oldRows.get(extra.Id);
            if (!inserting) {
                Boolean wasPending = previous != null && previous.Buy_Agent_Currency_Pending__c == true;
                Boolean isPending = extra.Buy_Agent_Currency_Pending__c == true;
                if (isPending != wasPending && !FcosTradeCurrencyService.isManagedWrite()) {
                    extra.addError('The agent-currency proposal marker is system managed.');
                } else if (wasPending && FcosTradeCurrencyService.isManagedWrite()
                    && hasInitialBuyEvidence(extra)) {
                    // A Sell-side reviewed write must not consume a Buy proposal.
                    extra.Buy_Agent_Currency_Pending__c = false;
                }
                continue;
            }
            // Ignore any client-supplied value; eligibility below is the only authority.
            extra.Buy_Agent_Currency_Pending__c = false;
            if (fxEnabled && extra.Cancelled__c != true && extra.STEM__c != null && extra.Supplier__c != null
                && !hasInitialBuyEvidence(extra)) candidates.add(extra);
        }
        if (candidates.isEmpty()) return;

        Set<Id> stemIds = new Set<Id>(), supplierIds = new Set<Id>();
        for (STEM_Extra_Cost__c extra : candidates) { stemIds.add(extra.STEM__c); supplierIds.add(extra.Supplier__c); }
        Map<Id,STEM__c> stems = new Map<Id,STEM__c>([
            SELECT Id, Port__c, Port__r.Name, Port__r.Country__c FROM STEM__c WHERE Id IN :stemIds
        ]);
        Map<Id,Account> suppliers = new Map<Id,Account>([
            SELECT Id, Is_Agent__c, Agency_Fee_Currency__c FROM Account WHERE Id IN :supplierIds
        ]);
        Set<String> scopeIds = new Set<String>(), existingSides = new Set<String>(), liveFuel = new Set<String>(), legacyUsd = new Set<String>();
        for (Id stemId : stems.keySet()) scopeIds.add(String.valueOf(stemId));
        for (Trade_Currency_Side__c side : FcosTradeEvidenceStore.buySidesForScopes(scopeIds,supplierIds)) existingSides.add(side.Scope_Id__c + ':' + side.Party__c);
        for (STEM_Line_Item__c fuel : [
            SELECT STEM__c, Original_Supplier__c FROM STEM_Line_Item__c
            WHERE STEM__c IN :stemIds AND Original_Supplier__c IN :supplierIds AND Cancelled__c = false
        ]) liveFuel.add(String.valueOf(fuel.STEM__c) + ':' + fuel.Original_Supplier__c);
        for (STEM_Extra_Cost__c existing : [
            SELECT STEM__c, Supplier__c, Buy_Agent_Currency_Pending__c, Buy_Currency__c,
                Buy_HKD_Unit_Price__c, Buy_FX_Rate__c, Buy_FX_Revision__c, Buy_FX_Side__c
            FROM STEM_Extra_Cost__c
            WHERE STEM__c IN :stemIds AND Supplier__c IN :supplierIds AND Cancelled__c = false
        ]) {
            if (existing.Buy_Agent_Currency_Pending__c != true && !hasValidNativeBuyEvidence(existing)) {
                legacyUsd.add(String.valueOf(existing.STEM__c) + ':' + existing.Supplier__c);
            }
        }
        for (STEM_Extra_Cost__c extra : candidates) {
            STEM__c stem = stems.get(extra.STEM__c);
            Account supplier = suppliers.get(extra.Supplier__c);
            String key = String.valueOf(extra.STEM__c) + ':' + extra.Supplier__c;
            if (stem != null && FcosTradeCurrencyService.hongKong(stem.Port__r == null ? null : stem.Port__r.Name,
                    stem.Port__r == null ? null : stem.Port__r.Country__c)
                && supplier != null && supplier.Is_Agent__c == true && supplier.Agency_Fee_Currency__c == 'HKD'
                && !existingSides.contains(key) && !liveFuel.contains(key) && !legacyUsd.contains(key)) {
                extra.Buy_Agent_Currency_Pending__c = true;
            }
        }
    }
    private static Boolean hasInitialBuyEvidence(STEM_Extra_Cost__c row) {
        return row.Buy_Currency__c == 'HKD' || row.Buy_USD_Unit_Price_Precise__c != null
            || row.Buy_HKD_Unit_Price__c != null || row.Buy_HKD_Minimum__c != null
            || row.Buy_HKD_Lumpsum__c != null || row.Buy_FX_Rate__c != null
            || !String.isBlank(row.Buy_FX_Revision__c) || row.Buy_FX_Confirmed_At__c != null
            || row.Buy_FX_Side__c != null;
    }

    private static Boolean hasValidNativeBuyEvidence(STEM_Extra_Cost__c row) {
        return row.Buy_Currency__c == 'HKD' && row.Buy_HKD_Unit_Price__c != null
            && row.Buy_FX_Rate__c != null && row.Buy_FX_Rate__c > 0
            && !String.isBlank(row.Buy_FX_Revision__c) && row.Buy_FX_Side__c != null;
    }

    private static Set<String> inheritDraftRows(List<SObject> rows) {
        Set<String> admitted = new Set<String>();
        FcosTradeCurrencyInheritance.Plan plan = FcosTradeCurrencyInheritance.prepare(rows, true);
        if (plan.rowsToStamp.isEmpty()) return admitted;
        Map<String,Trade_Currency_Side__c> persisted = FcosTradeCurrencyService.persistInheritedSides(plan.newSides);
        FcosTradeCurrencyInheritance.apply(plan, persisted);
        for (FcosTradeCurrencyInheritance.RowBinding binding : plan.rowsToStamp) admitted.add(binding.rowIndex+':'+binding.direction);
        return admitted;
    }

    private static void validate(SObject row, SObject oldRow, Integer index, String direction, Set<String> admitted, Boolean fxEnabled,
        Map<Id,Trade_Currency_Side__c> sides, Map<Id,STEM__c> stems, Map<Id,Quote> quotes, Map<Id,Supplier_Bid__c> bids) {
        String p = direction+'_';
        String currencyCode = (String)row.get(p+'Currency__c');
        if (String.isBlank(currencyCode)) { currencyCode='USD'; row.put(p+'Currency__c', currencyCode); }
        String oldCurrency = oldRow == null ? null : (String)oldRow.get(p+'Currency__c');
        Boolean isHkd = currencyCode == 'HKD', wasHkd = oldCurrency == 'HKD';
        Boolean trusted = admitted.contains(index+':'+direction) || FcosTradeCurrencyService.isManagedWrite();
        Trade_Currency_Side__c side = sides.get((Id)row.get(p+'FX_Side__c'));
        if (!isHkd && !wasHkd) {
            if (hasHkdEvidence(row, direction)) row.addError('USD records cannot carry HKD currency snapshots.');
            else if (!matchesUsdSide(row, direction, side)) row.addError('USD currency snapshots must match their reviewed trading side.');
            else if (side != null) {
                FcosTradeCurrencyService.setUsdPrincipal(row);
                matchesContext(row, direction, side, stems, quotes, bids);
            }
            validateReissueLineageImmutability(row, oldRow, direction);
            return;
        }
        if (!fxEnabled) { row.addError('HKD trading entry is not enabled.'); return; }
        if (!isHkd) {
            if (!trusted || !matchesUsdSide(row, direction, sides.get((Id)row.get(p+'FX_Side__c')))) row.addError('Use the reviewed trading-currency action to change an HKD trading side.');
            else FcosTradeCurrencyService.setUsdPrincipal(row);
            return;
        }
        if (!matchesSide(row, direction, side)) { row.addError('Currency and FX snapshots must match the reviewed trading side.'); return; }
        if (!matchesContext(row, direction, side, stems, quotes, bids)) return;
        FcosTradeCurrencyService.setUsdPrincipal(row);
        if (hasField(row, 'Master_Contract_Source__c') && row.get('Master_Contract_Source__c') == true) {
            row.addError('Formula-linked Master Contract records remain in USD.'); return;
        }
        if (oldRow != null && oldCurrency != currencyCode && !trusted) {
            row.addError('Use the reviewed trading-currency action to change currency.'); return;
        }
        Boolean sharedChanged = sharedFinancialTermsChanged(row, oldRow);
        Boolean directionalChanged = directionalFinancialTermsChanged(row, oldRow, direction);
        Boolean issuedOnDirection = hasInvoice(row, direction) || hasInvoice(oldRow, direction);
        if ((issuedOnDirection && directionalChanged) || ((hasInvoice(row) || hasInvoice(oldRow)) && sharedChanged) || (invoiceLinkChanged(row, oldRow) && !FcosTradeReissueService.isAuthorizedRelease(row,oldRow))) {
            row.addError('Issued trading rows require a credit and reissue workflow for financial changes.'); return;
        }
        if (!trusted && side.Confirmed_At__c == null) {
            row.addError('Confirm the trading side before applying native-currency amendments through the API.'); return;
        }
        normalizeUsd(row, direction, side.FX_Rate__c);
    }

    private static Boolean matchesSide(SObject row, String direction, Trade_Currency_Side__c side) {
        String p = direction+'_';
        return side != null && side.Currency__c == 'HKD' && side.FX_Rate__c != null && side.FX_Rate__c > 0 && !String.isBlank(side.FX_Revision__c)
            && row.get(p+'FX_Rate__c') == side.FX_Rate__c && row.get(p+'FX_Revision__c') == side.FX_Revision__c
            && row.get(p+'FX_Confirmed_At__c') == side.Confirmed_At__c;
    }
    private static Boolean matchesUsdSide(SObject row, String direction, Trade_Currency_Side__c side) {
        String p = direction+'_';
        if (row.get(p+'FX_Side__c') == null) return true;
        return side != null && side.Currency__c == 'USD' && row.get(p+'FX_Rate__c') == null && row.get(p+'FX_Revision__c') == null
            && row.get(p+'FX_Confirmed_At__c') == side.Confirmed_At__c;
    }

    @TestVisible private static Boolean matchesContext(SObject row, String direction, Trade_Currency_Side__c side, Map<Id,STEM__c> stems, Map<Id,Quote> quotes,
        Map<Id,Supplier_Bid__c> bids) {
        String name = row.getSObjectType().getDescribe().getName(), expected;
        if (name == 'Supplier_Bid_Extra_Cost__c') {
            Supplier_Bid__c bid = bids.get((Id)row.get('Supplier_Bid__c'));
            if (bid == null) { row.addError('A Supplier Bid extra cost requires its parent bid.'); return false; }
            expected = 'Bid:'+bid.Id+':'+bid.Port__c+':'+direction+':'+bid.Supplier__c;
        } else if (name.startsWith('STEM_')) {
            STEM__c stem = stems.get((Id)row.get('STEM__c'));
            if (stem == null) { row.addError('The trading side context is unavailable.'); return false; }
            if(hasField(stem,'CurrencyIsoCode') && stem.get('CurrencyIsoCode')!='USD') {
                row.addError('The STEM principal currency must remain USD.'); return false;
            }
            if (side.Currency__c == 'HKD' && !FcosTradeCurrencyService.hongKong(stem.Port__r == null ? null : stem.Port__r.Name,
                    stem.Port__r == null ? null : stem.Port__r.Country__c)) {
                row.addError('HKD is available only for Hong Kong deliveries.'); return false;
            }
            Id party = direction == 'Sell' ? stem.Account__c : (Id)row.get(name == 'STEM_Line_Item__c' ? 'Original_Supplier__c' : 'Supplier__c');
            expected = 'STEM:'+stem.Id+':'+stem.Port__c+':'+direction+':'+party;
        } else if (name == 'QuoteLineItem') {
            Quote quote = quotes.get((Id)row.get('QuoteId'));
            if(quote!=null && hasField(quote,'CurrencyIsoCode') && quote.get('CurrencyIsoCode')!='USD') { row.addError('The Offer principal currency must remain USD.');return false; }
            Id party = direction == 'Sell' ? (quote == null ? null : quote.Quote_Buyer__c) : (Id)row.get('Supplier__c');
            expected = 'Offer:'+row.get('QuoteId')+':'+row.get('Port__c')+':'+direction+':'+party;
        } else expected = 'Bid:'+row.Id+':'+row.get('Port__c')+':'+direction+':'+row.get('Supplier__c');
        if (side.External_Key__c != expected) { row.addError('A rate snapshot cannot be reused for another trading side.'); return false; }
        return true;
    }

    private static void normalizeUsd(SObject row, String direction, Decimal rate) {
        for (String kind : new List<String>{'Unit_Price','Minimum','Lumpsum'}) {
            String nativeField = direction+'_HKD_'+kind+'__c';
            Decimal nativeValue = decimalValue(row, nativeField);
            if (nativeValue != null && nativeValue < 0) { row.addError('HKD values must be non-negative.'); return; }
            String usd = usdField(row, direction, kind);
            Boolean fixedLumpsum = hasField(row, 'Fixed__c') && row.get('Fixed__c') == true
                && decimalValue(row, direction+'_HKD_Lumpsum__c') != null;
            if (kind == 'Unit_Price' && nativeValue == null && !fixedLumpsum) { row.addError('HKD requires a non-negative native price.'); return; }
            if (kind != 'Unit_Price' && nativeValue == null && usd != null && row.get(usd) != null) {
                row.addError('Edit the native HKD minimum or lumpsum; USD is calculated from the saved rate.'); return;
            }
            if (usd != null) row.put(usd, nativeValue == null ? null : nativeValue/rate);
        }
    }

    @TestVisible private static Boolean financialTermsChanged(SObject row, SObject oldRow, String direction) {
        return sharedFinancialTermsChanged(row, oldRow) || directionalFinancialTermsChanged(row, oldRow, direction);
    }
    private static Boolean sharedFinancialTermsChanged(SObject row, SObject oldRow) {
        if (oldRow == null) return true;
        for (String field : FINANCIAL_FIELDS) if (changed(row, oldRow, field)) return true;
        return false;
    }
    private static Boolean directionalFinancialTermsChanged(SObject row, SObject oldRow, String direction) {
        if (oldRow == null) return true;
        String p=direction+'_';
        for (String suffix : new List<String>{'Currency__c','USD_Unit_Price_Precise__c','HKD_Unit_Price__c','HKD_Minimum__c','HKD_Lumpsum__c','FX_Rate__c','FX_Revision__c','FX_Confirmed_At__c','FX_Side__c'}) if (changed(row,oldRow,p+suffix)) return true;
        for (String kind : new List<String>{'Unit_Price','Minimum','Lumpsum'}) if (changed(row,oldRow,usdField(row,direction,kind))) return true;
        return false;
    }

    private static Boolean hasInvoice(SObject row) {
        if (row == null) return false;
        for (String field : INVOICE_FIELDS) if (hasField(row,field) && row.get(field) != null) return true;
        return false;
    }
    private static Boolean hasInvoice(SObject row, String direction) {
        if (row == null) return false;
        String field = direction == 'Buy' ? 'Supplier_Invoice__c' : 'Buyer_Invoice__c';
        return hasField(row, field) && row.get(field) != null;
    }
    private static Boolean invoiceLinkChanged(SObject row, SObject oldRow) {
        if (oldRow == null) return false;
        for (String field : INVOICE_FIELDS) if (hasField(oldRow, field) && oldRow.get(field) != null && changed(row, oldRow, field)) return true;
        return false;
    }
    @TestVisible private static void validateReissueLineageImmutability(SObject row, SObject oldRow, String direction) {
        if (oldRow == null || !hasReissueLineage(row, oldRow)) return;
        Boolean sharedChanged = sharedFinancialTermsChanged(row, oldRow);
        Boolean directionalChanged = directionalFinancialTermsChanged(row, oldRow, direction);
        Boolean issuedOnDirection = hasInvoice(row, direction) || hasInvoice(oldRow, direction);
        if ((issuedOnDirection && directionalChanged)
            || ((hasInvoice(row) || hasInvoice(oldRow)) && sharedChanged)
            || (invoiceLinkChanged(row, oldRow) && !FcosTradeReissueService.isAuthorizedRelease(row,oldRow))) {
            row.addError('Issued trading rows require a credit and reissue workflow for financial changes.');
        }
    }
    private static Boolean hasReissueLineage(SObject row, SObject oldRow) {
        for (String field : new List<String>{'Reissue_Of_Buyer_Invoice__c','Reissue_Of_Supplier_Invoice__c'}) {
            if (hasField(row,field) && (row.get(field) != null || (oldRow != null && oldRow.get(field) != null))) return true;
        }
        return false;
    }
    private static Boolean hasUsdSideOrReissueEvidence(List<SObject> rows, Map<Id,SObject> oldRows, List<String> directions) {
        for (SObject row : rows) {
            SObject oldRow = oldRows == null ? null : oldRows.get(row.Id);
            if (hasReissueLineage(row, oldRow)) return true;
            for (String direction : directions) {
                String field = direction+'_FX_Side__c';
                if (row.get(field) != null || (oldRow != null && oldRow.get(field) != null)) return true;
            }
        }
        return false;
    }
    private static Boolean hasHkdEvidence(SObject row, String direction) {
        for (String suffix : new List<String>{'HKD_Unit_Price__c','HKD_Minimum__c','HKD_Lumpsum__c','FX_Rate__c','FX_Revision__c'}) if (hasField(row,direction+'_'+suffix) && row.get(direction+'_'+suffix) != null) return true;
        return false;
    }
    private static Boolean hasAnyHkdRows(List<SObject> rows, Map<Id,SObject> oldRows, List<String> directions) {
        for (SObject row : rows) for (String direction : directions) {
            SObject oldRow = oldRows == null ? null : oldRows.get(row.Id);
            if (row.get(direction+'_Currency__c') == 'HKD' || (oldRow != null && oldRow.get(direction+'_Currency__c') == 'HKD') || hasHkdEvidence(row, direction)) return true;
        }
        return false;
    }
    private static String usdField(SObject row, String direction, String kind) {
        String name=row.getSObjectType().getDescribe().getName();
        if (name == 'Supplier_Bid__c') return kind == 'Unit_Price' ? 'Supplier_Unit_Price__c' : null;
        if (name == 'Supplier_Bid_Extra_Cost__c') return kind == 'Unit_Price' ? 'Unit_Cost__c' : kind == 'Minimum' ? 'Minimum__c' : 'Lumpsum_Cost__c';
        if (name == 'QuoteLineItem') return kind == 'Unit_Price' ? (direction == 'Buy' ? 'Supplier_Unit_Price__c' : 'UnitPrice') : kind == 'Minimum' ? (direction == 'Buy' ? 'Minimum_Buy_At__c' : 'Minimum_Sell_At__c') : (direction == 'Buy' ? 'Lumpsum_Buy_At__c' : 'Lumpsum_Sell_At__c');
        if (name == 'STEM_Line_Item__c') return kind == 'Unit_Price' ? (direction == 'Buy' ? 'Unit_Buy_At__c' : 'Unit_Sell_At__c') : null;
        return kind == 'Unit_Price' ? (direction == 'Buy' ? 'Unit_Cost__c' : 'Unit_Price__c') : kind == 'Minimum' ? (direction == 'Buy' ? 'Minimum_Buy_At__c' : 'Minimum_Sell_At__c') : (direction == 'Buy' ? 'Lumpsum_Cost__c' : 'Lumpsum_Price__c');
    }
    private static Boolean changed(SObject row, SObject oldRow, String field) { return field != null && hasField(row,field) && row.get(field) != oldRow.get(field); }
    private static Boolean hasField(SObject row, String field) { return row != null && field != null && row.getSObjectType().getDescribe().fields.getMap().containsKey(field); }
    private static Decimal decimalValue(SObject row, String field) { return !hasField(row,field) || row.get(field) == null ? null : (Decimal)row.get(field); }
}
