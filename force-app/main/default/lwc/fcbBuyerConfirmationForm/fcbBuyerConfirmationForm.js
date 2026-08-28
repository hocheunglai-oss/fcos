import { LightningElement , api , track , wire} from 'lwc';
import jsPDF from '@salesforce/resourceUrl/jsPDF';
import {loadScript} from "lightning/platformResourceLoader";
import { CurrentPageReference } from 'lightning/navigation';
import jspdfAutotable from '@salesforce/resourceUrl/jspdfAutotable';
import InvoiceHeaderLogo from '@salesforce/resourceUrl/InvoiceHeaderLogo';
import InvoiceSquareChop from '@salesforce/resourceUrl/InvoiceSquareChop';
import InvoiceRoundChop from '@salesforce/resourceUrl/InvoiceRoundChop';
import InvoiceRoundChopWithSignature from '@salesforce/resourceUrl/InvoiceRoundChopWithSignature';
import generateDocumentFromBlob from "@salesforce/apex/NominationController.generateDocumentFromBlob";
import generateDocument from "@salesforce/apex/NominationController.generateDocument";
import getStemBuyerInfo from "@salesforce/apex/NominationController.getStemBuyerInfo";
import getConfirmationSpecialTerms from "@salesforce/apex/NominationController.getConfirmationSpecialTerms";
import getPaymentTerm from "@salesforce/apex/NominationController.getPaymentTerm";
import {updateRecord} from "lightning/uiRecordApi";
import { fireEvent } from 'c/pubsub';
import { ShowToastEvent } from "lightning/platformShowToastEvent";

const FCBS_NAME = 'FRATELLI COSULICH BUNKERS (S) PTE LTD';
const TRUSTEE_SERVICE = 'TRUSTEE SERVICE';
 
export default class FcbBuyerConfirmationForm extends LightningElement {
    stemId
    nomination;
    stem;
    isModalOpen = false;
    actionExecuted = true;
    @track inputs = [];
    @track specialTerms = {};

    @wire(CurrentPageReference) pageRef;

    renderedCallback(){
        Promise.all([
            loadScript(this, jsPDF),
        ]).then(() => {
            loadScript(this, jspdfAutotable);
        })
    }

    @api
    openModal(recordData, lastSavedContract) {
        this.inputs = [];
        this.specialTerms = {};
        this.isModalOpen = true;
        this.actionExecuted = false;
        this.nomination = recordData;
        this.fileName = this.nomination.STEM__r.Name + ' - CON';
        this.stemId = recordData.STEM__c;
        if(lastSavedContract){
            this.inputs = JSON.parse(this.nomination.Last_Saved_Inputs__c);
            this.specialTerms = JSON.parse(this.nomination.Last_Saved_Remarks__c);
            this.actionExecuted = true;
        } else{
            getStemBuyerInfo({stemId: this.stemId}).then((stem) => {
                this.stem = stem;
                getPaymentTerm({paymentTerm: this.stem.Payment_Term__c}).then(paymentTerm => {
                    this.prefillInputs(paymentTerm);
                })
                let lineItemIds = [
                    ...(this.stem.STEM_Line_Items__r ? this.stem.STEM_Line_Items__r.map(stemLineItem => stemLineItem.Id) : []),
                    ...(this.stem.STEM_Extra_Costs__r ? this.stem.STEM_Extra_Costs__r.map(stemExtraCost => stemExtraCost.Id) : [])
                  ];
                getConfirmationSpecialTerms({lineItemIds: lineItemIds, remarks: this.nomination.Remarks__c, enquiryId: this.nomination.Enquiry__c}).then(specialTerms => {
                    let specialTermText = specialTerms.map(item => `${item.toUpperCase()}`).join('<br/>');
                    this.specialTerms = {label: 'REMARKS', value: specialTermText ? specialTermText : 'NIL'};
                })
            })
        }    
    }

