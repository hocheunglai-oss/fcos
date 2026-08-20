import { LightningElement , api , track , wire} from 'lwc';
import jsPDF from '@salesforce/resourceUrl/jsPDF';
import {loadScript} from "lightning/platformResourceLoader";
import { CurrentPageReference } from 'lightning/navigation';
import jspdfAutotable from '@salesforce/resourceUrl/jspdfAutotable';
import InvoiceHeaderLogo from '@salesforce/resourceUrl/InvoiceHeaderLogo';
import InvoiceRoundChop from '@salesforce/resourceUrl/InvoiceRoundChop';
import InvoiceRoundChopWithSignature from '@salesforce/resourceUrl/InvoiceRoundChopWithSignature';
import getStemInfo from "@salesforce/apex/InvoiceController.getStemInfo";
import getPaymentTerm from "@salesforce/apex/InvoiceController.getPaymentTerm";
import getDBSInfo from "@salesforce/apex/InvoiceController.getDBSInfo";
import getUBSInfo from "@salesforce/apex/InvoiceController.getUBSInfo";
import createInvoice from "@salesforce/apex/InvoiceController.createInvoice";
import generateInvoicePDF from "@salesforce/apex/InvoiceController.generateInvoicePDF";
import upsertLastInvoiceForm from "@salesforce/apex/InvoiceController.upsertLastInvoiceForm";
import getBDNBase64Strings from "@salesforce/apex/InvoiceController.getBDNBase64Strings";
import getVariableChargeInvoiceReadiness from "@salesforce/apex/InvoiceController.getVariableChargeInvoiceReadiness";
import pdfLib from '@salesforce/resourceUrl/pdfLib';
import { fireEvent } from 'c/pubsub';
import { buildInvoiceVesselText, normalizeInvoiceVesselText } from './invoiceVesselText';

export default class FcbInvoiceForm extends LightningElement {
    stemId
    stem;
    products;
    total = {};
    balance;
    attn = {};
    infoText = {};
    vesselText = {};
    buyerName = {};
    todayDate;
    buyerName;
    brokerName;
    address = {};
    @track poVoyageNumber;
    @track poVoyageNumberNeeded = false;
    dbs;
    ubs;
    isModalOpen = false;
    actionExecuted = true;
    proforma = false;
    @track inputs = [];
    @track productInputs = [];
    lastInvoiceForm;
    @track isCreditNote = false;
    @track invoiceNumberLabel;
    isPDFLibLoaded = false;
    @track todayDateLabel;
    selectedProductInputs;
    isProductLineItemExisting;
    @track serviceDeliveryDateValue;

    @track showBalanceRows = false;
    @track variableChargeReadiness;
    invoiceNumber;

    @wire(CurrentPageReference) pageRef;

    renderedCallback(){
        Promise.all([
            loadScript(this, jsPDF)
        ]).then(() => {
            loadScript(this, jspdfAutotable);
        })
        loadScript(this, pdfLib).then(() => {
            this.isPDFLibLoaded = true;
        })
    }

    @api
    openModal(stemId, products, proforma, isProductLineItemExisting, lastInvoiceForm) {
        try {
            this.stemId = stemId;
            this.products = products;
            this.isModalOpen = true;
            this.actionExecuted = false;
            this.proforma = proforma;
            this.isCreditNote = false;
            this.variableChargeReadiness = null;
            this.isProductLineItemExisting = isProductLineItemExisting;
            this.serviceDeliveryDateValue = null;
            this.loadVariableChargeReadiness();
            if(lastInvoiceForm){
                getStemInfo({stemId: this.stemId}).then((stem) => {
                    this.stem = stem;
                    this.invoiceNumber = this.stem.KeyStem__c;
                    this.lastInvoiceForm = lastInvoiceForm;
                    this.fillLastForm(products);
                })
            }else{
                getStemInfo({stemId: this.stemId}).then((stem) => {
                    this.stem = stem;
                    this.invoiceNumber = this.stem.KeyStem__c;
                    getPaymentTerm({paymentTerm: stem.Payment_Term__c}).then(paymentTerm => {
                        getDBSInfo().then((dbs) => {
                            this.dbs = dbs
                            getUBSInfo().then((ubs) => {
                                this.ubs = ubs;
                                this.prefillInputs(paymentTerm, products);
                            })
                        })
                    })
                })
            }
        } catch (error) {
            console.error(error);
        }
    }

    loadVariableChargeReadiness() {
        getVariableChargeInvoiceReadiness({ stemId: this.stemId })
            .then((readiness) => {
                this.variableChargeReadiness = readiness;
            })
            .catch(() => {
                this.variableChargeReadiness = {
                    ready: false,
                    requiresVariableChargeReview: true,
                    reason: 'Variable Charges readiness could not be verified. Refresh and try again.',
                    fcosUrl: `https://fcos.fcuno.com/payment-collections?tab=variable-charges&stemId=${this.stemId}`
                };
            });
    }

