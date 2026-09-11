public class DepositCalculationService {

    public static void calculateDeposits(Set<Id> stemIds, Set<Id> supplierIds, Set<Id> oldSupplierIds){
        Map<String, Decimal> amountMap = new Map<String, Decimal>();
        Map<String, Decimal> maximumAmountMap = new Map<String, Decimal>();
        for(STEM_Line_Item__c stemLineItem: [SELECT Id, Original_Supplier__c, STEM__c, Total_Cost__c, Quantity_Delivered_Per_BDN__c, Unit_Buy_At__c, Is_Quantity_Range__c,
                                             Quantity_Max__c
                                             FROM STEM_Line_Item__c
                                             WHERE (Original_Supplier__c IN: supplierIds OR Original_Supplier__c IN: oldSupplierIds)
                                             AND STEM__c IN: stemIds AND Payment_Term__c = 'Deposit' AND Supplier_Issued__c = false]){
        	if(amountMap.get(stemLineItem.STEM__c + '_' + stemLineItem.Original_Supplier__c) == null){
                amountMap.put(stemLineItem.STEM__c + '_' + stemLineItem.Original_Supplier__c, 0);
                maximumAmountMap.put(stemLineItem.STEM__c + '_' + stemLineItem.Original_Supplier__c, 0);
            }
            amountMap.put(stemLineItem.STEM__c + '_' + stemLineItem.Original_Supplier__c, amountMap.get(stemLineItem.STEM__c + '_' + stemLineItem.Original_Supplier__c) + stemLineItem.Total_Cost__c);
         	Decimal maximumAmount = 0;
            if(stemLineItem.Is_Quantity_Range__c){
                maximumAmount = stemLineitem.Quantity_Delivered_Per_BDN__c == null || stemLineitem.Quantity_Delivered_Per_BDN__c == 0 
                    ? stemLineitem.Quantity_Max__c * stemLineitem.Unit_Buy_At__c
                    : stemLineitem.Quantity_Delivered_Per_BDN__c * stemLineitem.Unit_Buy_At__c;
            } else{
                maximumAmount = stemLineitem.Total_Cost__c;
            }
            maximumAmountMap.put(stemLineItem.STEM__c + '_' + stemLineItem.Original_Supplier__c, maximumAmountMap.get(stemLineItem.STEM__c + '_' + stemLineItem.Original_Supplier__c) + maximumAmount);
        }
        
        for(STEM_Extra_Cost__c stemExtraCost: [SELECT Id, Supplier__c, STEM__c, Line_Total_Buy__c, Fixed__c, Quantity__c, Quantity_Range_Max__c, Unit_Cost__c, Minimum_Buy_At__c,
                                               Quantity_Delivered_Per_BDN__c, Is_Quantity_Range__c, Nundination_Type__c
                                               FROM STEM_Extra_Cost__c
                                               WHERE (Supplier__c IN: supplierIds OR Supplier__c IN: oldSupplierIds)
                                               AND STEM__c IN: stemIds AND Payment_Term__c = 'Deposit' AND Supplier_Issued__c = false]){
        	if(amountMap.get(stemExtraCost.STEM__c + '_' + stemExtraCost.Supplier__c) == null){
                amountMap.put(stemExtraCost.STEM__c + '_' + stemExtraCost.Supplier__c, 0);
                maximumAmountMap.put(stemExtraCost.STEM__c + '_' + stemExtraCost.Supplier__c, 0);
            }
            amountMap.put(stemExtraCost.STEM__c + '_' + stemExtraCost.Supplier__c, amountMap.get(stemExtraCost.STEM__c + '_' + stemExtraCost.Supplier__c) + stemExtraCost.Line_Total_Buy__c);
            Decimal maximumAmount = 0;    
        	if(stemExtraCost.Nundination_Type__c == 'Sell'){
                maximumAmount = 0;
            } else if(!stemExtraCost.Is_Quantity_Range__c || stemExtraCost.Quantity_Delivered_Per_BDN__c != null || stemExtraCost.Fixed__c){
                maximumAmount = stemExtraCost.Line_Total_Buy__c != null ? stemExtraCost.Line_Total_Buy__c : 0;
            } else{
                 if(stemExtraCost.Quantity_Delivered_Per_BDN__c == null && (stemExtraCost.Quantity_Range_Max__c * stemExtraCost.Unit_Cost__c > stemExtraCost.Minimum_Buy_At__c || stemExtraCost.Minimum_Buy_At__c == null)){
                    maximumAmount = stemExtraCost.Quantity_Range_Max__c * stemExtraCost.Unit_Cost__c;
                } else {
                    maximumAmount = stemExtraCost.Minimum_Buy_At__c;
                }
            }
            maximumAmountMap.put(stemExtraCost.STEM__c + '_' + stemExtraCost.Supplier__c, maximumAmountMap.get(stemExtraCost.STEM__c + '_' + stemExtraCost.Supplier__c) + maximumAmount);
        }

        Id payableRecordTypeId = Schema.SObjectType.Payment__c.getRecordTypeInfosByName().get('Payable').getRecordTypeId();
        List<Payment__c> paymentsToUpsert = new List<Payment__c>();
        Map<String, Payment__c> newPaymentMap = new Map<String, Payment__c>();
        Map<String, Payment__c> oldPaymentMap = new Map<String, Payment__c>();
        for(Payment__c payment: [SELECT Id, Date__c, Amount__c, Account__c, STEM__c
                                 FROM Payment__c 
                                 WHERE RecordTypeId =: payableRecordTypeId AND STEM__c IN: stemIds AND (Account__c IN: supplierIds OR Account__c IN: oldSupplierIds)
                                 AND Supplier_Invoice__c = null AND Is_Deposit__c = true]){
            if(amountMap.get(payment.STEM__c + '_' + payment.Account__c) == null || amountMap.get(payment.STEM__c + '_' + payment.Account__c) == 0){
                oldPaymentMap.put(payment.STEM__c + '_' + payment.Account__c, payment);        
            }else{
                newPaymentMap.put(payment.STEM__c + '_' + payment.Account__c, payment);
            }
        }
        delete oldPaymentMap.values();
        for(String key: amountMap.keySet()){
        	if(newPaymentMap.get(key) != null){
            	paymentsToUpsert.add(new Payment__c(Id = newPaymentMap.get(key).Id,
                                                    Amount__c = amountMap.get(key),
                                                    Maximum_Amount__c = maximumAmountMap.get(key),
                                                    Bank__c = 'UBS',
                                                    Is_Deposit__c = true));
			} else if(amountMap.get(key) != 0){
                paymentsToUpsert.add(new Payment__c(RecordTypeId = payableRecordTypeId,
                                                    STEM__c = key.split('_')[0],
                                                    Account__c = key.split('_')[1],
                                                    Date__c = Date.today(),
                                                    Amount__c = amountMap.get(key), 
                                                    Maximum_Amount__c = maximumAmountMap.get(key),
                                                    Bank__c = 'UBS',
                                                    Is_Deposit__c = true));
        	}
        }
    	upsert paymentsToUpsert;
        
    }
}