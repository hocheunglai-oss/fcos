import { LightningElement , api , track , wire} from 'lwc';
// import jsPDF from '@salesforce/resourceUrl/jsPDF';
// import {loadScript} from "lightning/platformResourceLoader";
// import { CurrentPageReference } from 'lightning/navigation';
// import jspdfAutotable from '@salesforce/resourceUrl/jspdfAutotable';
// import InvoiceHeaderLogo from '@salesforce/resourceUrl/InvoiceHeaderLogo';
// import InvoiceSquareChop from '@salesforce/resourceUrl/InvoiceSquareChop';
// import InvoiceRoundChop from '@salesforce/resourceUrl/InvoiceRoundChop';
// import generateDocumentFromBlob from "@salesforce/apex/NominationController.generateDocumentFromBlob";
// import getStemInfo from "@salesforce/apex/NominationController.getStemInfo";
// import getSpecialTerms from "@salesforce/apex/NominationController.getSpecialTerms";
// import getPaymentTerm from "@salesforce/apex/NominationController.getPaymentTerm";
// import {updateRecord} from "lightning/uiRecordApi";
// import { fireEvent } from 'c/pubsub';

export default class FcbContractForm extends LightningElement {
    // stemId
    // nomination;
    // stem;
    // isModalOpen = false;
    // actionExecuted = true;
    // @track inputs = [];
    // @track specialTerms = {};

    // @wire(CurrentPageReference) pageRef;

    // renderedCallback(){
    //     Promise.all([
    //         loadScript(this, jsPDF),
    //     ]).then(() => {
    //         loadScript(this, jspdfAutotable);
    //     })
    // }

    // @api
    // openModal(recordData) {
    //     this.isModalOpen = true;
    //     this.actionExecuted = false;
    //     this.nomination = recordData;
    //     this.stemId = recordData.STEM__c;
    //     getStemInfo({stemId: this.stemId}).then((stem) => {
    //         this.stem = stem;
    //         getPaymentTerm({paymentTerm: this.stem.Payment_Term__c}).then(paymentTerm => {
    //             this.prefillInputs(paymentTerm);
    //         })
    //         let lineItemIds = [...this.stem.STEM_Line_Items__r.map(stemLineItem => stemLineItem.Id),
    //             ...this.stem.STEM_Extra_Costs__r.map(stemExtraCost => stemExtraCost.Id)]
    //         getSpecialTerms({lineItemIds: lineItemIds, remarks: this.nomination.Remarks__c}).then(specialTerms => {
    //             this.specialTerms = {label: 'REMARKS', value: specialTerms.map(item => `--${item.toUpperCase()}`).join('\r\n')};
    //         })
    //     })
    // }

    // prefillInputs(paymentTerm) {
    //     this.inputs.push({ id: this.makeId(7), label: "TO", value: this.stem.Account__r.Name });
    //     this.inputs.push({
    //         id: this.makeId(7),
    //         label: "ATTN",
    //         value: this.stem.Contact__c ? this.stem.Contact__r.Salutation != null ?
    //             this.stem.Contact__r.Salutation + ' ' + this.stem.Contact__r.Name :
    //             this.stem.Contact__r.Name : ''
    //     });
    //     this.inputs.push({ id: this.makeId(7), label: "DATE", value: new Date().toLocaleDateString('en-GB') });
    //     this.inputs.push({ id: this.makeId(7), label: "REF", value: this.nomination.RefCode__c });
    //     this.inputs.push({label: '', value: '', isHidden: true, isDisabled: true});
    //     this.inputs.push({label: {content: 'WE ARE PLEASED TO CONFIRM HAVING ARRANGED FOLLOWING SUPPLY IN ACCORDANCE WITH YOUR INSTRUCTIONS', colSpan: 2}, value: '', isHidden: true});
    //     this.inputs.push({label: '', value: '', isHidden: true, isDisabled: true});
    //     this.inputs.push({ id: this.makeId(7), label: "VESSEL", value: this.stem.Vessel__r.Name + ' (IMO: ' + this.stem.Vessel__r.IMO__c + ')' });
    //     this.inputs.push({ id: this.makeId(7), label: "PORT", value: this.stem.Port__r.Name });
    //     this.inputs.push({ id: this.makeId(7), label: "READINESS", value: this.setDateRange() });
    //     this.inputs.push({ label: "--", isHidden: true})
    //     this.stem.STEM_Line_Items__r.forEach(stemLineItem => {

