export const APP_VERSION = '1.0.0.5';

export const APP_VERSION_HISTORY = [
  {
    version: '1.0.0.5',
    releasedAt: '2026-07-06',
    title: 'Broker routing and commission exclusions',
    changes: [
      'Outstanding buyer invoice reminders no longer route to hidden broker individual or hidden broker company accounts.',
      'Added broker commission row inclusion checkboxes so selected rows can be excluded from totals.',
      'Broker summary, page summary, CNY summary, and XLS export now use only included broker commission rows.',
    ],
  },
  {
    version: '1.0.0.4',
    releasedAt: '2026-07-06',
    title: 'Dashboard KPI and payment details',
    changes: [
      'Added Turnover KPI to the dashboard using filtered buyer invoice total.',
      'Standardized the Product Volume KPI layout with the other dashboard KPI cards.',
      'Added a wide-view toggle for the dashboard Filtered STEMs table.',
      'Added supplier invoice paid dates and buyer invoice received dates to Stem Detail.',
    ],
  },
  {
    version: '1.0.0.3',
    releasedAt: '2026-07-06',
    title: 'Buyer broker reminder routing',
    changes: [
      'Added buyer broker routing metadata to Outstanding Buyer Invoices.',
      'Payment reminders now route buyer-only, broker-only, or buyer-with-broker-copied based on Salesforce broker Invoice Format.',
      'Broker reminders use the broker Account email field, not broker invoice email or accounts email.',
      'Added routing details and warnings to the payment reminder selection workflow.',
    ],
  },
  {
    version: '1.0.0.2',
    releasedAt: '2026-07-06',
    title: 'Live update notification',
    changes: [
      'Added top-of-app notification when a newer Vercel deployment is available.',
      'Added Update Now action to clear browser caches and refresh the app to the latest deployment.',
      'Added build metadata generation so open browser sessions can detect new deployments.',
    ],
  },
  {
    version: '1.0.0.1',
    releasedAt: '2026-07-06',
    title: 'Operational analytics baseline',
    changes: [
      'Added version audit trail access from the main app sidebar.',
      'Added dashboard monthly volume view with HSFO, VLSFO, and LSMGO stacked by month.',
      'Updated dashboard port filtering so the same search box matches both port country and port name.',
      'Added grouped copy selection for outstanding buyer invoices by buyer and buyer group.',
      'Included recent broker commission, dispute management, document management, payment reminder, and collection workflow improvements in this baseline release.',
    ],
  },
];