    get isFinalInvoiceBlocked() {
        if (this.proforma || this.isCreditNote) return false;
        return !this.variableChargeReadiness || (this.variableChargeReadiness.requiresVariableChargeReview && !this.variableChargeReadiness.ready);
    }

    get readinessBannerVisible() {
        return this.isFinalInvoiceBlocked;
    }

    get variableChargeReadinessReason() {
        return this.variableChargeReadiness?.reason || 'Verifying Variable Charges readiness.';
    }

    get variableChargeFcosUrl() {
        return this.variableChargeReadiness?.fcosUrl || `https://fcos.fcuno.com/payment-collections?tab=variable-charges&stemId=${this.stemId}`;
    }

    get isGenerateDisabled() {
        return !this.actionExecuted || this.isFinalInvoiceBlocked;
    }

    get isExtraCostOnly() {
        return this.isProductLineItemExisting === false;
    }

    fillLastForm(products){
        this.attn = JSON.parse(this.lastInvoiceForm.Attn__c);
        this.infoText = this.lastInvoiceForm.Info_Text__c?.toUpperCase();
        this.total = JSON.parse(this.lastInvoiceForm.Total__c);
        this.productInputs = JSON.parse(this.lastInvoiceForm.Products__c);
        this.selectedProductInputs = JSON.parse(JSON.stringify(this.productInputs))
        this.inputs = JSON.parse(this.lastInvoiceForm.Inputs__c);
        this.vesselText = normalizeInvoiceVesselText(this.lastInvoiceForm.Vessel_Text__c?.toUpperCase());
        this.todayDate = this.lastInvoiceForm.Today_Date__c?.toUpperCase();
        this.buyerName = this.lastInvoiceForm.Buyer_Name__c?.toUpperCase();
        this.brokerName = this.lastInvoiceForm.Broker_Name__c?.toUpperCase();
        this.address = this.lastInvoiceForm.Address__c?.toUpperCase();
        if (this.isExtraCostOnly) this.infoText = this.buildExtraCostInfoText();
        this.isCreditNote = products.every(product => product.total < 0);
        this.invoiceNumberLabel = this.isCreditNote ? 'CREDIT NOTE NO.' : 'INVOICE NO.';
        this.todayDateLabel = this.stem.Mailing_Requirement__c?.includes('-3') && this.isProductLineItemExisting ? 'Date ( =Delivery Date)' : 'Date'
        this.actionExecuted = true;
    }

