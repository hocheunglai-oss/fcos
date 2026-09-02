/**
 * ConfirmationToBuyerTemplateController
 * Render Buyer Confirmation document
 */
public with sharing class ConfirmationToBuyerTemplateController {

    public Nomination__c nomination { get; private set; }
    public List<InputRow> inputs { get; private set; }
    public String specialTermsLabel { get; private set; }
    public String specialTermsValue { get; private set; }

    public ConfirmationToBuyerTemplateController() {

        Id nominationId = ApexPages.currentPage().getParameters().get('nominationId');

        nomination = [SELECT Id, BT_ST_Visible__c, Buyer_Supplier_Trader__c, Saved_Inputs__c, Saved_Remarks__c, Account__r.Chop_Type__c
                      FROM Nomination__c WHERE Id = :nominationId];

        inputs = new List<InputRow>();

        if (String.isNotBlank(nomination.Saved_Inputs__c)) {
            List<Object> rawInputs =
                (List<Object>) JSON.deserializeUntyped(nomination.Saved_Inputs__c);

            for (Object o : rawInputs) {

                Map<String, Object> m = (Map<String, Object>) o;

                InputRow r = new InputRow();

                extractText(m.get('label'), r, true);
                extractText(m.get('value'), r, false);

                Object hiddenObj = m.get('isHidden');
                r.isHidden = hiddenObj instanceof Boolean
                    ? (Boolean) hiddenObj
                    : false;

                inputs.add(r);
            }
        }

        if (String.isNotBlank(nomination.Saved_Remarks__c)) {
            Map<String, Object> st =
                (Map<String, Object>) JSON.deserializeUntyped(nomination.Saved_Remarks__c);

            InputRow tmp = new InputRow();
            extractText(st.get('label'), tmp, true);
            extractText(st.get('value'), tmp, false);

            specialTermsLabel = tmp.label;
            system.debug('RAW: ' + tmp.value);
            specialTermsValue = tmp.value
                .replace('</p><p><br></p><p>', '<br/><br/>')
                .replace('</P><P><BR></P><P>', '<br/><br/>')
                .replace('<p><br></p>', '')
                .replace('<p><br/></p>', '')
                .replace('</p><p>', '<br/>')
                .replace('</P><P>', '<br/>')
                .replace('<p>', '')
                .replace('</p>', '')
                .replace('<P>', '')
                .replace('</P>', '');
            system.debug(specialTermsValue);
        }
    }

    private static void extractText(Object raw, InputRow row, Boolean isLabel) {

        if (raw == null) {
            if (isLabel) {
                row.label = '';
                row.labelColSpan = null;
            } else {
                row.value = '';
            }
            return;
        }

        if (raw instanceof String) {
            if (isLabel) {
                row.label = (String) raw;
            } else {
                row.value = (String) raw;
            }
            return;
        }

        if (raw instanceof Map<String, Object>) {

            Map<String, Object> m = (Map<String, Object>) raw;

            if (isLabel) {

                row.label = m.containsKey('content')
                    ? String.valueOf(m.get('content'))
                    : '';

                if (m.containsKey('colSpan')) {
                    Object cs = m.get('colSpan');
                    row.labelColSpan = cs != null
                        ? Integer.valueOf(String.valueOf(cs))
                        : null;
                }

            } else {

                if (m.containsKey('content')) {
                    row.value = String.valueOf(m.get('content'));
                } else {
                    for (Object v : m.values()) {
                        row.value = String.valueOf(v);
                        break;
                    }
                }
            }
        }
    }

    public class InputRow {
        public String label { get; set; }
        public String value { get; set; }
        public Boolean isHidden { get; set; }
        public Integer labelColSpan { get; set; }
    }

}