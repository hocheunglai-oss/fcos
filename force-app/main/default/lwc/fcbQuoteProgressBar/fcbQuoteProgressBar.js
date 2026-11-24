import { api, LightningElement, track, wire } from 'lwc';
import getKoreaDeskChoices from '@salesforce/apex/QuoteProgressBarController.getKoreaDeskChoices';
import closeKoreaDeskWon from '@salesforce/apex/QuoteProgressBarController.closeKoreaDeskWon';
import STATUS_FIELD from '@salesforce/schema/Quote.Status';
import { getRecord } from 'lightning/uiRecordApi';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { updateRecord } from 'lightning/uiRecordApi';
import LightningConfirm from 'lightning/confirm';
import { refreshApex } from '@salesforce/apex';
import {MessageContext } from 'lightning/messageService';
import getWinningQuoteLineItems from "@salesforce/apex/QuoteProgressBarController.getWinningQuoteLineItems";


const COLS = [
    {
        label: "Port",
        fieldName: "portUrl",
        type: "url",
        typeAttributes: {
            label: { fieldName: "portName" },
            tooltip: { fieldName: "portName" },
            target: "_blank"
        },
        sortable: true
    },
    {
        label: "Supplier",
        fieldName: "supplierUrl",
        type: "url",
        typeAttributes: {
            label: { fieldName: "supplierName" },
            tooltip: { fieldName: "supplierName" },
            target: "_blank"
        }
    },
    {
        label: "BDN",
        fieldName: "bdnCompany",
        type: "text"
    },
    {
        label: "Product",
        fieldName: "productUrl",
        type: "url",
        typeAttributes: {
            label: { fieldName: "productName" },
            tooltip: { fieldName: "productName" },
            target: "_blank"
        },
        sortable: true
    },
    {
        label: "Qty",
        fieldName: "Qty",
        type: "text",
        initialWidth: 100
    },
      {
        label: "Supplier Payment Term",
        fieldName: "Supplier_Payment_Term__c",
        type: "paymentTerm",
        initialWidth: 140,
        typeAttributes: {
            paymentTermValue: {fieldName: "supplierPaymentTerm"},
            parentId: {fieldName: "Id"}
        },
        wrapText:true
    },
];

export default class FcbQuoteProgressBar extends LightningElement {
    @api recordId;
  get showKoreaDeskChoices() { return this.koreaDeskChoices.length > 0; }
  koreaDeskChoices = [];
  koreaDeskOptions = [{ label: 'Yes', value: 'Yes' }, { label: 'No', value: 'No' }];

  async loadKoreaDeskChoices() {
    const choicesJson = await getKoreaDeskChoices({ recordId: this.recordId, recordType: 'quote' });
    this.koreaDeskChoices = JSON.parse(choicesJson).map(choice => ({
      ...choice,
      isFixed: choice.kind === 'fixed',
      isRequired: choice.kind === 'required'
    }));
  }

  handleKoreaDeskChange(event) {
    const key = event.target.dataset.key;
    this.koreaDeskChoices = this.koreaDeskChoices.map(choice =>
      choice.key === key ? { ...choice, answer: event.detail.value } : choice
    );
  }

  validateKoreaDeskChoices() {
    return [...this.template.querySelectorAll('[data-korea-choice]')]
      .map(input => { input.reportValidity(); return input.checkValidity(); })
      .every(Boolean);
  }

    wiredRecord;
    @track statuses = [];
    wiredStatuses;
    @track currentStatus;
    changedStatus;
    openModal = false;
    showDatatable = false;
    value = "Closed Won";
    @track message;
    statuses = [
        { label: "RFQ", value: "RFQ" },
        { label: "Quote Collection", value: "Quote Collection" },
        { label: "Offer Sent & Negotiation", value: "Offer Sent & Negotiation" },
        { label: "Closed Won", value: "Closed Won" },
    ];

    @track actionExecuting = false;

    @wire(MessageContext)
    messageContext;

    @track columns = COLS;
    @track quoteLineItems = [];
    @track disabledButton = true;