    prefillInputs(paymentTerm, products){
        let totalAmount = 0;
        this.isCreditNote = products.every(product => product.total < 0);
        this.todayDateLabel = this.stem.Mailing_Requirement__c?.includes('-3') && this.isProductLineItemExisting ? 'Date ( =Delivery Date)' : 'Date'
        products.forEach(product => {
            totalAmount += this.isCreditNote ? Math.abs(product.total) : product.total;
            this.productInputs.push({
                id: product.id,
                name: this.stem.Mailing_Requirement__c?.includes('-4') ? '[BDN Product Name]': product.productName?.toUpperCase(),
                quantity: product.quantity ? this.numberWithCommas(product.quantity?.toFixed(3)) + ' ' + product.unitOfMeasure.toUpperCase() : '',
                unitPrice: product.unitSellAt ? Math.abs(Number(product.unitSellAt))?.toFixed(2) : '',
                amount: this.isCreditNote ? Math.abs(Number(product.total)).toFixed(2) : product.total.toFixed(2)
            });
        })
        this.selectedProductInputs = JSON.parse(JSON.stringify(this.productInputs))
        let imo = this.stem.Vessel__c
            ? Boolean(this.stem.Vessel__r.IMO__c)
                ? this.stem.Vessel__r.IMO__c
                : 'N/A'
            : ''
        this.vesselText = buildInvoiceVesselText(this.stem.Vessel__r?.Name?.toUpperCase(), imo);
        this.buyerName = this.stem.Account__r.Name?.toUpperCase();
        this.todayDate = this.stem.Mailing_Requirement__c?.includes('-3') && this.stem.Delivery_Date__c
            ? new Date(this.stem.Delivery_Date__c).toLocaleDateString('en-GB')
            : new Date().toLocaleDateString('en-GB');
        if(this.stem.Mailing_Requirement__c?.includes('-2')){
            this.poVoyageNumberNeeded = true;
            this.poVoyageNumber = this.stem.PO_Voyage_Number__c?.toUpperCase();
        }
        if (this.stem.Buyer_Broker__c &&
            this.stem.Buyer_Broker__r.Invoice_Format__c == 'Buyer C/O Broker') {
            this.brokerName = 'C/O ' + this.stem.Buyer_Broker__r.Name?.toUpperCase();
            this.address = this.stem.Buyer_Broker__r.Imported_Address__c?.toUpperCase();
            this.attn = {
                label: "ATTN", value: this.stem.Buyer_Broker__r.Attn_Override__c
                    ? this.stem.Buyer_Broker__r.Attn__c
                    : this.stem.Buyer_Broker__r.Default_Contact__c ? this.stem.Buyer_Broker__r.Default_Contact__r.Salutation != null
                        ? this.stem.Buyer_Broker__r.Default_Contact__r.Salutation + ' ' + this.stem.Buyer_Broker__r.Default_Contact__r.Name
                        : this.stem.Buyer_Broker__r.Default_Contact__r.Name : ''
            };
        } else {
            this.address = this.stem.Account__r.Imported_Address__c?.toUpperCase();
            this.attn = {
                label: "ATTN", value: this.stem.Account__r.Attn_Override__c
                    ? this.stem.Account__r.Attn__c
                    : this.stem.Contact__c ? this.stem.Contact__r.Salutation != null
                        ? this.stem.Contact__r.Salutation + ' ' + this.stem.Contact__r.Name
                        : this.stem.Contact__r.Name : ''
            };
        }
        this.infoText = this.isExtraCostOnly
            ? this.buildExtraCostInfoText()
            : this.isCreditNote
            ? 'RE M/V ' + this.stem.Vessel__r?.Name?.toUpperCase() + ' (IMO: ' + imo + ') AT ' + this.stem.Port__r.Name.toUpperCase() + ' ON ' + new Date(this.stem.Delivery_Date__c).toLocaleDateString('en-GB')
            : this.isProductLineItemExisting ?
                this.stem.Delivery_Date__c
                    ? 'FOR BUNKERS SUPPLIED TO ' + this.stem.Vessel__r?.Name?.toUpperCase() + ' (IMO: ' + imo + ') AT ' + this.stem.Port__r.Name.toUpperCase() + ' ON ' + new Date(this.stem.Delivery_Date__c).toLocaleDateString('en-GB')
                    : 'TO BE SUPPLIED TO ' + this.stem.Vessel__r?.Name?.toUpperCase() + ' (IMO: ' + imo + ') AT ' + this.stem.Port__r.Name.toUpperCase() + ' ON ' + this.setDateRange()
                : '';
        this.total = {id: this.makeId(7), name: "TOTAL", quantity: '', unitPrice: '', amount: Math.abs(totalAmount).toFixed(2)};

        if(this.stem.Partial_CIA__c && this.stem.Payments__r){
            this.showBalanceRows = true;
            this.balance = [];
            let paymentAmount = 0;
            this.stem.Payments__r.forEach(payment => {
                paymentAmount += payment.Amount__c;
                this.balance.push({id: this.makeId(7), name: "CASH IN ADVANCE PAID ON " + new Date(payment.Date__c).toLocaleDateString('en-GB'), quantity: '', unitPrice: '', amount: - payment.Amount__c.toFixed(2)})
            })
            this.balance.push({id: this.makeId(7), name: "BALANCE", quantity: '', unitPrice: '', amount: (Math.abs(totalAmount) - paymentAmount).toFixed(2)});
            console.log(this.balance);

        }
        this.inputs.push({id: this.makeId(7), label: "PAYMENT TERM", value: paymentTerm.Name !== 'CIA'
            ? paymentTerm.Name?.toUpperCase() + ' ' + paymentTerm.Description__c?.toUpperCase()
            : paymentTerm.Description__c?.toUpperCase() });
        this.inputs.push({id: this.makeId(7), label: "DUE DATE", value: this.stem.Invoice_Due_Date__c ? new Date(`${this.stem.Invoice_Due_Date__c}T00:00:00`).toLocaleDateString('en-GB') : ''});
        this.inputs.push({id: this.makeId(7), label: "BENEFICIARY BANK", value: this.stem.Account__r.Banking_Preference__c == 'DBS' ? this.dbs.Beneficiary_Bank__c?.toUpperCase() : this.ubs.Beneficiary_Bank__c?.toUpperCase()});
        if(this.stem.Account__r.Banking_Preference__c !== 'DBS'){
            this.inputs.push({id: this.makeId(7), label: "INTERMEDIARY BANK", value: this.ubs.Intermediary_Bank__c?.toUpperCase()});
        }
        this.inputs.push({id: this.makeId(7), label: "BENEFICIARY", value: this.stem.Account__r.Banking_Preference__c == 'DBS' ? this.dbs.Beneficiary__c?.toUpperCase() : this.ubs.Beneficiary__c?.toUpperCase()});
        this.inputs.push({id: this.makeId(7), label: "ACCOUNT NO", value: this.stem.Account__r.Banking_Preference__c == 'DBS' ? this.dbs.Account_No__c.toUpperCase() : this.ubs.Account_No__c.toUpperCase()});
        this.invoiceNumberLabel = this.isCreditNote ? 'CREDIT NOTE NO.' : 'INVOICE NO.';
        this.actionExecuted = true;
    }

    handleChangePoVoyageNumber(event){
        this.poVoyageNumber = event.detail.value.toUpperCase();
    }