    prefillInputs(paymentTerm) {
        this.inputs.push({ id: this.makeId(7), label: "TO", value: this.stem.Account__r.Name });
        if(this.stem.Buyer_Broker__c && this.stem.Buyer_Broker__r.Confirmation_Format__c === 'Buyer C/O Broker' ){
            this.inputs.push({ id: this.makeId(7), label: "", value: 'C/O ' + this.stem.Buyer_Broker__r?.Name }); 
        }
        if(this.stem.Buyer_Broker__c && this.stem.Buyer_Broker__r.Confirmation_Format__c === 'Buyer C/O Broker' ){
            let attnValue = this.stem.Buyer_Broker__r.Attn_Override__c 
                    ? this.stem.Buyer_Broker__r.Attn__c
                    : this.nomination.Contact__c ? this.nomination.Contact__r.Salutation != null 
                            ? this.nomination.Contact__r.Salutation + ' ' + this.nomination.Contact__r.Name 
                            : this.nomination.Contact__r.Name : ''
            this.inputs.push({
                id: this.makeId(7),
                label: "ATTN",
                value: attnValue.toLocaleUpperCase()
            }); 
        } else {
            let attnValue = this.stem.Account__r.Attn_Override__c 
                    ? this.stem.Account__r.Attn__c
                    : this.nomination.Contact__c ? this.nomination.Contact__r.Salutation != null 
                            ? this.nomination.Contact__r.Salutation + ' ' + this.nomination.Contact__r.Name 
                            : this.nomination.Contact__r.Name : ''
            this.inputs.push({
                id: this.makeId(7),
                label: "ATTN",
                value: attnValue.toLocaleUpperCase()
            });
        }
        this.inputs.push({ id: this.makeId(7), label: "DATE", value: new Date().toLocaleDateString('en-GB') });
        this.inputs.push({ id: this.makeId(7), label: "REF", value: this.nomination.Sent_Nomination__c ? this.nomination.RefCode__c + ' <REVISED COPY>' : this.nomination.RefCode__c, subjectInput: true});
        this.inputs.push({ id: this.makeId(7), label: '', value: '', isHidden: true, isDisabled: true});
        this.inputs.push({ id: this.makeId(7), label: {content: 'WE ARE PLEASED TO CONFIRM HAVING ARRANGED FOLLOWING SUPPLY IN ACCORDANCE WITH YOUR INSTRUCTIONS', colSpan: 3}, value: '', isHidden: true});
        this.inputs.push({ id: this.makeId(7), label: '', value: '', isHidden: true, isDisabled: true});
        let imo = this.stem.Vessel__c
            ? Boolean(this.stem.Vessel__r.IMO__c)
                ? this.stem.Vessel__r.IMO__c
                : 'N/A'
            : ''
        this.inputs.push({ id: this.makeId(7), label: "VESSEL", value: this.stem.Vessel__c ? this.stem.Vessel__r.Name + ' (IMO: ' + imo + ')' : 'UNKNOWN VESSEL'});
        const portText = Boolean(this.stem.Location_Details__c) ? this.stem.Port__r.Name + ' (' + this.stem.Location_Details__c + ')' : this.stem.Port__r.Name; 
        this.inputs.push({ id: this.makeId(7), label: "PORT", value: portText});
        this.inputs.push({ id: this.makeId(7), label: "READINESS", value: this.setDateRange() });
        this.inputs.push({ id: this.makeId(7), label: "--", isHidden: true})
        if(this.stem.STEM_Line_Items__r){
            this.stem.STEM_Line_Items__r.forEach(stemLineItem => {
            
                this.inputs.push({ id: this.makeId(7), label: "GRADE", value: stemLineItem.Product__r.Name })
                this.inputs.push({
                    id: this.makeId(7), label: "QUANTITY", value: stemLineItem.Is_Quantity_Range__c
                        ? this.numberWithCommas(stemLineItem.Quantity__c) + '-' + this.numberWithCommas(stemLineItem.Quantity_Max__c) + ' ' + stemLineItem.Unit_of_Measure__c 
                        : this.numberWithCommas(stemLineItem.Quantity__c) + ' ' + stemLineItem.Unit_of_Measure__c
                });
                this.inputs.push({ id: this.makeId(7), label: "PRICE", value: 'USD ' + this.numberWithCommas(stemLineItem.Unit_Sell_At__c.toFixed(2)) + '/' + stemLineItem.Unit_of_Measure__c });
                if(this.stem.STEM_Extra_Costs__r){
                    this.stem.STEM_Extra_Costs__r.filter(stemExtraCost => stemExtraCost.STEM_Line_Item__c === stemLineItem.Id && stemExtraCost.Line_Total__c != null && stemExtraCost.Line_Total__c != 0
                        && (stemExtraCost.Transportation_Included__c === false || stemExtraCost.Nundination_Type__c === 'Sell')).forEach((stemExtraCost => {
                            this.inputs.push(this.processExtraCost(stemExtraCost))
                    }))
                }
                this.inputs.push({
                    id: this.makeId(7), label: "SUPPLIER", value: stemLineItem.BDN_Company__c
                        ? stemLineItem.BDN_Company__c
                        : stemLineItem.Original_Supplier__r.BDN_Company__c
                            ? stemLineItem.Original_Supplier__r.BDN_Company__c
                            : stemLineItem.Original_Supplier__r.Name
                });
                this.inputs.push({ id: this.makeId(7), label: "--", isHidden: true})
            });
        }
        if (this.stem.STEM_Extra_Costs__r) {
            let filteredExtraCosts = this.stem.STEM_Extra_Costs__r.filter(stemExtraCost => stemExtraCost.RecordType.Name === 'STEM Charge' && stemExtraCost.Line_Total__c != null && stemExtraCost.Line_Total__c != 0);
            if (filteredExtraCosts && Array.isArray(filteredExtraCosts) && filteredExtraCosts.length > 0) {
                filteredExtraCosts.forEach(stemExtraCost => {
                    this.inputs.push(this.processExtraCost(stemExtraCost))
                })
                this.inputs.push({ id: this.makeId(7), label: "--", isHidden: true })
            }
        }
        let hasTrusteeServiceExtraCost = false;
        if (this.stem.STEM_Extra_Costs__r && Array.isArray(this.stem.STEM_Extra_Costs__r)) {
            hasTrusteeServiceExtraCost = this.stem.STEM_Extra_Costs__r.some(
              ec => ec.Product2Id__r?.Name === TRUSTEE_SERVICE
              && ec.Supplier__r.Name === FCBS_NAME
            );
        }
        this.inputs.push({ id: this.makeId(7), label: "SELLER", value: hasTrusteeServiceExtraCost ? "FRATELLI COSULICH BUNKERS (S) PTE LTD." : "FRATELLI COSULICH BUNKERS (HK) LTD." });
        let paymentTermText;
        if(this.stem.Partial_CIA__c){
            paymentTermText = 'USD ' + this.numberWithCommas(this.stem.Partial_Lumpsum_Sell_At__c.toFixed(2)) + ' BASIS CASH IN ADVANCE, BALANCE ON ' + paymentTerm.Name + ' ' + paymentTerm.Description__c;
        } else{
            paymentTermText = paymentTerm.Name + ' ' + paymentTerm.Description__c;
        }
        this.inputs.push({ id: this.makeId(7), label: "PAYMENT TERM", value: paymentTermText.toLocaleUpperCase() });
        this.inputs = this.inputs.map(i => this.decorateRow(i));
        this.actionExecuted = true;
    }