    //         this.inputs.push({ id: this.makeId(7), label: "GRADE", value: stemLineItem.Product__r.Name })
    //         this.inputs.push({
    //             id: this.makeId(7), label: "QUANTITY", value: stemLineItem.Is_Quantity_Range__c
    //                 ? stemLineItem.Quantity__c + '-' + stemLineItem.Quantity_Max__c + ' ' + stemLineItem.Unit_of_Measure__c
    //                 : stemLineItem.Quantity__c + ' ' + stemLineItem.Unit_of_Measure__c
    //         });
    //         this.inputs.push({ id: this.makeId(7), label: "PRICE", value: 'USD ' + stemLineItem.Unit_Sell_At__c.toFixed(2) + '\\' + stemLineItem.Unit_of_Measure__c });
    //         if(this.stem.STEM_Extra_Costs__r){
    //             console.log(this.stem.STEM_Extra_Costs__r);
    //             this.stem.STEM_Extra_Costs__r.filter(stemExtraCost => stemExtraCost.STEM_Line_Item__c === stemLineItem.Id && stemExtraCost.Line_Total__c != null && stemExtraCost.Line_Total__c != 0
    //                 && (stemExtraCost.Transportation_Included__c === false || stemExtraCost.Nundination_Type__c === 'Sell')).forEach((stemExtraCost => {
    //                     this.inputs.push({ id: this.makeId(7), label: "TRANSPORTATION", value: this.processExtraCost(stemExtraCost) })
    //             }))
    //         }
    //         this.inputs.push({
    //             id: this.makeId(7), label: "SUPPLIER", value: stemLineItem.BDN_Company__c
    //                 ? stemLineItem.BDN_Company__c
    //                 : stemLineItem.Original_Supplier__r.BDN_Company__c
    //                     ? stemLineItem.Original_Supplier__r.BDN_Company__c
    //                     : stemLineItem.Original_Supplier__r.Name
    //         });
    //         if(stemLineItem.Buyers_Brokers_Commission_Per_Unit__c && stemLineItem.Buyers_Brokers_Commission_Per_Unit__c !== 0 && !stemLineItem.Hide_Buyers_Brokers_Commission__c){
    //             this.inputs.push({ id: this.makeId(7), label: "COMMISSION", value: 'USD ' + stemLineItem.Buyers_Brokers_Commission_Per_Unit__c.toFixed(2) + '/' + stemLineItem.Unit_of_Measure__c})
    //         }
    //         this.inputs.push({ label: "--", isHidden: true})
    //     });
    //     this.stem.STEM_Extra_Costs__r.filter(stemExtraCost => stemExtraCost.RecordType.Name === 'STEM Charge').forEach(stemExtraCost => {
    //         this.inputs.push({ id: this.makeId(7), label: stemExtraCost.Product2Id__r.Name, value: this.processExtraCost(stemExtraCost) })
    //         this.inputs.push({ label: "--", isHidden: true})
    //     })
    //     this.inputs.push({ id: this.makeId(7), label: "SELLER", value: "FRATELLI COSULICH BUNKERS (HK) LTD." });
    //     this.inputs.push({ id: this.makeId(7), label: "PAYMENT TERM", value: paymentTerm.Name + ' ' + paymentTerm.Description__c });
    //     console.log(this.inputs);
    //     this.actionExecuted = true;
    // }