    handleChangeAttnLabel(event){
        this.attn.label = event.detail.value.toUpperCase();
    }

    handleChangeAttnValue(event){
        this.attn.value = event.detail.value.toUpperCase();
    }

    handleChangeVesselText(event){
        this.vesselText = event.detail.value.toUpperCase();
    }

    handleChangeBuyerName(event){
        this.buyerName = event.detail.value.toUpperCase();
    }

    handleChangeTodayDate(event){
        this.todayDate = event.detail.value.toUpperCase();
    }

    handleChangeBrokerName(event){
        this.brokerName = event.detail.value.toUpperCase();
    }

    handleChangeAddress(event){
        this.address = event.detail.value.toUpperCase();
    }

    handleChangeInfoText(event){
        this.infoText = event.detail.value.toUpperCase();
    }

    handleChangeServiceDeliveryDate(event) {
        this.serviceDeliveryDateValue = event.detail.value || null;
        this.infoText = this.buildExtraCostInfoText();
    }

    buildExtraCostInfoText() {
        const vessel = String(this.stem?.Vessel__r?.Name || '').trim().toUpperCase();
        const imo = String(this.stem?.Vessel__r?.IMO__c || '').trim().toUpperCase();
        const port = String(this.stem?.Port__r?.Name || '').trim().toUpperCase();
        let wording = 'CHARGES IN CONNECTION WITH';
        if (vessel) wording += ` M/V ${vessel}`;
        if (imo) wording += ` (IMO: ${imo})`;
        if (port) wording += ` AT ${port}`;
        if (this.serviceDeliveryDateValue) {
            wording += ` ON ${new Date(`${this.serviceDeliveryDateValue}T00:00:00`).toLocaleDateString('en-GB')}`;
        }
        return wording;
    }

    handleChangeInputLabel(event){
        this.inputs.find(input => input.id === event.target.dataset.id).label = event.detail.value.toUpperCase();
    }

    handleChangeInputValue(event){
        this.inputs.find(input => input.id === event.target.dataset.id).value = event.detail.value.toUpperCase();
    }

    handleChangeProductName(event){
        this.productInputs.find(input => input.id === event.target.dataset.id).name = event.detail.value.toUpperCase();
    }

    handleChangeProductQuantity(event){
        this.productInputs.find(input => input.id === event.target.dataset.id).quantity = event.detail.value.toUpperCase();
    }

    handleChangeProductUnitPrice(event){
        this.productInputs.find(input => input.id === event.target.dataset.id).unitPrice = event.detail.value.toUpperCase();
    }

    handleChangeProductAmount(event){
        this.productInputs.find(input => input.id === event.target.dataset.id).amount = event.detail.value.toUpperCase();
    }

    handleChangeTotalName(event){
        this.total.name = event.detail.value.toUpperCase();
    }

    handleChangeTotalAmount(event){
        this.total.amount = event.detail.value.toUpperCase();
    }

    handleChangeBalanceName(event){
        this.balance.find(input => input.id === event.target.dataset.id).name = event.detail.value.toUpperCase();
    }

    handleChangeBalanceAmount(event){
        this.balance.find(input => input.id === event.target.dataset.id).amount = event.detail.value.toUpperCase();
    }

    handleChangeInvoiceNumber(event){
        this.invoiceNumber = event.detail.value.toUpperCase();
    }

    handleDragProductStart(event) {
        event.dataTransfer.setData('text/plain', event.target.dataset.id);
    }

    handleDragProductOver(event) {
        event.preventDefault();
    }

    handleProductDrop(event) {
        event.preventDefault();
        const draggedItemId = event.dataTransfer.getData('text/plain');
        const dropzoneId = event.target.dataset.id;
        const draggedIndex = this.productInputs.findIndex(input => input.id === draggedItemId);
        const dropzoneIndex = this.productInputs.findIndex(input => input.id === dropzoneId);

        if (draggedIndex > -1 && dropzoneIndex > -1) {
            const draggedItem = this.productInputs.splice(draggedIndex, 1)[0];
            this.productInputs.splice(dropzoneIndex, 0, draggedItem);
            this.productInputs = [...this.productInputs];
        }
    }

    handleDragStart(event) {
        event.dataTransfer.setData('text/plain', event.target.dataset.id);
    }

    handleDragOver(event) {
        event.preventDefault();
    }

    handleDrop(event) {
        event.preventDefault();
        const draggedItemId = event.dataTransfer.getData('text/plain');
        const dropzoneId = event.target.dataset.id;
        const draggedIndex = this.inputs.findIndex(input => input.id === draggedItemId);
        const dropzoneIndex = this.inputs.findIndex(input => input.id === dropzoneId);

        if (draggedIndex > -1 && dropzoneIndex > -1) {
            const draggedItem = this.inputs.splice(draggedIndex, 1)[0];
            this.inputs.splice(dropzoneIndex, 0, draggedItem);
            this.inputs = [...this.inputs];
        }
    }

