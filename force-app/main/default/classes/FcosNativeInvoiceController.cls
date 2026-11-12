/** Renders native invoice financials solely from immutable issued-document evidence. */
public with sharing class FcosNativeInvoiceController {
    public class NativeInvoiceException extends Exception {}
    public class DisplayLine {
        public String description {get;set;}
        public String quantity {get;set;}
        public String unitPrice {get;set;}
        public String amount {get;set;}
        public String pricingBasis {get;set;}
    }
    public Invoice__c invoice {get;private set;}
    public List<DisplayLine> lines {get;private set;}
    public String nativeTotal {get;private set;}
    public String accountingTotal {get;private set;}
    public String companyRate {get;private set;}
    public String currencyCode {get;private set;}
    public Boolean isHkd {get {return currencyCode=='HKD';}}
    public Boolean isProforma {get;private set;}
    public String depositRequested {get;private set;}
    public String depositUsdEquivalent {get;private set;}
    public String depositDisclosure {get;private set;}
    public Boolean showDeposit {get;private set;}
    public Date depositDueDate {get;private set;}
    public Map<String,String> presentation {get;private set;}
    public String title {get;private set;}
    public String proformaReference {get;private set;}
    public Boolean finalFromProforma {get;private set;}
    public FcosNativeInvoiceController() {
        Id invoiceId=(Id)ApexPages.currentPage().getParameters().get('id');
        if(invoiceId==null) throw new NativeInvoiceException('An exact saved native invoice is required.');
        invoice=[SELECT Id,Name,Invoice_Date__c,Invoice_Due_Date__c,Delivery_Date__c,
            Amount__c,Reissue_Of_Invoice__c,Document_FX_Fingerprint__c,Document_Presentation_JSON__c,Document_Currency__c,Document_HKD_Amount__c,Document_FX_Rate__c,
            Document_FX_Revision__c,Document_FX_Confirmed_At__c,Document_FX_Side__c,Proforma__c,Deprecated__c,Final_Of_Proforma__c,Final_Of_Proforma__r.Name,
            Deposit_Requested_HKD__c,Deposit_Requested_USD__c,Deposit_Due_Date__c
            FROM Invoice__c WHERE Id=:invoiceId];
        List<Trade_Document_Line__c> evidence=FcosTradeDocumentLineService.readForAuthorizedDocument(invoiceId);
        lines=project(invoice,evidence);
        presentation=readPresentation(invoice.Document_Presentation_JSON__c);
        currencyCode=invoice.Document_Currency__c;
        nativeTotal=decimalText(isHkd?invoice.Document_HKD_Amount__c:invoice.Amount__c,2);
        accountingTotal=decimalText(invoice.Amount__c,2);
        companyRate=decimalText(invoice.Document_FX_Rate__c,6);
        isProforma=invoice.Proforma__c==true;depositDueDate=invoice.Deposit_Due_Date__c;
        Decimal deposit=isHkd?invoice.Deposit_Requested_HKD__c:invoice.Deposit_Requested_USD__c;
        showDeposit=invoice.Deposit_Due_Date__c!=null;depositRequested=decimalText(deposit,2);depositUsdEquivalent=decimalText(invoice.Deposit_Requested_USD__c,2);
        depositDisclosure=isProforma?'This proforma is a payment request. It is not evidence that cash was received or allocated.':'The gross invoice amount is shown above. Any actual deposit allocation is recorded separately.';
        finalFromProforma=invoice.Final_Of_Proforma__c!=null;proformaReference=finalFromProforma?invoice.Final_Of_Proforma__r.Name:null;
        title=isProforma?'PROFORMA INVOICE':invoice.Amount__c<0?'CREDIT NOTE':'INVOICE';
    }
    public static String capturePresentation(Id stemId) {
        return capturePresentation(stemId,false);
    }
    public static String capturePresentation(Id stemId,Boolean allowReviewedDepositTerms) {
        STEM__c stem=[SELECT Id,KeyStem__c,Partial_CIA__c,Account__r.Name,Account__r.Imported_Address__c,
            Account__r.Banking_Preference__c,Account__r.Attn_Override__c,Account__r.Attn__c,
            Contact__r.Salutation,Contact__r.Name,Vessel__r.Name,Vessel__r.IMO__c,Port__r.Name,Payment_Term__c,Mailing_Requirement__c,PO_Voyage_Number__c,
            Buyer_Broker__c,Buyer_Broker__r.Name,Buyer_Broker__r.Invoice_Format__c,Buyer_Broker__r.Imported_Address__c,
            Buyer_Broker__r.Attn_Override__c,Buyer_Broker__r.Attn__c,Buyer_Broker__r.Default_Contact__c,
            Buyer_Broker__r.Default_Contact__r.Salutation,Buyer_Broker__r.Default_Contact__r.Name
            FROM STEM__c WHERE Id=:stemId];
        if(stem.Partial_CIA__c==true && !allowReviewedDepositTerms) throw new NativeInvoiceException('Reconcile native prepayments before generating the invoice.');
        String bank=stem.Account__r.Banking_Preference__c;
        if(bank!='DBS' && bank!='UBS') throw new NativeInvoiceException('Set the buyer banking preference explicitly to DBS or UBS.');
        SObject configuration=bank=='DBS'?(SObject)DBS_Bank__c.getOrgDefaults():(SObject)UBS_Bank__c.getOrgDefaults();
        if(configuration==null || String.isBlank((String)configuration.get('Beneficiary_Bank__c'))
            || String.isBlank((String)configuration.get('Beneficiary__c')) || String.isBlank((String)configuration.get('Account_No__c')))
            throw new NativeInvoiceException('The selected beneficiary bank instructions are incomplete.');
        List<Payment_Term__c> terms=[SELECT Name,Description__c FROM Payment_Term__c WHERE Name=:stem.Payment_Term__c LIMIT 1];
        if(terms.isEmpty()) throw new NativeInvoiceException('A configured invoice payment term is required.');
        Map<String,String> header=new Map<String,String>{
            'version'=>'1','legalEntity'=>'FRATELLI COSULICH BUNKERS (HK) LTD',
            'companyContact'=>'UNITS 02-03, 23/F, PLAZA 228, 228 WAN CHAI ROAD, HONG KONG; T +852-25299138 GENERAL@COSULICH.COM.HK',
            'buyerName'=>stem.Account__r.Name,'buyerAddress'=>stem.Account__r.Imported_Address__c,
            'attention'=>stem.Account__r.Attn_Override__c==true?stem.Account__r.Attn__c:stem.Contact__r==null?'':(stem.Contact__r.Salutation==null?'':stem.Contact__r.Salutation+' ')+stem.Contact__r.Name,
            'vessel'=>stem.Vessel__r==null?'':stem.Vessel__r.Name,'imo'=>stem.Vessel__r==null?'':stem.Vessel__r.IMO__c,
            'port'=>stem.Port__r==null?'':stem.Port__r.Name,'reference'=>stem.KeyStem__c,
            'paymentTerm'=>terms[0].Name+' '+(terms[0].Description__c==null?'':terms[0].Description__c),
            'bankSelection'=>bank,'beneficiaryBank'=>(String)configuration.get('Beneficiary_Bank__c'),
            'beneficiary'=>(String)configuration.get('Beneficiary__c'),'accountNumber'=>(String)configuration.get('Account_No__c'),
            'intermediaryBank'=>bank=='UBS'?(String)configuration.get('Intermediary_Bank__c'):'',
            'paymentInstruction'=>'PLEASE MAKE PAYMENT BY TELEGRAPHIC TRANSFER, FREE OF ANY BANK CHARGES. PLEASE MENTION OUR INVOICE REFERENCE NUMBER WHEN SENDING PAYMENT.'
        };
        if(stem.Buyer_Broker__c!=null && stem.Buyer_Broker__r.Invoice_Format__c=='Buyer C/O Broker') {
            header.put('buyerName',stem.Account__r.Name+' — C/O '+stem.Buyer_Broker__r.Name);
            header.put('buyerAddress',stem.Buyer_Broker__r.Imported_Address__c);
            header.put('attention',stem.Buyer_Broker__r.Attn_Override__c==true?stem.Buyer_Broker__r.Attn__c:
                stem.Buyer_Broker__r.Default_Contact__c==null?'':
                (stem.Buyer_Broker__r.Default_Contact__r.Salutation==null?'':stem.Buyer_Broker__r.Default_Contact__r.Salutation+' ')+stem.Buyer_Broker__r.Default_Contact__r.Name);
        }
        header.put('mailingRequirement',stem.Mailing_Requirement__c);
        if(stem.Mailing_Requirement__c!=null && stem.Mailing_Requirement__c.contains('-2'))
            header.put('reference',stem.KeyStem__c+' / P/O VOYAGE # '+(stem.PO_Voyage_Number__c==null?'':stem.PO_Voyage_Number__c));
        if(stem.Mailing_Requirement__c!=null && stem.Mailing_Requirement__c.contains('-4'))
            throw new NativeInvoiceException('The buyer requires BDN product names. Verify and snapshot those names before generating a native invoice.');
        // Existing buyer-confirmation seller rule: a Singapore trustee changes the legal seller.
        List<STEM_Extra_Cost__c> trustee=[SELECT Id FROM STEM_Extra_Cost__c WHERE STEM__c=:stemId
            AND Product2Id__r.Name='TRUSTEE SERVICE' AND Supplier__r.Name='FRATELLI COSULICH BUNKERS (S) PTE LTD' LIMIT 1];
        if(!trustee.isEmpty()) {
            header.put('legalEntity','FRATELLI COSULICH BUNKERS (S) PTE LTD.');
            if(!((String)configuration.get('Beneficiary__c')).toUpperCase().contains('FRATELLI COSULICH BUNKERS (S)'))
                throw new NativeInvoiceException('The Singapore trustee seller requires matching configured beneficiary instructions before native invoicing.');
        }
        String snapshot=JSON.serialize(header);
        if(snapshot.length()>32768) throw new NativeInvoiceException('Invoice presentation exceeds the supported snapshot size.');
        return snapshot;
    }
    @TestVisible private static Map<String,String> readPresentation(String snapshot) {
        if(String.isBlank(snapshot)) throw new NativeInvoiceException('The immutable invoice presentation snapshot is missing.');
        Map<String,String> result=(Map<String,String>)JSON.deserialize(snapshot,Map<String,String>.class);
        if(result==null || result.get('version')!='1' || String.isBlank(result.get('legalEntity')) || String.isBlank(result.get('buyerName'))
            || String.isBlank(result.get('beneficiaryBank')) || String.isBlank(result.get('accountNumber')))
            throw new NativeInvoiceException('The immutable invoice presentation snapshot is incomplete.');
        return result;
    }
    @TestVisible private static String decimalText(Decimal value,Integer scale) {
        return value==null?'':String.valueOf(value.setScale(scale,RoundingMode.HALF_UP));
    }
    @TestVisible private static List<DisplayLine> project(Invoice__c document,List<Trade_Document_Line__c> evidence) {
        Boolean hkd=document.Document_Currency__c=='HKD';
        Boolean managedUsd=document.Document_Currency__c=='USD' && document.Document_FX_Side__c!=null
            && document.Document_FX_Confirmed_At__c!=null && !String.isBlank(document.Document_FX_Fingerprint__c);
        if((!hkd && !managedUsd) || document.Amount__c==null
            || (hkd && (document.Document_HKD_Amount__c==null || document.Document_FX_Rate__c==null || document.Document_FX_Rate__c<=0 || String.isBlank(document.Document_FX_Revision__c)))
            || (managedUsd && (document.Document_HKD_Amount__c!=null || document.Document_FX_Rate__c!=null || document.Document_FX_Revision__c!=null || String.isBlank(document.Document_FX_Fingerprint__c)))
            || document.Document_FX_Confirmed_At__c==null || document.Deprecated__c==true || evidence.isEmpty())
            throw new NativeInvoiceException('A confirmed active native invoice and immutable line evidence are required.');
        Decimal total=0;List<DisplayLine> output=new List<DisplayLine>();
        for(Trade_Document_Line__c line:evidence) {
            if(line.Currency__c!=document.Document_Currency__c || line.FX_Rate__c!=document.Document_FX_Rate__c || line.FX_Revision__c!=document.Document_FX_Revision__c || line.Native_Amount__c==null || (managedUsd && line.Native_Amount__c!=line.Accounting_USD__c))
                throw new NativeInvoiceException('The document line currency or original rate does not match the invoice.');
            DisplayLine display=new DisplayLine();display.description=line.Description__c;
            if(line.Pricing_Mode__c=='Minimum') {
                if(line.Native_Minimum__c==null) throw new NativeInvoiceException('The immutable minimum charge is missing.');
                display.pricingBasis='Minimum charge '+document.Document_Currency__c+' '+decimalText(line.Native_Minimum__c,8)+' applies';
            } else if(line.Pricing_Mode__c=='Lumpsum') {
                if(line.Native_Lumpsum__c==null) throw new NativeInvoiceException('The immutable lumpsum charge is missing.');
                display.pricingBasis='Fixed lumpsum '+document.Document_Currency__c+' '+decimalText(line.Native_Lumpsum__c,8);
            } else if(line.Pricing_Mode__c=='Excluded') {
                if(line.Native_Amount__c!=0) throw new NativeInvoiceException('An excluded charge must have zero amount.');
                display.pricingBasis='Excluded from this trading side';
            } else if(line.Pricing_Mode__c=='Unit') display.pricingBasis='Quantity × agreed unit price';
            else throw new NativeInvoiceException('The immutable pricing basis is missing or unsupported.');
            Decimal exactAmount=FcosTradeDocumentLineService.nativeAmount(line);
            total+=exactAmount;
            display.quantity=decimalText(line.Quantity__c,6)+' '+(line.Unit__c==null?'':line.Unit__c);
            display.unitPrice=decimalText(line.Native_Unit_Price__c,8);display.amount=decimalText(exactAmount,2);output.add(display);
        }
        Decimal expectedNative=hkd?document.Document_HKD_Amount__c:document.Amount__c;
        if(total.setScale(2,RoundingMode.HALF_UP)!=expectedNative || (hkd && (expectedNative/document.Document_FX_Rate__c).setScale(2,RoundingMode.HALF_UP)!=document.Amount__c))
            throw new NativeInvoiceException('Immutable document lines do not reconcile to the saved native and USD totals.');
        return output;
    }
}
