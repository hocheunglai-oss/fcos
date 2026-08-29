export const USER_TYPES = [
  { id: 'general_manager', label: 'General Manager' },
  { id: 'administrator', label: 'Administrator' },
  { id: 'manager', label: 'Manager' },
  { id: 'finance', label: 'Finance' },
  { id: 'operations', label: 'Operations' },
  { id: 'interoffice', label: 'Interoffice' },
  { id: 'viewer', label: 'Viewer' },
];

export function isAdministratorUserType(userType) {
  return userType === 'administrator' || userType === 'general_manager';
}

export const APP_MODULES = [
  { id: 'dashboard', label: 'Dashboard', path: '/', sortOrder: 10 },
  { id: 'review', label: 'Exception Review', path: '/review', sortOrder: 20 },
  { id: 'disputes', label: 'Dispute Workflow', path: '/disputes', sortOrder: 30 },
  { id: 'buyer_invoices', label: 'Payment Collections', path: '/payment-collections?tab=collections', sortOrder: 40 },
  { id: 'unofficial_compensation', label: 'Unofficial Compensation', path: '/unofficial-compensation', sortOrder: 42 },
  { id: 'incoming_payments', label: 'Incoming Payments (Payment Collections)', path: '/payment-collections?tab=incoming', sortOrder: 45 },
  { id: 'cashflow_forecast', label: 'Cashflow Forecast', path: '/cashflow-forecast', sortOrder: 47 },
  { id: 'pnl', label: 'Dashboard and Qlik Validator Tool', path: '/pnl', sortOrder: 50 },
  { id: 'brokers', label: "Broker's Commission", path: '/brokers', sortOrder: 70 },
  { id: 'report_archive', label: 'Reports Archive', path: '/brokers?tab=archive', sortOrder: 75 },
  { id: 'buyers_administrator', label: 'Account Managers', path: '/account-managers', sortOrder: 85 },
  { id: 'master_contracts', label: 'Master Contracts', path: '/master-contracts', sortOrder: 84 },
  { id: 'markets', label: 'Markets', path: '/markets', sortOrder: 86 },
  { id: 'special_terms', label: 'Special Terms', path: '/special-terms', sortOrder: 87 },
  { id: 'hedge_desk', label: 'Hedge Desk', path: '/hedge-desk', sortOrder: 88 },
  { id: 'xero_portal', label: 'Xero Portal', path: '/xero-portal', sortOrder: 89 },
  { id: 'email_router', label: 'Email Router', path: '/email-router', sortOrder: 91 },
  { id: 'settings', label: 'Settings', path: '/settings', sortOrder: 90 },
  { id: 'admin', label: 'People & Access', path: '/settings?section=people', sortOrder: 100 },
];

export const FULL_ACCESS = Object.fromEntries(APP_MODULES.map((module) => [module.id, true]));

export const APP_CAPABILITIES = [
  { id: 'disputes_approve', label: 'Approve disputes', description: 'Approve or reject dispute instructions.' },
  { id: 'disputes_account', label: 'Settle disputes', description: 'Record accounting settlement and close disputes.' },
  { id: 'buyer_invoices_manage', label: 'Manage invoice email settings', description: 'Change buyer invoice templates and schedules.' },
  { id: 'financial_report_settings_manage', label: 'Manage financial report settings', description: 'Change approved recipients and templates for internal financial reports.' },
  { id: 'cashflow_forecast_manage', label: 'Manage cashflow settings', description: 'Change forecast settings and manual overrides.' },
  { id: 'hedge_book_manage', label: 'Manage Hedge Book', description: 'Create and maintain trades, hedges, markets, and counterparties.' },
  { id: 'hedge_settlement_manage', label: 'Manage Hedge Settlement', description: 'Manage settlement, invoices, and clearing entries.' },
  { id: 'hedge_close_approve', label: 'Approve Hedge Close', description: 'Close or reopen months and approve SFS reports.' },
  { id: 'hedge_admin', label: 'Administer Hedge Desk', description: 'Manage Hedge Desk configuration and integrations.' },
  { id: 'special_terms_manage', label: 'Manage Special Terms', description: 'Create, edit, and remove Salesforce Special Terms and matching rules.' },
  { id: 'special_terms_clause_approve', label: 'Approve Special Term Clauses', description: 'Approve, retire, migrate, and roll back versioned Salesforce clause wording.' },
  { id: 'broker_settings_manage', label: 'Manage Broker Commission Settings', description: 'Change the company exchange-rate provider used by Broker Commissions.' },
  { id: 'xero_portal_manage', label: 'Manage Xero Portal', description: 'Connect Xero, create receipt draft bills, rename contacts, and archive unused contacts.' },
];

export const FULL_CAPABILITIES = Object.fromEntries(APP_CAPABILITIES.map((capability) => [capability.id, true]));

export function moduleLabel(moduleId) {
  return APP_MODULES.find((module) => module.id === moduleId)?.label || moduleId;
}
