import { LightningElement, wire } from 'lwc';
import { CurrentPageReference } from 'lightning/navigation';
import { getRecord } from 'lightning/uiRecordApi';
import previewFixture from '@salesforce/apex/FcosTradeCurrencyController.previewFixture';

const quoteFields = ['QuoteLineItem.Id', 'QuoteLineItem.QuoteId', 'QuoteLineItem.Port__r.Name',
    'QuoteLineItem.Product2.Name', 'QuoteLineItem.UnitPrice', 'QuoteLineItem.Supplier_Unit_Price__c'];
const supplierFields = ['Supplier_Bid__c.Id', 'Supplier_Bid__c.Quote__c',
    'Supplier_Bid__c.Product__r.Name', 'Supplier_Bid__c.Supplier__c', 'Supplier_Bid__c.Supplier_Unit_Price__c'];
const commonOptional = ['Buy_Currency__c', 'Buy_USD_Unit_Price_Precise__c', 'Buy_FX_Confirmed_At__c',
    'Expected_Delivery_Date__c', 'Suppliers_Broker__c', 'Partial_CIA__c'];

function recordValues(fields) {
    return Object.fromEntries(Object.entries(fields).map(([name, { value }]) =>
        [name, value?.fields ? recordValues(value.fields) : value]));
}

export default class FcosTradeCurrencyFixtureHost extends LightningElement {
    scope;
    recordId;
    recordFields;
    optionalFields;
    row;
    invalidScope = false;
    requestVersion = 0;
    enquiryLineItems = [];

    @wire(CurrentPageReference)
    async receiveScope(page) {
        if (!page) return;
        const { c__surface: surface, c__recordId: recordId, c__direction: direction, c__fixtureId: fixtureId } = page.state || {};
        const quote = surface === 'quote';
        const valid = page.type === 'standard__component'
            && page.attributes?.componentName === 'c__fcosTradeCurrencyFixtureHost'
            && typeof recordId === 'string' && /^[A-Za-z0-9]{18}$/.test(recordId)
            && typeof fixtureId === 'string' && /^[a-f0-9]{64}$/.test(fixtureId)
            && (direction === 'Buy' && (quote || surface === 'supplier') || direction === 'Sell' && quote);
        const version = ++this.requestVersion;
        this.invalidScope = !valid;
        this.scope = undefined;
        this.recordId = undefined;
        this.row = undefined;
        if (!valid) return;

        // The Apex entrypoint verifies the DEVEE principal and signed record
        // scope before this host reads data or mounts an ordinary modal.
        try {
            await previewFixture({ fixtureId, recordId, direction, currencyCode: null });
            if (version !== this.requestVersion) return;
            const object = quote ? 'QuoteLineItem' : 'Supplier_Bid__c';
            const optional = quote ? [...commonOptional, 'Sell_Currency__c', 'Sell_USD_Unit_Price_Precise__c',
                'Sell_FX_Confirmed_At__c', 'Validity_Time__c', 'Partial_Buyer_CIA__c', 'Supplier__c', 'Quote.Broker__c',
                'Quote.Broker__r.Name', 'Quote.Status'] : commonOptional;
            this.scope = { surface, recordId, direction, fixtureId };
            this.recordFields = quote ? quoteFields : supplierFields;
            this.optionalFields = optional.map(field => object + '.' + field);
            this.recordId = recordId;
        } catch {
            if (version === this.requestVersion) this.invalidScope = true;
        }
    }

    @wire(getRecord, { recordId: '$recordId', fields: '$recordFields', optionalFields: '$optionalFields' })
    receiveRecord({ data, error }) {
        if (!this.scope) return;
        if (error) {
            this.invalidScope = true;
            this.row = undefined;
        } else if (data?.id === this.scope.recordId) {
            const quote = this.scope.surface === 'quote';
            if (data.apiName !== (quote ? 'QuoteLineItem' : 'Supplier_Bid__c')) return;
            const row = recordValues(data.fields);
            const complete = quote ? row.QuoteId && row.Port__r?.Name && row.Product2?.Name
                : row.Quote__c && row.Product__r?.Name && row.Supplier__c;
            this.invalidScope = !complete;
            this.row = complete ? { ...row, Id: data.id } : undefined;
        }
    }

    get offerLine() {
        return this.scope?.surface === 'quote' && this.row ? { ...this.row, ProductName: this.row.Product2.Name } : undefined;
    }

    get quote() {
        return this.offerLine ? { ...this.row.Quote, Id: this.row.QuoteId } : undefined;
    }

    get buyFixtureId() {
        return this.scope?.direction === 'Buy' ? this.scope.fixtureId : undefined;
    }

    get sellFixtureId() {
        return this.scope?.direction === 'Sell' ? this.scope.fixtureId : undefined;
    }

    get bid() {
        return this.scope?.surface === 'supplier' && this.row ? { ...this.row, supplierBidIds: [this.row.Id] } : undefined;
    }

    get bids() {
        return this.bid ? [this.bid] : [];
    }

    get bidQuoteId() {
        return this.bid?.Quote__c;
    }
}
