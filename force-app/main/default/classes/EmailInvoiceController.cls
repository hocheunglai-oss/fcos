public class EmailInvoiceController {
    @AuraEnabled
    public static EmailData getEmailData(String stemId, List<Invoice__c> invoices) {
        STEM__c stem = [SELECT Id, Enquiry__c, Account__r.Name, KeyStem__c, Contact__c, Contact__r.Name, Contact__r.Salutation, Contact__r.Email, Buyer_Broker__c,
                               Buyer_Broker__r.Company_Code__c, Buyer_Broker__r.Default_Contact__r.Email, Buyer_Broker__r.Name, Buyer_Broker__r.Email_Address__c,
                               Buyer_Broker__r.Default_Contact__r.Name, Vessel__r.Name, Buyer_Broker__r.Accounts_Email__c, Account__r.Accounts_Email__c, Account__r.Email_Address__c,
                               Account__r.Invoicing_Override_to_Contact__c, Buyer_Broker__r.Hidden_Broker__c, Buyer_Broker__r.Hidden_Broker_Company__c,
                               Buyer_Broker__r.Email_Invoice__c, Contact__r.Invoicing_Email_To__c, Contact__r.Invoicing_Cc__c, Buyer_Broker__r.Confirmation_Format__c, Buyer_Broker__r.Invoice_Format__c
                        FROM STEM__c WHERE Id =: stemId LIMIT 1];
        Opportunity enquiry = [SELECT Id, Vessel__r.Name, Account.Name, Primary_Contact__c, Primary_Contact__r.Email FROM Opportunity WHERE Id = :stem.Enquiry__c LIMIT 1];
        List<STEM_Line_Item__c> stemLineItems = [SELECT Id, Product__c, Product__r.Name, STEM__c FROM STEM_Line_Item__c WHERE STEM__c =: stemId];
        List<STEM_Extra_Cost__c> stemExtraCosts = [SELECT Id, Product2Id__c, Product2Id__r.Name, STEM__c FROM STEM_Extra_Cost__c WHERE STEM__c =: stemId];
        EmailData emailData = new EmailData();
        Boolean isBrokerBC = stem.Buyer_Broker__c != null &&
              !stem.Buyer_Broker__r.Hidden_Broker__c && !stem.Buyer_Broker__r.Hidden_Broker_Company__c &&
             (stem.Buyer_Broker__r.Company_Code__c == null || !stem.Buyer_Broker__r.Company_Code__c.startsWith('HK*BC'));
        Boolean toBuyerOnly = stem.Buyer_Broker__c != null && stem.Buyer_Broker__r.Email_Invoice__c == 'TO Buyer Only';
        Boolean toBuyerCCBroker = stem.Buyer_Broker__c != null && stem.Buyer_Broker__r.Email_Invoice__c == 'TO Buyer CC Broker';
        Boolean toBrokerOnly =  stem.Buyer_Broker__c != null && stem.Buyer_Broker__r.Email_Invoice__c == 'TO Broker Only';
        Boolean coBroker = stem.Buyer_Broker__c != null && stem.Buyer_Broker__r.Invoice_Format__c == 'Buyer C/O Broker';

        Boolean proforma = false;
        Boolean creditNote = false;
        for(Invoice__c invoice: invoices){
            if(invoice.Proforma__c){
                proforma = true;
            }
            if(invoice.Name.contains('CN')){
                creditNote = true;
            }
        }

        emailData.toAddress = isBrokerBC
                ? proforma
            ? joinEmails(new List<String>{stem.Buyer_Broker__r.Email_Address__c, stem.Buyer_Broker__r.Accounts_Email__c})
                    : stem.Buyer_Broker__r.Accounts_Email__c
                : proforma
                    ? joinEmails(new List<String>{stem.Account__r.Email_Address__c, stem.Account__r.Accounts_Email__c})
                    : stem.Account__r.Accounts_Email__c;
        emailData.toCCAddress = isBrokerBC
                ? null
                : stem.Buyer_Broker__r.Hidden_Broker__c || stem.Buyer_Broker__r.Hidden_Broker_Company__c
                    ? null
                    : proforma
                        ? joinEmails(new List<String>{stem.Buyer_Broker__r.Email_Address__c, stem.Buyer_Broker__r.Accounts_Email__c})
                        : stem.Buyer_Broker__r.Accounts_Email__c;
        if(stem.Account__r.Invoicing_Override_to_Contact__c){
            emailData.toAddress = stem.Contact__r.Invoicing_Email_To__c;
            emailData.toCCAddress = stem.Contact__r.Invoicing_Cc__c;
        } else if(toBuyerOnly){
            if(proforma){
                emailData.toAddress = joinEmails(new List<String>{stem.Account__r.Email_Address__c, stem.Account__r.Accounts_Email__c});
            } else{
                emailData.toAddress = stem.Account__r.Accounts_Email__c;
            }
            emailData.toCCAddress = '';
        } else if(toBuyerCCBroker){
            if(proforma){
                emailData.toAddress = joinEmails(new List<String>{stem.Account__r.Email_Address__c, stem.Account__r.Accounts_Email__c});
                emailData.toCCAddress = joinEmails(new List<String>{stem.Buyer_Broker__r.Email_Address__c, stem.Buyer_Broker__r.Accounts_Email__c});
            } else{
                emailData.toAddress = stem.Account__r.Accounts_Email__c;
                emailData.toCCAddress = stem.Buyer_Broker__r.Accounts_Email__c;
            }
        } else if(toBrokerOnly){
            if(proforma){
                emailData.toAddress = joinEmails(new List<String>{stem.Buyer_Broker__r.Email_Address__c, stem.Buyer_Broker__r.Accounts_Email__c});
            } else{
                emailData.toAddress = stem.Buyer_Broker__r.Accounts_Email__c;
            }
            emailData.toAddress = stem.Buyer_Broker__r.Accounts_Email__c;
            emailData.toCCAddress = '';
        } else if(coBroker){
            if(proforma){
                emailData.toAddress = joinEmails(new List<String>{stem.Account__r.Email_Address__c, stem.Account__r.Accounts_Email__c});
            } else{
                emailData.toAddress = stem.Account__r.Accounts_Email__c;
            }
            emailData.toCCAddress = '';
        }

        Nomination__c nomination = [SELECT Id, BT_ST_CC_Email_Address__c FROM Nomination__c WHERE STEM__c =: stemId AND RecordTypeId =: FCBStatic.BUYER_NOMINATION_RT_ID AND Deprecated__c = false];
        String senderEmail = getTraderEmailAddress(nomination.BT_ST_CC_Email_Address__c);

        if (emailData.toCCAddress != null && String.isNotBlank(emailData.toCCAddress)){
            emailData.toCCAddress += ',' + senderEmail;
        } else{
            emailData.toCCAddress = senderEmail;
        }

        emailData.toBCCAddress = 'louisa@cosulich.com.hk,laureen@cosulich.com.hk,bt@cosulich.com.hk';

        if(proforma){
            emailData.subject = '(Proforma Invoice - ' + stem.KeyStem__c + ' - ' + stem.Vessel__r.Name + ')';
        } else if(creditNote){
            emailData.subject = '(Electronic Credit Note - ' + stem.KeyStem__c + ' - ' + stem.Vessel__r.Name + ')';
        } else{
            emailData.subject = '(Electronic Invoice - ' + stem.KeyStem__c + ' - ' + stem.Vessel__r.Name + ')';
        }

        if(toBuyerOnly || toBuyerCCBroker){
            emailData.textBody = 'To ' + stem.Account__r.Name;
        } else if(toBrokerOnly || isBrokerBC){
            emailData.textBody = 'To ' + stem.Buyer_Broker__r.Name;
        }else{
            emailData.textBody = 'To ' + stem.Account__r.Name;
        }
        emailData.textBody += '\n\n';
        emailData.textBody += 'We are pleased to enclose the following electronic documents, which serve as our formal request for payment:' + '\n';
        if(proforma){
            emailData.textBody += '- Proforma Invoice' + '\n\n';
        } else if(creditNote){
            emailData.textBody += '- Credit Note' + '\n\n';
            emailData.textBody += 'Please note that unless we receive any new instructions from you, we will not be sending a physical copy.' + '\n\n';
        }else{
            emailData.textBody += '- Invoice' + '\n';
            emailData.textBody += '- Delivery Receipt' + '\n\n';
            emailData.textBody += 'Please note that unless we receive any new instructions from you, we will not be sending a physical copy.' + '\n\n';
        }
        emailData.textBody += 'Thank you for your kind attention and understanding on this matter.' + '\n\n';
        emailData.textBody += 'Best Regards,' + '\n';
        emailData.textBody += 'Fratelli Cosulich Bunkers (HK) Ltd' + '\n';
        emailData.textBody += 'Units 02-03, 23/F, Plaza 228, 228 Wan Chai Road, Hong Kong' + '\n';
        emailData.textBody += 'Office: +852 25299138 | Email: accounts@cosulich.com.hk' + '\n';
        emailData.stemId = stemId;
        emailData.stemLineItems = stemLineItems;
        emailData.stemExtraCosts = stemExtraCosts;
        return emailData;
    }

    public static String joinEmails(List<String> emailStrings) {
        if (emailStrings == null || emailStrings.isEmpty()) {
            return '';
        }

        List<String> ordered = new List<String>();
        Set<String> seen = new Set<String>();

        for (String value : emailStrings) {
            if (String.isBlank(value)) continue;

            for (String p : value.split(',')) {
                if (p == null) continue;

                String email = p.trim();
                if (String.isBlank(email)) continue;

                if (!seen.contains(email)) {
                    seen.add(email);
                    ordered.add(email);
                }
            }
        }

        return ordered.isEmpty() ? '' : String.join(ordered, ',');
    }

    private static String getTraderEmailAddress(String emailAddress) {
        if(runningInASandbox || Test.IsRunningTest()){
            Email_Configuration__mdt emailConfig = [
                SELECT Email_Address__c
                FROM Email_Configuration__mdt
                LIMIT 1
            ];
            return emailConfig.Email_Address__c;
        }
        return emailAddress;
    }

    public static Boolean runningInASandbox {
        get {
            if (runningInASandbox == null) {
                runningInASandbox = [SELECT IsSandbox FROM Organization LIMIT 1].IsSandbox;
            }
            return runningInASandbox;
        }
        set;
    }

    @AuraEnabled
    public static void sendEmail(EmailData emailData, List<Invoice__c> invoices, List<String> documentIds) {
        if (invoices == null || invoices.isEmpty()) {
            throw new AuraHandledException('Invoice readiness could not be verified because no persisted invoice was supplied.');
        }
        Set<Id> invoiceIds = new Set<Id>();
        for (Invoice__c invoice : invoices) {
            if (invoice == null || invoice.Id == null) {
                throw new AuraHandledException('Invoice readiness could not be verified because every invoice must already exist in Salesforce.');
            }
            invoiceIds.add(invoice.Id);
        }
        MasterContractInvoiceReadinessService.assertPersistedInvoicesAllowed(invoiceIds);
        VariableChargeInvoiceReadinessService.assertPersistedInvoicesAllowed(invoiceIds);
        STEM__c stem = [SELECT Id, KeyStem__c, Invoice_Date__c FROM STEM__c WHERE Id = :emailData.stemId LIMIT 1];
        List<String> invoicesIds = new List<String>();
        for(Invoice__c invoice: invoices){
            invoicesIds.add(invoice.Id);
            invoice.Sent__c = true;
        }
        update invoices;
        //Creating EmailMessage and setting Addresses, Sender, Subject, TextBody
        Messaging.SingleEmailMessage mail = new Messaging.SingleEmailMessage();
        List<String> toAddresses = emailData.toAddress.split(',');
        mail.setToAddresses(toAddresses);

        String senderEmail = getOrgWideEmail();
        OrgWideEmailAddress owEmail = [SELECT Id FROM OrgWideEmailAddress WHERE Address = :senderEmail LIMIT 1];
        mail.setReplyTo(senderEmail);
        mail.setOrgWideEmailAddressId(owEmail.Id);

        if (emailData.toCCAddress != null && String.isNotBlank(emailData.toCCAddress)){
            List<String> toCCAddresses = emailData.toCCAddress.split(',');
            mail.setCcAddresses(toCCAddresses);
        }
        if (emailData.toBCCAddress != null && String.isNotBlank(emailData.toBCCAddress)){
            List<String> toBCCAddresses = emailData.toBCCAddress.split(',');
            mail.setBccAddresses(toBCCAddresses);
        }
        mail.setSubject(emailData.subject);
        mail.setPlainTextBody(emailData.textBody);
        List<ContentVersion> versions = [SELECT Id, Title, FileType, VersionData, isLatest, ContentDocumentId, FileExtension, FirstPublishLocationId
                                         FROM ContentVersion where isLatest = true AND ContentDocumentId In: documentIds];
        List<Messaging.EmailFileAttachment> emailAttachments= new List<Messaging.EmailFileAttachment>();
        versions.sort(new DocumentSorter(documentIds));
        for (ContentVersion version : versions) {
            Messaging.EmailFileAttachment emailAttachment = new Messaging.EmailFileAttachment();
            if (String.isNotBlank(version.FileType) && version.FileType.equalsIgnoreCase('pdf')){
                emailAttachment.setContentType('application/pdf');
            } else if(String.isNotBlank(version.FileType) && version.FileType.equalsIgnoreCase('jpg')){
                emailAttachment.setContentType('application/jpg');
            }
            emailAttachment.setFileName(version.Title);
            emailAttachment.setBody(version.VersionData);
            emailAttachments.add(emailAttachment);
        }
        mail.setFileAttachments(emailAttachments);
        Messaging.sendEmail(new Messaging.SingleEmailMessage[] { mail });
    }

    private static String getOrgWideEmail() {
        try {
            Email_Configuration__mdt emailConfig = [
                SELECT Email_Address__c
                FROM Email_Configuration__mdt
                LIMIT 1
            ];
            return emailConfig.Email_Address__c;
        } catch (Exception e) {
            System.debug('Error fetching email config: ' + e.getMessage());
            return null;
        }
    }

    public class EmailData {
        @AuraEnabled public String toAddress{get;set;}
        @AuraEnabled public String toCCAddress{get;set;}
        @AuraEnabled public String toBCCAddress{get;set;}
        @AuraEnabled public String senderDisplayName{get;set;}
        @AuraEnabled public String subject{get;set;}
        @AuraEnabled public String textBody{get;set;}
        @AuraEnabled public String stemId{get;set;}
        @AuraEnabled public List<STEM_Line_Item__c> stemLineItems{get;set;}
        @AuraEnabled public List<STEM_Extra_Cost__c> stemExtraCosts{get;set;}
    }
}
