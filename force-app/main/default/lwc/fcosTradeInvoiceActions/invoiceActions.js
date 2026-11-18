const invoiceObjects = new Set(['Invoice__c', 'Supplier_Invoice__c']);
const finalize = Object.freeze({ name: 'Finalize_Native_Proforma', label: 'Finalize Native Proforma' });
const payment = Object.freeze({ name: 'Record_HKD_Payment', label: 'Record Native Payment' });
const credit = Object.freeze({ name: 'Record_HKD_Credit', label: 'Record Native Credit' });

export function invoiceLauncherRecordId({ objectApiName, recordId, canEnter }) {
    return canEnter === true && invoiceObjects.has(objectApiName)
        && typeof recordId === 'string' && /^[A-Za-z0-9]{18}$/u.test(recordId) ? recordId : undefined;
}

export function availableInvoiceActions({ objectApiName, recordId, canEnter, availability }) {
    const launchId = invoiceLauncherRecordId({ objectApiName, recordId, canEnter });
    if (!launchId || availability?.recordId !== launchId || availability.objectApiName !== objectApiName
        || !Array.isArray(availability.actions)) return [];
    return [finalize, payment, credit].filter(({ name }) => availability.actions.includes(name));
}

export function invoiceActionPageReference({ objectApiName, recordId, canEnter, availability, action }) {
    const allowed = availableInvoiceActions({ objectApiName, recordId, canEnter, availability });
    if (!allowed.some(item => item.name === action)) return null;
    return {
        type: 'standard__quickAction',
        attributes: { apiName: objectApiName + '.' + action },
        state: { recordId }
    };
}
