import { test, expect } from '@playwright/test';
const open = async (page) => {
  await page.goto('/e2e/fixtures/people-access.html');
  await expect(page.getByLabel('Group name')).toHaveValue('Operations');
};

test('group-first editor previews affected users, saves a revision, and fits desktop without horizontal scrolling', async ({ page }) => {
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await open(page);
  await expect(page.getByRole('button', { name: 'Permission Groups', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('Legacy · Alice Example', { exact: true })).toHaveCount(0);
  await page.getByLabel('Show personal legacy groups').check();
  await expect(page.getByText('Legacy · Alice Example', { exact: true })).toBeVisible();
  await page.getByLabel('Xero Portal permission', { exact: true }).click();
  await page.getByRole('button', { name: 'Review & save' }).click();
  await expect(page.getByRole('dialog')).toContainText('1 with effective access changes');
  await expect(page.getByRole('dialog')).toContainText('Bob Example');
  await page.getByRole('button', { name: 'Save permission group', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Permission group saved.');
  const save = await page.evaluate(() => window.peopleAccessFixture.requests.find((request) => request.name === 'adminPermissionGroupSave'));
  expect(save.body.expectedRevision).toBe(2);
  expect(save.body.permissions.xero_portal).toBe(true);
  await page.screenshot({ path: 'test-results/people-access-desktop.png' });
  expect((await page.getByRole('button', { name: 'Review & save' }).boundingBox()).y).toBeLessThan(900);
  await page.setViewportSize({ width: 1366, height: 768 });
  await expect.poll(async () => {
    const footer = await page.getByRole('button', { name: 'Review & save' }).boundingBox();
    return footer ? footer.y + footer.height : Infinity;
  }, { message: 'Save controls must fit after the desktop resize event has settled.' }).toBeLessThanOrEqual(768);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('person membership preview combines grants, tracks sources, and saves groups without changing role', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'People', exact: true }).click();
  await page.getByRole('button', { name: 'Manage groups for Alice Example' }).click();
  const panel = page.getByRole('region', { name: 'Person access' });
  await expect(panel).toContainText('Granted by Operations, Finance');
  await expect(panel).toContainText('Full access');
  await panel.getByLabel('Operations', { exact: false }).uncheck();
  await expect(panel).toContainText('Granted by Finance');
  await expect(panel).toContainText('Organizational role remains operations');
  await panel.getByRole('button', { name: 'Save groups', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Permission groups saved.');
  const saved = await page.evaluate(() => ({ user: window.peopleAccessFixture.users[0], request: window.peopleAccessFixture.requests.find((request) => request.name === 'adminUserGroupsSave') }));
  expect(saved.user.group_ids).toEqual(['finance']); expect(saved.user.user_type).toBe('operations');
  expect(saved.request.body.expectedRevision).toBe(4); expect(saved.request.body).not.toHaveProperty('user_type');
});

test('unsaved switching offers Stay, Discard, and Save with impact review', async ({ page }) => {
  await open(page);
  await page.getByLabel('Group description').fill('Updated delivery responsibilities');
  await page.getByRole('button', { name: 'People', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Save your changes?');
  await page.getByRole('button', { name: 'Stay', exact: true }).click();
  await expect(page.getByLabel('Group description')).toHaveValue('Updated delivery responsibilities');
  await page.getByRole('button', { name: 'People', exact: true }).click();
  await page.getByRole('button', { name: 'Discard', exact: true }).click();
  await expect(page.getByRole('button', { name: 'People', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Permission Groups', exact: true }).click();
  await expect(page.getByLabel('Group description')).toHaveValue('Delivery work');
  await page.getByLabel('Group description').fill('New description');
  await page.getByRole('button', { name: 'People', exact: true }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: 'Save permission group', exact: true }).click();
  await expect(page.getByRole('button', { name: 'People', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('revision conflict preserves membership choices and disabled users have no effective grants', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'People', exact: true }).click();
  await page.getByRole('button', { name: 'Manage groups for Bob Example' }).click();
  const panel = page.getByRole('region', { name: 'Person access' });
  await panel.getByLabel('Finance', { exact: false }).check();
  await page.evaluate(() => { window.peopleAccessFixture.conflict = true; });
  await panel.getByRole('button', { name: 'Save groups', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Your choices are retained');
  await expect(panel.getByLabel('Finance', { exact: false })).toBeChecked();
  await panel.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Manage groups for Carol Example' }).click();
  await expect(panel).toContainText('Account disabled');
  await expect(panel).toContainText('No matching permissions');
  await panel.getByLabel('Enabled only').uncheck();
  await expect(panel.getByText('No access', { exact: true }).first()).toBeVisible();
});

test('Members Add opens an explicit combined-access review and keyboard controls work', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Members', exact: true }).click();
  await page.getByLabel('Search group members').fill('Carol');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Carol Example');
  await expect(dialog.getByLabel('Operations', { exact: false })).toBeChecked();
  expect(await page.evaluate(() => window.peopleAccessFixture.requests.filter((request) => request.name === 'adminUserGroupsSave').length)).toBe(0);
  await dialog.getByRole('button', { name: 'Save groups', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status')).toHaveText('Permission groups saved.');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.evaluate(() => window.peopleAccessFixture.users.find((person) => person.id === 'carol').group_ids)).toEqual(['finance', 'operations']);
  await page.getByRole('button', { name: 'Permissions', exact: true }).click();
  await page.getByLabel('Group description').fill('Delivery and follow-up');
  await page.getByRole('button', { name: 'Review & save' }).click();
  await page.getByRole('button', { name: 'Save permission group', exact: true }).click();
  expect(await page.evaluate(() => window.peopleAccessFixture.requests.find((request) => request.name === 'adminPermissionGroupSave').body.expectedRevision)).toBe(3);
});


test('non-FCUNO identity controls remain separate and new users start without permission groups', async ({ page }) => {
  await page.goto('/e2e/fixtures/people-access.html?authority=fcos');
  await expect(page.getByLabel('Group name')).toHaveValue('Operations');
  await page.getByRole('button', { name: 'People', exact: true }).click();
  await page.getByRole('button', { name: 'Add person', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Identity email').fill('new-person@example.invalid');
  await dialog.getByLabel('Identity full name').fill('New Person Example');
  await dialog.getByLabel('Identity password').fill('Fixture-only-123');
  await dialog.getByRole('button', { name: 'Save person', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Person saved');
  expect(await page.evaluate(() => window.peopleAccessFixture.users.find((person) => person.id === 'new-person').group_ids)).toEqual([]);
  const save = await page.evaluate(() => window.peopleAccessFixture.requests.find((request) => request.name === 'adminUserSave').body);
  expect(save).not.toHaveProperty('permissions'); expect(save).not.toHaveProperty('capabilities');
  await page.getByRole('button', { name: 'Manage groups for New Person Example' }).click();
  await page.getByRole('button', { name: 'Manage identity', exact: true }).click();
  await expect(page.getByLabel('Identity email')).toBeDisabled();
  await expect(page.getByLabel('Identity password')).toHaveValue('');
  await page.getByLabel('Identity full name').fill('Updated Name');
  await page.getByLabel('Active account').uncheck();
  await page.getByRole('button', { name: 'Save person', exact: true }).click();
  expect(await page.evaluate(() => window.peopleAccessFixture.users.find((person) => person.id === 'new-person').active)).toBe(false);
});