    @wire(getRecord, { recordId: "$recordId", fields: STATUS_FIELD })
    getRecord(value) {
        this.wiredRecord = value;
        const { data, error } = value;
        if (data) {
            this.currentStatus = data.fields.Status.value;
            this.disabledButton = true;
        } else if (error) {
            console.error(error);
        }
    }

    handleClick(event) {
        this.changedStatus = event.target.value;
        this.disabledButton = this.changedStatus === this.currentStatus;
    }

    async nextStatus() {
        try {
        this.disabledButton = true;
        if(this.changedStatus === 'Closed Won'){
            Promise.all([getWinningQuoteLineItems({ quoteId: this.recordId }), this.loadKoreaDeskChoices()]).then(([data]) => {
                this.prepareDataForTable(data);
                let bdnCompanyMap = new Map();
                let showDatatable = false;

                for (const item of this.quoteLineItems) {
                    const key = item.Port__c + '_' + item.Supplier__c;
                    const company = item.bdnCompany;

                    if (bdnCompanyMap.has(key)) {
                        if (bdnCompanyMap.get(key) !== company) {
                            showDatatable = true;
                            break;
                        }
                    } else {
                        bdnCompanyMap.set(key, company);
                    }
                }
                this.openModal = true;
                this.showDatatable = showDatatable
            }).catch(error => {
                this.disabledButton = false;
                this.dispatchEvent(new ShowToastEvent({ title: 'Unable to load Korea Desk', message: error?.body?.message || 'Please try again.', variant: 'error' }));
            });
        } else{
            this.saveStatus();
        }    
        } catch (error) {
            console.error(error)
        }
        
        
    }

    saveStatus(){
        const fields = {};
        fields["Id"] = this.recordId;
        fields[STATUS_FIELD.fieldApiName] = this.changedStatus;
        const recordInput = { fields };
        updateRecord(recordInput).then(() => {
            refreshApex(this.wiredRecord);
            this.closeModal();
            this.dispatchEvent(
                new ShowToastEvent({
                    title: "Success",
                    message: "Quote updated",
                    variant: "success",
                })
            );
            this.disabledButton = false;
            this.actionExecuting = false;
        })
        .catch(error => {
            this.dispatchEvent(
                new ShowToastEvent({
                    title: "Error",
                    message: error.body.output.errors[0].message,
                    variant: "error",
                }),
            );
            this.disabledButton = false;
            this.actionExecuting = false;
        })
    }

    closeModal(event) {
        this.openModal = false;
    }

    handleSave(event) {
        try {
            if (this.actionExecuting) return;
            let quoteLineItemsToUpdate = [];
            if (!this.validateKoreaDeskChoices()) return;
            this.actionExecuting = true;
            if (this.showDatatable) {
                let draftValues = this.template.querySelector("c-fcb-data-table").draftValues;
                draftValues.forEach((changedRecord) => {
                    const fields = {};
                    fields.Id = changedRecord.Id;
                    fields.Supplier_Payment_Term__c = changedRecord.Supplier_Payment_Term__c;
                    quoteLineItemsToUpdate.push({ fields });
                    this.quoteLineItems.find(lineItem => lineItem.Id === changedRecord.Id).Product_Extra_Charges__r?.forEach(extraCharge => {
                        const fields = {};
                        fields.Id = extraCharge.Id;
                        fields.Supplier_Payment_Term__c = changedRecord.Supplier_Payment_Term__c;
                        quoteLineItemsToUpdate.push({ fields });
                    })
                })

                Promise.all(quoteLineItemsToUpdate.map((record) => updateRecord(record))).then(() => {
                    this.saveMessage()
                }).catch(error => {
                    this.actionExecuting = false;
                    this.dispatchEvent(new ShowToastEvent({ title: 'Unable to save payment terms', message: error?.body?.message || 'Please try again.', variant: 'error' }));
                })
            } else {
                this.saveMessage();
            }
        } catch (error) {
            this.actionExecuting = false;
            console.error(error);
            
        }
    }