    // handleChangeLabel(event){
    //     try {
    //         this.inputs.find(input => input.id === event.target.dataset.id).label = event.detail.value;
    //     } catch (error) {
    //         console.error(error)
    //     }
    // }

    // handleChangeValue(event){
    //     try {
    //         this.inputs.find(input => input.id === event.target.dataset.id).value = event.detail.value;
    //     } catch (error) {
    //         console.error(error)
    //     }
    // }

    // handleChangeSpecialTermLabel(event){
    //     this.specialTerms.label = event.detail.value;
    // }

    // handleChangeSpecialTermValue(event){
    //     this.specialTerms.value = event.detail.value;
    // }

    // addNewInput(){
    //     this.inputs.push({id: this.makeId(7), label: '', value: ''});
    // }

    // removeInput(event){
    //     this.inputs = this.inputs.filter(input => {
    //         return input.id !== event.target.dataset.id;
    //     })
    // }

    // async handleGeneratePDF(event){
    //     try {
    //         this.actionExecuted = false;
    //         const { jsPDF } = window.jspdf;
    //         let doc = new jsPDF('p', 'pt','a4',true);
    //         doc.setFont("courier");
    //         this.addHeader(doc);
    //         doc.setTextColor(0,0,0);
    //         doc.setFontSize(8);
    //         let maxRowLength = 700;

    //         let tableRows = this.inputs.map(input => [
    //             input.label,
    //             input.value ? `: ${input.value}` : ''
    //         ]);
    //         tableRows.push([this.specialTerms.label, ': ' + this.specialTerms.value.replaceAll('\n', '\n  ')]);

    //         let pageHeight = 160;
    //         let marginTop = 160;
    //         let currentRows = [];
    //         tableRows.forEach((tableRow) => {
    //             pageHeight = pageHeight + 13;
    //             if (pageHeight < maxRowLength) {
    //                 currentRows.push(tableRow);
    //             } else{
    //                 console.log(currentRows.length);
    //                 console.log(pageHeight);
    //                 pageHeight = 50;
    //                 doc.autoTable({
    //                     body: currentRows,
    //                     tableWidth: 'auto',
    //                     margin: {top: marginTop},
    //                     styles : {font: 'courier', fontSize: 8, textColor: [0, 0, 0], cellPadding: 2},
    //                     alternateRowStyles: {fillColor : [255, 255, 255]},
    //                     tableLineColor: [255, 255, 255]
    //                 });
    //                 doc.addPage();
    //                 marginTop = 50;
    //                 currentRows = [tableRow];
    //             }
    //         })
    //         doc.autoTable({
    //             body: currentRows,
    //             tableWidth: 'auto',
    //             pageBreak: 'auto',
    //             rowPageBreak: 'avoid',
    //             margin: {top: marginTop},
    //             styles : {font: 'courier', fontSize: 8, textColor: [0, 0, 0], cellPadding: 2},
    //             alternateRowStyles: {fillColor : [255, 255, 255]},
    //             tableLineColor: [255, 255, 255]
    //         });
    //         let finalY = doc.lastAutoTable.finalY;
    //         this.addText(doc, finalY);
    //         this.addFooters(doc);
    //         const base64String = doc.output('datauristring').split(',')[1];
    //         generateDocumentFromBlob({body: base64String, nominationId: this.nomination.Id, fileUrl: this.nomination.File__c}).then(() => {
    //             const fields = {};
    //             fields["Id"] = this.nomination.Id;
    //             fields["PDF__c"] = "🟢";
    //             const nominationForUpdate = { fields };
    //             updateRecord(nominationForUpdate).then(() =>{
    //                 this.closeModal();
    //                 fireEvent(this.pageRef, "refreshNominations", true);
    //             })
    //         });
    //     } catch (error) {
    //         console.error(error);
    //     }
    // }

