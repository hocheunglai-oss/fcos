import { LightningElement } from 'lwc';
import documentUploadRender from './documentUploadRender.html';
import navigationLinkRender from './navigationLinkRender.html';
import buyerSupplierTraderRender from './buyerSupplierTraderRender.html'
import LightningDatatable from 'lightning/datatable';
import contact from './contact.html';

export default class FileUploadDataTable extends LightningDatatable   {
    static customTypes = {
        fileUpload: {
            template: documentUploadRender,
            typeAttributes: ['acceptedFileFormats','fileUploaded', 'uploadValue', 'stem', 'directUpload', 'uploadLabel']
        },
        buyerSupplierTrader: {
            template: buyerSupplierTraderRender,
            typeAttributes: ['parentId', 'buyerSupplierTraderValue']
        },
        navigationLink: {
            template: navigationLinkRender,
            typeAttributes: ['fileUrl', 'refCode']
        },
        contactType: {
            template: contact,
            typeAttributes: ['parentId', 'selectedContactId', 'selectedContactName']
        }
    };
}