    saveMessage() {
        closeKoreaDeskWon({
            recordId: this.recordId,
            recordType: 'quote',
            choicesJson: JSON.stringify(this.koreaDeskChoices),
            message: this.message
        }).then(() => {
            refreshApex(this.wiredRecord);
            this.closeModal();
            this.dispatchEvent(new ShowToastEvent({ title: 'Success', message: 'Quote updated', variant: 'success' }));
            this.disabledButton = false;
            this.actionExecuting = false;
        }).catch(error => {
            this.actionExecuting = false;
            this.disabledButton = false;
            this.dispatchEvent(new ShowToastEvent({ title: 'Unable to close quote', message: error?.body?.message || 'Please reopen the window and try again.', variant: 'error' }));
        });
    }

    handleChangeMessage(event){
        this.message = event.detail.value;
    }

    prepareDataForTable(data) {
        if (data) {
            let dates;
            let dependentColumns = {
                bdnCompany: false,
            };
            this.quoteLineItems = data.map(row => {
                dates = this.setDateRange(row);
                if (row.BDN_Company__c || row.Supplier__r.BDN_Company__c) {
                    dependentColumns.bdnCompany = true;
                }
                return {
                    ...row,
                    portUrl: !row.Port__c ? "" : `/${row.Port__c}`,
                    productUrl: !row.Product2 || !row.Product2.Id ? "" : `/${row.Product2.Id}`,
                    supplierUrl: !row.Supplier__c ? "" : `/${row.Supplier__c}`,
                    portName: !row.Port__r ? "" : row.Port__r.Name,
                    productName: !row.Product2 ? "" : row.Product2.Name,
                    supplierName: row.Supplier__r?.Name,
                    bdnCompany: row.BDN_Company__c
                        ? row.BDN_Company__c
                        : !row.Supplier__r
                            ? ""
                            : row.Supplier__r?.BDN_Company__c
                                ? row.Supplier__r?.BDN_Company__c
                                : "",
                    supplierPaymentTerm: !row.Supplier_Payment_Term__c ? "" : row.Supplier_Payment_Term__r.Name,
                    startDateRange: dates.startDateRange.dateValue,
                    endDateRange: dates.endDateRange.dateValue,
                    dateRange: dates.dateRange,
                    Qty: row.Quantity_Range_Maximum__c != undefined ?
                        row.Quantity + '-' + row.Quantity_Range_Maximum__c + ' ' + row.Unit_of_Measure__c :
                        row.Unit_of_Measure__c === '1.' ?
                            row.Unit_of_Measure__c :
                            row.Quantity + ' ' + row.Unit_of_Measure__c,
                };
            }).sort((start, end) => {
                if (new Date(start.startDateRange).toLocaleDateString('en-GB') !== new Date(end.startDateRange).toLocaleDateString('en-GB')) {
                    return new Date(start.startDateRange) - new Date(end.startDateRange);
                } else {
                    return new Date(start.endDateRange) - new Date(end.endDateRange);
                }
            });
        } else if (error) {
            this.error = error;
        }
    }

