public without sharing class BuyerInvoiceApprovalService {
    // Versioned invoice content, deliberately excluding accounting balances,
    // supplier costs, and workflow status. Keep the FCOS projection in sync.
    public static final List<String> INVOICE_FIELDS = new List<String>{
        'Id','Name','STEM__c','CurrencyIsoCode','Amount__c','Invoice_Date__c',
        'Delivery_Date__c','Invoice_Due_Date__c','File__c'
    };
    public static final List<String> STEM_FIELDS = new List<String>{
        'Id','Account__c','CurrencyIsoCode','Payment_Term__c'
    };
    public static final List<String> LINE_FIELDS = new List<String>{
        'Id','Product__c','Product__r.Name','Quantity__c','Quantity_Delivered_Per_BDN__c',
        'Quantity_Max__c','Unit_of_Measure__c','Unit_Sell_At__c','Total_Price__c','CurrencyIsoCode'
    };
    public static final List<String> EXTRA_FIELDS = new List<String>{
        'Id','Product2Id__c','Product2Id__r.Name','Description__c','Quantity__c',
        'Quantity_Delivered_Per_BDN__c','Quantity_Range_Max__c','Unit_of_Measure__c',
        'Unit_Price__c','Lumpsum_Price__c','Line_Total__c','CurrencyIsoCode'
    };

    public static String snapshot(Invoice__c invoice) {
        Id stemId = invoice.STEM__c, invoiceId = invoice.Id;
        STEM__c stem = Database.query('SELECT ' + String.join(STEM_FIELDS, ',')
            + ' FROM STEM__c WHERE Id = :stemId LIMIT 1');
        List<SObject> lines = Database.query('SELECT ' + String.join(LINE_FIELDS, ',')
            + ' FROM STEM_Line_Item__c WHERE STEM__c = :stemId AND Buyer_Invoice__c = :invoiceId'
            + ' AND Cancelled__c = false ORDER BY Id');
        List<SObject> extras = Database.query('SELECT ' + String.join(EXTRA_FIELDS, ',')
            + ' FROM STEM_Extra_Cost__c WHERE STEM__c = :stemId AND Buyer_Invoice__c = :invoiceId'
            + ' AND Cancelled__c = false ORDER BY Id');
        Id documentId;
        try { documentId = Id.valueOf(invoice.File__c.substringAfterLast('/')); }
        catch (Exception error) { throw blocked('The invoice PDF could not be verified. Generate the invoice PDF again.'); }
        List<ContentDocument> documents = [SELECT Id, LatestPublishedVersionId FROM ContentDocument WHERE Id = :documentId];
        if (documents.isEmpty()) throw blocked('The invoice PDF could not be verified. Generate the invoice PDF again.');
        return JSON.serialize(new Map<String, Object>{
            'version' => 1, 'invoice' => project(invoice, INVOICE_FIELDS),
            'stem' => project(stem, STEM_FIELDS),
            'pdf' => new Map<String, Object>{'Id' => documents[0].Id, 'LatestPublishedVersionId' => documents[0].LatestPublishedVersionId},
            'lines' => projectRows(lines, LINE_FIELDS), 'extras' => projectRows(extras, EXTRA_FIELDS)
        });
    }

    private static List<Object> projectRows(List<SObject> rows, List<String> fields) {
        List<Object> result = new List<Object>();
        for (SObject row : rows) result.add(project(row, fields));
        return result;
    }

    private static Map<String, Object> project(SObject row, List<String> fields) {
        Map<String, Object> result = new Map<String, Object>();
        for (String field : fields) {
            if (field.contains('.')) {
                SObject related = row.getSObject(field.substringBefore('.'));
                result.put(field, related == null ? null : related.get(field.substringAfter('.')));
            } else result.put(field, row.get(field));
        }
        return result;
    }

    public static void assertPersistedInvoicesCanSend(Set<Id> invoiceIds) {
        if (invoiceIds == null || invoiceIds.isEmpty()) return;
        List<Invoice__c> invoices = Database.query('SELECT Proforma__c, Deprecated__c,'
            + 'Buyer_Charge_Snapshot__c,' + String.join(INVOICE_FIELDS, ',')
            + ' FROM Invoice__c WHERE Id IN :invoiceIds');
        if (invoices.size() != invoiceIds.size()) throw blocked('Invoice approval could not be checked.');
        for (Invoice__c invoice : invoices) assertCanSend(invoice);
    }

    public static void assertCanSend(Invoice__c invoice) {
        if (!isFinal(invoice)) return;
        if (invoice.Deprecated__c == true) throw blocked('This invoice has been replaced. Select the current invoice version.');
        if (String.isBlank(invoice.Buyer_Charge_Snapshot__c)) {
            // Older invoices have no issuance snapshot. Preserve their existing
            // approval requirement; never manufacture historical approval.
            VariableChargeInvoiceReadinessService.assertFinalBuyerInvoiceAllowed(invoice.STEM__c);
            return;
        }
        if (invoice.Buyer_Charge_Snapshot__c != snapshot(invoice)) {
            throw blocked('Buyer charges or invoice details changed after this invoice was generated. '
                + 'Review the changes in FCOS and generate the corrected invoice before sending. '
                + VariableChargeInvoiceReadinessService.FCOS_URL_PREFIX + invoice.STEM__c);
        }
    }

    public static void beforeUpdate(Invoice__c invoice, Invoice__c oldInvoice) {
        if (invoice.Buyer_Charge_Snapshot__c != oldInvoice.Buyer_Charge_Snapshot__c) {
            throw blocked('Invoice approval is recorded automatically when an approved invoice PDF is generated.');
        }
        if (!isFinal(invoice)) return;
        Boolean identityChanged = invoice.STEM__c != oldInvoice.STEM__c || !isFinal(oldInvoice);
        Boolean fileChanged = invoice.File__c != oldInvoice.File__c;
        if (identityChanged || fileChanged) {
            VariableChargeInvoiceReadinessService.Readiness readiness =
                VariableChargeInvoiceReadinessService.evaluateBuyer(invoice.STEM__c);
            if (readiness.ready != true) throw blocked(readiness.reason + ' ' + readiness.fcosUrl);
            // Moving an existing PDF to a different STEM cannot carry approval.
            if (identityChanged && invoice.File__c != null && !fileChanged) {
                throw blocked('Generate a new invoice PDF after changing its STEM or invoice type.');
            }
            Boolean tracked = readiness.requiresVariableChargeReview == true
                || String.isNotBlank(oldInvoice.Buyer_Charge_Snapshot__c);
            invoice.Buyer_Charge_Snapshot__c = invoice.File__c == null || !tracked ? null : snapshot(invoice);
        }
        if (oldInvoice.Sent__c != true && invoice.Sent__c == true) assertCanSend(invoice);
    }

    public static Boolean isFinal(Invoice__c invoice) {
        return invoice != null && invoice.Proforma__c != true
            && (invoice.Name == null || !invoice.Name.toUpperCase().contains('-CN-'));
    }

    private static AuraHandledException blocked(String message) {
        AuraHandledException error = new AuraHandledException(message);
        error.setMessage(message);
        return error;
    }
}