    handleChangeLabel(event){
        try {
            this.inputs.find(input => input.id === event.target.dataset.id).label = event.detail.value;
        } catch (error) {
            console.error(error)
        }
    }

    handleChangeValue(event){
        try {
            this.inputs.find(input => input.id === event.target.dataset.id).value = event.detail.value;   
        } catch (error) {
            console.error(error)
        }
    }

    handleChangeSpecialTermLabel(event){
        this.specialTerms.label = event.detail.value; 
    }

    handleChangeSpecialTermValue(event){
        this.specialTerms.value = event.detail.value;
    }

    addNewInput(){
        this.inputs.push({id: this.makeId(7), label: '', value: ''});
    }

    removeInput(event){
        this.inputs = this.inputs.filter(input => {
            return input.id !== event.target.dataset.id;
        })
    }

      
    decorateRow(input) {
        return {
            ...input,
            rowClass: '',
            topLineClass: '',
            bottomLineClass: ''
        };
    }

    handleDragStart(event) {
        this.draggedId = event.currentTarget.dataset.id;

        this.inputs = this.inputs.map(input => ({
            ...input,
            rowClass: input.id === this.draggedId ? 'row-dragged' : '',
            topLineClass: '',
            bottomLineClass: ''
        }));
    }

    handleDragOver(event) {
        event.preventDefault();

        const rowId = event.currentTarget.dataset.id;
        if (rowId === this.draggedId) return;

        const rect = event.currentTarget.getBoundingClientRect();
        const isTop = event.clientY < rect.top + rect.height / 2;

        this.inputs = this.inputs.map(input => {
            const isDragged = input.id === this.draggedId;
            if (input.id === rowId) {
                return {
                    ...input,
                    topLineClass: isTop ? 'highlight-line' : '',
                    bottomLineClass: !isTop ? 'highlight-line' : '',
                    rowClass: input.rowClass
                };
            } else {
                return {
                    ...input,
                    topLineClass: '',
                    bottomLineClass: '',
                    rowClass: input.rowClass
                };
            }
        });
    }

