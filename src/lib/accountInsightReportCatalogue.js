// The catalogue is deliberately data-free.  Presets are presentation defaults, never
// server-side authority to widen a report's audience or disclose additional fields.
export const REPORT_AUDIENCES = ['internal', 'buyer', 'supplier'];

export const REPORT_SECTIONS = [
  { id: 'profile', label: 'Account profile', audiences: REPORT_AUDIENCES },
  { id: 'trading', label: 'Trading summary', audiences: REPORT_AUDIENCES },
  { id: 'monthly', label: 'Monthly activity', audiences: REPORT_AUDIENCES },
  { id: 'products', label: 'Products', audiences: REPORT_AUDIENCES },
  { id: 'ports', label: 'Ports', audiences: REPORT_AUDIENCES },
  { id: 'children', label: 'Trading accounts', audiences: ['internal'] },
  { id: 'credit', label: 'Credit overview', audiences: REPORT_AUDIENCES },
  { id: 'forecast', label: 'Credit exposure forecast', audiences: ['internal'] },
  { id: 'aging', label: 'Aging', audiences: REPORT_AUDIENCES },
  { id: 'payments', label: 'Payments', audiences: REPORT_AUDIENCES },
  { id: 'statement', label: 'Statement', audiences: REPORT_AUDIENCES },
  { id: 'stems', label: 'STEM detail', audiences: REPORT_AUDIENCES },
  { id: 'risks', label: 'Risks and exceptions', audiences: ['internal'] },
  { id: 'methodology', label: 'Methodology and source notes', audiences: REPORT_AUDIENCES },
];

export const REPORT_COLUMNS = [
  { id: 'stem', label: 'STEM', audiences: REPORT_AUDIENCES },
  { id: 'date', label: 'Delivery date', audiences: REPORT_AUDIENCES },
  { id: 'expectedDate', label: 'Expected delivery', audiences: REPORT_AUDIENCES },
  { id: 'status', label: 'Status', audiences: REPORT_AUDIENCES },
  { id: 'currency', label: 'Currency', audiences: REPORT_AUDIENCES },
  { id: 'vessel', label: 'Vessel', audiences: REPORT_AUDIENCES },
  { id: 'port', label: 'Port', audiences: REPORT_AUDIENCES },
  { id: 'product', label: 'Product', audiences: REPORT_AUDIENCES },
  { id: 'quantity', label: 'Quantity', audiences: REPORT_AUDIENCES },
  { id: 'invoice', label: 'Invoice amount', audiences: REPORT_AUDIENCES },
  { id: 'payments', label: 'Payments', audiences: REPORT_AUDIENCES },
  { id: 'balance', label: 'Outstanding balance', audiences: REPORT_AUDIENCES },
  { id: 'dueDate', label: 'Due date', audiences: REPORT_AUDIENCES },
  { id: 'age', label: 'Age', audiences: REPORT_AUDIENCES },
  { id: 'invoiceCount', label: 'Invoice count', audiences: REPORT_AUDIENCES },
  { id: 'paymentCount', label: 'Payment count', audiences: REPORT_AUDIENCES },
  { id: 'collectionStatus', label: 'Collection status', audiences: ['internal', 'buyer'] },
  { id: 'grossProfit', label: 'Gross profit', audiences: ['internal'] },
  { id: 'grossMargin', label: 'Gross margin', audiences: ['internal'] },
];

const INTERNAL_COLUMNS = REPORT_COLUMNS.map(({ id }) => id);
const EXTERNAL_COLUMNS = REPORT_COLUMNS.filter((item) => item.audiences.includes('buyer') && item.id !== 'expectedDate').map(({ id }) => id);

export const REPORT_PRESETS = [
  {
    id: 'internalOverview', label: 'Internal overview', audience: 'internal',
    sections: ['profile', 'trading', 'monthly', 'products', 'ports', 'children', 'payments', 'stems', 'methodology'],
    columns: INTERNAL_COLUMNS,
    depth: 'summary', includeExpected: false, includeCharts: true,
  },
  {
    id: 'internalCreditReview', label: 'Internal credit review', audience: 'internal',
    sections: ['profile', 'credit', 'aging', 'payments', 'statement', 'stems', 'risks', 'methodology'],
    columns: INTERNAL_COLUMNS,
    depth: 'detail', includeExpected: false, includeCharts: false,
  },
  {
    id: 'buyerStatement', label: 'Buyer statement', audience: 'buyer',
    sections: ['profile', 'trading', 'monthly', 'products', 'ports', 'credit', 'aging', 'payments', 'statement', 'stems', 'methodology'],
    columns: EXTERNAL_COLUMNS,
    depth: 'detail', includeExpected: false, includeCharts: true,
  },
  {
    id: 'supplierStatement', label: 'Supplier statement', audience: 'supplier',
    sections: ['profile', 'trading', 'monthly', 'products', 'ports', 'credit', 'aging', 'payments', 'statement', 'stems', 'methodology'],
    columns: EXTERNAL_COLUMNS.filter((id) => id !== 'collectionStatus'),
    depth: 'detail', includeExpected: false, includeCharts: true,
  },
];

export const DEFAULT_REPORT_CONFIG = {
  audience: 'internal', sections: REPORT_PRESETS[0].sections, columns: INTERNAL_COLUMNS,
  depth: 'summary', includeExpected: false, includeCharts: true,
  detailSelection: 'all', selectedStemIds: [],
};

export const reportCatalogue = { audiences: REPORT_AUDIENCES, sections: REPORT_SECTIONS, columns: REPORT_COLUMNS, presets: REPORT_PRESETS };
