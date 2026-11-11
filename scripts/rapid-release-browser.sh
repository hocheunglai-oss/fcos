#!/usr/bin/env bash
set -euo pipefail

verify_browser() {
  node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

const browser = await chromium.launch({ headless: true, timeout: 15000 });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.setContent('<main>FCOS browser readiness</main>', { timeout: 5000 });
  assert.equal(await page.locator('main').innerText({ timeout: 5000 }), 'FCOS browser readiness');
  const png = await page.screenshot({ timeout: 5000 });
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
} finally {
  await browser.close();
}
JS
}

npx --no-install playwright install chromium
if verify_browser; then
  echo 'Pinned Chromium passed launch and rendering with runner libraries.'
else
  echo 'Installing Chromium system dependencies after the readiness probe failed.'
  npx --no-install playwright install-deps chromium
  verify_browser
fi