    handleDrop(event) {
        event.preventDefault();

        const draggedIndex = this.inputs.findIndex(i => i.id === this.draggedId);
        const dropId = event.currentTarget.dataset.id;
        const dropIndex = this.inputs.findIndex(i => i.id === dropId);

        if (draggedIndex === -1 || dropIndex === -1 || draggedIndex === dropIndex) {
            this.resetHighlights();
            return;
        }

        const [dragged] = this.inputs.splice(draggedIndex, 1);

        const dropRow = this.inputs[dropIndex];
        let insertIndex = dropIndex;
        if (dropRow.bottomLineClass === 'highlight-line') {
            insertIndex = dropIndex + 1;
        }

        this.inputs.splice(insertIndex, 0, dragged);

        this.inputs = this.inputs.map(input => ({
            ...input,
            rowClass: '',
            topLineClass: '',
            bottomLineClass: ''
        }));

        this.draggedId = null;
    }

    resetHighlights() {
        this.inputs = this.inputs.map(input => this.decorateRow(input));
    }

    async handlePreviewPDF(event){
        this.actionExecuted = false;

        const fields = {
            Id: this.nomination.Id,
            Saved_Inputs__c: JSON.stringify(this.inputs),
            Saved_Remarks__c: JSON.stringify(this.specialTerms)
        };

        try {
            await updateRecord({ fields });
            const vfUrl =
                '/apex/ConfirmationToBuyer?nominationId=' + this.nomination.Id;

            window.open(vfUrl, '_blank');
            this.actionExecuted = true;
        } catch (error) {
            this.showError(error);
        }
    }


    // handleGeneratePDF(event) {
    //     try {
    //         this.actionExecuted = false;
    //         const { jsPDF } = window.jspdf;
    //         let doc = new jsPDF('p', 'pt', 'a4', true);
    //         doc.setFont("courier");
    //         this.addHeader(doc);
    //         doc.setTextColor(0, 0, 0);
    //         doc.setFontSize(8);
    //         let maxRowLength = 700;

    //         const indent = ' ';
    //         const maxWidth = 400;

    //         let tableRows = this.inputs.map(input => {
    //             if (input.isHidden) return [input.label, '', ''];

    //             let valueText = input.value || '';

    //             const lines = doc.splitTextToSize(valueText, maxWidth);

    //             const indented = lines.map((line, i) => (indent + line));

    //             return [input.label, ':', indented.join('\n')];
    //         });

    //         let specialTermsValue = this.specialTerms.value || 'NIL.';
    //         specialTermsValue = doc.splitTextToSize(specialTermsValue, maxWidth)
    //             .map((line, i) => indent + line)
    //             .join('\n');

