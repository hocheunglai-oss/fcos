public with sharing class EmailCompensations {

    public static void sendEmails(Set<Id> accountIds) {
        if (accountIds == null || accountIds.isEmpty()) {
            return;
        }

        List<Agreed_Compensation__c> agreedList = [
            SELECT Id,
                   Account__c,
                   Account__r.Name,
                   Amount__c,
                   Deadline_Date__c,
                   Status__c,
                   Contact__c,
                   Contact__r.Name,
            	   Buyer_Supplier_Trader__c
            FROM Agreed_Compensation__c
            WHERE Account__c IN :accountIds
            AND Status__c = 'Opened'
            ORDER BY Contact__r.Name NULLS LAST
        ];

        List<Unofficial_Compensation__c> unofficialList = [
            SELECT Id,
                   Account__c,
                   Account__r.Name,
                   Amount__c,
                   Contact__c,
                   Contact__r.Name,
                   STEM__c,
                   STEM__r.Name,
            	   Buyer_Supplier_Trader__c
            FROM Unofficial_Compensation__c
            WHERE Account__c IN :accountIds AND Cancelled__c =: false
            ORDER BY Contact__r.Name NULLS LAST
        ];

        if (agreedList.isEmpty() && unofficialList.isEmpty()) {
            return;
        }

        Map<Id, Map<Id, List<Object>>> accountMap = new Map<Id, Map<Id, List<Object>>>();

        for (Agreed_Compensation__c a : agreedList) {
            if (!accountMap.containsKey(a.Account__c)) {
                accountMap.put(a.Account__c, new Map<Id, List<Object>>());
            }

            Map<Id, List<Object>> contactMap = accountMap.get(a.Account__c);

            if (!contactMap.containsKey(a.Contact__c)) {
                contactMap.put(a.Contact__c, new List<Object>());
            }

            contactMap.get(a.Contact__c).add(a);
        }

        for (Unofficial_Compensation__c u : unofficialList) {
            if (!accountMap.containsKey(u.Account__c)) {
                accountMap.put(u.Account__c, new Map<Id, List<Object>>());
            }

            Map<Id, List<Object>> contactMap = accountMap.get(u.Account__c);

            if (!contactMap.containsKey(u.Contact__c)) {
                contactMap.put(u.Contact__c, new List<Object>());
            }

            contactMap.get(u.Contact__c).add(u);
        }

        String fullHtmlBody = '';
        for (Id accountId : accountMap.keySet()) {
            Map<Id, List<Object>> contactMap = accountMap.get(accountId);
            if (contactMap == null || contactMap.isEmpty()) continue;
        
            fullHtmlBody += '<br/>';
            fullHtmlBody += buildEmailBody(contactMap);
        }
        
        if(!fullHtmlBody.contains('table')){
            fullHtmlBody = '<p>There is currently no UOC on the book.</p>';
        }
        
        if (!String.isBlank(fullHtmlBody)) {
            List<String> recipients = getRecipientEmails();
            if (recipients.isEmpty()) return;
            String senderEmail = getOrgWideEmail();
            if (String.isBlank(senderEmail)) return;
            List<OrgWideEmailAddress> senderAddresses = [SELECT Id FROM OrgWideEmailAddress WHERE Address = :senderEmail LIMIT 1];
            if (senderAddresses.isEmpty()) return;
            Messaging.SingleEmailMessage email = new Messaging.SingleEmailMessage();
            email.setSubject('***** UOC Daily Report');
            email.setHtmlBody(fullHtmlBody);
            email.setToAddresses(recipients);
            email.setReplyTo(senderEmail);
            email.setOrgWideEmailAddressId(senderAddresses[0].Id);
            Messaging.sendEmail(new List<Messaging.SingleEmailMessage>{ email });
        }
    }
    
    private static List<String> getRecipientEmails() {
        List<String> emails = new List<String>();
    
        for (UOC_Recipient__mdt uocRecipient : [SELECT Email__c FROM UOC_Recipient__mdt]) {
            if (!String.isBlank(uocRecipient.Email__c)) emails.add(uocRecipient.Email__c.trim());
        }
        return emails;
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

    private static String buildEmailBody(Map<Id, List<Object>> contactMap) {
    	return buildHtmlTable(contactMap);
    }
    
    private static String buildHtmlTable(Map<Id, List<Object>> contactMap) {
        Decimal grandTotal = 0;
        Boolean totalOpened = false;
        Boolean hasVisibleData = false;
    
        Id accountId;
        String accountName = '';
    
        for (List<Object> rows : contactMap.values()) {
            if (!rows.isEmpty()) {
                Object o = rows[0];
                if (o instanceof Agreed_Compensation__c) {
                    Agreed_Compensation__c a = (Agreed_Compensation__c)o;
                    if (a.Account__r != null) {
                        accountId = a.Account__c;
                        accountName = a.Account__r.Name;
                    }
                } else if (o instanceof Unofficial_Compensation__c) {
                    Unofficial_Compensation__c u = (Unofficial_Compensation__c)o;
                    if (u.Account__r != null) {
                        accountId = u.Account__c;
                        accountName = u.Account__r.Name;
                    }
                }
                break;
            }
        }
    
        String accountLink = '';
        if (accountId != null) {
            accountLink =
                '<a href="' + Url.getOrgDomainURL().toExternalForm() + '/' + accountId + '" target="_blank">' +
                accountName +
                '</a>';
        }
    
        String html = '';
        html += '<table border="1" cellpadding="6" cellspacing="0" ';
        html += 'style="border-collapse:collapse;width:100%;font-family:Arial;font-size:12px;">';
    
        html += '<tr style="background:#f3f3f3;font-weight:bold">';
        html += '<th align="left">Account</th>';
        html += '<th align="left">Contact</th>';
        html += '<th align="left">PIC</th>';
        html += '<th align="left">Type</th>';
        html += '<th align="left">Stem</th>';
        html += '<th align="left">Deadline</th>';
        html += '<th align="right">Amount</th>';
        html += '<th align="left">Status</th>';
        html += '</tr>';
    
        for (Id contactId : contactMap.keySet()) {
            List<Object> rows = contactMap.get(contactId);
            if (rows.isEmpty()) continue;
    
            Boolean hasOpenedAgreed = false;
    
            for (Object o : rows) {
                if (o instanceof Agreed_Compensation__c) {
                    Agreed_Compensation__c a = (Agreed_Compensation__c)o;
                    if (a.Status__c == 'Opened') {
                        hasOpenedAgreed = true;
                        break;
                    }
                }
            }
    
            if (!hasOpenedAgreed) {
                continue;
            }
    
            hasVisibleData = true;
    
            Decimal subtotal = 0;
            Boolean isOpened = false;
            String contactName = '';
    
            for (Object o : rows) {
                String type = '';
                String trader = '';
                String stemText = '';
                String deadlineText = '';
                String statusText = '';
                Decimal amount = 0;
    
                if (o instanceof Agreed_Compensation__c) {
                    Agreed_Compensation__c a = (Agreed_Compensation__c)o;
    
                    contactName = a.Contact__r != null ? a.Contact__r.Name : '';
                    type = 'New';
                    trader = a.Buyer_Supplier_Trader__c != null ? a.Buyer_Supplier_Trader__c : '';
                    amount = a.Amount__c != null ? a.Amount__c : 0;
                    statusText = a.Status__c != null ? a.Status__c : '';
    
                    if (a.Deadline_Date__c != null) {
                        Date d = a.Deadline_Date__c;
                        deadlineText =
                            d.day() + '/' +
                            d.month() + '/' +
                            d.year();
                    }
    
                    if (a.Status__c == 'Opened') {
                        isOpened = true;
                        totalOpened = true;
                    }
    
                } else {
                    Unofficial_Compensation__c u = (Unofficial_Compensation__c)o;
    
                    contactName = u.Contact__r != null ? u.Contact__r.Name : '';
                    type = 'Compensation';
                    trader = u.Buyer_Supplier_Trader__c != null ? u.Buyer_Supplier_Trader__c : '';
                    amount = u.Amount__c != null ? u.Amount__c : 0;
                    stemText = u.STEM__r != null ? u.STEM__r.Name : '';
                }
    
                subtotal += amount;
                grandTotal += amount;
    
                html += '<tr>';
                html += '<td>' + accountLink + '</td>';
                html += '<td>' + contactName + '</td>';
                html += '<td>' + trader + '</td>';
                html += '<td>' + type + '</td>';
                html += '<td>' + stemText + '</td>';
                html += '<td>' + deadlineText + '</td>';
                html += '<td align="right">$ ' +
                     String.valueOf(amount.setScale(2, RoundingMode.HALF_UP)).replaceAll('\\B(?=(\\d{3})+(?!\\d))', ',') +
                    '</td>';
                html += '<td>' + statusText + '</td>';
                html += '</tr>';
            }
    
            html += '<tr style="font-weight:bold;background:#eef">';
            html += '<td colspan="6">Subtotal</td>';
            html += '<td align="right">$ ' +
                 String.valueOf(subtotal.setScale(2, RoundingMode.HALF_UP)).replaceAll('\\B(?=(\\d{3})+(?!\\d))', ',') +
                '</td>';
            html += '<td>' + (isOpened ? 'Opened' : '') + '</td>';
            html += '</tr>';
        }
    
        if (!hasVisibleData) {
            return '';
        }
    
        html += '<tr style="font-weight:bold;background:#ddd">';
        html += '<td colspan="6">Total</td>';
        html += '<td align="right">$ ' +
             String.valueOf(grandTotal.setScale(2, RoundingMode.HALF_UP)).replaceAll('\\B(?=(\\d{3})+(?!\\d))', ',') +
            '</td>';
        html += '<td>' + (totalOpened ? 'Opened' : 'Closed') + '</td>';
        html += '</tr>';
    
        html += '</table>';
        return html;
    }

}
