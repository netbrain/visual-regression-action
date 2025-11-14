import { test } from '@playwright/test';

/**
 * Visual Regression Test Suite
 *
 * This suite captures screenshots for visual comparison.
 * Screenshots are saved to the screenshots/ directory and should be committed to git.
 */

async function captureScreenshot(page: any, name: string): Promise<void> {
  // Scroll to top
  await page.evaluate(() => window.scrollTo(0, 0));

  // Wait for any pending animations
  await page.waitForTimeout(300);
  await page.waitForLoadState('networkidle');

  // Take screenshot
  await page.screenshot({
    path: `screenshots/${name}.png`,
    fullPage: true,
    animations: 'disabled',
  });

  console.log(`📸 Screenshot saved: screenshots/${name}.png`);
}

test.describe('Visual Regression Tests', () => {
  test('Desktop - Full page', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await captureScreenshot(page, 'desktop-full-page');
  });

  test('Mobile - Full page', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await captureScreenshot(page, 'mobile-full-page');
  });

  test('Tablet - Full page', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await captureScreenshot(page, 'tablet-full-page');
  });
});