    //         tableRows.push([this.specialTerms.label, ':', specialTermsValue]);

    //         let pageHeight = 160;
    //         let marginTop = 160;
    //         let currentRows = [];
    //         tableRows.forEach((tableRow) => {
    //             pageHeight = pageHeight + 13;
    //             if (pageHeight < maxRowLength) {
    //                 currentRows.push(tableRow);
    //             } else {
    //                 pageHeight = 50;
    //                 doc.autoTable({
    //                     body: currentRows,
    //                     tableWidth: 'auto',
    //                     margin: { top: marginTop },
    //                     styles: { font: 'courier', fontSize: 8, textColor: [0, 0, 0], cellPadding: 2, valign: 'top', overflow: 'linebreak', lineHeight: 1.0 },
    //                     alternateRowStyles: { fillColor: [255, 255, 255] },
    //                     tableLineColor: [255, 255, 255],
    //                     columnStyles: {
    //                         0: { cellWidth: 100, valign: 'top' },
    //                         1: {
    //                             cellWidth: 5,
    //                             halign: 'center',
    //                             valign: 'top',
    //                             lineHeight: 1.0,
    //                             cellPadding: { top: 0, right: 0, bottom: 0, left: 0 },
    //                             overflow: 'hidden'
    //                         },
    //                         2: {
    //                             cellWidth: 'auto',
    //                             valign: 'top',
    //                             overflow: 'linebreak',
    //                             lineHeight: 1.0,
    //                             cellPadding: { top: 0, right: 0, bottom: 0, left: 2 }
    //                         }
    //                     },
    //                     didParseCell: (data) => {
    //                         if (data.column.index === 1) {
    //                             data.cell.styles.valign = 'top';
    //                             data.cell.styles.lineHeight = 1.0;
    //                             data.cell.styles.minCellHeight = 0;
    //                             data.cell.styles.cellPadding = { top: 0, right: 0, bottom: 0, left: 2 };
    //                         }

    //                         if (data.column.index === 2) {
    //                             data.cell.styles.valign = 'top';
    //                             data.cell.styles.lineHeight = 1.0;
    //                         }
    //                     }
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
    //             margin: { top: marginTop },
    //             styles: { font: 'courier', fontSize: 8, textColor: [0, 0, 0], cellPadding: 2, valign: 'top', overflow: 'linebreak', lineHeight: 1.0 },
    //             alternateRowStyles: { fillColor: [255, 255, 255] },
    //             tableLineColor: [255, 255, 255],
    //             columnStyles: {
    //                 0: { cellWidth: 100, valign: 'top' },
    //                 1: {
    //                     cellWidth: 5,
    //                     halign: 'center',
    //                     valign: 'top',
    //                     lineHeight: 1.0,
    //                     cellPadding: { top: 0, right: 0, bottom: 0, left: 0 },
    //                     overflow: 'hidden'
    //                 },
    //                 2: {
    //                     cellWidth: 'auto',
    //                     valign: 'top',
    //                     overflow: 'linebreak',
    //                     lineHeight: 1.0,
    //                     cellPadding: { top: 0, right: 0, bottom: 0, left: 2 }
    //                 }
    //             },
    //             didParseCell: (data) => {
    //                 if (data.column.index === 1) {
    //                     data.cell.styles.valign = 'top';
    //                     data.cell.styles.lineHeight = 1.0;
    //                     data.cell.styles.minCellHeight = 0;
    //                     data.cell.styles.cellPadding = { top: 0, right: 0, bottom: 0, left: 2 };
    //                 }

