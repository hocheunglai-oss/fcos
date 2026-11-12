/**
 * Internal canonical currency-side metadata only. Callers must derive exact
 * keys or IDs from sharing-visible, authorized source records before calling
 * this store. It never reads business rows and exposes no public endpoint.
 */
public without sharing class FcosTradeEvidenceStore {
    private static final String SIDE_FIELDS =
        'Id,External_Key__c,Currency__c,FX_Rate__c,FX_Revision__c,FX_Effective_At__c,' +
        'Confirmed_At__c,Version__c,Review_Fingerprint__c,Scope_Id__c,Scope_Type__c,' +
        'Party__c,Port__c,Direction__c';

    public static List<Trade_Currency_Side__c> sidesByIds(Set<Id> sideIds) {
        if (sideIds == null || sideIds.isEmpty()) return new List<Trade_Currency_Side__c>();
        return sides('SELECT '+SIDE_FIELDS+' FROM Trade_Currency_Side__c WHERE Id IN :sideIds',
            new Map<String,Object>{'sideIds'=>sideIds});
    }

    public static List<Trade_Currency_Side__c> sidesByKeys(Set<String> keys, Boolean lockRows) {
        if (keys == null || keys.isEmpty()) return new List<Trade_Currency_Side__c>();
        return sides('SELECT '+SIDE_FIELDS+' FROM Trade_Currency_Side__c WHERE External_Key__c IN :keys'+
            (lockRows == true ? ' FOR UPDATE' : ''),new Map<String,Object>{'keys'=>keys});
    }

    public static List<Trade_Currency_Side__c> buySidesForScopes(Set<String> scopeIds, Set<Id> partyIds) {
        if (scopeIds == null || scopeIds.isEmpty() || partyIds == null || partyIds.isEmpty()) return new List<Trade_Currency_Side__c>();
        return sides('SELECT '+SIDE_FIELDS+' FROM Trade_Currency_Side__c WHERE Scope_Id__c IN :scopeIds '+
            'AND Scope_Type__c = :scopeType AND Direction__c = :direction AND Party__c IN :partyIds',
            new Map<String,Object>{'scopeIds'=>scopeIds,'scopeType'=>'STEM','direction'=>'Buy','partyIds'=>partyIds});
    }

    public static Set<String> nativeScopes(Set<String> scopeIds) {
        Set<String> found=new Set<String>();
        if(scopeIds==null || scopeIds.isEmpty()) return found;
        for(Trade_Currency_Side__c side:sides('SELECT '+SIDE_FIELDS+' FROM Trade_Currency_Side__c WHERE Scope_Id__c IN :scopeIds AND Currency__c = :currencyCode',
            new Map<String,Object>{'scopeIds'=>scopeIds,'currencyCode'=>'HKD'})) found.add(side.Scope_Id__c);
        return found;
    }

    public static void saveSide(Trade_Currency_Side__c side) {
        if (side == null) return;
        requireManagedWrite();
        Database.upsert(new List<Trade_Currency_Side__c>{side},Trade_Currency_Side__c.Fields.External_Key__c,true,AccessLevel.SYSTEM_MODE);
    }

    public static void insertSides(List<Trade_Currency_Side__c> sides) {
        if (sides == null || sides.isEmpty()) return;
        requireManagedWrite();
        Database.insert(sides,true,AccessLevel.SYSTEM_MODE);
    }

    public static void updateSide(Trade_Currency_Side__c side) {
        if (side == null) return;
        requireManagedWrite();
        Database.update(side,true,AccessLevel.SYSTEM_MODE);
    }

    private static List<Trade_Currency_Side__c> sides(String query, Map<String,Object> binds) {
        List<Trade_Currency_Side__c> result = new List<Trade_Currency_Side__c>();
        for (SObject row : Database.queryWithBinds(query,binds,AccessLevel.SYSTEM_MODE)) result.add((Trade_Currency_Side__c)row);
        return result;
    }

    private static void requireManagedWrite() {
        if (!FcosTradeCurrencyService.isManagedWrite()) {
            throw new FcosTradeCurrencyService.TradeFxException('Canonical trading currency sides require a managed reviewed write.');
        }
    }
}