    addNewProduct(){
        this.productInputs.push({id: this.makeId(7), name: "", quantity: '', unitPrice: '', amount: ''})
    }

    addNewInput(){
        this.inputs.push({id: this.makeId(7), label: "", value: ""});
    }

    removeProductInput(event){
        this.productInputs = this.productInputs.filter(input => {
            return input.id !== event.target.dataset.id;
        })
    }

    removeInput(event){
        this.inputs = this.inputs.filter(input => {
            return input.id !== event.target.dataset.id;
        })
    }

    handleGeneratePDF(event) {
        try {
            if (this.isGenerateDisabled) return;
            this.vesselText = normalizeInvoiceVesselText(this.vesselText);
            this.actionExecuted = false;
            const { jsPDF } = window.jspdf;
            let doc = new jsPDF('p', 'pt', 'a4', true);
            doc.setFont('courier', 'bold');
            this.addHeader(doc);
            doc.setTextColor(0, 0, 0);
            doc.setFontSize(8);
            let maxRowLength = 700;
            let head = [];
            let invoiceText = this.isCreditNote ? 'CREDIT NOTE NO.' : 'INVOICE NO.';
            if (this.stem.Buyer_Broker__c &&
                this.stem.Buyer_Broker__r.Invoice_Format__c == 'Buyer C/O Broker') {
                if(this.stem.Mailing_Requirement__c?.includes('-2')){
                    head = [[this.vesselText, '', invoiceText, ': ' + this.invoiceNumber],
                    [this.buyerName, '', 'DATE', ': ' + this.todayDate],
                    [this.brokerName, '', 'P/O VOYAGE #', ': ' + this.poVoyageNumber],
                    [this.address]]
                } else{
                    head = [[this.vesselText, '', invoiceText, ': ' + this.invoiceNumber],
                    [this.buyerName, '', 'DATE', ': ' + this.todayDate],
                    [this.brokerName],
                    [this.address]]
                }
            } else {
                if(this.stem.Mailing_Requirement__c?.includes('-2')){
                    head = [[this.vesselText, '', invoiceText, ': ' + this.invoiceNumber],
                    [this.buyerName, '', 'DATE', ': ' + this.todayDate],
                    ['', '', 'P/O VOYAGE #', ': ' + this.poVoyageNumber],
                    [this.address]]
                } else{
                    head = [[this.vesselText, '', invoiceText, ': ' + this.invoiceNumber],
                    [this.buyerName, '', 'DATE', ': ' + this.todayDate],
                    [this.address]]
                }
            }
            doc.autoTable({
                head: head,
                tableWidth: 'auto',
                margin: { top: 160 },
                styles: { font: 'courier', fontSize: 8, textColor: [0, 0, 0], cellPadding: 2 },
                alternateRowStyles: { fillColor: [255, 255, 255] },
                tableLineColor: [255, 255, 255],
                headStyles: { fillColor: [255, 255, 255] },
            });

            if(this.proforma){
                doc.setFontSize(12);
                let text = "PROFORMA INVOICE"
                let xOffset = (doc.internal.pageSize.width / 2) - (doc.getStringUnitWidth(text) * doc.internal.getFontSize() / 2);
                doc.text(text, xOffset, doc.lastAutoTable.finalY + 10);
                doc.setFontSize(8);
            }
            doc.text(this.attn.label + ': ' + this.attn.value, 40, doc.lastAutoTable.finalY + 30);
            doc.text(this.infoText, 40, doc.lastAutoTable.finalY + 50)
            let tableRows = [['', '', 'USD', 'USD']];
            tableRows = tableRows.concat(
                this.productInputs.map(input => [
                    input.name,
                    input.quantity,
                    input.unitPrice ? this.numberWithCommas(Number(input.unitPrice).toFixed(2)) : '',
                    input.amount ? this.numberWithCommas(Number(input.amount).toFixed(2)) : ''
                ])
            );
            tableRows.push(['','','','']);
            tableRows.push([this.total.name, '', '', this.numberWithCommas(Number(this.total.amount).toFixed(2))])
            var equalsSymbols = "=".repeat(String(this.total.amount).length + 3);
            tableRows.push(['','','', equalsSymbols]);
            if(this.balance){
                this.balance.forEach(balanceRow => {
                    tableRows.push([balanceRow.name, '', '', this.numberWithCommas(Number(balanceRow.amount).toFixed(2))])
                })
            }

            let pageHeight = doc.lastAutoTable.finalY + 60;
            let marginTop = doc.lastAutoTable.finalY + 60;
            let currentRows = [];

            tableRows.forEach((tableRow) => {
                pageHeight = pageHeight + 13;
                if (pageHeight < maxRowLength) {
                    currentRows.push(tableRow);
                } else {
                    pageHeight = 50;
                    doc.autoTable({
                        head: [['DESCRIPTION', 'QUANTITY', 'UNIT PRICE', 'AMOUNT']],
                        body: currentRows,
                        tableWidth: 'auto',
                        margin: { top: marginTop },
                        styles: { font: 'courier', fontStyle: 'bold', fontSize: 8, textColor: [0, 0, 0], cellPadding: 2 },
                        alternateRowStyles: { fillColor: [255, 255, 255] },
                        tableLineColor: [255, 255, 255],
                        headStyles: { lineWidth: {top: 10, right: 0, bottom: 10, left: 0}, lineColor: [255, 0, 0]},
                        didParseCell: (hookData) => {
                            if (hookData.column.index !== 0) {
                                hookData.cell.styles.halign = 'right';
                            }
                        },
                        willDrawCell: function (data) {
                            if (data.section === 'body') {
                                doc.setDrawColor(0, 0, 0);
                                doc.setLineWidth(0.5);

                                doc.line(
                                    data.cell.x,
                                    data.cell.y + data.cell.height,
                                    data.cell.x + data.cell.width,
                                    data.cell.y + data.cell.height
                                );
                            }
                        },
                    });
                    doc.addPage();
                    marginTop = 50;
                    currentRows = [tableRow];
                }
            })
            doc.autoTable({
                head: [['DESCRIPTION', 'QUANTITY', 'UNIT PRICE', 'AMOUNT']],
                body: currentRows,
                tableWidth: 'auto',
                pageBreak: 'auto',
                rowPageBreak: 'avoid',
                startY: marginTop,
                styles: { font: 'courier', fontStyle: 'bold', fontSize: 8, textColor: [0, 0, 0], cellPadding: 2 },
                alternateRowStyles: { fillColor: [255, 255, 255] },
                tableLineColor: [255, 255, 255],
                headStyles: { fillColor: [255, 255, 255], lineWidth: {top: 1, right: 0, bottom: 1, left: 0}, lineColor: [0, 0, 0] },
                didParseCell: (hookData) => {
                    if (hookData.column.index === 1 || hookData.column.index === 2 || hookData.column.index === 3) {
                        hookData.cell.styles.halign = 'right';
                    }
                },
                willDrawCell: function (data) {
                    if (data.section === 'body') {
                        doc.setDrawColor(0, 0, 0);
                        doc.setLineWidth(0.5);

                        doc.line(
                            data.cell.x,
                            data.cell.y + data.cell.height,
                            data.cell.x + data.cell.width,
                            data.cell.y + data.cell.height
                        );
                    }
                },
            });
            if(!this.isCreditNote){
                doc.line(40, doc.lastAutoTable.finalY, 555, doc.lastAutoTable.finalY);
                doc.text('PLEASE MAKE PAYMENT BY TELEGRAPHIC TRANSFER, FREE OF ANY BANK CHARGES', 40, doc.lastAutoTable.finalY + 20);
                tableRows = this.inputs.map(input => [
                    input.label,
                    input.value ? `: ${input.value}` : ''
                ]);
                pageHeight = doc.lastAutoTable.finalY + 30;
                marginTop = doc.lastAutoTable.finalY + 30;
                currentRows = [];
                tableRows.forEach((tableRow) => {
                    pageHeight = pageHeight + 13;
                    if (pageHeight < maxRowLength) {
                        currentRows.push(tableRow);
                    } else {
                        pageHeight = 50;
                        doc.autoTable({
                            body: currentRows,
                            tableWidth: 'auto',
                            margin: { top: marginTop },
                            styles: { font: 'courier', fontStyle: 'bold', fontSize: 8, textColor: [0, 0, 0], cellPadding: 2 },
                            alternateRowStyles: { fillColor: [255, 255, 255] },
                            tableLineColor: [255, 255, 255],
                        });
                        doc.addPage();
                        marginTop = 50;
                        currentRows = [tableRow];
                    }
                })
                doc.autoTable({
                    body: currentRows,
                    tableWidth: 'auto',
                    pageBreak: 'auto',
                    rowPageBreak: 'avoid',
                    startY: marginTop ,
                    styles: { font: 'courier', fontStyle: 'bold', fontSize: 8, textColor: [0, 0, 0], cellPadding: 2 },
                    alternateRowStyles: { fillColor: [255, 255, 255] },
                    tableLineColor: [255, 255, 255]
                });

                let finalY = doc.lastAutoTable.finalY;
                this.addText(doc, finalY);
            }

            this.addFooters(doc);
            const base64String = doc.output('datauristring').split(',')[1];
            let fields = this.mapLastInvoiceFormFields();
            let selectedProducts = this.selectedProductInputs.map(product => {
                if(product.id.length > 7) return product.id;
            })
            createInvoice({
                stemId: this.stemId,
                extraIds: selectedProducts,
                createProforma: this.proforma,
                isCreditNote: this.isCreditNote,
                invoiceDate: this.stem.Mailing_Requirement__c?.includes('-3')
                    ? this._convertDate(new Date(this.stem.Delivery_Date__c))
                    : this._convertDate(new Date()),
                deliveryDate: this.isExtraCostOnly
                    ? this.serviceDeliveryDateValue
                    : this.stem.Delivery_Date__c
                    ? this._convertDate(new Date(this.stem.Delivery_Date__c))
                    : null,
                invoiceDueDate: this._convertDate(new Date(this.stem.Invoice_Due_Date__c)),
            }).then((result) => {
                if (this.stem.Mailing_Requirement__c?.includes('-7')) {
                    getBDNBase64Strings({ entityIds: this.products.map(product => product.id) }).then(async (bdn64Strings) => {
                        try {
                            const { PDFDocument } = window['pdfLib'] || window['PDFLib'];
                            const mergedPdf = await PDFDocument.create();

                            bdn64Strings.unshift(base64String)

                            for (let pdfFile of bdn64Strings) {
                                const pdfBytes = Uint8Array.from(atob(pdfFile), c => c.charCodeAt(0));
                                const pdfDoc = await PDFDocument.load(pdfBytes);
                                const copiedPages = await mergedPdf.copyPages(pdfDoc, pdfDoc.getPageIndices());
                                copiedPages.forEach(page => mergedPdf.addPage(page));
                            }

                            const mergedPdfBytes = await mergedPdf.save();

                            function arrayBufferToBase64(buffer) {
                                let binary = '';
                                const bytes = new Uint8Array(buffer);
                                const chunkSize = 8192;

                                for (let i = 0; i < bytes.length; i += chunkSize) {
                                    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
                                }
                                return btoa(binary);
                            }
                            const combinedBase64String = arrayBufferToBase64(mergedPdfBytes);
                            generateInvoicePDF({
                                invoiceId: result.Id,
                                invoiceVersionName: result.Name,
                                extraIds: selectedProducts,
                                body: combinedBase64String,
                                createProforma: this.proforma,
                            }).then(() => {
                                upsertLastInvoiceForm({ lastInvoiceForm: fields }).then(() => {
                                    this.closeModal();
                                    fireEvent(this.pageRef, "refreshInvoices", true);
                                });
                            });
                        } catch (error) {
                            console.error('Error merging PDF files:', error);
                        }
                    })
                } else {
                    generateInvoicePDF({
                        invoiceId: result.Id,
                        invoiceVersionName: result.Name,
                        extraIds: selectedProducts,
                        body: base64String,
                        createProforma: this.proforma,
                    }).then(() => {
                        upsertLastInvoiceForm({ lastInvoiceForm: fields }).then(() => {
                            this.closeModal();
                            fireEvent(this.pageRef, "refreshInvoices", true);
                        });
                    });
                }
            })
        } catch (error) {
            console.error(error);
        }
    }

