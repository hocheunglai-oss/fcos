public class ReconfirmProcessing {
	private static final Datetime VARIABLE_CHARGE_CUTOFF = Datetime.newInstanceGmt(2026, 1, 1, 0, 0, 0);

	@AuraEnabled
	    public static List<ReconfirmItem> getReconfirmInfo(List<String> enquiryIds){
        List<STEM_Line_Item__c> stemLineItems = [SELECT Id, STEM__c, STEM__r.Name, Original_Supplier__c, Original_Supplier__r.Name, Reconfirm__c,
	                                                Intended_Payment_Date__c, STEM__r.Enquiry__c, LastModifiedDate
                                                FROM STEM_Line_Item__c WHERE STEM__r.Enquiry__c IN: enquiryIds AND (Payment_Term__c = 'CIA' OR Partial_CIA__c = true)];
        List<STEM_Extra_Cost__c> stemExtraCosts = [SELECT Id, STEM__c, STEM__r.Name, Supplier__c, Supplier__r.Name, Reconfirm__c,
	                                                  Intended_Payment_Date__c, STEM__r.Enquiry__c, LastModifiedDate
                                                  FROM STEM_Extra_Cost__c WHERE STEM__r.Enquiry__c IN: enquiryIds AND Payment_Term__c = 'CIA'];
        List<ReconfirmItem> reconfirmItems = new List<ReconfirmItem>();
        Map<String, String> nominationMap = new Map<String, String>();
        for(Nomination__c nomination: [SELECT Id, STEM__c, Account__c, Buyer_Supplier_Trader__c 
                                       FROM Nomination__c WHERE Enquiry__c IN: enquiryIds 
                                       AND Deprecated__c = false AND RecordTypeId =: FCBStatic.SUPPLIER_NOMINATION_RT_ID]){
        	nominationMap.put(nomination.STEM__c + '-' + nomination.Account__c, nomination.Buyer_Supplier_Trader__c);
		}
        Set<String> userNames = new Set<String>(nominationMap.values());

        Map<String, Id> userIdMap = new Map<String, Id>();
        for (User user : [SELECT Id, Name FROM User WHERE Name IN :userNames]) {
            userIdMap.put(user.Name, user.Id);
        }
        for(STEM_Line_Item__c stemLineItem: stemLineItems){
            String key = stemLineItem.STEM__c + '-' + stemLineItem.Original_Supplier__c;
            String userName = nominationMap.get(key);
            
            Id ownerId = userIdMap.get(userName);
            reconfirmItems.add(new ReconfirmItem(stemLineItem.Id,
                                                 stemLineItem.STEM__r.Enquiry__c,
                                                 stemLineItem.STEM__c,
                                                 stemLineItem.STEM__r.Name,
                                                 stemLineItem.Original_Supplier__c,
                                                 stemLineItem.Original_Supplier__r.Name,
                                                 stemLineItem.Reconfirm__c,
                                                 stemLineItem.Intended_Payment_Date__c,
                                                 ownerId,
                                                 stemLineItem.LastModifiedDate));
        }
        for(STEM_Extra_Cost__c stemExtraCost: stemExtraCosts){
            String key = stemExtraCost.STEM__c + '-' + stemExtraCost.Supplier__c;
            String userName = nominationMap.get(key);
            
            Id ownerId = userIdMap.get(userName);
            reconfirmItems.add(new ReconfirmItem(stemExtraCost.Id,
                                                 stemExtraCost.STEM__r.Enquiry__c,
                                                 stemExtraCost.STEM__c,
                                                 stemExtraCost.STEM__r.Name,
                                                 stemExtraCost.Supplier__c,
                                                 stemExtraCost.Supplier__r.Name,
                                                 stemExtraCost.Reconfirm__c,
                                                 stemExtraCost.Intended_Payment_Date__c,
	                                                 ownerId,
	                                                 stemExtraCost.LastModifiedDate));
        }
		        return reconfirmItems;
		    }

    @AuraEnabled
    public static List<ReconfirmItem> saveCiaChanges(Id enquiryId, List<CiaChangeInput> changes) {
        if (enquiryId == null || changes == null || changes.isEmpty()) {
            throw new AuraHandledException('No CIA supplier changes were supplied.');
        }

        Map<Id, CiaChangeInput> changesById = new Map<Id, CiaChangeInput>();
        Set<Id> lineItemIds = new Set<Id>();
        Set<Id> extraCostIds = new Set<Id>();
        for (CiaChangeInput change : changes) {
            if (change == null || change.recordId == null ||
                (change.intendedPaymentDateChanged != true && change.reconfirmChanged != true)) {
                throw new AuraHandledException('One or more CIA supplier changes are incomplete. Reload and try again.');
            }
            if (changesById.containsKey(change.recordId)) {
                throw new AuraHandledException('A CIA supplier row was submitted more than once. Reload and try again.');
            }
            changesById.put(change.recordId, change);
            if (change.recordId.getSObjectType() == STEM_Line_Item__c.SObjectType) {
                lineItemIds.add(change.recordId);
            } else if (change.recordId.getSObjectType() == STEM_Extra_Cost__c.SObjectType) {
                extraCostIds.add(change.recordId);
            } else {
                throw new AuraHandledException('An unsupported CIA supplier record was supplied. Reload and try again.');
            }
        }

        Map<Id, STEM_Line_Item__c> lineItems = new Map<Id, STEM_Line_Item__c>([
            SELECT Id, STEM__c, STEM__r.Name, STEM__r.Enquiry__c, Original_Supplier__c,
                   Original_Supplier__r.Name, Payment_Term__c, Partial_CIA__c, Reconfirm__c,
                   Intended_Payment_Date__c, LastModifiedDate
            FROM STEM_Line_Item__c
            WHERE Id IN :lineItemIds
            FOR UPDATE
        ]);
        Map<Id, STEM_Extra_Cost__c> extraCosts = new Map<Id, STEM_Extra_Cost__c>([
            SELECT Id, STEM__c, STEM__r.Name, STEM__r.Enquiry__c, Supplier__c,
                   Supplier__r.Name, Payment_Term__c, Reconfirm__c,
                   Intended_Payment_Date__c, LastModifiedDate
            FROM STEM_Extra_Cost__c
            WHERE Id IN :extraCostIds
            FOR UPDATE
        ]);

        List<STEM_Line_Item__c> lineItemUpdates = new List<STEM_Line_Item__c>();
        List<STEM_Extra_Cost__c> extraCostUpdates = new List<STEM_Extra_Cost__c>();
        Map<String, ReconfirmItem> intendedPaymentItems = new Map<String, ReconfirmItem>();
        Map<String, ReconfirmItem> completedItems = new Map<String, ReconfirmItem>();
        Map<String, ReconfirmItem> cancelledItems = new Map<String, ReconfirmItem>();

        for (CiaChangeInput change : changesById.values()) {
            ReconfirmItem item;
            if (lineItems.containsKey(change.recordId)) {
                STEM_Line_Item__c source = lineItems.get(change.recordId);
                validateCiaChange(enquiryId, change, source.STEM__r.Enquiry__c, source.LastModifiedDate,
                    source.Payment_Term__c == 'CIA' || source.Partial_CIA__c == true);
                STEM_Line_Item__c updateRow = new STEM_Line_Item__c(Id = source.Id);
                if (change.intendedPaymentDateChanged == true) updateRow.Intended_Payment_Date__c = change.intendedPaymentDate;
                if (change.reconfirmChanged == true) updateRow.Reconfirm__c = change.reconfirm == true;
                lineItemUpdates.add(updateRow);
                item = new ReconfirmItem(source.Id, enquiryId, source.STEM__c, source.STEM__r.Name,
                    source.Original_Supplier__c, source.Original_Supplier__r.Name,
                    change.reconfirmChanged == true ? change.reconfirm == true : source.Reconfirm__c,
                    change.intendedPaymentDateChanged == true ? change.intendedPaymentDate : source.Intended_Payment_Date__c,
                    null, source.LastModifiedDate);
            } else if (extraCosts.containsKey(change.recordId)) {
                STEM_Extra_Cost__c source = extraCosts.get(change.recordId);
                validateCiaChange(enquiryId, change, source.STEM__r.Enquiry__c, source.LastModifiedDate,
                    source.Payment_Term__c == 'CIA');
                STEM_Extra_Cost__c updateRow = new STEM_Extra_Cost__c(Id = source.Id);
                if (change.intendedPaymentDateChanged == true) updateRow.Intended_Payment_Date__c = change.intendedPaymentDate;
                if (change.reconfirmChanged == true) updateRow.Reconfirm__c = change.reconfirm == true;
                extraCostUpdates.add(updateRow);
                item = new ReconfirmItem(source.Id, enquiryId, source.STEM__c, source.STEM__r.Name,
                    source.Supplier__c, source.Supplier__r.Name,
                    change.reconfirmChanged == true ? change.reconfirm == true : source.Reconfirm__c,
                    change.intendedPaymentDateChanged == true ? change.intendedPaymentDate : source.Intended_Payment_Date__c,
                    null, source.LastModifiedDate);
            } else {
                throw new AuraHandledException('A CIA supplier record no longer exists. Reload and try again.');
            }

            String key = item.stemId + '-' + item.supplierId;
            if (change.intendedPaymentDateChanged == true) intendedPaymentItems.put(key, item);
            if (change.reconfirmChanged == true && item.reconfirm == true) completedItems.put(key, item);
            if (change.reconfirmChanged == true && item.reconfirm != true) cancelledItems.put(key, item);
        }

        if (!lineItemUpdates.isEmpty()) update lineItemUpdates;
        if (!extraCostUpdates.isEmpty()) update extraCostUpdates;
        if (!intendedPaymentItems.isEmpty()) sendReconfirmNotification(intendedPaymentItems.values());
        if (!completedItems.isEmpty()) completeTasks(completedItems.values());
        if (!cancelledItems.isEmpty()) cancelTasks(cancelledItems.values());
        return getReconfirmInfo(new List<String>{ String.valueOf(enquiryId) });
    }

    private static void validateCiaChange(Id expectedEnquiryId, CiaChangeInput change, Id actualEnquiryId,
                                          Datetime actualLastModifiedAt, Boolean isCiaEligible) {
        if (actualEnquiryId != expectedEnquiryId || isCiaEligible != true) {
            throw new AuraHandledException('A CIA supplier row is no longer eligible for this enquiry. Reload and try again.');
        }
        if (change.expectedLastModifiedAt == null || actualLastModifiedAt != change.expectedLastModifiedAt) {
            throw new AuraHandledException('A CIA supplier row changed after it was opened. Reload before saving.');
        }
    }

	    @AuraEnabled
    public static List<VariableChargeSupplierRow> getVariableChargeSuppliers(Id enquiryId) {
        if (enquiryId == null) return new List<VariableChargeSupplierRow>();
        Map<String, VariableChargeSupplierRow> rows = new Map<String, VariableChargeSupplierRow>();
        Set<Id> stemIds = new Set<Id>();
        Set<Id> supplierIds = new Set<Id>();
        for (STEM_Line_Item__c child : [
            SELECT STEM__c, STEM__r.Name, STEM__r.LastModifiedDate, Original_Supplier__c,
                Original_Supplier__r.Name, Original_Supplier__r.Is_Agent__c,
                Original_Supplier__r.LastModifiedDate
            FROM STEM_Line_Item__c
            WHERE STEM__r.Enquiry__c = :enquiryId AND STEM__r.CreatedDate >= :VARIABLE_CHARGE_CUTOFF
                AND Cancelled__c = false AND Original_Supplier__c != null
            ORDER BY STEM__r.Name, Original_Supplier__r.Name, Id
        ]) {
            String key = variableChargeKey(child.STEM__c, child.Original_Supplier__c);
            if (!rows.containsKey(key)) rows.put(key, new VariableChargeSupplierRow(
                child.STEM__c, child.STEM__r.Name, child.STEM__r.LastModifiedDate,
                child.Original_Supplier__c, child.Original_Supplier__r.Name,
                child.Original_Supplier__r.Is_Agent__c, child.Original_Supplier__r.LastModifiedDate
            ));
            rows.get(key).lineItemCount++;
            stemIds.add(child.STEM__c);
            supplierIds.add(child.Original_Supplier__c);
        }
        for (STEM_Extra_Cost__c child : [
            SELECT STEM__c, STEM__r.Name, STEM__r.LastModifiedDate, Supplier__c,
                Supplier__r.Name, Supplier__r.Is_Agent__c, Supplier__r.LastModifiedDate
            FROM STEM_Extra_Cost__c
            WHERE STEM__r.Enquiry__c = :enquiryId AND STEM__r.CreatedDate >= :VARIABLE_CHARGE_CUTOFF
                AND Cancelled__c = false AND Supplier__c != null
            ORDER BY STEM__r.Name, Supplier__r.Name, Id
        ]) {
            String key = variableChargeKey(child.STEM__c, child.Supplier__c);
            if (!rows.containsKey(key)) rows.put(key, new VariableChargeSupplierRow(
                child.STEM__c, child.STEM__r.Name, child.STEM__r.LastModifiedDate,
                child.Supplier__c, child.Supplier__r.Name, child.Supplier__r.Is_Agent__c,
                child.Supplier__r.LastModifiedDate
            ));
            rows.get(key).extraCostCount++;
            stemIds.add(child.STEM__c);
            supplierIds.add(child.Supplier__c);
        }
        if (rows.isEmpty()) return new List<VariableChargeSupplierRow>();

        for (STEM_Variable_Charge_Supplier__c stage : [
            SELECT Id, External_Key__c, STEM__c, Supplier__c, Manual_Review_Required__c,
                Supplier_Status__c, Verified_At__c, Verified_By_Email__c, Revision__c, LastModifiedDate
            FROM STEM_Variable_Charge_Supplier__c
            WHERE STEM__c IN :stemIds AND Supplier__c IN :supplierIds
        ]) {
            VariableChargeSupplierRow row = rows.get(variableChargeKey(stage.STEM__c, stage.Supplier__c));
            if (row == null) continue;
            row.stageId = stage.Id;
            row.manualReviewRequired = stage.Manual_Review_Required__c;
            row.supplierStatus = stage.Supplier_Status__c;
            row.verifiedAt = stage.Verified_At__c;
            row.verifiedByEmail = stage.Verified_By_Email__c;
            row.revision = stage.Revision__c == null ? 0 : Integer.valueOf(stage.Revision__c);
            row.stageLastModifiedAt = isoDateTime(stage.LastModifiedDate);
        }

        Map<String, List<Nomination__c>> nominationsByKey = new Map<String, List<Nomination__c>>();
        for (Nomination__c nomination : [
            SELECT Id, STEM__c, Account__c, Buyer_Supplier_Trader__c, BT_ST_Email_Address__c
            FROM Nomination__c
            WHERE STEM__c IN :stemIds AND Account__c IN :supplierIds AND Deprecated__c = false
                AND RecordTypeId = :FCBStatic.SUPPLIER_NOMINATION_RT_ID
            ORDER BY Id
        ]) {
            String key = variableChargeKey(nomination.STEM__c, nomination.Account__c);
            if (!nominationsByKey.containsKey(key)) nominationsByKey.put(key, new List<Nomination__c>());
            nominationsByKey.get(key).add(nomination);
        }
        for (String key : rows.keySet()) {
            VariableChargeSupplierRow row = rows.get(key);
            List<Nomination__c> nominations = nominationsByKey.get(key);
            Set<String> identities = new Set<String>();
            if (nominations != null) for (Nomination__c nomination : nominations) {
                String name = normalizeIdentity(nomination.Buyer_Supplier_Trader__c);
                String email = normalizeEmail(nomination.BT_ST_Email_Address__c);
                identities.add(name + '|' + email);
                row.supplierTraderName = nomination.Buyer_Supplier_Trader__c;
                row.supplierTraderEmail = email;
            }
            if (nominations == null || nominations.isEmpty()) {
                row.assignmentStatus = 'Missing';
                row.assignmentMessage = 'No active Supplier Nomination is assigned.';
            } else if (identities.size() != 1) {
                row.assignmentStatus = 'Conflict';
                row.assignmentMessage = 'Active Supplier Nominations disagree on the Supplier Trader.';
            } else {
                row.assignmentStatus = 'Resolved';
            }
            row.effectiveRequired = row.isAgent || row.manualReviewRequired;
            row.requirementLocked = row.isAgent;
            row.requirementSource = row.isAgent ? 'Account · Is Agent' : (row.manualReviewRequired ? 'Manual STEM selection' : 'Not required');
        }
        List<VariableChargeSupplierRow> result = rows.values();
        result.sort();
        return result;
    }

    @AuraEnabled
    public static List<VariableChargeSupplierRow> saveVariableChargeRequirements(List<VariableChargeRequirementInput> changes, Id enquiryId) {
        if (enquiryId == null || changes == null || changes.isEmpty()) return getVariableChargeSuppliers(enquiryId);
        Set<Id> stemIds = new Set<Id>();
        Set<Id> supplierIds = new Set<Id>();
        Set<String> keys = new Set<String>();
        for (VariableChargeRequirementInput change : changes) {
            if (change == null || change.stemId == null || change.supplierId == null) throw variableChargeException('Every change requires an exact STEM and Supplier Account.');
            stemIds.add(change.stemId);
            supplierIds.add(change.supplierId);
            keys.add(variableChargeKey(change.stemId, change.supplierId));
        }
        Map<Id, STEM__c> stems = new Map<Id, STEM__c>([
            SELECT Id, Enquiry__c, CreatedDate, LastModifiedDate, Variable_Charges_Confirmed__c
            FROM STEM__c WHERE Id IN :stemIds FOR UPDATE
        ]);
        Map<Id, Account> suppliers = new Map<Id, Account>([
            SELECT Id, Is_Agent__c, LastModifiedDate FROM Account WHERE Id IN :supplierIds
        ]);
        Map<String, STEM_Variable_Charge_Supplier__c> stages = new Map<String, STEM_Variable_Charge_Supplier__c>();
        for (STEM_Variable_Charge_Supplier__c stage : [
            SELECT Id, External_Key__c, STEM__c, Supplier__c, Manual_Review_Required__c,
                Supplier_Status__c, Verified_At__c, Verified_By_Email__c,
                Reviewed_Source_Fingerprint__c, LastModifiedDate
            FROM STEM_Variable_Charge_Supplier__c WHERE External_Key__c IN :keys FOR UPDATE
        ]) stages.put(stage.External_Key__c, stage);
        Set<String> exactPairs = new Set<String>();
        for (STEM_Line_Item__c child : [SELECT STEM__c, Original_Supplier__c FROM STEM_Line_Item__c WHERE STEM__c IN :stemIds AND Original_Supplier__c IN :supplierIds AND Cancelled__c = false]) exactPairs.add(variableChargeKey(child.STEM__c, child.Original_Supplier__c));
        for (STEM_Extra_Cost__c child : [SELECT STEM__c, Supplier__c FROM STEM_Extra_Cost__c WHERE STEM__c IN :stemIds AND Supplier__c IN :supplierIds AND Cancelled__c = false]) exactPairs.add(variableChargeKey(child.STEM__c, child.Supplier__c));
        Set<String> invoicedPairs = new Set<String>();
        for (Supplier_Invoice__c invoice : [SELECT STEM__c, Supplier__c FROM Supplier_Invoice__c WHERE STEM__c IN :stemIds AND Supplier__c IN :supplierIds]) invoicedPairs.add(variableChargeKey(invoice.STEM__c, invoice.Supplier__c));
        Set<Id> buyerInvoicedStems = new Set<Id>();
        for (Invoice__c invoice : [SELECT STEM__c, Name, Proforma__c FROM Invoice__c WHERE STEM__c IN :stemIds]) {
            if (invoice.Proforma__c != true && !(String.isNotBlank(invoice.Name) && invoice.Name.toUpperCase().contains('-CN-'))) buyerInvoicedStems.add(invoice.STEM__c);
        }
        List<STEM_Variable_Charge_Supplier__c> writes = new List<STEM_Variable_Charge_Supplier__c>();
        Set<Id> invalidateStems = new Set<Id>();
        for (VariableChargeRequirementInput change : changes) {
            String key = variableChargeKey(change.stemId, change.supplierId);
            STEM__c stem = stems.get(change.stemId);
            Account supplier = suppliers.get(change.supplierId);
            if (stem == null || stem.Enquiry__c != enquiryId || stem.CreatedDate < VARIABLE_CHARGE_CUTOFF || supplier == null || !exactPairs.contains(key)) {
                throw variableChargeException('A Variable Charges requirement changed or is no longer an exact active STEM/supplier pair. Refresh before saving.');
            }
            if (isoDateTime(stem.LastModifiedDate) != change.expectedStemLastModifiedAt
                || isoDateTime(supplier.LastModifiedDate) != change.expectedAccountLastModifiedAt) {
                throw variableChargeException('The STEM or Supplier Account changed after this row was opened. Refresh before saving.');
            }
            STEM_Variable_Charge_Supplier__c stage = stages.get(key);
            if (stage != null && isoDateTime(stage.LastModifiedDate) != change.expectedStageLastModifiedAt) {
                throw variableChargeException('This supplier requirement changed after it was opened. Refresh before saving.');
            }
            if (supplier.Is_Agent__c == true && change.manualReviewRequired != true) {
                change.manualReviewRequired = false;
            }
            Boolean priorManual = stage?.Manual_Review_Required__c == true;
            Boolean nextManual = change.manualReviewRequired == true;
            if (priorManual && !nextManual && (invoicedPairs.contains(key) || buyerInvoicedStems.contains(change.stemId) || stem.Variable_Charges_Confirmed__c == true)) {
                throw variableChargeException('This supplier can no longer be removed from Variable Charges because invoicing or final confirmation already exists. Use a reasoned GM/Admin resolution.');
            }
            if (stage == null) stage = new STEM_Variable_Charge_Supplier__c(STEM__c = change.stemId, Supplier__c = change.supplierId, External_Key__c = key);
            stage.Manual_Review_Required__c = nextManual;
            if (priorManual != nextManual) {
                stage.Supplier_Status__c = 'Pending';
                stage.Verified_At__c = null;
                stage.Verified_By_Email__c = null;
                stage.Reviewed_Source_Fingerprint__c = null;
                invalidateStems.add(change.stemId);
            }
            writes.add(stage);
        }
        upsert writes External_Key__c;
        if (!invalidateStems.isEmpty()) {
            List<STEM__c> updates = new List<STEM__c>();
            for (Id stemId : invalidateStems) if (stems.get(stemId).Variable_Charges_Confirmed__c == true) updates.add(new STEM__c(Id = stemId, Variable_Charges_Confirmed__c = false));
            if (!updates.isEmpty()) update updates;
        }
        return getVariableChargeSuppliers(enquiryId);
    }
    
    @AuraEnabled
    public static Map<String, Payment__c> getPayablePayments(String enquiryId){
    	String payableRecordTypeId = Schema.SObjectType.Payment__c.getRecordTypeInfosByName().get('Payable').getRecordTypeId();
        Map<String, Payment__c> paymentMap = new Map<String, Payment__c>();
        for(Payment__c payment: [SELECT Id, Account__c, STEM__c FROM Payment__c WHERE RecordTypeId =: payableRecordTypeId AND STEM__r.Enquiry__c =: enquiryId]){
            paymentMap.put(payment.STEM__c + '-' + payment.Account__c, payment);
        }
        return paymentMap;
    }
    
    @AuraEnabled
    public static List<STEM__c> getStemsMessages(Id enquiryId){
        return [SELECT Id, Message__c FROM STEM__c WHERE Enquiry__c =: enquiryId];
    }
    
    @AuraEnabled
    public static void updateStems(List<STEM__c> stems){
        ContextManager.avoidStemRecursion = true;
        update stems;
        ContextManager.avoidStemRecursion = false;
    }
    
    @AuraEnabled
    public static void sendReconfirmNotification(List<ReconfirmItem> reconfirmItems){
        List<String> stemIds = new List<String>();
        List<String> supplierIds = new List<String>();
        List<String> enquiryIds = new List<String>();
        for(ReconfirmItem reconfirmItem: reconfirmItems){
            enquiryIds.add(reconfirmItem.enquiryId);
            stemIds.add(reconfirmItem.stemId);
            supplierIds.add(reconfirmItem.supplierId);
        }
        Map<String, String> nominationMap = new Map<String, String>();
        for(Nomination__c nomination: [SELECT Id, STEM__c, Account__c, Buyer_Supplier_Trader__c 
                                       FROM Nomination__c WHERE STEM__c IN: stemIds AND Account__c IN: supplierIds 
                                       AND Deprecated__c = false AND RecordTypeId =: FCBStatic.SUPPLIER_NOMINATION_RT_ID]){
        	nominationMap.put(nomination.STEM__c + '-' + nomination.Account__c, nomination.Buyer_Supplier_Trader__c);
		}
        Set<String> userNames = new Set<String>(nominationMap.values());

        Map<String, Id> userIdMap = new Map<String, Id>();
        for (User user : [SELECT Id, Name FROM User WHERE Name IN :userNames OR Name = 'Vincent Lee']) {
            userIdMap.put(user.Name, user.Id);
        }
        List<Task> tasks = [SELECT Id, Reconfirm_Unique_Key__c FROM Task WHERE WhatId IN: enquiryIds];
        Map<String, Task> taskMap = new Map<String, Task>();
        for(Task task: tasks){
            taskMap.put(task.Reconfirm_Unique_Key__c, task);
        }
        List<Task> tasksToUpsert = new List<Task>();
        for(ReconfirmItem reconfirmItem: reconfirmItems){
            String key = reconfirmItem.stemId + '-' + reconfirmItem.supplierId;
            String userName = nominationMap.get(key);
            Id ownerId = userIdMap.get(userName);
            Datetime reminderAt = futureReminder(reconfirmItem.intendedPaymentDate);
            String description = reconfirmItem.intendedPaymentDate != null
                ? 'Intended Payment Date: ' + reconfirmItem.intendedPaymentDate.format() + ' for STEM: ' +
                    reconfirmItem.stemName + ' - SUPPLIER: ' + reconfirmItem.supplierName
                : 'Intended Payment Date is not defined for STEM: ' + reconfirmItem.stemName +
                    ' - SUPPLIER: ' + reconfirmItem.supplierName;
            if(taskMap.get(key) != null){
                tasksToUpsert.add(new Task(
                    		 Id = taskMap.get(key).Id,
                			 WhatId = reconfirmItem.enquiryId,
                			 Subject = 'STEM: ' + reconfirmItem.stemName + ' - SUPPLIER: ' + reconfirmItem.supplierName + ' - CIA Reconfirm Task - Intended Payment Date - Updated', 
                             Status = 'Open', 
                             Priority = 'Normal', 
	                         IsReminderSet = reminderAt != null,
                    		 ActivityDate = reconfirmItem.intendedPaymentDate,
	                         ReminderDateTime = reminderAt,
	                         Description = description,
                    		 OwnerId = ownerId != null ? ownerId : userIdMap.get('Vincent Lee'),
                			 Reconfirm_Unique_Key__c = reconfirmItem.stemId + '-' + reconfirmItem.supplierId
            	));
            }else{
            	tasksToUpsert.add(new Task(
                			 WhatId = reconfirmItem.enquiryId,
                			 Subject = 'STEM: ' + reconfirmItem.stemName + ' - SUPPLIER: ' + reconfirmItem.supplierName + ' - CIA Reconfirm Task - Added', 
                             Status = 'Open', 
                             Priority = 'Normal', 
	                         IsReminderSet = reminderAt != null,
                     		 ActivityDate = reconfirmItem.intendedPaymentDate,
	                         ReminderDateTime = reminderAt,
	                         Description = description,
                    		 OwnerId = ownerId != null ? ownerId : userIdMap.get('Vincent Lee'),
                			 Reconfirm_Unique_Key__c = reconfirmItem.stemId + '-' + reconfirmItem.supplierId
            	));      
            }
           	
        }
        upsert tasksToUpsert;
    }

    private static Datetime futureReminder(Date intendedPaymentDate) {
        if (intendedPaymentDate == null) return null;
        Datetime candidate = Datetime.newInstance(intendedPaymentDate, Time.newInstance(9, 0, 0, 0));
        return candidate > System.now() ? candidate : null;
    }
    
    @AuraEnabled
    public static void completeTasks(List<ReconfirmItem> reconfirmItems){
        List<String> enquiryIds = new List<String>();
        for(ReconfirmItem reconfirmItem: reconfirmItems){
            enquiryIds.add(reconfirmItem.enquiryId);
        }
        List<Task> tasks = [SELECT Id, Reconfirm_Unique_Key__c, OwnerId FROM Task WHERE WhatId IN: enquiryIds];
        Map<String, Task> taskMap = new Map<String, Task>();
        for(Task task: tasks){
            taskMap.put(task.Reconfirm_Unique_Key__c, task);
        }
        List<Task> primaryTasks = new List<Task>();
        List<Task> completionTasks = new List<Task>();
        Group allUsers = [SELECT Id FROM Group WHERE DeveloperName = 'All_Users'];
        Map<String, User> users = new Map<String, User>([SELECT Id, Name FROM User WHERE IsActive = true]);
        User currentUser = users.get(UserInfo.getUserId());
        Id fallbackOwnerId;
        for (User user : users.values()) if (user.Name == 'Vincent Lee') fallbackOwnerId = user.Id;
        CustomNotificationType notificationType = [SELECT Id, DeveloperName 
             FROM CustomNotificationType 
             WHERE DeveloperName='All_Users_Notification'];
        for(ReconfirmItem reconfirmItem: reconfirmItems){
            String text = 'STEM: ' + reconfirmItem.stemName + ' - SUPPLIER: ' + reconfirmItem.supplierName +
                ' - CIA Reconfirm Task - Reconfirmed by ' + (currentUser != null ? currentUser.Name : UserInfo.getUserName());
            String primaryKey = reconfirmItem.stemId + '-' + reconfirmItem.supplierId;
            Task primaryTask = taskMap.get(primaryKey);
            primaryTasks.add(new Task(
                             Id = primaryTask != null ? primaryTask.Id : null,
							 WhatId = reconfirmItem.enquiryId,
							 Subject = 'STEM: ' + reconfirmItem.stemName + ' - SUPPLIER: ' + reconfirmItem.supplierName + ' - CIA Reconfirm Task',
							 Status = 'Completed',
							 Priority = 'Normal',
							 IsReminderSet = false,
							 ActivityDate = reconfirmItem.intendedPaymentDate,
							 OwnerId = primaryTask != null ? primaryTask.OwnerId :
								 (reconfirmItem.ownerId != null ? reconfirmItem.ownerId : fallbackOwnerId),
							 Reconfirm_Unique_Key__c = primaryKey
			));

            String completionKey = primaryKey + '- completed';
            Task currentTask = taskMap.get(completionKey);
            completionTasks.add(new Task(
                             Id = currentTask != null ? currentTask.Id : null,
            				 WhatId = reconfirmItem.enquiryId,
                			 Subject = text, 
                             Status = 'Open', 
                             Priority = 'Normal', 
	                         IsReminderSet = false,
                             Description = text,
                             ActivityDate = Date.today(),
                    		 OwnerId = allUsers.Id,
                             Reconfirm_Unique_Key__c = completionKey
            ));
        }
        upsert primaryTasks Reconfirm_Unique_Key__c;
        upsert completionTasks Reconfirm_Unique_Key__c;
        for(ReconfirmItem reconfirmItem: reconfirmItems){
            String text = 'STEM: ' + reconfirmItem.stemName + ' - SUPPLIER: ' + reconfirmItem.supplierName +
                ' - CIA Reconfirm Task - Reconfirmed by ' + (currentUser != null ? currentUser.Name : UserInfo.getUserName());
            notifyUsers(users.keySet(), reconfirmItem.enquiryId, notificationType.Id, text, text);
        }
    }
    
    public static void notifyUsers(Set<String> recipientsIds, String targetId, String notificationTypeId, String title, String body) {
        Messaging.CustomNotification notification = new Messaging.CustomNotification();

        notification.setTitle(title);
        notification.setBody(body);

        notification.setNotificationTypeId(notificationTypeId);
        notification.setTargetId(targetId);
        
        try {
            notification.send(recipientsIds);
        }
        catch (Exception e) {
            System.debug('Problem sending notification: ' + e.getMessage());
        }
    }
    
    @AuraEnabled
    public static void cancelTasks(List<ReconfirmItem> reconfirmItems){
        List<String> enquiryIds = new List<String>();
        for(ReconfirmItem reconfirmItem: reconfirmItems){
            enquiryIds.add(reconfirmItem.enquiryId);
        }
        List<Task> tasks = [SELECT Id, Reconfirm_Unique_Key__c, OwnerId FROM Task WHERE WhatId IN: enquiryIds];
        Map<String, Task> taskMap = new Map<String, Task>();
        for(Task task: tasks){
            taskMap.put(task.Reconfirm_Unique_Key__c, task);
        }
        List<Task> primaryTasks = new List<Task>();
        List<Task> cancellationTasks = new List<Task>();
        Map<String, User> users = new Map<String, User>([SELECT Id, Name FROM User WHERE IsActive = true]);
        User currentUser = users.get(UserInfo.getUserId());
        Id fallbackOwnerId;
        for (User user : users.values()) if (user.Name == 'Vincent Lee') fallbackOwnerId = user.Id;
        for(ReconfirmItem reconfirmItem: reconfirmItems){
            String text = 'STEM: ' + reconfirmItem.stemName + ' - SUPPLIER: ' + reconfirmItem.supplierName +
                ' - CIA Reconfirm Task - Cancelled by ' + (currentUser != null ? currentUser.Name : UserInfo.getUserName());
            
            String primaryKey = reconfirmItem.stemId + '-' + reconfirmItem.supplierId;
            Task ownerTask = taskMap.get(primaryKey);
            Id ownerId = ownerTask != null ? ownerTask.OwnerId :
                (reconfirmItem.ownerId != null ? reconfirmItem.ownerId : fallbackOwnerId);
            Datetime reminderAt = futureReminder(reconfirmItem.intendedPaymentDate);
            primaryTasks.add(new Task(
							 Id = ownerTask != null ? ownerTask.Id : null,
							 WhatId = reconfirmItem.enquiryId,
							 Subject = 'STEM: ' + reconfirmItem.stemName + ' - SUPPLIER: ' + reconfirmItem.supplierName + ' - CIA Reconfirm Task',
							 Status = 'Open',
							 Priority = 'Normal',
							 IsReminderSet = reminderAt != null,
							 ReminderDateTime = reminderAt,
							 ActivityDate = reconfirmItem.intendedPaymentDate,
							 OwnerId = ownerId,
							 Reconfirm_Unique_Key__c = primaryKey
			));

            String completionKey = primaryKey + '- completed';
            Task currentTask = taskMap.get(completionKey);
            cancellationTasks.add(new Task(
                             Id = currentTask != null ? currentTask.Id : null,
            				 WhatId = reconfirmItem.enquiryId,
                			 Subject = text, 
                             Status = 'Open', 
                             Priority = 'Normal', 
	                         IsReminderSet = false,
                             Description = text,
                             ActivityDate = Date.today(),
                             OwnerId = ownerId,
                             Reconfirm_Unique_Key__c = completionKey
            ));     
        }
        upsert primaryTasks Reconfirm_Unique_Key__c;
        upsert cancellationTasks Reconfirm_Unique_Key__c;
    }
    
    @AuraEnabled
    public static void sendUrgentNotification(String supplierId, String stemId){
        String text = 'Accounts Department is trying to make a CIA payment to a supplier for a stem that requires you as the supplier trader to reconfirm.';
        Map<String, String> nominationMap = new Map<String, String>();
        STEM__c stem = [SELECT Id, Name, Enquiry__c FROM STEM__c WHERE Id =: stemId LIMIT 1];
        for(Nomination__c nomination: [SELECT Id, STEM__c, Account__c, Buyer_Supplier_Trader__c 
                                       FROM Nomination__c WHERE STEM__c =: stemId AND Account__c =: supplierId 
                                       AND Deprecated__c = false AND RecordTypeId =: FCBStatic.SUPPLIER_NOMINATION_RT_ID]){
            nominationMap.put(nomination.STEM__c + '-' + nomination.Account__c, nomination.Buyer_Supplier_Trader__c);
        }
        Set<String> userNames = new Set<String>(nominationMap.values());
    
        Map<String, Id> userIdMap = new Map<String, Id>();
        for (User user : [SELECT Id, Name FROM User WHERE Name IN :userNames OR Name = 'Vincent Lee']) {
            userIdMap.put(user.Name, user.Id);
        }
            
        String userName = nominationMap.get(stemId + '-' + supplierId);
        Account supplier = [SELECT Id, Name FROM Account WHERE Id =: supplierId];
        
        Id ownerId = userIdMap.get(userName);
        Task newTask = new Task(
                			 WhatId = stem.Enquiry__c,
                			 Subject = 'STEM: ' + stem.Name + ' - SUPPLIER: ' + supplier.Name + ' - CIA Reconfirm Task - Urgent Reminder', 
                             Status = 'Open', 
                             Priority = 'Normal', 
                             IsReminderSet = true, 
                             ReminderDateTime = Date.today(),
                             Description = text,
             				 ActivityDate = Date.today(),
                    		 OwnerId = ownerId != null ? ownerId : userIdMap.get('Vincent Lee')
       	);
        insert newTask;   
    }
    
    @AuraEnabled
    public static void updateTasksOwner(List<Id> nominationIds){
        List<Nomination__c> nominations = [SELECT Id, Buyer_Supplier_Trader__c, Account__c, STEM__c 
                                          FROM Nomination__c WHERE Id IN: nominationIds AND RecordTypeId =: FCBStatic.NOMINATION_SUPPLIER_RT_IT];
        Map<String, String> nominationMap = new Map<String, String>();
        for(Nomination__c nomination: nominations){
        	nominationMap.put(nomination.STEM__c + '-' + nomination.Account__c, nomination.Buyer_Supplier_Trader__c);
            nominationMap.put(nomination.STEM__c + '-' + nomination.Account__c + '- completed', nomination.Buyer_Supplier_Trader__c);
        }
        if(!nominationMap.isEmpty()){
            Set<String> userNames = new Set<String>(nominationMap.values());
    
            Map<String, Id> userIdMap = new Map<String, Id>();
            for (User user : [SELECT Id, Name FROM User WHERE Name IN :userNames OR Name = 'Vincent Lee']) {
                userIdMap.put(user.Name, user.Id);
            }
            List<Task> tasks = [SELECT Id, OwnerId, Reconfirm_Unique_Key__c FROM Task WHERE Reconfirm_Unique_Key__c In: nominationMap.keySet()];
            for(Task task: tasks){
                Id ownerId = userIdMap.get(nominationMap.get(task.Reconfirm_Unique_Key__c));
                task.OwnerId = ownerId == null ? userIdMap.get('Vincent Lee') : ownerId.getSObjectType() == User.SObjectType ? ownerId != null ? ownerId : userIdMap.get('Vincent Lee') : ownerId;
            }
            update tasks;
        }
    }
    
    @AuraEnabled
    public static List<Public_Day_Off__c> getUsPublicDaysOff(){
        return [SELECT Id, Name, Day__c, Month__c, Country__c FROM Public_Day_Off__c WHERE Country__c = 'US'];
    }
    /*
    @AuraEnabled
    public static String getUsPublicDaysOff(){    
        HttpRequest request = new HttpRequest();
        request.setEndpoint('https://date.nager.at/api/v3/publicholidays/' + (Date.today().year() + 1) + '/SG');
        request.setMethod('GET');
        Http http = new Http();
        HttpResponse response = http.send(request);
        
        if (response.getStatusCode() == 200) {
            String responseBody = response.getBody();
            system.debug(responseBody);
            return responseBody;
        } else {
            String errorMessage = 'Error calling API: ' + response.getStatus();
            system.debug('Error calling API: ' + response.getStatus());
            return 'Error';
        }
    }
    */
	    public class ReconfirmItem{
        @AuraEnabled
        public Id id{ get; set; }
        @AuraEnabled
        public Id enquiryId{ get; set; }
        @AuraEnabled
        public Id stemId{ get; set; }
        @AuraEnabled
        public String stemName{ get; set; }
        @AuraEnabled
        public Id supplierId{ get; set; }
		@AuraEnabled
        public String supplierName{ get; set; }
		@AuraEnabled
        public Boolean reconfirm{ get; set; }
        @AuraEnabled
        public Date intendedPaymentDate{ get; set; }
        @AuraEnabled
        public Id ownerId{ get; set; }
		@AuraEnabled
		public Datetime lastModifiedAt{ get; set; }
        
        public ReconfirmItem(){
            
        }
        
        public ReconfirmItem(Id id, Id enquiryId, Id stemId, String stemName, Id supplierId, String supplierName,
							 Boolean reconfirm, Date intendedPaymentDate, Id ownerId, Datetime lastModifiedAt){
            this.id = id;
            this.enquiryId = enquiryId;
            this.stemId = stemId;
            this.stemName = stemName;
            this.supplierId = supplierId;
            this.supplierName = supplierName;
            this.reconfirm = reconfirm;
            this.intendedPaymentDate = intendedPaymentDate;
            this.ownerId = ownerId;
			this.lastModifiedAt = lastModifiedAt;
	    }
	}

	public class CiaChangeInput {
		@AuraEnabled public Id recordId { get; set; }
		@AuraEnabled public Date intendedPaymentDate { get; set; }
		@AuraEnabled public Boolean intendedPaymentDateChanged { get; set; }
		@AuraEnabled public Boolean reconfirm { get; set; }
		@AuraEnabled public Boolean reconfirmChanged { get; set; }
		@AuraEnabled public Datetime expectedLastModifiedAt { get; set; }
	}

    public class VariableChargeRequirementInput {
        @AuraEnabled public Id stemId { get; set; }
        @AuraEnabled public Id supplierId { get; set; }
        @AuraEnabled public Boolean manualReviewRequired { get; set; }
        @AuraEnabled public String expectedStageLastModifiedAt { get; set; }
        @AuraEnabled public String expectedStemLastModifiedAt { get; set; }
        @AuraEnabled public String expectedAccountLastModifiedAt { get; set; }
    }

    public class VariableChargeSupplierRow implements Comparable {
        @AuraEnabled public String key { get; set; }
        @AuraEnabled public Id stageId { get; set; }
        @AuraEnabled public Id stemId { get; set; }
        @AuraEnabled public String stemName { get; set; }
        @AuraEnabled public Id supplierId { get; set; }
        @AuraEnabled public String supplierName { get; set; }
        @AuraEnabled public Boolean isAgent { get; set; }
        @AuraEnabled public Boolean manualReviewRequired { get; set; }
        @AuraEnabled public Boolean effectiveRequired { get; set; }
        @AuraEnabled public Boolean requirementLocked { get; set; }
        @AuraEnabled public String requirementSource { get; set; }
        @AuraEnabled public String supplierStatus { get; set; }
        @AuraEnabled public Datetime verifiedAt { get; set; }
        @AuraEnabled public String verifiedByEmail { get; set; }
        @AuraEnabled public Integer revision { get; set; }
        @AuraEnabled public String stageLastModifiedAt { get; set; }
        @AuraEnabled public String stemLastModifiedAt { get; set; }
        @AuraEnabled public String accountLastModifiedAt { get; set; }
        @AuraEnabled public String supplierTraderName { get; set; }
        @AuraEnabled public String supplierTraderEmail { get; set; }
        @AuraEnabled public String assignmentStatus { get; set; }
        @AuraEnabled public String assignmentMessage { get; set; }
        @AuraEnabled public Integer lineItemCount { get; set; }
        @AuraEnabled public Integer extraCostCount { get; set; }

        public VariableChargeSupplierRow(Id stemId, String stemName, Datetime stemModified, Id supplierId, String supplierName, Boolean isAgent, Datetime accountModified) {
            this.key = variableChargeKey(stemId, supplierId);
            this.stemId = stemId;
            this.stemName = stemName;
            this.supplierId = supplierId;
            this.supplierName = supplierName;
            this.isAgent = isAgent == true;
            this.manualReviewRequired = false;
            this.effectiveRequired = this.isAgent;
            this.requirementLocked = this.isAgent;
            this.requirementSource = this.isAgent ? 'Account · Is Agent' : 'Not required';
            this.supplierStatus = 'Pending';
            this.revision = 0;
            this.stemLastModifiedAt = isoDateTime(stemModified);
            this.accountLastModifiedAt = isoDateTime(accountModified);
            this.lineItemCount = 0;
            this.extraCostCount = 0;
        }

        public Integer compareTo(Object otherObject) {
            VariableChargeSupplierRow other = (VariableChargeSupplierRow)otherObject;
            String left = String.valueOf(stemName).toLowerCase() + '|' + String.valueOf(supplierName).toLowerCase() + '|' + key;
            String right = String.valueOf(other.stemName).toLowerCase() + '|' + String.valueOf(other.supplierName).toLowerCase() + '|' + other.key;
            return left.compareTo(right);
        }
    }

    private static String variableChargeKey(Id stemId, Id supplierId) {
        return String.valueOf(stemId) + ':' + String.valueOf(supplierId);
    }

    private static String normalizeIdentity(String value) {
        return String.isBlank(value) ? '' : value.trim().toLowerCase().replaceAll('[^a-z0-9]+', ' ');
    }

    private static String normalizeEmail(String value) {
        return String.isBlank(value) ? '' : value.trim().toLowerCase();
    }

    private static String isoDateTime(Datetime value) {
        return value == null ? null : value.formatGmt('yyyy-MM-dd\'T\'HH:mm:ss.SSS\'Z\'');
    }

    private static AuraHandledException variableChargeException(String message) {
        AuraHandledException error = new AuraHandledException(message);
        error.setMessage(message);
        return error;
    }
}
