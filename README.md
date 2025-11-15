# Visual Regression Action

Catch visual bugs in pull requests with automated screenshot comparison and side-by-side diffs.

## What It Does

This GitHub Action captures screenshots from your Playwright tests, compares them between your base branch and PR, and posts a comment showing what changed. No more "looks good to me" reviews when the button moved 5 pixels or the color shifted slightly.

[See it in action →](https://github.com/netbrain/visual-regression-action/pull/15)

## Quick Start

**1. Write Playwright tests that save screenshots:**

```typescript
// tests/visual.spec.ts
import { test } from '@playwright/test';

test('homepage', async ({ page }) => {
  await page.goto('/');
  await page.screenshot({
    path: 'screenshots/homepage.png',
    fullPage: true
  });
});
```

**2. Add the workflow:**

```yaml
# .github/workflows/visual-regression.yml
name: Visual Regression

on: pull_request

permissions:
  pull-requests: write

jobs:
  capture:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        branch: [base, pr]
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ matrix.branch == 'base' && github.event.pull_request.base.ref || github.head_ref }}

      - uses: netbrain/visual-regression-action@v2
        with:
          mode: capture
          artifact-name: screenshots-${{ matrix.branch }}

      - uses: actions/upload-artifact@v4
        with:
          name: screenshots-${{ matrix.branch }}
          path: screenshots/

  compare:
    runs-on: ubuntu-latest
    needs: capture
    steps:
      - uses: actions/checkout@v4

      - uses: actions/download-artifact@v4
        with:
          name: screenshots-base
          path: screenshots-base

      - uses: actions/download-artifact@v4
        with:
          name: screenshots-pr
          path: screenshots-pr

      - uses: netbrain/visual-regression-action@v2
        with:
          mode: compare
          github-token: ${{ secrets.GITHUB_TOKEN }}
          r2-account-id: ${{ secrets.R2_ACCOUNT_ID }}
          r2-access-key-id: ${{ secrets.R2_ACCESS_KEY_ID }}
          r2-secret-access-key: ${{ secrets.R2_SECRET_ACCESS_KEY }}
          r2-bucket-name: ${{ secrets.R2_BUCKET_NAME }}
          r2-public-url: ${{ secrets.R2_PUBLIC_URL }}
```

**3. Set up Cloudflare R2** for image storage:
- Create a free Cloudflare account at https://cloudflare.com
- Go to R2 → Create bucket (e.g., `visual-regression-diffs`)
- Enable public access on the bucket
- Create an R2 API token with Read & Write permissions
- Add these repository secrets:
  - `R2_ACCOUNT_ID` - Your Cloudflare account ID
  - `R2_ACCESS_KEY_ID` - R2 access key ID
  - `R2_SECRET_ACCESS_KEY` - R2 secret access key
  - `R2_BUCKET_NAME` - Your bucket name
  - `R2_PUBLIC_URL` - Public bucket URL (e.g., `https://pub-xxxxx.r2.dev`)

**4. Open a PR** - The action will comment with visual diffs.

## Key Features

- **Minimal config** - Works with sensible defaults, just specify `mode`
- **Fast** - Docker image with Playwright, odiff, and ImageMagick
- **Smart cropping** - Shows only the changed regions, not entire pages
- **Clean storage** - Uses GitHub Actions artifacts for screenshots, Cloudflare R2 for diff images
- **No repo bloat** - Screenshots aren't committed to your repository
- **Permanent history** - Diff images stored permanently on R2 for long-term PR reference
- **Free tier** - Cloudflare R2 offers 10GB storage free with unlimited egress

## Configuration

The action operates in two modes: **capture** and **compare**.

### Capture Mode Options

Use in the matrix capture job to take screenshots:

```yaml
- uses: netbrain/visual-regression-action@v2
  with:
    mode: capture                              # Required: 'capture' or 'compare'
    playwright-command: npm test               # Default: 'npm test'
    screenshot-directory: screenshots          # Default: 'screenshots'
    working-directory: .                       # Default: '.'
    artifact-name: screenshots                 # Default: 'screenshots'
    install-deps: true                         # Default: true
```

### Compare Mode Options

Use in the compare job to generate diffs and post PR comments:

```yaml
- uses: netbrain/visual-regression-action@v2
  with:
    mode: compare                              # Required: 'capture' or 'compare'
    github-token: ${{ secrets.GITHUB_TOKEN }}  # Required for compare mode
    r2-account-id: ${{ secrets.R2_ACCOUNT_ID }}           # Required: Cloudflare R2 account ID
    r2-access-key-id: ${{ secrets.R2_ACCESS_KEY_ID }}     # Required: R2 access key ID
    r2-secret-access-key: ${{ secrets.R2_SECRET_ACCESS_KEY }} # Required: R2 secret access key
    r2-bucket-name: ${{ secrets.R2_BUCKET_NAME }}         # Required: R2 bucket name
    r2-public-url: ${{ secrets.R2_PUBLIC_URL }}           # Required: R2 public URL
    base-artifact: screenshots-base            # Default: 'screenshots-base'
    pr-artifact: screenshots-pr                # Default: 'screenshots-pr'
    post-comment: true                         # Default: true
    fail-on-changes: false                     # Default: false
    diff-threshold: '0.1'                      # Default: 0.1 (10% tolerance)
    crop-padding: '50'                         # Default: 50px
    crop-min-height: '300'                     # Default: 300px
    working-directory: .                       # Default: '.'
```

## How It Works

1. **Parallel capture** - Matrix job runs Playwright tests on both base and PR branches
2. **Upload artifacts** - Screenshots uploaded as GitHub Actions artifacts
3. **Download & compare** - Compare job downloads both artifact sets
4. **Generate diffs** - Uses odiff to highlight pixel differences
5. **Smart cropping** - Shows only changed regions with context padding
6. **Store diffs** - Uploads diff images to Cloudflare R2 (stored permanently)
7. **Comment on PR** - Posts expandable comparison gallery with side-by-side views

## Example PR Comment

```markdown
## 📸 Visual Regression Changes Detected

<details>
<summary>📄 homepage.png</summary>

| Original | Diff | New |
|----------|------|-----|
| [Image showing before/after/diff side-by-side]
</details>

<details>
<summary>📄 dashboard.png</summary>
...
</details>
```

## Common Patterns

### Fail CI on Visual Changes

```yaml
# In the compare job
- uses: netbrain/visual-regression-action@v2
  with:
    mode: compare
    github-token: ${{ secrets.GITHUB_TOKEN }}
    r2-account-id: ${{ secrets.R2_ACCOUNT_ID }}
    r2-access-key-id: ${{ secrets.R2_ACCESS_KEY_ID }}
    r2-secret-access-key: ${{ secrets.R2_SECRET_ACCESS_KEY }}
    r2-bucket-name: ${{ secrets.R2_BUCKET_NAME }}
    r2-public-url: ${{ secrets.R2_PUBLIC_URL }}
    fail-on-changes: true
```

### Custom Playwright Command & Directory

```yaml
# In the capture job
- name: Build site
  run: npm run build

- uses: netbrain/visual-regression-action@v2
  with:
    mode: capture
    playwright-command: npm run test:visual
    working-directory: frontend
    screenshot-directory: e2e/screenshots
    install-deps: false
```

### Skip PR Comments

```yaml
# In the compare job
- uses: netbrain/visual-regression-action@v2
  with:
    mode: compare
    github-token: ${{ secrets.GITHUB_TOKEN }}
    r2-account-id: ${{ secrets.R2_ACCOUNT_ID }}
    r2-access-key-id: ${{ secrets.R2_ACCESS_KEY_ID }}
    r2-secret-access-key: ${{ secrets.R2_SECRET_ACCESS_KEY }}
    r2-bucket-name: ${{ secrets.R2_BUCKET_NAME }}
    r2-public-url: ${{ secrets.R2_PUBLIC_URL }}
    post-comment: false
```

## Outputs

### Capture Mode Outputs

- `screenshot-count` - Number of PNG files found
- `screenshot-directory` - Absolute path to screenshot directory

### Compare Mode Outputs

- `has-diffs` - Whether visual differences were detected (`true`/`false`)
- `comment-posted` - Whether PR comment was posted (`true`/`false`)

Example usage:

```yaml
- name: Compare screenshots
  id: compare
  uses: netbrain/visual-regression-action@v2
  with:
    mode: compare
    github-token: ${{ secrets.GITHUB_TOKEN }}
    r2-account-id: ${{ secrets.R2_ACCOUNT_ID }}
    r2-access-key-id: ${{ secrets.R2_ACCESS_KEY_ID }}
    r2-secret-access-key: ${{ secrets.R2_SECRET_ACCESS_KEY }}
    r2-bucket-name: ${{ secrets.R2_BUCKET_NAME }}
    r2-public-url: ${{ secrets.R2_PUBLIC_URL }}

- name: Check results
  run: |
    echo "Has diffs: ${{ steps.compare.outputs.has-diffs }}"
    echo "Comment posted: ${{ steps.compare.outputs.comment-posted }}"
```

## Requirements

- Playwright tests that save screenshots to a directory
- Cloudflare R2 account with a public bucket (free tier available)
- `pull-requests: write` permission (for posting PR comments)
- Node.js project with `package.json` (for capture mode)

## License

MIT

## Acknowledgments

Built with [Playwright](https://playwright.dev/), [odiff](https://github.com/dmtrKovalenko/odiff), and [ImageMagick](https://imagemagick.org/).
