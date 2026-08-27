public class VesselTriggerHandler {
    public static void checkIMO(List<Vessel__c> vesselList) {
        for (Vessel__c vessel : vesselList) {
            if (String.isBlank(vessel.IMO__c)) continue;
            if (!vessel.IMO__c.isNumeric() || vessel.IMO__c.length() != 7) {
                vessel.IMO__c.addError('IMO field should be numeric. Please enter 7 digits, for example 5161536.');
                continue;
            }
            String firstSix = vessel.IMO__c.substring(0, 6);
            List<Integer> digits = getDigits(firstSix);
            Integer result = digits[0] * 7 + digits[1] * 6 + digits[2] * 5 + digits[3] * 4 + digits[4] * 3 + digits[5] * 2;
            String resultText = String.valueOf(result);
            if (vessel.IMO__c != firstSix + resultText.substring(resultText.length() - 1)) vessel.IMO__c.addError('Invalid IMO number, please check entry');
        }
    }
    public static List<Integer> getDigits(String input) { List<Integer> digits = new List<Integer>(); Matcher matcher = Pattern.compile('\\d').matcher(input); while (matcher.find()) digits.add(Integer.valueOf(matcher.group())); return digits; }
    public static void capitalizeName(List<Vessel__c> vesselList) { for (Vessel__c vessel : vesselList) if (vessel.Name != null) vessel.Name = vessel.Name.toUpperCase(); }
    public static void checkNrt(List<Vessel__c> vesselList) { for (Vessel__c vessel : vesselList) if (vessel.NRT__c != null && (vessel.NRT__c <= 0 || vessel.NRT__c != vessel.NRT__c.setScale(0))) vessel.NRT__c.addError('Net Registered Tonnage (NRT) must be a positive whole number.'); }
}
