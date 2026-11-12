/** Parent edits cannot move a native-currency trade to a different buyer or delivery port. */
public with sharing class FcosTradeCurrencyParentGuard {
    public static void guard(List<SObject> rows,Map<Id,SObject> oldRows,Boolean deleting) {
        if(FcosTradeCurrencyService.isManagedWrite()) return;
        Set<String> scopes=new Set<String>();
        for(SObject row:rows) {
            SObject oldRow=oldRows==null?null:oldRows.get(row.Id);
            if(!deleting && (oldRow==null || row.get('Sell_Currency__c')!=oldRow.get('Sell_Currency__c') || row.get('Sell_FX_Side__c')!=oldRow.get('Sell_FX_Side__c'))
                && (row.get('Sell_Currency__c')=='HKD' || row.get('Sell_FX_Side__c')!=null || (oldRow!=null && oldRow.get('Sell_Currency__c')=='HKD'))) row.addError('Use the reviewed buyer-side currency action.');
            if(row.Id!=null && (deleting || contextChanged(row,oldRow))) scopes.add(String.valueOf(row.Id));
        }
        if(scopes.isEmpty()) return;
        Set<String> nativeScopes=FcosTradeEvidenceStore.nativeScopes(scopes);
        for(SObject row:rows) if(nativeScopes.contains(String.valueOf(row.Id))) row.addError('Retain the buyer, delivery port and USD accounting currency of this HKD trade. Use the explicit amendment and credit/reissue workflow.');
    }
    @TestVisible private static Boolean contextChanged(SObject row,SObject oldRow) {
        if(oldRow==null) return false;
        Map<String,Schema.SObjectField> fields=row.getSObjectType().getDescribe().fields.getMap();
        for(String field:new List<String>{'Account__c','Quote_Buyer__c','Port__c','CurrencyIsoCode'}) if(fields.containsKey(field) && row.get(field)!=oldRow.get(field)) return true;
        return false;
    }
}
