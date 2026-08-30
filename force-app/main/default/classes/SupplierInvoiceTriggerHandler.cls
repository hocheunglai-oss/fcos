public class SupplierInvoiceTriggerHandler {
    
    public static void setRefcodeIndex(List<Supplier_Invoice__c> supplierInvoices){
        String chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        Set<String> stemIds = new Set<String>();
        for(Supplier_Invoice__c supplierInvoice: supplierInvoices){
            stemIds.add(supplierInvoice.STEM__c);
        }
        List<Supplier_Invoice__c> currentSupplierInvoices = [SELECT Id, Supplier__c, STEM__c, Refcode_Index__c
                                                             FROM Supplier_Invoice__c 
                                                             WHERE STEM__c IN: stemIds
                                                             ORDER BY Refcode_Index__c];
        Map<Id, List<Supplier_Invoice__c>> supplierToInvoiceMap = new Map<Id, List<Supplier_Invoice__c>>();
        for(Supplier_Invoice__c currentSupplierInvoice: currentSupplierInvoices){
            if(supplierToInvoiceMap.get(currentSupplierInvoice.Supplier__c) == null){
                supplierToInvoiceMap.put(currentSupplierInvoice.Supplier__c, new List<Supplier_Invoice__c>());
            }
            supplierToInvoiceMap.get(currentSupplierInvoice.Supplier__c).add(currentSupplierInvoice);
        }
        for(Supplier_Invoice__c supplierInvoice: supplierInvoices){
            if(supplierInvoice.Refcode_Index__c == null){
                if(supplierToInvoiceMap.isEmpty()){
                    supplierInvoice.Refcode_Index__c = supplierInvoice.KeyStem__c.substring(4, supplierInvoice.KeyStem__c.length() - 1) + 'P1A';
                } else if(supplierToInvoiceMap.get(supplierInvoice.Supplier__c) == null){
                    String refcodeIndex = supplierToInvoiceMap.values()[supplierToInvoiceMap.size() - 1][0].Refcode_Index__c;
                    Integer secondLastDigitIndex = refcodeIndex.length() - 2;
                    String baseRef = refcodeIndex.substring(0, secondLastDigitIndex);
                    Integer updatedDigit = Integer.valueOf(refcodeIndex.substring(secondLastDigitIndex, secondLastDigitIndex + 1)) + 1;
                    String newRefcode = baseRef + updatedDigit + 'A';
                    
                    supplierInvoice.Refcode_Index__c = newRefcode;
                } else{
                    List<Supplier_Invoice__c> invoices = supplierToInvoiceMap.get(supplierInvoice.Supplier__c);
                    String lastRefcodeIndex = invoices[invoices.size() - 1].Refcode_Index__c;
                    String lastChar = lastRefcodeIndex.substring(lastRefcodeIndex.length() - 1);
                    
                    Integer lastCharIndex = chars.indexOf(lastChar);
                    String nextChar = (lastCharIndex == 25) ? 'A' : chars.substring(lastCharIndex + 1, lastCharIndex + 2);
                    
                    supplierInvoice.Refcode_Index__c = lastRefcodeIndex.substring(0, lastRefcodeIndex.length() - 1) + nextChar;
                }    
            }
        }
    }
    
    public static void addBankDetailToSupplier(List<Supplier_Invoice__c> supplierInvoices, Map<Id, Supplier_Invoice__c> oldSupplierInvoiceMap){
        Map<String, List<String>> supplierIdToBankDetailsMap = new Map<String, List<String>>();
        for(Supplier_Invoice__c supplierInvoice: supplierInvoices){
            if(supplierInvoice.Bank_Details__c != oldSupplierInvoiceMap.get(supplierInvoice.Id).Bank_Details__c && supplierInvoice.Bank_Details__c != 'Not Provided'){
                if(supplierIdToBankDetailsMap.get(supplierInvoice.Supplier__c) == null){
                   supplierIdToBankDetailsMap.put(supplierInvoice.Supplier__c, new List<String>());  
                }
                supplierIdToBankDetailsMap.get(supplierInvoice.Supplier__c).add(supplierInvoice.Bank_Details__c);
            }
        }
        if(!supplierIdToBankDetailsMap.isEmpty()){
            Map<Id, Account> accountMap = new Map<Id, Account>();
            for(Account account: [SELECT Id, Bank_Details__c FROM Account WHERE Id IN: supplierIdToBankDetailsMap.keySet()]){
                for(String bankDetail: supplierIdToBankDetailsMap.get(account.Id)){
                    if(account.Bank_Details__c == null){
                        account.Bank_Details__c = bankDetail;
                        accountMap.put(account.Id, account);
                    } else if(!account.Bank_Details__c.contains(bankDetail)){
                        account.Bank_Details__c = account.Bank_Details__c + '\r\n' + bankDetail;
                        accountMap.put(account.Id, account);
                    }
                }
            }
            update accountMap.values();
        }
	}
    
    public static void updateIsChangedCSVField(List<Supplier_Invoice__c> supplierInvoices, Map<Id, Supplier_Invoice__c> oldSupplierInvoiceMap){
        for(Supplier_Invoice__c supplierInvoice: supplierInvoices){
            Supplier_Invoice__c oldSupplierInvoice = oldSupplierInvoiceMap.get(supplierInvoice.Id);
            if(supplierInvoice.Exported__c && (supplierInvoice.Invoice_Amount__c != oldSupplierInvoice.Invoice_Amount__c)){
                supplierInvoice.Is_CSV_Info_Changed__c = true;
            }
        }
    }
    
    public static void updateLastPayments(List<Supplier_Invoice__c> supplierInvoices, Map<Id, Supplier_Invoice__c> oldSupplierInvoiceMap){
        Id payableRecordTypeId = Schema.SObjectType.Payment__c.getRecordTypeInfosByName().get('Payable').getRecordTypeId();
        Set<Id> supplierInvoiceIds = new Set<Id>();
        for (Supplier_Invoice__c supplierInvoice: supplierInvoices) {
            if (oldSupplierInvoiceMap.containsKey(supplierInvoice.Id) &&
                oldSupplierInvoiceMap.get(supplierInvoice.Id).Payable_Balance__c != supplierInvoice.Payable_Balance__c) {
                supplierInvoiceIds.add(supplierInvoice.Id);
            }
        }
        if(!supplierInvoiceIds.isEmpty()){
            Map<Id, List<Payment__c>> supplierInvoiceToPaymentsMap = new Map<Id, List<Payment__c>>();
            for (Payment__c payment : [
                SELECT Id, Amount__c, Is_Last__c, Supplier_Invoice__c
                FROM Payment__c
                WHERE Supplier_Invoice__c IN :supplierInvoiceIds AND RecordTypeId =: payableRecordTypeId
                ORDER BY Date__c ASC
            ]) {
                if (!supplierInvoiceToPaymentsMap.containsKey(payment.Supplier_Invoice__c)) {
                    supplierInvoiceToPaymentsMap.put(payment.Supplier_Invoice__c, new List<Payment__c>());
                }
                supplierInvoiceToPaymentsMap.get(payment.Supplier_Invoice__c).add(payment);
            }
            List<Payment__c> paymentsToUpdate = new List<Payment__c>();
            for (Supplier_Invoice__c supplierInvoice: supplierInvoices) {
                if (supplierInvoiceToPaymentsMap.containsKey(supplierInvoice.Id)) {
                    Decimal fixedAmountForLastPayment = 350;
                    Decimal balance = supplierInvoice.Invoice_Amount__c;
                    Decimal runningTotal = 0;
                    Boolean lastSet = false;
    
                    for (Payment__c payment : supplierInvoiceToPaymentsMap.get(supplierInvoice.Id)) {
                        if (!lastSet) {
                            runningTotal += payment.Amount__c;
    
                            if (runningTotal >= balance - fixedAmountForLastPayment) {
                                payment.Is_Last__c = true;  
                                lastSet = true;
                            } else {
                                payment.Is_Last__c = false;
                            }
                        } else {
                            payment.Is_Last__c = false;
                        }
    
                        paymentsToUpdate.add(payment);
                    }
                }
            }
            
            if (!paymentsToUpdate.isEmpty()) {
                ContextManager.avoidPaymentFiring = true;
                update paymentsToUpdate;
                ContextManager.avoidPaymentFiring = false;
            }
        }
    }
    
    public static void setCalculatedAmount(List<Supplier_Invoice__c> supplierInvoices, Map<Id, Supplier_Invoice__c> oldSupplierInvoiceMap){
        String payableRecordTypeId = Schema.SObjectType.Payment__c.getRecordTypeInfosByName().get('Payable').getRecordTypeId();
        List<String> supplierIds = new List<String>();
        List<String> stemIds = new List<String>();
        for(Supplier_Invoice__c supplierInvoice: supplierInvoices){
            supplierIds.add(supplierInvoice.Supplier__c);
            stemIds.add(supplierInvoice.STEM__c);
        }
        
        List<STEM_Line_Item__c> stemLineItems = [SELECT Id, Original_Supplier__c, Payment_Term__c, Total_Cost__c, STEM__c, Supplier_Invoice__c
                                                 FROM STEM_Line_Item__c WHERE Original_Supplier__c IN : supplierIds AND STEM__c IN: stemIds AND Cancelled__c = false];
        List<STEM_Extra_Cost__c> stemExtraCosts = [SELECT Id, Supplier__c, Line_Total_Buy__c, Payment_Term__c, STEM__c, Supplier_Invoice__c
                                                   FROM STEM_Extra_Cost__c WHERE Supplier__c In: supplierIds AND STEM__c In: stemIds AND Cancelled__c = false];
        Map<Id, Supplier_Invoice__c> currentSupplierInvoices = new Map<Id, Supplier_Invoice__c>(
            [SELECT Id,
             (SELECT Id, Is_Volume_Discount__c, Amount__c, Volume_Discount__c FROM Payments__r WHERE RecordTypeId =: payableRecordTypeId)
              FROM Supplier_Invoice__c WHERE Supplier__c In :supplierIds AND STEM__c IN :stemIds]);
        //Setting value for PSPRS 
        for(Supplier_Invoice__c supplierInvoice: supplierInvoices){
            Boolean containsStemLineItem = false;
            supplierInvoice.Calculated_Amount__c = 0;
            for(STEM_Line_Item__c stemLineItem: stemLineItems){
            	if(supplierInvoice.Id == stemLineItem.Supplier_Invoice__c){
                    containsStemLineItem = true;
                	supplierInvoice.Calculated_Amount__c += stemLineItem.Total_Cost__c;
                    supplierInvoice.Payment_Term__c = stemLineItem.Payment_Term__c;
                }   
            }
            for(STEM_Extra_Cost__c stemExtraCost: stemExtraCosts){
            	if(supplierInvoice.Id == stemExtraCost.Supplier_Invoice__c){
                    supplierInvoice.Calculated_Amount__c += stemExtraCost.Line_Total_Buy__c;
                    supplierInvoice.Payment_Term__c = stemExtraCost.Payment_Term__c;
                }
           	}
            if(supplierInvoice.PSPRS__c != 'Uploaded'){
                if(containsStemLineItem){
                    if(supplierInvoice.Payment_Term__c.contains('P')){
                        supplierInvoice.PSPRS__c = 'Missing';
                    } else if(!supplierInvoice.Payment_Term__c.contains('P')){
                        supplierInvoice.PSPRS__c = 'NOT Required';
                    }    
                } else{
                    supplierInvoice.PSPRS__c = 'N/A';
                }
            }  
            supplierInvoice.Payable_Balance__c = supplierInvoice.Invoice_Amount__c;
            supplierInvoice.Volume_Discount_Amount__c = 0;
            if(!currentSupplierInvoices.isEmpty()){
                if(currentSupplierInvoices.get(supplierInvoice.Id) != null){
                    for(Payment__c payment: currentSupplierInvoices.get(supplierInvoice.Id).Payments__r){
            			supplierInvoice.Payable_Balance__c -= payment.Amount__c;
                        if(payment.Volume_Discount__c != null){
                            supplierInvoice.Volume_Discount_Amount__c += payment.Amount__c;
                        }
            		}  
                }
            }
        }
    }
    
    public static void setPayableDepositPayment(List<Supplier_Invoice__c> supplierInvoices){
        Set<Id> stemIds = new Set<Id>();
        Set<Id> supplierIds = new Set<Id>();
        Map<String, List<Supplier_Invoice__c>> supplierInvoiceMap = new Map<String, List<Supplier_Invoice__c>>();
        for(Supplier_Invoice__c supplierInvoice: supplierInvoices){
            if(supplierInvoice.Payment_Term__c == 'Deposit'){
                stemIds.add(supplierInvoice.STEM__c);
            	supplierIds.add(supplierInvoice.Supplier__c);
                if(supplierInvoiceMap.get(supplierInvoice.STEM__c + '_' + supplierInvoice.Supplier__c) == null){
                	supplierInvoiceMap.put(supplierInvoice.STEM__c + '_' + supplierInvoice.Supplier__c, new List<Supplier_Invoice__c>());    
                }
                supplierInvoiceMap.get(supplierInvoice.STEM__c + '_' + supplierInvoice.Supplier__c).add(supplierInvoice);
            }    
        }
        if(!stemIds.isEmpty()){
            Id payableRecordTypeId = Schema.SObjectType.Payment__c.getRecordTypeInfosByName().get('Payable').getRecordTypeId();
        	List<Payment__c> payments = [SELECT Id, Date__c, Amount__c, Account__c, STEM__c, Supplier_Invoice__c, Maximum_Amount__c
                                     	FROM Payment__c 
                                     	WHERE RecordTypeId =: payableRecordTypeId AND STEM__c IN: stemIds AND Account__c IN: supplierIds
                                        AND Supplier_Invoice__c = null AND Is_Deposit__c = true AND Volume_Discount__c = null];
            Map<String, Payment__c> paymentMap = new Map<String, Payment__c>();
            for(Payment__c payment: payments){
                paymentMap.put(payment.STEM__c + '_' + payment.Account__c, payment);
            }
            for(String key: supplierInvoiceMap.keySet()){
                for(Supplier_Invoice__c supplierInvoice: supplierInvoiceMap.get(key)){
                    Decimal discount = supplierInvoice.Volume_Discount_Amount__c != null ? supplierInvoice.Volume_Discount_Amount__c : 0;
                    if(paymentMap.get(key) == null){
                        paymentMap.put(key, new Payment__c(RecordTypeId = payableRecordTypeId,
                                                            STEM__c = key.split('_')[0],
                                                            Account__c = key.split('_')[1],
                                                            Date__c = Date.today(),
                                                            Amount__c = supplierInvoice.Invoice_Amount__c - discount, 
                                                            Maximum_Amount__c = supplierInvoice.Invoice_Amount__c - discount, 
                                                            Is_Deposit__c = true,
                                                          	Supplier_Invoice__c = supplierInvoice.Id));  
                    } else{
                        paymentMap.get(key).Supplier_Invoice__c = supplierInvoice.Id;
                        paymentMap.get(key).Amount__c = supplierInvoice.Invoice_Amount__c - discount;
                        paymentMap.get(key).Maximum_Amount__c = supplierInvoice.Invoice_Amount__c - discount;
                    }    
                }
            }
        	upsert paymentMap.values();
        }    
    }
    
    public static void changeDepositPaymentAmount(List<Supplier_Invoice__c> supplierInvoices, Map<Id, Supplier_Invoice__c> oldSupplierInvoiceMap){
        Set<Id> stemIds = new Set<Id>();
        Set<Id> supplierIds = new Set<Id>();
        Map<String, Supplier_Invoice__c> supplierInvoiceMap = new Map<String, Supplier_Invoice__c>();
        for(Supplier_Invoice__c supplierInvoice: supplierInvoices){
            system.debug(supplierInvoice.Volume_Discount_Amount__c + ' - ' + oldSupplierInvoiceMap.get(supplierInvoice.Id).Volume_Discount_Amount__c);
            if(supplierInvoice.Payment_Term__c == 'Deposit' 
               && (supplierInvoice.Invoice_Amount__c != oldSupplierInvoiceMap.get(supplierInvoice.Id).Invoice_Amount__c 
                   || supplierInvoice.Volume_Discount_Amount__c != oldSupplierInvoiceMap.get(supplierInvoice.Id).Volume_Discount_Amount__c 
                   || supplierInvoice.Supplier__c != oldSupplierInvoiceMap.get(supplierInvoice.Id).Supplier__c)){
            	supplierInvoiceMap.put(supplierInvoice.Id, supplierInvoice);
                stemIds.add(supplierInvoice.STEM__c);
            	supplierIds.add(supplierInvoice.Supplier__c);
            }
        }
        if(!supplierInvoiceMap.isEmpty()){
            Id payableRecordTypeId = Schema.SObjectType.Payment__c.getRecordTypeInfosByName().get('Payable').getRecordTypeId();
            Map<String, Payment__c> paymentMap = new Map<String, Payment__c>();
            for(Payment__c payment: [SELECT Id, Date__c, Amount__c, Account__c, STEM__c, Supplier_Invoice__c, Maximum_Amount__c
                                     FROM Payment__c 
                                     WHERE RecordTypeId =: payableRecordTypeId AND Supplier_Invoice__c IN: supplierInvoiceMap.keySet() AND Is_Deposit__c = true AND Volume_Discount__c = null]){
                paymentMap.put(payment.Supplier_Invoice__c, payment);
            }
            for(String supplierInvoiceId: paymentMap.keySet()){
                Decimal discount = supplierInvoiceMap.get(supplierInvoiceId).Volume_Discount_Amount__c != null ? supplierInvoiceMap.get(supplierInvoiceId).Volume_Discount_Amount__c : 0;
                system.debug(discount);
                paymentMap.get(supplierInvoiceId).Amount__c = supplierInvoiceMap.get(supplierInvoiceId).Invoice_Amount__c - discount;
                paymentMap.get(supplierInvoiceId).Maximum_Amount__c = supplierInvoiceMap.get(supplierInvoiceId).Invoice_Amount__c - discount;
            }
            update paymentMap.values();
            DepositCalculationService.calculateDeposits(stemIds, supplierIds, new Set<Id>());
        }
    }
    
    private static AuraHandledException newMessageException(String message) {
        AuraHandledException e = new AuraHandledException(message);
        e.setMessage(message);
        return e;
	}
    
    
    
	public static void createPaymentOverview(List<Supplier_Invoice__c> supplierInvoices){
        String payableRecordTypeId = Schema.SObjectType.STEM_Payment_Overview__c.getRecordTypeInfosByName().get('Payable').getRecordTypeId();
        List<STEM_Payment_Overview__c> paymentOverviews = new List<STEM_Payment_Overview__c>();
        for(Supplier_Invoice__c supplierInvoice: supplierInvoices){
            paymentOverviews.add(new STEM_Payment_Overview__c(RecordTypeId = payableRecordTypeId, Supplier_Invoice__c = supplierInvoice.Id, STEM__c = supplierInvoice.STEM__c, Account__c = supplierInvoice.Supplier__c));
        }
        insert paymentOverviews;
    }
    /*
    public static void createCashflow(Map<Id, Supplier_Invoice__c> supplierInvoiceMap){
        String supplierInvoiceRecordTypeId = Schema.SObjectType.Cashflow__c.getRecordTypeInfosByName().get('Supplier Invoice').getRecordTypeId();
        List<String> stemIds = new List<String>();
        List<String> supplierIds = new List<String>();
        for(Supplier_Invoice__c supplierInvoice: supplierInvoiceMap.values()){
            stemIds.add(supplierInvoice.STEM__c);
            supplierIds.add(supplierInvoice.Supplier__c);
        }
        List<Cashflow__c> cashflows = [SELECT Id, STEM__c, Supplier_Invoice__c, Account__c, STEM_Line_Item__c, Subtotal_Buy_At__c, Bank__c, STEM_Extra_Cost__c,
                                       Pay_Term__c
                                       FROM Cashflow__c WHERE RecordTypeId =: supplierInvoiceRecordTypeId AND STEM__c In: stemIds
                                       AND Account__c In: supplierIds AND (STEM_Line_Item__c != NULL OR STEM_Extra_Cost__c != NULL)];
        Map<String, Cashflow__c> uniqueCashflows = new Map<String, Cashflow__c>();
        for(Cashflow__c cashflow: cashflows){
            uniqueCashflows.put(cashflow.STEM__c + ',' + cashflow.Account__c + ',' + cashflow.Pay_Term__c, cashflow);
        }
        system.debug(uniqueCashflows);
        List<Cashflow__c> newCashflows = new List<Cashflow__c>();
        for(Supplier_Invoice__c supplierInvoice: supplierInvoiceMap.values()){
            Cashflow__c uniqueCashflow = uniqueCashflows.get(supplierInvoice.STEM__c + ',' + supplierInvoice.Supplier__c + ',' + supplierInvoice.Payment_Term__c);
            if(uniqueCashflow != null){
                if(uniqueCashflow.Supplier_Invoice__c != null){
                    newCashflows.add(new Cashflow__c(STEM__c = supplierInvoice.STEM__c,
                                                     STEM_Line_Item__c = uniqueCashflow.STEM_Line_Item__c,
                                                     STEM_Extra_Cost__c = uniqueCashflow.STEM_Extra_Cost__c,
                                                     Pay_Term__c = uniqueCashflow.Pay_Term__c,
                                                     Subtotal_Buy_At__c = uniqueCashflow.Subtotal_Buy_At__c,
                                                     Account__c = supplierInvoice.Supplier__c,
                                                     Supplier_Invoice__c = supplierInvoice.Id,
                                                     RecordTypeId = supplierInvoiceRecordTypeId));   
                } else {
                    uniqueCashflows.get(supplierInvoice.STEM__c + ',' + supplierInvoice.Supplier__c + ',' + supplierInvoice.Payment_Term__c).Supplier_Invoice__c = supplierInvoice.Id;
                    if(supplierInvoice.Bank_Details__c.startsWith('DBS')){
                        uniqueCashflows.get(supplierInvoice.STEM__c + ',' + supplierInvoice.Supplier__c + ',' + supplierInvoice.Payment_Term__c).Bank__c = 'DBS';
                    } else if(supplierInvoice.Bank_Details__c.startsWith('UBS')){
                        uniqueCashflows.get(supplierInvoice.STEM__c + ',' + supplierInvoice.Supplier__c + ',' + supplierInvoice.Payment_Term__c).Bank__c = 'UBS';
                    }
                }    
            }
            
        }
        update uniqueCashflows.values();
        insert newCashflows;
    }
    
    public static void updateCashflowAccount(Map<Id, Supplier_Invoice__c> supplierInvoiceMap, Map<Id, Supplier_Invoice__c> oldSupplierInvoiceMap){
        String supplierInvoiceRecordTypeId = Schema.SObjectType.Cashflow__c.getRecordTypeInfosByName().get('Supplier Invoice').getRecordTypeId();
        List<String> stemIds = new List<String>();
        List<String> oldSupplierIds = new List<String>();
        for(Supplier_Invoice__c supplierInvoice: supplierInvoiceMap.values()){
            if(oldSupplierInvoiceMap.get(supplierInvoice.Id).Supplier__c != supplierInvoice.Supplier__c){
                stemIds.add(supplierInvoice.STEM__c);
                oldSupplierIds.add(oldSupplierInvoiceMap.get(supplierInvoice.Id).Supplier__c);    
            }
        }
        if(!stemIds.IsEmpty()){
            List<Cashflow__c> cashflows = [SELECT Id, Supplier_Invoice__c, Account__c FROM Cashflow__c WHERE STEM__c IN: stemIds AND Account__c IN: oldSupplierIds
                                           AND Supplier_Invoice__c IN: supplierInvoiceMap.keySet() AND RecordTypeId =: supplierInvoiceRecordTypeId];
            for(Cashflow__c cashflow: cashflows){
                cashflow.Account__c = supplierInvoiceMap.get(cashflow.Supplier_Invoice__c).Supplier__c;
            }
            update cashflows;    
        }  
    }
    
    public static void deleteCashflows(Map<Id, Supplier_Invoice__c> supplierInvoiceMap){
        List<String> stemIds = new List<String>();
        List<String> supplierIds = new List<String>();
        for(Supplier_Invoice__c supplierInvoice: supplierInvoiceMap.values()){
            stemIds.add(supplierInvoice.STEM__c);
            supplierIds.add(supplierInvoice.Supplier__c);
        }
        List<Cashflow__c> cashflows = [SELECT Id, STEM__c, Account__c, Payment_Term__c, Supplier_Invoice__c FROM Cashflow__c WHERE Supplier_Invoice__c In: supplierInvoiceMap.keySet()];
        List<Cashflow__c> sameSupplierCashflows = [SELECT Id, STEM__c, Account__c, Payment_Term__c, Supplier_Invoice__c FROM Cashflow__c WHERE STEM__c IN: stemIds AND Account__c IN: supplierIds AND Supplier_Invoice__c NOT In: supplierInvoiceMap.keySet()];
        Map<String, Cashflow__c> uniqueCashflows = new Map<String, Cashflow__c>();
        for(Cashflow__c cashflow: sameSupplierCashflows){
            uniqueCashflows.put(cashflow.STEM__c + ',' + cashflow.Account__c + ',' + cashflow.Payment_Term__c, cashflow);
        }
        List<Cashflow__c> cashflowsToDelete = new List<Cashflow__c>();
        for(Cashflow__c cashflow: cashflows){
            if(uniqueCashflows.get(cashflow.STEM__c + ',' + cashflow.Account__c + ',' + cashflow.Payment_Term__c) != NULL){
				cashflowsToDelete.add(cashflow);
            }
        }
        delete cashflowsToDelete;
    }
    
    public static void updateCashflows(Map<Id, Supplier_Invoice__c> supplierInvoiceMap){
        List<String> stemIds = new List<String>();
        List<String> supplierIds = new List<String>();
        for(Supplier_Invoice__c supplierInvoice: supplierInvoiceMap.values()){
            stemIds.add(supplierInvoice.STEM__c);
            supplierIds.add(supplierInvoice.Supplier__c);
        }
        List<Cashflow__c> sameSupplierCashflows = [SELECT Id, STEM__c, Account__c, Payment_Term__c, Supplier_Invoice__c FROM Cashflow__c WHERE STEM__c IN: stemIds AND Account__c IN: supplierIds];
        system.debug(sameSupplierCashflows);
        update sameSupplierCashflows;
    }
    */
    public static void deleteContentDocuments(Map<Id, Supplier_Invoice__c> supplierInvoiceMap) {
		List<ContentDocumentLink> contentDocumentLinkList = [SELECT Id, ContentDocumentId FROM ContentDocumentLink WHERE LinkedEntityId In: supplierInvoiceMap.keySet()];
        List<Id> docIdList = new List<Id>();
        for(ContentDocumentLink cdl: ContentDocumentLinkList){
            docIdList.add(cdl.ContentDocumentId);
        }
        List<ContentDocument> conDocList =[SELECT Id FROM ContentDocument where Id IN: docIdList];
         
        delete conDocList; 
	}
    
    public static void unassignDepositPayment(Map<Id, Supplier_Invoice__c> supplierInvoiceMap){
        Set<Id> stemIds = new Set<Id>();
        Set<Id> supplierIds = new Set<Id>();
         for(Supplier_Invoice__c supplierInvoice: supplierInvoiceMap.values()){
            if(supplierInvoice.Payment_Term__c == 'Deposit'){
				stemIds.add(supplierInvoice.STEM__c);
                supplierIds.add(supplierInvoice.Supplier__c);
            }
        }
        if(!stemIds.isEmpty()){
            List<Payment__c> payments = [SELECT Id, Account__c, STEM__c, Supplier_Invoice__c FROM Payment__c
                                     WHERE STEM__c IN: stemIds AND Is_Deposit__c = true AND Account__c IN: supplierIds];
            if(!payments.IsEmpty()){
                Map<String, List<Payment__c>> paymentMap = new Map<String, List<Payment__c>>();
                for(Payment__c payment: payments){
                    if(paymentMap.get(payment.STEM__c + '_' + payment.Account__c) == null){
                        paymentMap.put(payment.STEM__c + '_' + payment.Account__c, new List<Payment__c>());    
                    }
                    paymentMap.get(payment.STEM__c + '_' + payment.Account__c).add(payment);
                }
                List<Payment__c> paymentsDelete = new List<Payment__c>();
                stemIds = new Set<Id>();
                supplierIds = new Set<Id>();
                for(Supplier_Invoice__c supplierInvoice: supplierInvoiceMap.values()){
                    if(paymentMap.get(supplierInvoice.STEM__c + '_' + supplierInvoice.Supplier__c).size() > 1){
                        for(Payment__c payment: paymentMap.get(supplierInvoice.STEM__c + '_' + supplierInvoice.Supplier__c)){
                            if(payment.Supplier_Invoice__c == supplierInvoice.Id){
                                paymentsDelete.add(payment);
                            }
                            else{
                                stemIds.add(supplierInvoice.STEM__c);
                                supplierIds.add(supplierInvoice.Supplier__c);
                            }
                        }
                    }else if(paymentMap.get(supplierInvoice.STEM__c + '_' + supplierInvoice.Supplier__c).size() == 1){
                        stemIds.add(supplierInvoice.STEM__c);
                        supplierIds.add(supplierInvoice.Supplier__c);
                        paymentMap.get(supplierInvoice.STEM__c + '_' + supplierInvoice.Supplier__c)[0].Supplier_Invoice__c = null;
                    }
                }
                update payments;
                delete paymentsDelete;
                if(!stemIds.isEmpty()){
                    DepositCalculationService.calculateDeposits(stemIds, supplierIds, new Set<Id>());
                }   
        	}     
        }
    }
    
    public static void unissueProducts(Map<Id, Supplier_Invoice__c> supplierInvoiceMap){
        List<STEM_Line_Item__c> stemLineItems = [SELECT Id, Supplier_Input__c, Supplier_Issued__c, Supplier_Invoice__c, Buyer_Invoice__c,
                                                 Buyer_Invoice__r.Delivery_Date__c, Buyer_Invoice__r.Invoice_Date__c, Is_Purchase_CSV_Info_Changed__c, 
                                                 Is_Purchase_CSV_Exported__c
                                                 FROM STEM_Line_Item__c 
                                                 WHERE Supplier_Invoice__c IN: supplierInvoiceMap.keySet()];
        for(STEM_Line_Item__c stemLineItem : stemLineItems){
            stemLineItem.Supplier_Input__c = '🔴';
            stemLineItem.Supplier_Issued__c = false;
            stemLineItem.Is_Purchase_CSV_Info_Changed__c = stemLineItem.Is_Purchase_CSV_Exported__c ? true : false;
        }
        ContextManager.avoidSTEMLineItemFiring = true;
        update stemLineItems;
        ContextManager.avoidSTEMLineItemFiring = false;
        
        List<STEM_Extra_Cost__c> stemExtraCosts = [SELECT Id, Supplier_Input__c, Supplier_Issued__c, RecordTypeId, Line_Total__c, Buyer_Invoice__c, Supplier_Invoice__c,
                                                   Buyer_Invoice__r.Delivery_Date__c, Buyer_Invoice__r.Invoice_Date__c, Product2Id__r.Name, Is_Purchase_CSV_Info_Changed__c, 
                                                   Is_Purchase_CSV_Exported__c
                                                   FROM STEM_Extra_Cost__c WHERE Supplier_Invoice__c IN: supplierInvoiceMap.keySet()];
        Map<String, List<STEM_Extra_Cost__c>> stemExtraCostMap = new Map<String, List<STEM_Extra_Cost__c>>();
        for(STEM_Extra_Cost__c stemExtraCost : stemExtraCosts){
            stemExtraCost.Supplier_Input__c =  '🔴';
            stemExtraCost.Supplier_Issued__c = false;
            stemExtraCost.Is_Purchase_CSV_Info_Changed__c = stemExtraCost.Is_Purchase_CSV_Exported__c ? true : false;
        }
        ContextManager.avoidSTEMExtraCostFiring = true;
        update stemExtraCosts;
        ContextManager.avoidSTEMExtraCostFiring = false;
        
        List<String> refcodes = new List<String>();
        for(Supplier_Invoice__c supplierInvoice: supplierInvoiceMap.values()){
            if(supplierInvoice.Exported__c){
                  refcodes.add(supplierInvoice.Refcode_Index__c);
            }
        }
        MyobDataExportController.updateMyobInvoices(refcodes);
    }
}