    saveByteArray(pdfName, byte) {
        var blob = new Blob([byte], { type: "application/pdf" });
        var link = document.createElement("a");
        link.href = window.URL.createObjectURL(blob);
        var fileName = pdfName;
        link.download = fileName;
        link.click();
    }

    addHeader(doc){
        doc.addImage(InvoiceHeaderLogo, 'JPEG', 150, 20, 280, 100, undefined, "FAST");
        doc.setTextColor(0,40,85);
        doc.setFontSize(10);
        let text = 'FRATELLI COSULICH BUNKERS (HK) LTD', xOffset = (doc.internal.pageSize.width / 2) - (doc.getStringUnitWidth(text) * doc.internal.getFontSize() / 2);
        doc.setFont('courier', 'bold');
        doc.text(text, xOffset, 135);
        doc.setFontSize(7);
        doc.line(40, 140, 555, 138);
        text = 'UNITS 02-03, 23/F, PLAZA 228, 228 WAN CHAI ROAD, HONG KONG   ; T +852-25299138 GENERAL@COSULICH.COM.HK';
        xOffset = (doc.internal.pageSize.width / 2) - (doc.getStringUnitWidth(text) * doc.internal.getFontSize() / 2);
        doc.text(text, xOffset, 147).setFont('courier', 'bold');
        doc.line(40, 150, 555, 150);
    }

