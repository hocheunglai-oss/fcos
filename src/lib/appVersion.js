export const APP_VERSION = '1.0.0.2';

export const APP_VERSION_HISTORY = [
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
