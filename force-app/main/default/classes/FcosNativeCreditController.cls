public with sharing class FcosNativeCreditController {
    public class NativeCreditException extends Exception {}
    public String currencyCode {get;private set;}
    public Boolean isHkd {get {return currencyCode=='HKD';}}
    public Map<String,String> presentation {get;private set;}
    public SObject document {get;private set;}
    public String title {get;private set;}
    public String reference {get;private set;}
    public String originalReference {get;private set;}
    public Boolean showOriginal {get;private set;}
    public String counterparty {get;private set;}
    public String reason {get;private set;}
    public String dateLabel {get;private set;}
    public String amountLabel {get;private set;}
    public String footerText {get;private set;}
    public Date creditDate {get;private set;}
    public Decimal total {get;private set;}
    public Decimal usd {get;private set;}
    public Decimal rate {get;private set;}
    public String revision {get;private set;}
    public Boolean showDeposit {get;private set;}
    public Decimal depositRequested {get;private set;}
    public Decimal depositUsdEquivalent {get;private set;}
    public Date depositDueDate {get;private set;}
    public List<Trade_Document_Line__c> lines {get;private set;}
    public Map<Id,Decimal> exactLineAmounts {get;private set;}

    public FcosNativeCreditController() {
        Id documentId=Id.valueOf(ApexPages.currentPage().getParameters().get('id'));
        Boolean buyer=documentId.getSObjectType()==Invoice__c.SObjectType;
        if(!buyer && documentId.getSObjectType()!=Supplier_Invoice__c.SObjectType) throw new AuraHandledException('Select a native credit or supplier document.');
        if(!buyer) {
            Supplier_Invoice__c supplier=[SELECT Id,Name,Invoice_Date__c,Credit_Reason__c,Invoice_Amount__c,Proforma__c,Final_Of_Proforma__c,Final_Of_Proforma__r.Name,
                Original_Supplier_Invoice__c,Original_Supplier_Invoice__r.Name,Original_Supplier_Invoice__r.Document_Currency__c,
                Original_Supplier_Invoice__r.Document_HKD_Amount__c,Original_Supplier_Invoice__r.Document_FX_Rate__c,
                Original_Supplier_Invoice__r.Document_FX_Revision__c,Original_Supplier_Invoice__r.Document_FX_Fingerprint__c,
                Original_Supplier_Invoice__r.Document_FX_Confirmed_At__c,Original_Supplier_Invoice__r.Document_FX_Side__c,Original_Supplier_Invoice__r.Document_Presentation_JSON__c,
                Original_Supplier_Invoice__r.Reissue_Of_Supplier_Invoice__c,Document_Currency__c,Document_HKD_Amount__c,Document_FX_Rate__c,
                Document_FX_Revision__c,Document_FX_Confirmed_At__c,Document_FX_Side__c,Document_FX_Fingerprint__c,Document_Presentation_JSON__c,
                Deposit_Requested_HKD__c,Deposit_Requested_USD__c,Deposit_Due_Date__c FROM Supplier_Invoice__c WHERE Id=:documentId];
            document=supplier;lines=FcosTradeDocumentLineService.readForAuthorizedDocument(documentId);
            if(supplier.Original_Supplier_Invoice__c!=null) initializeCredit(supplier,supplier.Original_Supplier_Invoice__r,false);
            else initializeSupplierDocument(supplier);
            return;
        }
        Invoice__c credit=[SELECT Id,Name,Invoice_Date__c,Credit_Reason__c,Amount__c,Original_Invoice__c,
            Original_Invoice__r.Name,Original_Invoice__r.Document_Currency__c,Original_Invoice__r.Document_HKD_Amount__c,
            Original_Invoice__r.Document_FX_Rate__c,Original_Invoice__r.Document_FX_Revision__c,Original_Invoice__r.Document_FX_Fingerprint__c,
            Original_Invoice__r.Document_FX_Confirmed_At__c,Original_Invoice__r.Document_FX_Side__c,Original_Invoice__r.Document_Presentation_JSON__c,Original_Invoice__r.Reissue_Of_Invoice__c,
            Document_Currency__c,Document_HKD_Amount__c,Document_FX_Rate__c,Document_FX_Revision__c,Document_FX_Confirmed_At__c,Document_FX_Side__c
            FROM Invoice__c WHERE Id=:documentId];
        document=credit;if(credit.Original_Invoice__c==null) throw new NativeCreditException('The credit requires an original managed invoice.');
        lines=FcosTradeDocumentLineService.readForAuthorizedDocument(documentId);initializeCredit(credit,credit.Original_Invoice__r,true);
    }
    private void initializeCredit(SObject credit,SObject original,Boolean buyer) {
        validateProjection(credit,original,lines);exactLineAmounts=amounts(lines);
        presentation=readPresentation((String)original.get('Document_Presentation_JSON__c'),buyer);
        title=buyer?'CREDIT NOTE':'SUPPLIER CREDIT RECORD';reference=(String)credit.get('Name');originalReference=(String)original.get('Name');showOriginal=true;
        counterparty=presentation.get(buyer?'buyerName':'supplierName');reason=(String)credit.get('Credit_Reason__c');creditDate=(Date)credit.get('Invoice_Date__c');
        currencyCode=(String)credit.get('Document_Currency__c');usd=(Decimal)credit.get(buyer?'Amount__c':'Invoice_Amount__c');
        total=isHkd?(Decimal)credit.get('Document_HKD_Amount__c'):usd;rate=(Decimal)credit.get('Document_FX_Rate__c');revision=(String)credit.get('Document_FX_Revision__c');
        dateLabel='Credit date';amountLabel='Credit amount';footerText='This credit reverses the referenced invoice in its agreed currency. The original invoice remains part of the accounting record.';
    }
    private void initializeSupplierDocument(Supplier_Invoice__c supplier) {
        if(!FcosTradeDocumentService.isManagedDocument(supplier) || (supplier.Proforma__c!=true && supplier.Final_Of_Proforma__c==null))
            throw new NativeCreditException('Select a managed supplier proforma or its final document.');
        validatePositive(supplier,lines);exactLineAmounts=amounts(lines);presentation=readPresentation(supplier.Document_Presentation_JSON__c,false);
        title=supplier.Proforma__c?'SUPPLIER PROFORMA':'SUPPLIER INVOICE';reference=supplier.Name;showOriginal=supplier.Final_Of_Proforma__c!=null;
        originalReference=showOriginal?supplier.Final_Of_Proforma__r.Name:null;counterparty=presentation.get('supplierName');creditDate=supplier.Invoice_Date__c;
        currencyCode=supplier.Document_Currency__c;usd=supplier.Invoice_Amount__c;total=isHkd?supplier.Document_HKD_Amount__c:usd;
        rate=supplier.Document_FX_Rate__c;revision=supplier.Document_FX_Revision__c;dateLabel='Document date';amountLabel='Amount';
        showDeposit=supplier.Deposit_Due_Date__c!=null;depositRequested=isHkd?supplier.Deposit_Requested_HKD__c:supplier.Deposit_Requested_USD__c;depositUsdEquivalent=supplier.Deposit_Requested_USD__c;depositDueDate=supplier.Deposit_Due_Date__c;
        reason='';
        footerText=supplier.Proforma__c?'This proforma is a payment request. It is not evidence that cash was received or allocated.':'This final document states the gross amount. Any deposit allocation is recorded separately.';
    }
    private static Map<Id,Decimal> amounts(List<Trade_Document_Line__c> evidence) {Map<Id,Decimal> result=new Map<Id,Decimal>();for(Trade_Document_Line__c line:evidence)result.put(line.Id,FcosTradeDocumentLineService.nativeAmount(line));return result;}
    public static String captureSupplierPresentation(Id stemId,Id supplierId) {
        STEM__c stem=[SELECT KeyStem__c FROM STEM__c WHERE Id=:stemId];Account supplier=[SELECT Name FROM Account WHERE Id=:supplierId];
        return JSON.serialize(new Map<String,String>{'version'=>'1','legalEntity'=>'FRATELLI COSULICH BUNKERS (HK) LTD',
            'companyContact'=>'UNITS 02-03, 23/F, PLAZA 228, 228 WAN CHAI ROAD, HONG KONG; T +852-25299138 GENERAL@COSULICH.COM.HK',
            'supplierName'=>supplier.Name,'reference'=>stem.KeyStem__c});
    }
    @TestVisible private static Map<String,String> readPresentation(String value,Boolean buyer) {
        if(String.isBlank(value)) throw new NativeCreditException('The original immutable presentation is missing.');
        Map<String,String> result=(Map<String,String>)JSON.deserialize(value,Map<String,String>.class);
        if(result==null || result.get('version')!='1' || String.isBlank(result.get('legalEntity')) || String.isBlank(result.get(buyer?'buyerName':'supplierName')))
            throw new NativeCreditException('The original immutable presentation is incomplete.');return result;
    }
    private static void validatePositive(SObject row,List<Trade_Document_Line__c> evidence) {
        String documentCurrency=(String)row.get('Document_Currency__c');Boolean hkd=documentCurrency=='HKD';Decimal principal=(Decimal)row.get('Invoice_Amount__c');Decimal nativeHkd=(Decimal)row.get('Document_HKD_Amount__c');
        Decimal fx=(Decimal)row.get('Document_FX_Rate__c');String revision=(String)row.get('Document_FX_Revision__c');
        if(principal==null || principal<0 || evidence.isEmpty() || row.get('Document_FX_Confirmed_At__c')==null || row.get('Document_FX_Side__c')==null || String.isBlank((String)row.get('Document_FX_Fingerprint__c'))
            || (hkd && (nativeHkd==null || fx==null || fx<=0 || String.isBlank(revision))) || (!hkd && (documentCurrency!='USD' || nativeHkd!=null || fx!=null || revision!=null)))
            throw new NativeCreditException('The supplier document snapshot is incomplete.');
        Decimal sum=0;for(Trade_Document_Line__c line:evidence){if(line.Currency__c!=documentCurrency || line.FX_Rate__c!=fx || line.FX_Revision__c!=revision)throw new NativeCreditException('The supplier document line evidence is inconsistent.');sum+=FcosTradeDocumentLineService.nativeAmount(line);}
        Decimal nativeTotal=hkd?nativeHkd:principal;if(sum.setScale(2,RoundingMode.HALF_UP)!=nativeTotal || (hkd && (nativeTotal/fx).setScale(2,RoundingMode.HALF_UP)!=principal))throw new NativeCreditException('The supplier document totals do not reconcile.');
    }
    @TestVisible private static void validateProjection(SObject credit,SObject original,List<Trade_Document_Line__c> evidence) {
        Boolean buyer=credit.getSObjectType()==Invoice__c.SObjectType;String localCurrency=(String)credit.get('Document_Currency__c');Boolean hkd=localCurrency=='HKD';
        Boolean managedUsd=localCurrency=='USD' && original.get('Document_Currency__c')=='USD' && original.get('Document_FX_Side__c')!=null
            && !String.isBlank((String)original.get('Document_FX_Fingerprint__c')) && original.get('Document_FX_Confirmed_At__c')!=null;
        Decimal principal=(Decimal)credit.get(buyer?'Amount__c':'Invoice_Amount__c');Decimal nativeHkd=(Decimal)credit.get('Document_HKD_Amount__c');Decimal fx=(Decimal)credit.get('Document_FX_Rate__c');String revision=(String)credit.get('Document_FX_Revision__c');
        if((!hkd&&!managedUsd) || principal==null || principal>0 || evidence.isEmpty() || localCurrency!=original.get('Document_Currency__c') || credit.get('Document_FX_Confirmed_At__c')==null || credit.get('Document_FX_Side__c')!=original.get('Document_FX_Side__c')
            || (hkd && (nativeHkd==null || fx==null || fx<=0 || String.isBlank(revision) || fx!=original.get('Document_FX_Rate__c') || revision!=original.get('Document_FX_Revision__c')))
            || (managedUsd && (nativeHkd!=null || fx!=null || revision!=null || original.get('Document_HKD_Amount__c')!=null || original.get('Document_FX_Rate__c')!=null || original.get('Document_FX_Revision__c')!=null)))
            throw new NativeCreditException('The credit currency and immutable original evidence are inconsistent.');
        Decimal sum=0;Set<String> pricingModes=new Set<String>{'Unit','Minimum','Lumpsum','Excluded'};
        for(Trade_Document_Line__c line:evidence){if(line.Currency__c!=localCurrency || line.Native_Amount__c==null || line.FX_Rate__c!=fx || line.FX_Revision__c!=revision || (managedUsd && line.Native_Amount__c!=line.Accounting_USD__c) || !pricingModes.contains(line.Pricing_Mode__c) || (line.Pricing_Mode__c=='Minimum'&&line.Native_Minimum__c==null) || (line.Pricing_Mode__c=='Lumpsum'&&line.Native_Lumpsum__c==null) || (line.Pricing_Mode__c=='Excluded'&&line.Native_Amount__c!=0))throw new NativeCreditException('The immutable credit line currency, rate, or pricing evidence is inconsistent.');sum+=FcosTradeDocumentLineService.nativeAmount(line);}
        Decimal nativeTotal=hkd?nativeHkd:principal;if(sum.setScale(2,RoundingMode.HALF_UP)!=nativeTotal || (hkd && (nativeTotal/fx).setScale(2,RoundingMode.HALF_UP)!=principal))throw new NativeCreditException('The immutable credit totals do not reconcile.');
    }
}
