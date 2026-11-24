trigger KoreaDeskQuoteTransition on Quote (before update) {
    for (Quote quote : Trigger.new) {
        if (quote.Status == 'Closed Won' && Trigger.oldMap.get(quote.Id).Status != 'Closed Won') {
            KoreaDeskCloseService.closingQuoteIds.add(quote.Id);
        }
    }
}
