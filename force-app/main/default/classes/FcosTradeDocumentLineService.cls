/** Immutable issued document lines keep original amounts available for credits and audit. */
public with sharing class FcosTradeDocumentLineService {
    private static Boolean managed=false;
    /** The numeric amount is a six-decimal projection, not the final-rounding input. */
    public static Decimal nativeAmount(Trade_Document_Line__c line) {
        if(line==null || line.Native_Amount__c==null) throw new AuraHandledException('The immutable native line amount is required.');
        if(line.Currency__c!='HKD') return line.Native_Amount__c;
        Decimal exactAmount;
        if(line.Pricing_Mode__c=='Unit') {
            if(line.Quantity__c==null || line.Native_Unit_Price__c==null)
                throw new AuraHandledException('The immutable quantity and agreed native unit price are required.');
            exactAmount=line.Quantity__c*line.Native_Unit_Price__c;
        } else if(line.Pricing_Mode__c=='Minimum') exactAmount=line.Native_Minimum__c;
        else if(line.Pricing_Mode__c=='Lumpsum') exactAmount=line.Native_Lumpsum__c;
        else if(line.Pricing_Mode__c=='Excluded') exactAmount=0;
        else throw new AuraHandledException('The immutable native pricing basis is required.');
        if(exactAmount==null || exactAmount.setScale(6,RoundingMode.HALF_UP)!=line.Native_Amount__c.setScale(6,RoundingMode.HALF_UP))
            throw new AuraHandledException('The saved native amount does not match its immutable pricing inputs.');
        return exactAmount;
    }
    public static void persist(SObject document,FcosTradeDocumentService.DocumentReview review) {
        if(document.Id==null || review==null || (review.currencyCode!='HKD' && !FcosTradeDocumentService.isManagedDocument(document))) return;
        Id documentId=document.Id;
        if(FcosTradeDocumentLineStore.hasEvidenceForAuthorizedDocument(documentId)) return;
        String parent=parentField(document.getSObjectType());
        List<Trade_Document_Line__c> lines=new List<Trade_Document_Line__c>();
        for(FcosTradeDocumentService.Line line:review.lines) {
            Trade_Document_Line__c snapshot=new Trade_Document_Line__c(Source_Record_Id__c=String.valueOf(line.id),Description__c=line.name,Unit__c=line.unit,
                Quantity__c=line.quantity,Native_Unit_Price__c=line.nativeUnitPrice,Native_Amount__c=line.nativeAmount.setScale(6,RoundingMode.HALF_UP),
                Pricing_Mode__c=line.pricingMode,Native_Minimum__c=line.nativeMinimum,Native_Lumpsum__c=line.nativeLumpsum,
                Accounting_USD__c=(review.currencyCode=='USD'?line.nativeAmount:line.nativeAmount/review.rate).setScale(6,RoundingMode.HALF_UP),Currency__c=review.currencyCode,FX_Rate__c=review.rate,FX_Revision__c=review.rateId,Original_Line__c=line.originalLineId);
            snapshot.put(parent,document.Id);lines.add(snapshot);
        }
        if(lines.isEmpty()) throw new AuraHandledException('Native document line evidence is required.');
        managed=true;try { FcosTradeDocumentLineStore.insertForAuthorizedDocument(documentId,lines); } finally { managed=false; }
    }

    /**
     * A document is the sharing boundary. The immutable child evidence remains
     * private, so its system-mode store must always invoke this with-sharing
     * proof first.
     */
    public static void assertDocumentReadAccess(Set<Id> documentIds) {
        if(documentIds==null || documentIds.isEmpty()) throw new AuraHandledException('An issued business document is required.');
        Set<Id> buyers=new Set<Id>(),suppliers=new Set<Id>(),nominations=new Set<Id>();
        for(Id documentId:documentIds) {
            if(documentId==null) throw new AuraHandledException('An issued business document is required.');
            Schema.SObjectType type=documentId.getSObjectType();
            if(type==Invoice__c.SObjectType) buyers.add(documentId);
            else if(type==Supplier_Invoice__c.SObjectType) suppliers.add(documentId);
            else if(type==Nomination__c.SObjectType) nominations.add(documentId);
            else throw new AuraHandledException('Unsupported native document type.');
        }
        // This class is with sharing. Do not replace these parent probes with
        // system mode: visibility of the business document authorizes its lines.
        if(!buyers.isEmpty() && [SELECT COUNT() FROM Invoice__c WHERE Id IN:buyers] != buyers.size()) throw new AuraHandledException('The business document is unavailable.');
        if(!suppliers.isEmpty() && [SELECT COUNT() FROM Supplier_Invoice__c WHERE Id IN:suppliers] != suppliers.size()) throw new AuraHandledException('The business document is unavailable.');
        if(!nominations.isEmpty() && [SELECT COUNT() FROM Nomination__c WHERE Id IN:nominations] != nominations.size()) throw new AuraHandledException('The business document is unavailable.');
    }

    public static List<Trade_Document_Line__c> readForAuthorizedDocument(Id documentId) {
        return FcosTradeDocumentLineStore.readForAuthorizedDocuments(new Set<Id>{documentId},false);
    }

    /** For reissue/document projection: preserves the original immutable line id for each source record. */
    public static Map<Id,Id> originalLineIdsBySourceForAuthorizedDocuments(Set<Id> documentIds) {
        Map<Id,Id> result=new Map<Id,Id>();
        for(Trade_Document_Line__c line:FcosTradeDocumentLineStore.readForAuthorizedDocuments(documentIds,false)) {
            if(!String.isBlank(line.Source_Record_Id__c) && Pattern.matches('[a-zA-Z0-9]{15,18}',line.Source_Record_Id__c)) result.put(Id.valueOf(line.Source_Record_Id__c),line.Id);
        }
        return result;
    }
    public static String parentField(Schema.SObjectType type) {
        if(type==Invoice__c.SObjectType) return 'Buyer_Invoice__c';
        if(type==Supplier_Invoice__c.SObjectType) return 'Supplier_Invoice__c';
        if(type==Nomination__c.SObjectType) return 'Nomination__c';
        throw new AuraHandledException('Unsupported native document type.');
    }
    public static void guard(List<Trade_Document_Line__c> rows) {
        if(managed) return;
        for(Trade_Document_Line__c row:rows) row.addError('Document lines are immutable evidence created by the reviewed document workflow.');
    }
}
