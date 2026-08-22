import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('collaboration workspaces use shared native materials without changing their handlers', async () => {
  const [commitments, coaching, projects, improvements] = await Promise.all([
    read('src/pages/MyCommitments.jsx'),
    read('src/pages/GrowthCoaching.jsx'),
    read('src/pages/ProjectsTasks.jsx'),
    read('src/pages/FcosImprovements.jsx'),
  ]);

  for (const source of [commitments, coaching, projects, improvements]) {
    assert.match(source, /workspace-collaboration/);
  }
  assert.match(commitments, /workCommitments/);
  assert.match(coaching, /growthCoachingBootstrap/);
  assert.match(projects, /collaborationList/);
  assert.match(improvements, /improvementsList/);
});

test('Email Router keeps its split workflow inside opaque material and native toolbar layers', async () => {
  const [page, workspace, styles] = await Promise.all([
    read('src/pages/EmailRouter.jsx'),
    read('src/components/email-router/EmailRouterWorkspace.jsx'),
    read('src/index.css'),
  ]);

  assert.match(page, /workspace-tools/);
  assert.match(workspace, /email-router-workspace/);
  assert.match(workspace, /material-panel/);
  assert.match(workspace, /email-router-commandbar/);
  assert.match(workspace, /emailRouter\.list/);
  assert.match(styles, /\.email-router-workspace \.email-router-commandbar/);
});

test('Settings, administration, audit, notifications, and compatibility views honor shared appearance', async () => {
  const [settingsWorkspace, settings, admin, audit, notifications, notFound, styles] = await Promise.all([
    read('src/pages/SettingsWorkspace.jsx'),
    read('src/pages/Settings.jsx'),
    read('src/pages/AdminControl.jsx'),
    read('src/pages/UniversalAuditTrail.jsx'),
    read('src/components/WorkNotifications.jsx'),
    read('src/lib/PageNotFound.jsx'),
    read('src/index.css'),
  ]);

  assert.match(settingsWorkspace, /workspace-administration/);
  assert.match(settingsWorkspace, /settings-navigation/);
  assert.match(settingsWorkspace, /app-navigation-material/);
  assert.match(settings, /workspace-administration-canvas/);
  assert.match(admin, /workspace-administration-canvas/);
  assert.match(audit, /workspace-administration-canvas/);
  assert.match(notifications, /glass-floating/);
  assert.match(notifications, /app-navigation-caption-material/);
  assert.match(notFound, /workspace-tools/);
  assert.match(notFound, /material-panel/);
  assert.match(styles, /\.workspace-administration/);
});