    //                 if (data.column.index === 2) {
    //                     data.cell.styles.valign = 'top';
    //                     data.cell.styles.lineHeight = 1.0;
    //                 }
    //             }
    //         });
    //         let finalY = doc.lastAutoTable.finalY;
    //         finalY = this.addSanctionsComplianceText(doc, finalY);
    //         this.addText(doc, finalY);
    //         this.addFooters(doc);
    //         const base64String = doc.output('datauristring').split(',')[1];
    //         generateDocumentFromBlob({ body: base64String, nominationId: this.nomination.Id, fileUrl: this.nomination.File__c, fileName: this.fileName }).then(() => {
    //             const fields = {};
    //             fields["Id"] = this.nomination.Id;
    //             fields["PDF__c"] = "🟢";
    //             fields["Last_Saved_Inputs__c"] = JSON.stringify(this.inputs);
    //             fields["Last_Saved_Remarks__c"] = JSON.stringify(this.specialTerms);
    //             const nominationForUpdate = { fields };
    //             updateRecord(nominationForUpdate).then(() => {
    //                 this.closeModal();
    //                 fireEvent(this.pageRef, "refreshNominations", true);
    //             })
    //         }).catch((error) => {
    //             this.dispatchEvent(
    //                 new ShowToastEvent({
    //                     title: "Error",
    //                     message: error.body.pageErrors[0].message,
    //                     variant: "error"
    //                 })
    //             );
    //             this.closeModal();
    //         });
    //     } catch (error) {
    //         console.error(error);
    //     }
    // }

    async handleGeneratePDF() {
      try {
        this.actionExecuted = false;
        
        const fields = {
            Id: this.nomination.Id,
            Saved_Inputs__c: JSON.stringify(this.inputs),
            Saved_Remarks__c: JSON.stringify(this.specialTerms)
        };

        let additionalSubject;
        const refValue = this.inputs.find(input => input.subjectInput)?.value;
        if(refValue){
            const index = refValue.indexOf(' ');
            if(index !== -1){
                additionalSubject = refValue.slice(index + 1);
            }
        }

        await updateRecord({ fields });
        await generateDocument({
            nominationId: this.nomination.Id,
            fileUrl: this.nomination.File__c,
            fileName: this.fileName
        });

        const generatedFields = {
            Id: this.nomination.Id,
            Last_Saved_Inputs__c: JSON.stringify(this.inputs),
            Last_Saved_Remarks__c: JSON.stringify(this.specialTerms),
            PDF__c: '🟢',
            Additional_Subject__c: additionalSubject
        };
        await updateRecord({ fields: generatedFields });
        this.closeModal();
        fireEvent(this.pageRef, "refreshNominations", true);
      } catch (error) {
        this.showError(error);
      }
    }

    showError(error) {
        const message = this.getErrorMessage(error);
        this.actionExecuted = true;
        this.dispatchEvent(
            new ShowToastEvent({
                title: "Contract could not be generated",
                message,
                variant: "error",
                mode: "sticky"
            })
        );
    }

    getErrorMessage(error) {
        const pageErrors = error?.body?.output?.errors || error?.body?.pageErrors || [];
        const fieldErrors = Object.values(error?.body?.output?.fieldErrors || {}).flat();
        const detailedMessages = [...pageErrors, ...fieldErrors]
            .map(item => item?.message)
            .filter(Boolean);

        return detailedMessages[0]
            || error?.body?.message
            || error?.message
            || "Salesforce could not complete the contract. Refresh the form and try again.";
    }

    addHeader(doc){
        doc.addImage(InvoiceHeaderLogo, 'JPEG', 150, 20, 280, 100, '', "FAST");
        doc.setTextColor(0,40,85);
        doc.setFontSize(10);
        let text = 'FRATELLI COSULICH BUNKERS (HK) LTD', xOffset = (doc.internal.pageSize.width / 2) - (doc.getStringUnitWidth(text) * doc.internal.getFontSize() / 2); 
        doc.setFont('courier', 'bold');
        doc.text(text, xOffset, 135);
        doc.setFontSize(7);
        doc.line(40, 140, 555, 138);
        text = 'UNITS 02-03, 23/F, PLAZA 228, 228 WAN CHAI ROAD, HONG KONG    T +852-25299138 GENERAL@COSULICH.COM.HK';
        xOffset = (doc.internal.pageSize.width / 2) - (doc.getStringUnitWidth(text) * doc.internal.getFontSize() / 2);
        doc.text(text, xOffset, 147).setFont('courier', 'normal');
        doc.line(40, 150, 555, 150);
    }