    setDateRange(quoteLineItem) {
        let startDateRange, endDateRange, dateRange;
        let dateFields = [
            { dateValue: quoteLineItem.ETA_Start_Date__c, dateText: quoteLineItem.ETA_Start_Time__c ? quoteLineItem.ETA_Start_Date__c + 'T' + this.msToTime(quoteLineItem.ETA_Start_Time__c) : quoteLineItem.ETA_Start_Date__c },
            { dateValue: quoteLineItem.ETB_Start_Date__c, dateText: quoteLineItem.ETB_Start_Time__c ? quoteLineItem.ETB_Start_Date__c + 'T' + this.msToTime(quoteLineItem.ETB_Start_Time__c) : quoteLineItem.ETB_Start_Date__c },
            { dateValue: quoteLineItem.ETCD_Start_Date__c, dateText: quoteLineItem.ETCD_Start_Time__c ? quoteLineItem.ETCD_Start_Date__c + 'T' + this.msToTime(quoteLineItem.ETCD_Start_Time__c) : quoteLineItem.ETCD_Start_Date__c },
            { dateValue: quoteLineItem.ETD_Start_Date__c, dateText: quoteLineItem.ETD_Start_Time__c ? quoteLineItem.ETD_Start_Date__c + 'T' + this.msToTime(quoteLineItem.ETD_Start_Time__c) : quoteLineItem.ETD_Start_Date__c },
            { dateValue: quoteLineItem.ETA_End_Date__c, dateText: quoteLineItem.ETA_End_Time__c ? quoteLineItem.ETA_End_Date__c + 'T' + this.msToTime(quoteLineItem.ETA_End_Time__c) : quoteLineItem.ETA_End_Date__c },
            { dateValue: quoteLineItem.ETB_End_Date__c, dateText: quoteLineItem.ETB_End_Time__c ? quoteLineItem.ETB_End_Date__c + 'T' + this.msToTime(quoteLineItem.ETB_End_Time__c) : quoteLineItem.ETB_End_Date__c },
            { dateValue: quoteLineItem.ETCD_End_Date__c, dateText: quoteLineItem.ETCD_End_Time__c ? quoteLineItem.ETCD_End_Date__c + 'T' + this.msToTime(quoteLineItem.ETCD_End_Time__c) : quoteLineItem.ETCD_End_Date__c },
            { dateValue: quoteLineItem.ETD_End_Date__c, dateText: quoteLineItem.ETD_End_Time__c ? quoteLineItem.ETD_End_Date__c + 'T' + this.msToTime(quoteLineItem.ETD_End_Time__c) : quoteLineItem.ETD_End_Date__c },
        ];
        if (quoteLineItem.ETA_ETB__c !== "PROMPT") {
            startDateRange = this.getMinDate(dateFields);
            endDateRange = this.getMaxDate(dateFields);
        } else if (quoteLineItem.ETA_ETB__c === "PROMPT") {
            startDateRange = { dateValue: new Date(quoteLineItem.Expected_Delivery_Date__c), dateText: new Date(quoteLineItem.Expected_Delivery_Date__c).toLocaleDateString() };
            endDateRange = { dateValue: new Date(quoteLineItem.Expected_Delivery_Date__c), dateText: new Date(quoteLineItem.Expected_Delivery_Date__c).toLocaleDateString() };
        }
        if (startDateRange.dateText === endDateRange.dateText) {
            dateRange = startDateRange.dateText.includes("T") ? new Date(startDateRange.dateText).toLocaleString() : new Date(startDateRange.dateText).toLocaleDateString('en-GB');
        } else if (startDateRange.dateText.includes("T") && endDateRange.dateText.includes("T")) {
            dateRange = new Date(startDateRange.dateText).toLocaleString() + " - " + new Date(endDateRange.dateText).toLocaleString();
        } else if (startDateRange.dateText.includes("T")) {
            dateRange = new Date(startDateRange.dateText).toLocaleString() + " - " + new Date(endDateRange.dateText).toLocaleDateString('en-GB');
        } else if (endDateRange.dateText.includes("T")) {
            dateRange = new Date(startDateRange.dateText).toLocaleDateString('en-GB') + " - " + new Date(endDateRange.dateText).toLocaleString();
        } else {
            dateRange = new Date(startDateRange.dateText).toLocaleDateString('en-GB') + " - " + new Date(endDateRange.dateText).toLocaleDateString('en-GB');
        }
        return { startDateRange, endDateRange, dateRange };
    }

    getMinDate(dates) {
        dates = dates.filter(date => date.dateValue);
        if (dates.length === 0) return null;
        return dates.reduce((a, b) => new Date(a.dateValue) < new Date(b.dateValue) ? a : b);
    }

    getMaxDate(dates) {
        dates = dates.filter(date => date.dateValue);
        if (dates.length === 0) return null;
        return dates.reduce((a, b) => new Date(a.dateValue) > new Date(b.dateValue) ? a : b);
    }

    handleSelectedPaymentTerm(event) {
        let paymentTermValue = event.detail.paymentTermValue;
        let rowId = event.detail.rowId;
        let draftValues = [
            ...this.template.querySelector("c-fcb-data-table").draftValues
        ];
        const foundIndex = draftValues.findIndex((x) => x.Id === Id);
        if (foundIndex !== -1) {
            let updated = {
                ...draftValues[foundIndex],
                Supplier_Payment_Term__c: paymentTermValue
            };
            draftValues[foundIndex] = updated;
        } else {
            draftValues.push({
                Id: rowId,
                Supplier_Payment_Term__c: paymentTermValue
            });
        }
        this.template.querySelector("c-fcb-data-table").draftValues = draftValues;
    }
}