    // addHeader(doc){
    //     doc.addImage(InvoiceHeaderLogo, 'JPEG', 150, 20, 280, 100, '', "FAST");
    //     doc.setTextColor(0,40,85);
    //     doc.setFontSize(10);
    //     let text = 'FRATELLI COSULICH BUNKERS (HK) LTD', xOffset = (doc.internal.pageSize.width / 2) - (doc.getStringUnitWidth(text) * doc.internal.getFontSize() / 2);
    //     doc.setFont('courier', 'bold');
    //     doc.text(text, xOffset, 135);
    //     doc.setFontSize(7);
    //     doc.line(40, 140, 555, 138);
    //     text = 'ROOMS 1110-12, TAI YAU BUILDING, 181 JOHNSTON ROAD, HONG KONG   ; T +852-25299138 GENERAL@COSULICH.COM.HK';
    //     xOffset = (doc.internal.pageSize.width / 2) - (doc.getStringUnitWidth(text) * doc.internal.getFontSize() / 2);
    //     doc.text(text, xOffset, 147).setFont('courier', 'normal');
    //     doc.line(40, 150, 555, 150);
    // }

    // addText(doc, finalY){
    //     let wrappedText = doc.splitTextToSize('PLACING THIS ORDER AND CONFIRMING THIS BUNKER NOMINATION, THE BUYER WARRANTS AND REPRESENTS THAT THE NOMINATED VESSEL WILL BE EMPLOYED AT ALL TIMES IN FULL COMPLIANCE WITH ALL TRADE SANCTIONS, FOREIGN TRADE CONTROLS, EXPORT CONTROLS, NON-PROLIFERATION, ANTI-TERRORISM AND SIMILAR LAWS, REGULATIONS, DECREES, ORDINANCES, ORDERS, DEMANDS, REQUESTS, RULES OR REQUIREMENTS ISSUED OR ENACTED BY THE UNITED STATES OF AMERICA, THE UNITED NATIONS, UNITED KINGDOM AND/OR THE EUROPEAN UNION AND THAT THEREFORE, AMONGST OTHERS, THE NOMINATED VESSEL WILL NOT CALL AT ANY PLACE WHICH IS SUBJECT TO SANCTIONS, NAMELY, CUBA/IRAN/NORTH KOREA/SYRIA/SOMALIA/CRIMEA-SEVASTOPOL/VENEZUELA/RUSSIA.\n\nTHIS SALE OF MARINE FUELS IS SUBJECT TO OUR GENERAL TERMS AND CONDITIONS OF SALE AND DELIVERY [LATEST EDITION OCTOBER 2022] WHICH CAN BE FOUND AT THIS HYPERLINK AND WHICH WILL PREVAIL OVER ANY DIFFERENT AGREEMENT, UNLESS SPECIFICALLY AGREED.\n\nWE THANK YOU FOR YOUR NOMINATION.\n\nREGARDS\nFRATELLI COSULICH BUNKERS (HK) LTD.\n' + this.nomination.Buyer_Supplier_Trader__c.toUpperCase(), 500);
    //     //doc.text(40, finalY + 20, splitTitle);
    //     let iterations = 1;
    //     const defaultYJump = 10;
    //     let margin = finalY;
    //     wrappedText.forEach((line) => {
    //     let posY = margin + defaultYJump * iterations++;
    //     if (posY > 750) {
    //         doc.addPage();
    //         iterations = 1;
    //         margin = 50;
    //         posY = 50;
    //     }
    //     doc.text(40, posY, line);
    //     });
    // }

    // async addFooters (doc) {
    //         const pageCount = doc.internal.getNumberOfPages()
    //         for (var i = 1; i <= pageCount; i++) {
    //           doc.setPage(i);
    //           if(this.stem.Account__r.Chop_Type__c === 'Square'){
    //             doc.addImage(InvoiceSquareChop, 'JPEG', 300, 750, 280, 100, '', "FAST");
    //           } else{
    //             let img = new Image();
    //             img.src = InvoiceRoundChop;
    //             doc.addImage(img, 'JPEG', 400, 750, 100, 100, '', "FAST");
    //           }
    //         }
    //   }

