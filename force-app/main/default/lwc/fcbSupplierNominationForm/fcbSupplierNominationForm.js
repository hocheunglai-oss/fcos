import { LightningElement , api , track , wire} from 'lwc';
import jsPDF from '@salesforce/resourceUrl/jsPDF';
import {loadScript} from "lightning/platformResourceLoader";
import { CurrentPageReference } from 'lightning/navigation';
import jspdfAutotable from '@salesforce/resourceUrl/jspdfAutotable';
import InvoiceHeaderLogo from '@salesforce/resourceUrl/InvoiceHeaderLogo';
import generateDocumentFromBlob from "@salesforce/apex/NominationController.generateDocumentFromBlob";
import generateDocument from "@salesforce/apex/NominationController.generateDocument";
import getStemSupplierInfo from "@salesforce/apex/NominationController.getStemSupplierInfo";
import getSupplierPaymentTerms from "@salesforce/apex/NominationController.getSupplierPaymentTerms";
import getNominationSpecialTerms from "@salesforce/apex/NominationController.getNominationSpecialTerms";
import {updateRecord} from "lightning/uiRecordApi";
import { fireEvent } from 'c/pubsub';
import { ShowToastEvent } from "lightning/platformShowToastEvent";
 
export default class FcbSupplierNominationForm extends LightningElement {
    stemId
    nomination;
    stem;
    isModalOpen = false;
    actionExecuted = true;
    @track inputs = [];
    @track specialTerms = {};

