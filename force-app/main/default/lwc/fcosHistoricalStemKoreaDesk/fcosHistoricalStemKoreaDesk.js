import { api, LightningElement, wire } from 'lwc';
import { getRecord, getFieldValue } from 'lightning/uiRecordApi';
import { getObjectInfo } from 'lightning/uiObjectInfoApi';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import STEM from '@salesforce/schema/STEM__c';
import COUNTRY from '@salesforce/schema/STEM__c.Port__r.Country__c';
import BUYER from '@salesforce/schema/STEM__c.Account__r.Name';
import DESK from '@salesforce/schema/STEM__c.Korea_Desk__c';

const SINGAPORE_BUYER = 'FRATELLI COSULICH BUNKERS (S) PTE LTD';

export default class FcosHistoricalStemKoreaDesk extends LightningElement {
    @api recordId;
    changed = false;
    saving = false;

    @wire(getRecord, { recordId: '$recordId', fields: ['STEM__c.Id'], optionalFields: [COUNTRY, BUYER, DESK] })
    stem;

    @wire(getObjectInfo, { objectApiName: STEM }) objectInfo;

    get fixed() {
        const country = getFieldValue(this.stem.data, COUNTRY);
        return country === 'KOREA' || country === 'KOREA, REPUBLIC OF';
    }

    get visible() {
        if (this.fixed) return true;
        const buyer = getFieldValue(this.stem.data, BUYER);
        return this.stem.data?.fields?.Korea_Desk__c !== undefined
            && buyer?.trim().toUpperCase() === SINGAPORE_BUYER;
    }

    get editable() {
        return this.objectInfo.data?.fields?.Korea_Desk__c?.updateable === true;
    }

    handleChange() {
        this.changed = true;
    }

    handleSubmit(event) {
        if (this.saving) {
            event.preventDefault();
            return;
        }
        this.saving = true;
    }

    handleCancel() {
        this.template.querySelector('lightning-input-field')?.reset();
        this.changed = false;
    }

    handleSuccess() {
        this.saving = false;
        this.changed = false;
        this.dispatchEvent(new ShowToastEvent({ title: 'Korea Desk saved', variant: 'success' }));
    }

    handleError() {
        this.saving = false;
    }
}