    // closeModal() {
    //     this.inputs = [];
    //     this.isModalOpen = false;
    //     this.actionExecuted = true;
    // }

    // setDateRange() {
    //     let startDateRange, endDateRange;
    //     let dateFields = [
    //       this.stem.ETA_Start_Date__c,
    //       this.stem.ETB_Start_Date__c,
    //       this.stem.ETCD_Start_Date__c,
    //       this.stem.ETD_Start_Date__c,
    //       this.stem.ETA_End_Date__c,
    //       this.stem.ETB_End_Date__c,
    //       this.stem.ETCD_End_Date__c,
    //       this.stem.ETD_End_Date__c,
    //     ];
    //     if (this.stem.ETA_ETB__c.value !== "PROMPT") {
    //       startDateRange = this.getMinDate(dateFields);
    //       endDateRange = this.getMaxDate(dateFields);
    //       return endDateRange && startDateRange  && startDateRange !== endDateRange
    //           ? startDateRange + "-" + endDateRange
    //           : startDateRange
    //           ? startDateRange
    //           : "";
    //     } else if (this.stem.ETA_ETB__c.value === "PROMPT") {
    //       startDateRange = new Date(this.expectedDeliveryDateValue).toLocaleDateString('en-GB');
    //       endDateRange = this.getMaxDate(dateFields);
    //       return endDateRange && startDateRange  && startDateRange !== endDateRange
    //           ? startDateRange + "-" + endDateRange
    //           : startDateRange
    //           ? startDateRange
    //           : "";
    //     }
    //   }

    //   getMinDate(dates) {
    //     dates = dates.filter(Boolean);
    //     if (dates.length === 0) return null;
    //     let startDate = new Date(
    //       Math.min(
    //         ...dates.map((date) => {
    //           return new Date(date);
    //         })
    //       )
    //     );
    //     return startDate.toLocaleDateString('en-GB')
    //   }

    //   getMaxDate(dates) {
    //     dates = dates.filter(Boolean);
    //     if (dates.length === 0) return null;
    //     let endDate = new Date(
    //       Math.max(
    //         ...dates.map((date) => {
    //           return new Date(date);
    //         })
    //       )
    //     );
    //     return endDate.toLocaleDateString('en-GB')
    //   }

    // processExtraCost(extraCost) {
    //     let result = '';

    //     if (extraCost.Product2Id__r.Name.includes('Included')) {
    //         result = `${extraCost.Product2Id__r.Name.replace(/ Excluded\)| Included\)|Transport \(/g, '')} (INCLUDED)`;
    //     } else {
    //         result = extraCost.Product2Id__r.Name.includes('Barge')
    //             ? 'BARGING'
    //             : extraCost.Product2Id__r.Name.includes('Truck')
    //                 ? 'TRUCKING'
    //                 : '';
    //     }
    //     const formatter = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    //     result +=
    //         !extraCost.Fixed__c
    //             ? ` USD ${formatter.format(extraCost.Unit_Price__c)}/${extraCost.Unit_of_Measure__c} ${!extraCost.Minimum_Sell_At__c
    //                 ? ''
    //                 : `MINIMUM USD ${formatter.format(extraCost.Minimum_Sell_At__c)}`
    //             }`
    //             : ` USD ${formatter.format(extraCost.Lumpsum_Price__c)} LUMPSUM`;

    //     return result;
    // }

    //   makeId(length) {
    //     let result = "";
    //     let characters =
    //         "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    //     let charactersLength = characters.length;
    //     for (let i = 0; i < length; i++) {
    //         result += characters.charAt(Math.floor(Math.random() * charactersLength));
    //     }
    //     return result;
    // }
}