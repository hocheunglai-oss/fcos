public class PaymentTriggerHandler {
    public static void updatePartialCiaBuyerInvoiceDueDate(List<Payment__c> payments){
        Set<Id> stemIds = new Set<Id>();
        Id receivableRecordTypeId = Schema.SObjectType.Payment__c.getRecordTypeInfosByName().get('Receivable').getRecordTypeId();
        Id bankChargeRecordTypeId = Schema.SObjectType.Payment__c.getRecordTypeInfosByName().get('Bank Charge').getRecordTypeId();
        Id writeOffRecordTypeId = Schema.SObjectType.Payment__c.getRecordTypeInfosByName().get('Write Off').getRecordTypeId();
        for(Payment__c payment: payments){
            if(payment.STEM__c != null && (payment.RecordTypeId == receivableRecordTypeId 
            || payment.RecordTypeId == bankChargeRecordTypeId || payment.RecordTypeId == writeOffRecordTypeId)){
                stemIds.add(payment.STEM__c);
            }
        }
        if(!stemIds.isEmpty()){
            List<STEM__c> stems = [SELECT Id, Payment_Term__c, Delivery_Date__c, Invoice_Due_Date__c 
                FROM STEM__c 
                WHERE Id IN: stemIds AND Partial_CIA__c = TRUE AND Delivery_Date__c != null];
            for(STEM__c stem: stems){
                stem.Invoice_Due_Date__c = stem.Payment_Term__c == 'CIA' 
                    ? stem.Delivery_Date__c
                    : stem.Delivery_Date__c.addDays(Integer.valueOf(stem.Payment_Term__c) - 1);
            }
            ContextManager.avoidStemRecursion = true;
            update stems;
            ContextManager.avoidStemRecursion = false;
        }
    }

    public static void updatePayableBalance(Map<Id, Payment__c> payments){
        Id payableRecordTypeId = Schema.SObjectType.Payment__c.getRecordTypeInfosByName().get('Payable').getRecordTypeId();
        List<String> supplierInvoiceIds = new List<String>();
        for(Payment__c payment: payments.values()){
            supplierInvoiceIds.add(payment.Supplier_Invoice__c);
        }
        if(!supplierInvoiceIds.isEmpty()){
            List<Supplier_Invoice__c> supplierInvoices = [SELECT Id, Invoice_Amount__c, Payable_Balance__c, Volume_Discount_Amount__c FROM Supplier_Invoice__c WHERE Id In: supplierInvoiceIds];
            List<Payment__c> currentPayments = [SELECT Id, Supplier_Invoice__c, Amount__c, Volume_Discount__c FROM Payment__c
                                                WHERE Supplier_Invoice__c In: supplierInvoiceIds AND RecordTypeId =: payableRecordTypeId ORDER BY Date__c];
            List<Payment__c> paymentsToUpdate = new List<Payment__c>();
            for(Supplier_Invoice__c supplierInvoice: supplierInvoices){
                Decimal totalAmount = 0;
                Decimal discountAmount = 0;
                Decimal fixedAmountForLastPayment = 350;
                Boolean lastSet = false;
                for(Payment__c currentPayment: currentPayments){
                    if(supplierInvoice.Id == currentPayment.Supplier_Invoice__c){
                        totalAmount += currentPayment.Amount__c;
                        if(currentPayment.Volume_Discount__c != null){
                            discountAmount += currentPayment.Amount__c;
                        }
                        if (!lastSet) {
                            if (totalAmount >= supplierInvoice.Invoice_Amount__c - fixedAmountForLastPayment) {
                                currentPayment.Is_Last__c = true;  
                                lastSet = true;
                            } else {
                                currentPayment.Is_Last__c = false;
                            }
                        } else {
                            currentPayment.Is_Last__c = false;
                        }
        
                        paymentsToUpdate.add(currentPayment);
                    }
                }
                supplierInvoice.Volume_Discount_Amount__c = discountAmount;
                supplierInvoice.Payable_Balance__c = supplierInvoice.Invoice_Amount__c - totalAmount;	
            }
            ContextManager.avoidSupplierInvoiceFiring = true;
            update supplierInvoices;
            ContextManager.avoidSupplierInvoiceFiring = false;
            
            if (!paymentsToUpdate.isEmpty()) {
                ContextManager.avoidPaymentFiring = true;
                update paymentsToUpdate;
                ContextManager.avoidPaymentFiring = false;
            }    
        }  
    }
    
    public static void updateLastCiaPayment(List<Payment__c> payments){
        Id payableRecordTypeId = Schema.SObjectType.Payment__c.getRecordTypeInfosByName().get('Payable').getRecordTypeId();
        List<String> stemIds = new List<String>();
        List<String> supplierIds = new List<String>();
        for(Payment__c payment: payments){
            if(payment.RecordTypeId == payableRecordTypeId && payment.Supplier_Invoice__c == null){
                stemIds.add(payment.STEM__c);
            	supplierIds.add(payment.Account__c);
            }
        }
        if(!stemIds.isEmpty()){
            Decimal fixedAmountForLastPayment = 350;
            List<STEM_Line_Item__c> stemLineItems = [SELECT Id, STEM__c, Original_Supplier__c, QLIK_Total_Cost__c FROM STEM_Line_Item__c WHERE STEM__c IN: stemIds AND Original_Supplier__c IN: supplierIds AND Cancelled__c = false];
            List<STEM_Extra_Cost__c> stemExtraCosts = [SELECT Id, STEM__c, Supplier__c, QLIK_Total_Cost__c FROM STEM_Extra_Cost__c WHERE STEM__c IN: stemIds AND Supplier__c IN: supplierIds AND Cancelled__c = false];
            List<Payment__c> currentPayments = [SELECT Id, STEM__c, Account__c, Amount__c, Volume_Discount__c, Is_Last__c FROM Payment__c
                                                WHERE STEM__c IN: stemIds AND Account__c IN: supplierIds AND RecordTypeId =: payableRecordTypeId AND Supplier_Invoice__c = null ORDER BY Date__c];
            Map<String, Decimal> balanceMap = new Map<String, Decimal>();
            for(STEM_Line_Item__c stemLineItem: stemLineItems){
                String key = stemLineItem.STEM__c + '_' + stemLineItem.Original_Supplier__c;
                if(balanceMap.get(key) == null){
                    balanceMap.put(key, 0);
                }
                balanceMap.put(key, balanceMap.get(key) + stemLineItem.QLIK_Total_Cost__c);
            }
            for(STEM_Extra_Cost__c stemExtraCost: stemExtraCosts){
                String key = stemExtraCost.STEM__c + '_' + stemExtraCost.Supplier__c;
                if(balanceMap.get(key) == null){
                    balanceMap.put(key, 0);
                }
                balanceMap.put(key, balanceMap.get(key) + stemExtraCost.QLIK_Total_Cost__c);
            }
            for(Payment__c payment: currentPayments){
                String key = payment.STEM__c + '_' + payment.Account__c;
                if(balanceMap.get(key) == null){
                    balanceMap.put(key, 0);
                }
                balanceMap.put(key, balanceMap.get(key) - payment.Amount__c);
                if(balanceMap.get(key) <= fixedAmountForLastPayment){
                    payment.Is_Last__c = true;
                } else{
                    payment.Is_Last__c = false;
                }
            }
            if (!currentPayments.isEmpty()) {
                ContextManager.avoidPaymentFiring = true;
                update currentPayments;
                ContextManager.avoidPaymentFiring = false;
            }
        }
    }
    /*
    public static void updateCashflows(List<Payment__c> payments){
        Id payableRecordTypeId = Schema.SObjectType.Payment__c.getRecordTypeInfosByName().get('Payable').getRecordTypeId();
        Id supplierInvoiceRecordTypeId = Schema.SObjectType.Cashflow__c.getRecordTypeInfosByName().get('Supplier Invoice').getRecordTypeId();
        Id supplierPaymentRecordTypeId = Schema.SObjectType.Cashflow__c.getRecordTypeInfosByName().get('Supplier Payment').getRecordTypeId();
        List<String> stemIds = new List<String>();
        List<String> supplierIds = new List<String>();
        for(Payment__c payment: payments){
            if(payment.RecordTypeId == payableRecordTypeId && payment.Supplier_Invoice__c == null){
            	stemIds.add(payment.STEM__c);
            	supplierIds.add(payment.Account__c);
            }
        }
        if(!stemIds.isEmpty()){
            List<Cashflow__c> cashflows = [SELECT Id FROM Cashflow__c 
                                           WHERE STEM__c In: stemIds AND Account__c IN: supplierIds AND (RecordTypeId =: supplierInvoiceRecordTypeId OR RecordTypeId =: supplierPaymentRecordTypeId)];
            update cashflows;    
        }
    }
    */
    public static void recalculateRemittanceAmount(List<Payment__c> payments){
        set<String> remittanceIds = new Set<String>();
        for(Payment__c payment: payments){
            remittanceIds.add(payment.Remittance__c);
        }
        if(!remittanceIds.isEmpty()){
        	List<Payment__c> remittances = [SELECT Amount__c, (SELECT Id, Amount__c FROM Receivable_Payments__r) FROM Payment__c WHERE Id IN: remittanceIds];
            for(Payment__c remittance: remittances){
                remittance.Amount__c = 0;
                if(!remittance.Receivable_Payments__r.isEmpty()){
                    for(Payment__c payment: remittance.Receivable_Payments__r){
                        remittance.Amount__c += payment.Amount__c;
                    }   
                } else{
                    remittance.Amount__c = 0;
                } 
            }
            update remittances;
        }
    }
    

    public static void calculateCommissionPaidAmount(List<Payment__c> newPayments, Map<Id, Payment__c> oldPaymentMap, TriggerOperation operation) {
        Set<Id> invoiceIds = new Set<Id>();

        if (operation == TriggerOperation.AFTER_INSERT || operation == TriggerOperation.AFTER_UPDATE) {
            for (Payment__c payment : newPayments) {
                if (payment.Commission_Invoice__c != null) {
                    invoiceIds.add(payment.Commission_Invoice__c);
                }
            }
        }

        if (operation == TriggerOperation.AFTER_UPDATE || operation == TriggerOperation.AFTER_DELETE) {
            for (Payment__c oldPayment : oldPaymentMap.values()) {
                if (oldPayment.Commission_Invoice__c != null) {
                    invoiceIds.add(oldPayment.Commission_Invoice__c);
                }
            }
        }
        
        if (!invoiceIds.isEmpty()) {
            PaidAmountService.updatePaidAmount(invoiceIds);
        }
    }
    
    public static void emptyReconfirmInfo(List<Payment__c> payments){
        Id payableRecordTypeId = Schema.SObjectType.Payment__c.getRecordTypeInfosByName().get('Payable').getRecordTypeId();
        Set<Id> stemIds = new Set<Id>();
        Set<Id> supplierIds = new Set<Id>();
        Set<String> stemSupplierSet = new Set<String>();
        for(Payment__c payment: payments){
            if(payment.RecordTypeId == payableRecordTypeId){
                stemIds.add(payment.STEM__c);
                supplierIds.add(payment.Account__c);
                stemSupplierSet.add(payment.STEM__c + '_' + payment.Account__c);    
            }
        }
        List<STEM_Line_Item__c> stemLineItems = [SELECT Id, STEM__c, Original_Supplier__c, Reconfirm__c, Intended_Payment_Date__c FROM STEM_Line_Item__c WHERE STEM__c IN: stemIds AND Original_Supplier__c IN: supplierIds];
        List<STEM_Line_Item__c> stemLineItemsToUpdate = new List<STEM_Line_Item__c>();
        for(STEM_Line_Item__c stemLineItem: stemLineItems){
            if(stemSupplierSet.contains(stemLineItem.STEM__c + '_' + stemLineItem.Original_Supplier__c)){
                stemLineItem.Reconfirm__c = false;
                stemLineItem.Intended_Payment_Date__c = null;
                stemLineItemsToUpdate.add(stemLineItem);
            }
        }
        ContextManager.avoidSTEMLineItemFiring = true;
        update stemLineItemsToUpdate;
        ContextManager.avoidSTEMLineItemFiring = false;
        List<STEM_Extra_Cost__c> stemExtraCosts = [SELECT Id, STEM__c, Supplier__c, Reconfirm__c, Intended_Payment_Date__c FROM STEM_Extra_Cost__c WHERE STEM__c IN: stemIds AND Supplier__c IN: supplierIds];
        List<STEM_Extra_Cost__c> stemExtraCostsToUpdate = new List<STEM_Extra_Cost__c>();
        for(STEM_Extra_Cost__c stemExtraCost: stemExtraCosts){
            if(stemSupplierSet.contains(stemExtraCost.STEM__c + '_' + stemExtraCost.Supplier__c)){
                stemExtraCost.Reconfirm__c = false;
                stemExtraCost.Intended_Payment_Date__c = null;
                stemExtraCostsToUpdate.add(stemExtraCost);
            }
        }
        ContextManager.avoidSTEMExtraCostFiring = true;
        update stemExtraCostsToUpdate;
        ContextManager.avoidSTEMExtraCostFiring = false;
    }
    
    public static void deleteReceivablePaymentsFromRemittance(Map<Id, Payment__c> paymentMap){
        delete [SELECT Id FROM Payment__c WHERE Remittance__c In: paymentMap.keySet()];
    }
}