    addText(doc, finalY){
        let interestRate = this.stem.Account__r.Interest_Rate__c ? Number(this.stem.Account__r.Interest_Rate__c).toFixed(2) + '%' : '1.0%'
        let interestText = this.proforma ? '' : '\nINTEREST WILL BE CHARGED AT ' + interestRate + ' PER MONTH PRORATED DAILY FOR LATE PAYMENT.'
        let wrappedText = doc.splitTextToSize('**IMPORTANT STATEMENT AND PAYMENT FRAUD PREVENTION ADVICE**\nWE SHALL MAINTAIN THE PRESENT BANK ACCOUNT IN THE FORESEEABLE FUTURE. PLEASE DO NOT ACCEPT ANY CHANGE ON THE PRESENT PAYMENT INSTRUCITON UNDER ANY CIRCUMSTANCES. IF YOU RECEIVE ANY NOTICE FOR CHANGE ON PAYMENT INSTRUCTION, DO NOT TRY TO VERIFY BY EMAIL BUT PLEASE CALL YOUR USUAL CONTACT IN OUR COMPANY BY PHONE.\n\nPLEASE MENTION OUR INVOICE REFERENCE NUMBER WHEN SENDING PAYMENT.' + interestText, 500);
        let iterations = 1;
        const defaultYJump = 10;
        let margin = finalY + 10;
        wrappedText.forEach((line) => {
        let posY = margin + defaultYJump * iterations++;
        if (posY > 730) {
            doc.addPage();
            iterations = 1;
            margin = 50;
            posY = 50;
        }
        doc.text(40, posY, line);
        });
    }