    draggedId;
    hoverId;
    hoverPosition;

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
        this.fileName = this.nomination.STEM__r.Name + ' - NOM';
        this.stemId = recordData.STEM__c;
        if(lastSavedContract){
            this.inputs = JSON.parse(this.nomination.Last_Saved_Inputs__c.replace(/&quot;/g,'"'));
            this.specialTerms = JSON.parse(this.nomination.Last_Saved_Remarks__c.replace(/&quot;/g,'"'));
            this.actionExecuted = true;
        } else{
            getStemSupplierInfo({stemId: this.stemId, supplierId: this.nomination.Account__c, paymentTerm: this.nomination.Payment_Term__c}).then((stem) => {
                this.stem = stem;
                console.log(stem);
                
                if(this.stem.STEM_Line_Items__r?.every(stemLineItem => stemLineItem.Payment_Term__c === 'CIA' 
                    && Boolean(stemLineItem.Intended_Payment_Date__c) === false) 
                && this.stem.STEM_Extra_Costs__r?.every(stemExtraCost => stemExtraCost.Payment_Term__c === 'CIA' 
                    && Boolean(stemExtraCost.Intended_Payment_Date__c) === false)){
                        this.dispatchEvent(
                            new ShowToastEvent({
                                title: "Warning",
                                message: "Intended Payment Date isn't set",
                                variant: "warning"
                            })
                        );
                        this.closeModal();
                } else if(this.stem.STEM_Line_Items__r || this.stem.STEM_Extra_Costs__r){
                    let lineItemsPaymentTerms = this.stem.STEM_Line_Items__r ? this.stem.STEM_Line_Items__r.map(stemLineItem => stemLineItem.Payment_Term__c) : [];
                    let extraCostsPaymentTerms = this.stem.STEM_Extra_Costs__r ? this.stem.STEM_Extra_Costs__r.map(stemExtraCost => stemExtraCost.Payment_Term__c) : [];
                    
                    let paymentTerms = [...lineItemsPaymentTerms, ...extraCostsPaymentTerms];
                    getSupplierPaymentTerms({paymentTerms: paymentTerms}).then(paymentTerms => {
                        this.prefillInputs(paymentTerms);
                    })
                    let lineItemIds = [
                        ...(this.stem.STEM_Line_Items__r ? this.stem.STEM_Line_Items__r.map(stemLineItem => stemLineItem.Id) : []),
                        ...(this.stem.STEM_Extra_Costs__r ? this.stem.STEM_Extra_Costs__r.map(stemExtraCost => stemExtraCost.Id) : [])
                    ];
                    getNominationSpecialTerms({lineItemIds: lineItemIds, remarks: this.nomination.Remarks__c, enquiryId: this.nomination.Enquiry__c}).then(specialTerms => {
                        console.log(specialTerms);
                        
                        let specialTermText = specialTerms.map(item => `${item.toUpperCase()}`).join('<br/>');
                        console.log(specialTermText);
                        
                        this.specialTerms = {label: 'REMARKS', value: specialTermText ? specialTermText : 'NIL'};
                    })
                } else{
                    this.dispatchEvent(
                        new ShowToastEvent({
                            title: "Warning",
                            message: "All product line items and STEM extra costs are cancelled",
                            variant: "warning"
                        })
                    );
                    this.closeModal();
                }
            })    
        } 
    }

    prefillInputs(paymentTerms) {
        this.inputs.push({ id: this.makeId(7), label: "TO", value: this.nomination.Account__r.Name });
        if(this.stem.STEM_Line_Items__r){
            if(this.stem.STEM_Line_Items__r[0].Supplier_Broker__c 
                && this.stem.STEM_Line_Items__r[0].Supplier_Broker__r.Nomination_Format__c === 'Supplier C/O Supplier Broker'){
                this.inputs.push({ id: this.makeId(7), label: "", value: 'C/O ' + this.stem.STEM_Line_Items__r[0].Supplier_Broker__r?.Name }); 
            }
        }
        if(this.stem.STEM_Line_Items__r){
            if(this.stem.STEM_Line_Items__r[0].Supplier_Broker__c 
                && this.stem.STEM_Line_Items__r[0].Supplier_Broker__r.Nomination_Format__c === 'Supplier C/O Supplier Broker'){
                let attnValue = this.stem.STEM_Line_Items__r[0].Supplier_Broker__r.Attn_Override__c 
                        ? this.stem.STEM_Line_Items__r[0].Supplier_Broker__r.Attn__c
                        : this.nomination.Contact__c ? this.nomination.Contact__r.Salutation != null 
                            ? this.nomination.Contact__r.Salutation + ' ' + this.nomination.Contact__r.Name 
                            : this.nomination.Contact__r.Name : ''
                this.inputs.push({
                    id: this.makeId(7),
                    label: "ATTN",
                    value: attnValue.toLocaleUpperCase()
                });
            } else{
                let attnValue = this.nomination.Account__r.Attn_Override__c 
                        ? this.nomination.Account__r.Attn__c
                        : this.nomination.Contact__c ? this.nomination.Contact__r.Salutation != null 
                            ? this.nomination.Contact__r.Salutation + ' ' + this.nomination.Contact__r.Name 
                            : this.nomination.Contact__r.Name : ''
                this.inputs.push({
                    id: this.makeId(7),
                    label: "ATTN",
                    value: attnValue.toLocaleUpperCase()
                });
            }
        } else{
            let attnValue = this.nomination.Account__r.Attn_Override__c 
                    ? this.nomination.Account__r.Attn__c
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
        this.inputs.push({ id: this.makeId(7), label: {content: 'PLEASE ARRANGE AND CONFIRM FOLLOWING SUPPLY ON OUR ACCOUNT:', colSpan: 3}, value: '', isHidden: true});
        this.inputs.push({ id: this.makeId(7),label: '', value: '', isHidden: true, isDisabled: true});
        let imo = this.stem.Vessel__c
            ? Boolean(this.stem.Vessel__r.IMO__c)
                ? this.stem.Vessel__r.IMO__c
                : 'N/A'
            : ''
        this.inputs.push({ id: this.makeId(7), label: "VESSEL", value: this.stem.Vessel__c ? this.stem.Vessel__r.Name + ' (IMO: ' + imo + ')' : 'UNKNOWN VESSEL'});
        if (this.stem.STEM_Line_Items__r) {
            const portText = Boolean(this.stem.Location_Details__c) 
                ? this.stem.Port__r.Name + ' (' + this.stem.Location_Details__c + ')' 
                : this.stem.Port__r.Name;
            this.inputs.push({ id: this.makeId(7), label: "PORT", value: portText });
            this.inputs.push({ id: this.makeId(7), label: "READINESS", value: this.setDateRange(this.stem) });
            this.inputs.push({ id: this.makeId(7), label: "--", isHidden: true})
            this.stem.STEM_Line_Items__r.forEach(stemLineItem => {
                this.inputs.push({ id: this.makeId(7), label: "GRADE", value: stemLineItem.Product__r.Name })
                this.inputs.push({
                    id: this.makeId(7), label: "QUANTITY", value: stemLineItem.Is_Quantity_Range__c
                        ? this.numberWithCommas(stemLineItem.Quantity__c) + '-' + this.numberWithCommas(stemLineItem.Quantity_Max__c) + ' ' + stemLineItem.Unit_of_Measure__c
                        : this.numberWithCommas(stemLineItem.Quantity__c) + ' ' + stemLineItem.Unit_of_Measure__c
                });
                this.inputs.push({ id: this.makeId(7), label: "PRICE", value: 'USD ' + this.numberWithCommas(stemLineItem.Unit_Buy_At__c.toFixed(2)) + '/' + stemLineItem.Unit_of_Measure__c });
                if (this.stem.STEM_Extra_Costs__r) {
                    this.stem.STEM_Extra_Costs__r.filter(stemExtraCost => stemExtraCost.STEM_Line_Item__c === stemLineItem.Id && stemExtraCost.Line_Total_Buy__c != null && stemExtraCost.Line_Total_Buy__c != 0
                        && (stemExtraCost.Transportation_Included__c === false || stemExtraCost.Nundination_Type__c === 'Buy')).forEach((stemExtraCost => {
                            this.inputs.push(this.processExtraCost(stemExtraCost));
                        }))
                }
                this.inputs.push({ id: this.makeId(7), label: "--", isHidden: true })
            });
            if(this.stem.STEM_Extra_Costs__r){
                let filteredExtraCosts = this.stem.STEM_Extra_Costs__r.filter(stemExtraCost => stemExtraCost.RecordType.Name === 'STEM Charge' && stemExtraCost.Supplier__c === this.nomination.Account__c)
                if(filteredExtraCosts && Array.isArray(filteredExtraCosts) && filteredExtraCosts.length > 0){
                    filteredExtraCosts.forEach(stemExtraCost => {
                        this.inputs.push(this.processExtraCost(stemExtraCost))
                    })
                    this.inputs.push({ id: this.makeId(7), label: "--", isHidden: true})
                }
                
            }
        } else{
            if(this.stem.STEM_Extra_Costs__r){
                const portText = Boolean(this.stem.Location_Details__c) 
                    ? this.stem.Port__r.Name + ' (' + this.stem.Location_Details__c + ')' 
                    : this.stem.Port__r.Name; 
                this.inputs.push({ id: this.makeId(7), label: "PORT", value: portText});
                this.inputs.push({ id: this.makeId(7), label: "READINESS", value: this.setDateRange(this.stem) });
                this.inputs.push({ id: this.makeId(7), label: "--", isHidden: true})
                this.stem.STEM_Extra_Costs__r.filter(stemExtraCost => stemExtraCost.RecordType.Name === 'STEM Charge' && stemExtraCost.Supplier__c === this.nomination.Account__c).forEach(stemExtraCost => {
                    this.inputs.push(this.processExtraCost(stemExtraCost))
                })
                this.inputs.push({ id: this.makeId(7), label: "--", isHidden: true})
            }
        }
        let paymentTerm = this.stem.STEM_Line_Items__r ? paymentTerms.find(paymentTerm => paymentTerm.Name === this.stem.STEM_Line_Items__r.find(stemLineItem => stemLineItem.Original_Supplier__c === this.nomination.Account__c).Payment_Term__c)
            : paymentTerms.find(paymentTerm => paymentTerm.Name === this.stem.STEM_Extra_Costs__r.find(stemExtraCost => stemExtraCost.Supplier__c === this.nomination.Account__c).Payment_Term__c);
        
        let paymentTermText;
        if(this.stem.STEM_Line_Items__r && this.stem.STEM_Line_Items__r[0].Partial_CIA__c){
            paymentTermText = 'USD ' + this.numberWithCommas(this.stem.STEM_Line_Items__r[0].Partial_Lumpsum_Buy_At__c.toFixed(2)) + ' CIA, BALANCE AMOUNT ' + (paymentTerm.Name.split(' ')[0] + ' ' + paymentTerm.Description__c).toLocaleUpperCase();
        } else{
            paymentTermText = paymentTerm.Name.split(' ')[0] + ' ' + paymentTerm.Description__c
        }
        this.inputs.push({ id: this.makeId(7), label: "PAYMENT", value: paymentTermText.toLocaleUpperCase()});
        this.inputs.push({ id: this.makeId(7), label: "AGENT", value: this.stem.Agent__c ? this.stem.Agent__c : 'TO BE ADVISED'});
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
                '/apex/NominationToSupplier?nominationId=' + this.nomination.Id;

            window.open(vfUrl, '_blank');
            this.actionExecuted = true;
        } catch (error) {
            this.showError(error);
        }
    }

    // handleGeneratePDF(event){
    //     try {
    //         this.actionExecuted = false;
    //         const { jsPDF } = window.jspdf;           
    //         let doc = new jsPDF('p', 'pt','a4',false);
    //         doc.setFont("courier");
    //         this.addHeader(doc);
    //         doc.setTextColor(0,0,0);
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
    //          tableRows.forEach((tableRow) => {
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
    //         this.addText(doc, finalY);
    //         const base64String = doc.output('datauristring').split(',')[1];
    //         generateDocumentFromBlob({body: base64String, nominationId: this.nomination.Id, fileUrl: this.nomination.File__c, fileName: this.fileName}).then(() => {
    //             const fields = {};
    //             fields["Id"] = this.nomination.Id;
    //             fields["PDF__c"] = "🟢";
    //             fields["Last_Saved_Inputs__c"] = JSON.stringify(this.inputs);
    //             fields["Last_Saved_Remarks__c"] = JSON.stringify(this.specialTerms);
    //             const nominationForUpdate = { fields };
    //             updateRecord(nominationForUpdate).then(() =>{
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

    addText(doc, finalY){
        const trader = this.nomination.BT_ST_Visible__c ? this.nomination.Buyer_Supplier_Trader__c.toLocaleUpperCase() : '';
        let wrappedText = doc.splitTextToSize(`THIS BUNKER NOMINATION IS SUBJECT TO THE FOLLOWING SPECIAL CONDITIONS, WHICH WILL PREVAIL OVER ANY DIFFERENT APPLICABLE CONTRACTUAL CONDITIONS:\n\n\t1. THIS NOMINATION IS ASSUMED TO BE ACCEPTED AND CONFIRMED AS PER TERMS HEREIN UNLESS\n\t   WRITTEN MESSAGE STATING OTHERWISE IS RECEIVED IMMEDIATELY.\n\t2. MARPOL ANNEX VI: SULFUR CONTENT AS PER STATUTORY REGULATIONS. BUNKER RECEIPTS TO\n\t   CONTAIN INFORMATION AS SPECIFIED IN REGULATION 18. SUPPLIER TO PROVIDE THE SHIP\n\t   A MATERIAL SAFETY DATA SHEET (MSDS) FOR EACH GRADE TO BE SUPPLIED, IN ACCORDANCE\n\t   WITH ANNEX 1 AND ANNEX 2 OF SOLAS REGULATION VI/4-1 IN EFFECT FROM 1ST JULY 2009.\n\t3. BUNKER SUPPLIERS/BARGE OPERATORS WARRANT AND ENSURE AT ALL TIMES THAT PRODUCTS\n\t   SUPPLIED ARE HOMOGENOUS AND DOES NOT INCLUDE ANY ADDED SUBSTANCE OF CHEMICAL\n\t   WATER, LUBE OIL, RESIDUES FROM SLOPS AND SLUDGE, AND ANY OTHER SUBSTANCES THAT\n\t   COULD DAMAGE THE SAFETY OF SHIPS, THE PERFORMANCE OF THE MACHINERY OR IS HARMFUL\n\t   TO PERSONNEL OR MAY CONTRIBUTE TO POLLUTION.\n\nACCEPTING THIS ORDER AND CONFIRMING THIS BUNKER NOMINATION THE SELLER HEREBY WARRANTS THAT THE PRODUCT TO BE SUPPLIED (AND ITS BLENDED SUBSTANCES, IF ANY) DOES NOT ORIGINATE FROM A COUNTRY OR ENTITY DESIGNATED IN ANY SANCTION LIST ISSUED BY THE UNITED NATIONS, UNITED STATES, UNITED KINGDOM AND/OR EUROPEAN UNION; AND/OR FROM AN ENTITY OWNED 50% OR MORE -ALSO IN THE AGGREGATE- OR CONTROLLED BY ANY PERSON OR ENTITY DESIGNATED IN ANY SANCTIONS LIST ISSUED BY THE UNITED NATIONS, UNITED STATES, UNITED KINGDOM AND/OR EUROPEAN UNION.\n\nREGARDS\nFRATELLI COSULICH BUNKERS (HK) LTD.\n` + trader, 500);
        //let wrappedText = doc.splitTextToSize('THIS BUNKER NOMINATION IS SUBJECT TO THE FOLLOWING SPECIAL CONDITIONS, WHICH WILL PREVAIL OVER ANY DIFFERENT APPLICABLE CONTRACTUAL CONDITIONS:\n\n\t1. THIS NOMINATION IS ASSUMED TO BE ACCEPTED AND CONFIRMED AS PER TERMS HEREIN UNLESS WRITTEN MESSAGE STATING OTHERWISE IS RECEIVED IMMEDIATELY.\n\t2. MARPOL ANNEX VI: SULFUR CONTENT AS PER STATUTORY REGULATIONS. BUNKER RECEIPTS TO CONTAIN INFORMATION AS SPECIFIED IN REGULATION 18. SUPPLIER TO PROVIDE THE SHIP A MATERIAL SAFETY DATA SHEET (MSDS) FOR EACH GRADE TO BE SUPPLIED, IN ACCORDANCE WITH ANNEX 1 AND ANNEX 2 OF SOLAS REGULATION VI/4-1 IN EFFECT FROM 1ST JULY 2009.\n\t3. BUNKER SUPPLIERS/BARGE OPERATORS WARRANT AND ENSURE AT ALL TIMES THAT PRODUCTS SUPPLIED ARE HOMOGENOUS AND DOES NOT INCLUDE ANY ADDED SUBSTANCE OF CHEMICAL WATER, LUBE OIL, RESIDUES FROM SLOPS AND SLUDGE, AND ANY OTHER SUBSTANCES THAT COULD DAMAGE THE SAFETY OF SHIPS, THE PERFORMANCE OF THE MACHINERY OR IS HARMFUL TO PERSONNEL OR MAY CONTRIBUTE TO POLLUTION.\n\nREGARDS\nFRATELLI COSULICH BUNKERS (HK) LTD.\n' + this.nomination.Buyer_Supplier_Trader__c.toUpperCase(), 500);
        //doc.text(40, finalY + 20, splitTitle);
        // doc.text(40, finalY + 20, 'THIS BUNKER NOMINATION IS SUBJECT TO THE FOLLOWING SPECIAL CONDITIONS, WHICH WILL');
        // doc.text(40, finalY + 30, 'PREVAIL OVER ANY DIFFERENT APPLICABLE CONTRACTUAL CONDITIONS:');
        // doc.text(48, finalY + 40, '1.	THIS NOMINATION IS ASSUMED TO BE ACCEPTED AND CONFIRMED AS PER TERMS HEREIN UNLESS')
        // doc.text(50, finalY + 40, 'WRITTEN MESSAGE STATING OTHERWISE IS RECEIVED IMMEDIATELY.')
        let iterations = 1;
        const defaultYJump = 10;
        let margin = finalY + 20;
        wrappedText.forEach((line) => {
            let posY = margin + defaultYJump * iterations++;
            if (posY > 750) {
                doc.addPage();
                iterations = 1;
                margin = 50;
                posY = 50;
            }
            doc.text(40, posY, line);
        });
    }

    closeModal() {
        this.inputs = [];
        this.isModalOpen = false;
        this.actionExecuted = true;
    }

    setDateRange(stem) {
        let startDateRange, endDateRange;
        let dateFields = [
          stem.ETA_Start_Date__c,
          stem.ETB_Start_Date__c,
          stem.ETCD_Start_Date__c,
          stem.ETD_Start_Date__c,
          stem.ETA_End_Date__c,
          stem.ETB_End_Date__c,
          stem.ETCD_End_Date__c,
          stem.ETD_End_Date__c,
        ];
        if (stem.ETA_ETB__c !== "PROMPT") {
          startDateRange = this.getMinDate(dateFields);
          endDateRange = this.getMaxDate(dateFields);
          return endDateRange && startDateRange  && startDateRange !== endDateRange
              ? startDateRange + "-" + endDateRange
              : startDateRange
              ? startDateRange
              : "";
        } else if (stem.ETA_ETB__c === "PROMPT") {
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

        if(extraCost.Product2Id__r.Name.includes('Transport')){
            label = extraCost.Product2Id__r.Name.includes('Barge')
                ? 'BARGING '
                : extraCost.Product2Id__r.Name.includes('Truck')
                    ? 'TRUCKING '
                    : '';
        } else{
            label = extraCost.Product2Id__r.Name.toLocaleUpperCase();
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
                ? quantity + ` AT USD ${this.numberWithCommas(formatter.format(extraCost.Unit_Cost__c))}/${extraCost.Unit_of_Measure__c}  ${
                    extraCost.Minimum_Buy_At__c
                        ? `MINIMUM USD ${this.numberWithCommas(formatter.format(extraCost.Minimum_Buy_At__c))}`
                        : ''
                }`
                : `USD ${this.numberWithCommas(formatter.format(extraCost.Lumpsum_Cost__c))} LUMPSUM`;

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
