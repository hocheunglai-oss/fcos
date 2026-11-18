import { api, LightningElement, wire } from 'lwc';
import { NavigationMixin } from 'lightning/navigation';
import canEnter from '@salesforce/customPermission/Fcos_Trading_FX_Entry';
import invoiceLauncherActions from '@salesforce/apex/FcosTradeProformaService.invoiceLauncherActions';
import { availableInvoiceActions, invoiceActionPageReference, invoiceLauncherRecordId } from './invoiceActions';

export default class FcosTradeInvoiceActions extends NavigationMixin(LightningElement) {
    @api recordId;
    @api objectApiName;

    get launcherRecordId() {
        return invoiceLauncherRecordId({ objectApiName: this.objectApiName, recordId: this.recordId, canEnter });
    }

    @wire(invoiceLauncherActions, { recordId: '$launcherRecordId' }) availability;

    get actions() {
        return availableInvoiceActions({ objectApiName: this.objectApiName, recordId: this.recordId,
            canEnter, availability: this.availability?.data });
    }

    get hasActions() {
        return this.actions.length > 0;
    }

    handleAction(event) {
        const reference = invoiceActionPageReference({ objectApiName: this.objectApiName, recordId: this.recordId,
            canEnter, availability: this.availability?.data, action: event.currentTarget.dataset.action });
        if (reference) this[NavigationMixin.Navigate](reference);
    }
}