    addFooters(doc) {
        const pageCount = doc.internal.getNumberOfPages()
        for (var i = 1; i <= pageCount; i++) {
            doc.setPage(i);
            if(this.stem.Account__r.Chop_Type_Buyer_Invoice__c === 'With Singature'){
                let img = new Image();
                img.src = InvoiceRoundChopWithSignature;
                doc.addImage(img, 'JPEG', 450, 730, 100, 90, undefined, "FAST");
            } else{
                let img = new Image();
                img.src = InvoiceRoundChop;
                doc.addImage(img, 'JPEG', 450, 730, 100, 100, undefined, "FAST");
            }
        }
    }

    mapLastInvoiceFormFields(){
        let fields = {};
        fields["Id"] = this.lastInvoiceForm ? this.lastInvoiceForm.Id : null;
        fields["Attn__c"] = JSON.stringify(this.attn);
        fields["Total__c"] = JSON.stringify(this.total);
        fields["Info_Text__c"] = this.infoText;
        fields["Products__c"] = JSON.stringify(this.productInputs);
        fields["Inputs__c"] = JSON.stringify(this.inputs);
        fields["STEM__c"] = this.stemId;
        fields["Vessel_Text__c"] = this.vesselText;
        fields["Today_Date__c"] = this.todayDate;
        fields["Buyer_Name__c"] = this.buyerName;
        fields["Broker_Name__c"] = this.brokerName;
        fields["Address__c"] = this.address;
        return fields;
    }

    closeModal() {
        this.inputs = [];
        this.productInputs = [];
        this.isModalOpen = false;
        this.actionExecuted = true;
    }

    makeId(length) {
        let result = "";
        let characters =
            "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
        let charactersLength = characters.length;
        for (let i = 0; i < length; i++) {
            result += characters.charAt(Math.floor(Math.random() * charactersLength));
        }
        return result;
    }

    setDateRange() {
        let startDateRange, endDateRange;
        let dateFields = [
            this.stem.ETA_Start_Date__c,
            this.stem.ETB_Start_Date__c,
            this.stem.ETCD_Start_Date__c,
            this.stem.ETD_Start_Date__c,
            this.stem.ETA_End_Date__c,
            this.stem.ETB_End_Date__c,
            this.stem.ETCD_End_Date__c,
            this.stem.ETD_End_Date__c,
        ];
        if (this.stem.ETA_ETB__c.value !== "PROMPT") {
            startDateRange = this.getMinDate(dateFields);
            endDateRange = this.getMaxDate(dateFields);
            return endDateRange && startDateRange && startDateRange !== endDateRange
                ? startDateRange + "-" + endDateRange
                : startDateRange
                    ? startDateRange
                    : "";
        } else if (this.stem.ETA_ETB__c.value === "PROMPT") {
            startDateRange = new Date(this.expectedDeliveryDateValue).toLocaleDateString('en-GB');
            endDateRange = this.getMaxDate(dateFields);
            return endDateRange && startDateRange && startDateRange !== endDateRange
                ? startDateRange + "-" + endDateRange
                : startDateRange
                    ? startDateRange
                    : "";
        }
    }

    getMinDate(dates) {
        dates = dates.filter(Boolean);
        if (dates.length === 0) return null;
        let startDate = new Date(
            Math.min(
                ...dates.map((date) => {
                    return new Date(date);
                })
            )
        );
        return startDate.toLocaleDateString('en-GB')
    }

    getMaxDate(dates) {
        dates = dates.filter(Boolean);
        if (dates.length === 0) return null;
        let endDate = new Date(
            Math.max(
                ...dates.map((date) => {
                    return new Date(date);
                })
            )
        );
        return endDate.toLocaleDateString('en-GB')
    }

    _convertDate(date) {
        if (!date) {
            return undefined
        } else {
            let day = date.getDate();
            day = day < 10 ? '0' + day : day;
            let month = date.getMonth() + 1;
            month = month < 10 ? '0' + month : month;
            let year = date.getFullYear();
            return year + '-' + month + '-' + day;
        }
    }

    numberWithCommas(num) {
        return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    }
}