    addSanctionsComplianceText(doc, finalY){
        const defaultYJump = 10;
        let margin = finalY + 20;
        const startX = 40;
        let sanctionsComplianceText = 'SANCTIONS COMPLIANCE';

        doc.text(sanctionsComplianceText, startX, margin);
        const textWidth = doc.getTextWidth(sanctionsComplianceText);

        const underlineOffset = 0.5;
        doc.line(startX, margin + underlineOffset, startX + textWidth, margin + underlineOffset);

        let wrappedText = doc.splitTextToSize('THE BUYER AGREES THAT THE FRATELLI COSULICH SANCTIONS COMPLIANCE CLAUSE FORMS PART OF THIS CONTRACT. THE FULL TEXT IS ATTACHED HERE TO AS A SEPARATE DOCUMENT AND IS ALSO AVAILABLE ONLINE AT THIS HYPERLINK. THE BUYER FURTHER CONFIRMS THAT IT HAS READ AND ACCEPTED THE CLAUSE IN FULL.', 500);
        
        let iterations = 1; 
        const linkUrl = "https://marine-energy.cosulich.com/pdf/general-files/FC%20ME%20-%20Sanction%20Compliance%20Clause.pdf";

        wrappedText.forEach((line) => {
            let posY = margin + defaultYJump * iterations++;

            if (posY > 730) {
                doc.addPage();
                iterations = 1;
                margin = 50;
                posY = 50;
            }

            finalY = posY;

            if (line.includes("HYPERLINK")) {
                const parts = line.split("HYPERLINK");
                let currentX = startX;

                if (parts[0]) {
                    doc.text(parts[0], currentX, posY);
                    currentX += doc.getTextWidth(parts[0]);
                }

                const linkText = "HYPERLINK";
                doc.setTextColor(0, 0, 255);
                doc.textWithLink(linkText, currentX, posY, { url: linkUrl });

                const linkWidth = doc.getTextWidth(linkText);
                doc.line(currentX, posY + underlineOffset, currentX + linkWidth, posY + underlineOffset);

                doc.setTextColor(0, 0, 0);

                if (parts[1]) {
                    currentX += linkWidth;
                    doc.text(parts[1], currentX, posY);
                }
            } else {
                doc.text(startX, posY, line);
            }
        });
        return finalY;
    }

    addText(doc, finalY){
        const defaultYJump = 10;
        let margin = finalY + 20;
        const startX = 40;
        let generalText = 'GENERAL TERMS AND CONDITIONS';

        doc.text(generalText, startX, margin);
        const textWidth = doc.getTextWidth(generalText);

        const underlineOffset = 0.5;
        doc.line(startX, margin + underlineOffset, startX + textWidth, margin + underlineOffset);

        const trader = this.nomination.BT_ST_Visible__c ? this.nomination.Buyer_Supplier_Trader__c.toLocaleUpperCase() : '';
        let wrappedText = doc.splitTextToSize('THIS SALE OF MARINE FUELS IS SUBJECT TO THE FRATELLI COSULICH GENERAL TERMS AND CONDITIONS OF SALE AND DELIVERY [LATEST EDITION OCTOBER 2022] WHICH IS AVAILABLE ONLINE AT THIS HYPERLINK. THESE TERMS APPLY AND WILL OVERRIDE ANY CONFLICTING AGREEMENT UNLESS OTHERWISE SPECIFICALLY AGREED.\n\nWE THANK YOU FOR YOUR NOMINATION.\n\nREGARDS,\nFRATELLI COSULICH BUNKERS (HK) LTD.\n' + trader, 500);
        
        let iterations = 1; 
        const linkUrl = "https://cosulich.com/docs/FratelliCosulich%20GENERAL%20TermsAndConditions.pdf";

        wrappedText.forEach((line) => {
            let posY = margin + defaultYJump * iterations++;

            if (posY > 730) {
                doc.addPage();
                iterations = 1;
                margin = 50;
                posY = 50;
            }

            if (line.includes("HYPERLINK")) {
                const parts = line.split("HYPERLINK");
                let currentX = startX;

                if (parts[0]) {
                    doc.text(parts[0], currentX, posY);
                    currentX += doc.getTextWidth(parts[0]);
                }

                const linkText = "HYPERLINK";
                doc.setTextColor(0, 0, 255);
                doc.textWithLink(linkText, currentX, posY, { url: linkUrl });

                const linkWidth = doc.getTextWidth(linkText);
                doc.line(currentX, posY + underlineOffset, currentX + linkWidth, posY + underlineOffset);

                doc.setTextColor(0, 0, 0);

                if (parts[1]) {
                    currentX += linkWidth;
                    doc.text(parts[1], currentX, posY);
                }
            } else {
                doc.text(startX, posY, line);
            }
        });
    }

