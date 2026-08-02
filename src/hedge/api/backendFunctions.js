import { appClient } from '@/api/appClient';

export async function invokeHedgeFunction(name, payload = {}) {
  const response = await appClient.functions.invoke(name, payload, { cache: false });
  if (response.data?.error) throw new Error(response.data.error);
  return response.data;
}

export const parseMopsPrice = (payload) => invokeHedgeFunction('hedgeDeskParseMops', payload);
export const getSfsMonthReport = (payload) => invokeHedgeFunction('hedgeDeskSfsReport', payload);
export const sendSfsMonthReport = (payload) => invokeHedgeFunction('hedgeDeskSfsSend', payload);
export const getSfsReportFile = (payload) => invokeHedgeFunction('hedgeDeskSfsFile', payload);
export const generateOtcInvoice = (payload) => invokeHedgeFunction('hedgeDeskGenerateInvoice', payload);
export const saveInvoicePdf = (payload) => invokeHedgeFunction('hedgeDeskSaveInvoicePdf', payload);
export const sendInvoiceEmail = (payload) => invokeHedgeFunction('hedgeDeskSendInvoiceEmail', payload);
export const pushHedgeToSalesforce = (payload) => invokeHedgeFunction('hedgeDeskSalesforcePush', payload);
export const previewHedgeSalesforce = (payload) => invokeHedgeFunction('hedgeDeskSalesforcePreview', payload);
export const getHedgeSalesforceMapping = () => invokeHedgeFunction('hedgeDeskSalesforceMapping');
export const runHedgeAssistant = (payload) => invokeHedgeFunction('hedgeDeskAssistant', payload);
