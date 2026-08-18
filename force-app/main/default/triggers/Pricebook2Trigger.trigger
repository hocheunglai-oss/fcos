trigger Pricebook2Trigger on Pricebook2 (after update) {
    if (ContextManager.skipTriggers) return;
	system.debug('Pricebook 2 trigger');
}