    addFooters(doc) {
        const pageCount = doc.internal.getNumberOfPages()
        for (var i = 1; i <= pageCount; i++) {
            doc.setPage(i);
            if (this.nomination.Account__r.Chop_Type__c === 'Square') {
                doc.addImage(InvoiceSquareChop, 'JPEG', 300, 750, 280, 100, '', "FAST");
            } else if(this.nomination.Account__r.Chop_Type__c === 'Round'){
                let img = new Image();
                img.src = InvoiceRoundChop;
                doc.addImage(img, 'JPEG', 450, 730, 100, 100, '', "FAST");
            } else {
                let img = new Image();
                img.src = InvoiceRoundChopWithSignature;
                doc.addImage(img, 'JPEG', 450, 730, 100, 100, undefined, "FAST");
            }
        }
    }

    closeModal() {
        this.inputs = [];
        this.isModalOpen = false;
        this.actionExecuted = true;
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
        if (this.stem.ETA_ETB__c !== "PROMPT") {
          startDateRange = this.getMinDate(dateFields);
          endDateRange = this.getMaxDate(dateFields);
          return endDateRange && startDateRange  && startDateRange !== endDateRange
              ? startDateRange + "-" + endDateRange
              : startDateRange
              ? startDateRange
              : "";
        } else if (this.stem.ETA_ETB__c === "PROMPT") {   
          startDateRange = new Date(this.stem.Expected_Delivery_Date__c).toLocaleDateString('en-GB');
          endDateRange = this.getMaxDate(dateFields);
          return endDateRange && startDateRange  && startDateRange !== endDateRange
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

    processExtraCost(extraCost) {
        let label = '';
        console.log(extraCost.Product2Id__r.Name);
        
        if (extraCost.Product2Id__r.Name.includes('Transport')) {
            label = extraCost.Product2Id__r.Name.includes('Barge')
                ? 'BARGING '
                : extraCost.Product2Id__r.Name.includes('Truck')
                    ? 'TRUCKING '
                    : '';
        } else {
            label = extraCost.Product2Id__r.Name.toLocaleUpperCase()
        }

        const formatter = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        let quantity = '';
        if (!extraCost.Fixed__c) {
            quantity = extraCost.Is_Quantity_Range__c
                    ? this.numberWithCommas(extraCost.Quantity__c) + '-' + this.numberWithCommas(extraCost.Quantity_Range_Max__c) + ' ' + extraCost.Unit_of_Measure__c
                    : this.numberWithCommas(extraCost.Quantity__c) + ' ' + extraCost.Unit_of_Measure__c
        }

        let value =
            !extraCost.Fixed__c
                ? quantity + ` AT USD ${this.numberWithCommas(formatter.format(extraCost.Unit_Price__c))}/${extraCost.Unit_of_Measure__c} ${
                    extraCost.Minimum_Sell_At__c
                        ? `MINIMUM USD ${this.numberWithCommas(formatter.format(extraCost.Minimum_Sell_At__c))}`
                        : ''
                }`
                : `USD ${this.numberWithCommas(formatter.format(extraCost.Lumpsum_Price__c))} LUMPSUM`;
        
        return {id: this.makeId(7), label, value};
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

    numberWithCommas(x) {
        return x.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    }
}
