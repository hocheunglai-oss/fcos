import { reportCatalogue } from '../src/lib/accountInsightReportCatalogue.js';
import { MAX_REPORT_DETAIL_ROWS } from './_accountInsightReport.js';
import { listAccountInsightReportPresets, saveAccountInsightReportPreset } from './_accountInsightReportPresets.js';

export function accountInsightStatementRequest(body, side = null) {
  return {
    accountId: body.accountId,
    entityType: body.entityType === 'group' || body.contextRole === 'group' ? 'group' : 'account',
    side: side || (['both', 'buyer', 'supplier'].includes(body.side) ? body.side : body.contextRole === 'supplier' ? 'supplier' : 'buyer'),
    includedAccountIds: body.includedGroupAccountIds ?? body.includedAccountIds ?? null,
    scope: body.statementScope || 'open', limit: 100,
    forecastConservativeness: body.forecastConservativeness,
    filters: body.dashboardScope?.mode === 'account_wide' ? {} : {
      portIds: body.dashboardScope?.portIds || body.dashboardScope?.filters?.portIds || [],
      countryCodes: body.dashboardScope?.countryCodes || body.dashboardScope?.filters?.countryCodes || [],
    },
    disputeOnly: body.dashboardScope?.mode !== 'account_wide' && body.dashboardScope?.disputeOnly === true,
  };
}

// The dispatcher supplies its established authentication and permission checks;
// this module cannot manufacture access or cache user-specific capabilities.
export function createAccountInsightReportHandlers({ requireActiveUser, canManageCompanyPresets, loadInsight }) {
  return {
    async dashboardAccountInsightReportOptions(body = {}, req = null, accessContext = null) {
      const context = accessContext || await requireActiveUser(req);
      const [manageCompanyPresets, insight] = await Promise.all([
        canManageCompanyPresets(context),
        body.accountId ? loadInsight({ body: { ...body, section: 'stems', cursor: 0 }, accessContext: context }) : null,
      ]);
      const detailRowCount = insight?.activeRole === 'both' ? (insight.buyer?.stems?.analyzed || 0) + (insight.supplier?.stems?.analyzed || 0) : insight?.stems?.analyzed ?? null;
      return { catalogue: reportCatalogue, capabilities: { manageCompanyPresets, userId: context.profile.id }, detailRowCount, maxDetailRows: MAX_REPORT_DETAIL_ROWS };
    },
    async dashboardAccountInsightReportPresetsList(body = {}, req = null, accessContext = null) {
      return listAccountInsightReportPresets(accessContext || await requireActiveUser(req));
    },
    async dashboardAccountInsightReportPresetsSave(body = {}, req = null, accessContext = null) {
      const context = accessContext || await requireActiveUser(req);
      return saveAccountInsightReportPreset(context, body, { manageCompanyPresets: await canManageCompanyPresets(context) });
    },
    async dashboardAccountInsightReportPresetsArchive(body = {}, req = null, accessContext = null) {
      const context = accessContext || await requireActiveUser(req);
      return saveAccountInsightReportPreset(context, body, { archive: true, manageCompanyPresets: await canManageCompanyPresets(context) });
    },
  };
}
