const PAGE_COPY = {
  'Growth & Coaching': {
    eyebrow: 'Development',
    title: 'Growth & Coaching',
    description: 'Set measurable development goals and hold private, equal-participant coaching conversations.',
  },
  'Projects & Tasks': {
    eyebrow: 'Collaboration',
    title: 'Projects & Tasks',
    description: 'Plan shared work, assign accountability, and keep progress, discussion, and files together.',
  },
  Dashboard: {
    eyebrow: '',
    title: 'Dashboard',
    description: '',
  },
  'Outstanding Buyer Invoices': {
    eyebrow: 'Collection',
    title: 'Payment Collections',
    description: 'Prioritize overdue receivables, buyer commitments, payment advice, and settlement.',
  },
  'Payment Collections': {
    eyebrow: 'Collection',
    title: 'Payment Collections',
    description: 'Prioritize overdue receivables, buyer commitments, payment advice, and settlement.',
  },
  'Unofficial Compensation': {
    eyebrow: 'Recovery',
    title: 'Unofficial Compensation',
    description: 'Monitor agreed compensation claims, UOC recoveries, deadlines, and outstanding Account balances.',
  },
  'Incoming Payment': {
    eyebrow: 'Receipts',
    title: 'Incoming Payments',
    description: 'Review buyer receipts, supplier refunds, and CIA invoices.',
  },
  'Cashflow Forecast': {
    eyebrow: 'Forecast',
    title: 'Cashflow',
    description: 'Forecast buyer receipts and supplier payments.',
  },
  "Broker's Commission": {
    eyebrow: 'Commissions',
    title: 'Broker Commissions',
    description: 'Review broker commission rows, summaries, and XLS exports.',
  },
  'Dispute Workflow': {
    eyebrow: 'Disputes',
    title: 'Dispute Workflow',
    description: 'Manage trader instructions, approval, accounting settlement, documents, and closure.',
  },
  'Exception Review': {
    eyebrow: 'Review',
    title: 'Exception Review',
    description: 'Find STEMs that need finance or reporting checks.',
  },
  'Dashboard and Qlik Validator Tool': {
    eyebrow: 'Validation',
    title: 'Qlik Validator',
    description: 'Compare dashboard calculations with Qlik reference values.',
  },
  'Reports Archive': {
    eyebrow: 'Reports',
    title: 'Report Archive',
    description: 'Find exported XLS reports and audit file actions.',
  },
  'Account Managers': {
    eyebrow: 'Ownership',
    title: 'Account Managers',
    description: 'Maintain the internal managers responsible for active buyer, buyer and supplier, and broker Accounts.',
  },
  Settings: {
    eyebrow: 'System',
    title: 'Settings',
    description: 'Manage senders, integrations, documents, and health checks.',
  },
  'Universal Audit Trail': {
    eyebrow: 'Audit',
    title: 'Audit Trail',
    description: 'Review administrator and workflow events.',
  },
  'Admin Control': {
    eyebrow: 'Access',
    title: 'Users & Access',
    description: 'Manage users, access rights, and controlled FCOS update communications.',
  },
};

export function getPageCopy({ title, eyebrow, description }) {
  const copy = PAGE_COPY[title] || {};
  return {
    eyebrow: copy.eyebrow ?? eyebrow,
    title: copy.title ?? title,
    description: copy.description ?? description,
  };
}
