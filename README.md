# Visual Regression Action

Catch visual bugs in pull requests with automated screenshot comparison and side-by-side diffs.

## What It Does

This GitHub Action runs your Playwright tests, compares screenshots against your base branch, and posts a PR comment showing what changed. No more "looks good to me" reviews when the button moved 5 pixels or the color shifted slightly.

**Example PR comment:**

<details>
<summary>📄 homepage.png</summary>

Shows: Original | Diff (highlighted) | New

</details>

[See it in action →](https://github.com/netbrain/visual-regression-action/pull/1)

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
  contents: write
  pull-requests: write

jobs:
  visual-regression:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.head_ref }}
          fetch-depth: 0

      - uses: netbrain/visual-regression-action@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          playwright-command: npm test
```

**3. Open a PR** - The action will comment with any visual changes.

## Key Features

- **Zero config** - Works immediately with sensible defaults
- **Fast** - Pre-built Docker image with Playwright, odiff, and ImageMagick
- **Smart cropping** - Shows only the changed regions, not entire pages
- **Clean storage** - Uploads diff images to a dedicated `_ci` branch
- **Auto-commits** - Updates screenshots in your PR automatically

## Configuration

### Common Options

```yaml
- uses: netbrain/visual-regression-action@v1
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    playwright-command: npm test                    # Required
    screenshot-directory: screenshots               # Default
    working-directory: .                           # Default
    commit-screenshots: true                       # Auto-commit updated screenshots
    post-comment: true                             # Post PR comment with diffs
    fail-on-changes: false                         # Fail CI if changes detected
```

### Advanced Options

```yaml
    diff-threshold: '0.1'          # Pixel difference tolerance (0.0-1.0)
    crop-padding: '50'             # Padding around changed region (px)
    crop-min-height: '300'         # Minimum crop height (px)
    use-ci-branch: true            # Store artifacts on _ci branch
    ci-branch-name: '_ci'          # Branch name for artifacts
    base-branch: main              # Branch to compare against
    install-deps: true             # Run npm ci before tests
    amend-commit: true             # Amend vs new commit for screenshots
```

## How It Works

1. **Captures screenshots** - Runs your Playwright tests
2. **Fetches baseline** - Gets screenshots from the base branch
3. **Generates diffs** - Uses odiff to highlight pixel differences
4. **Crops intelligently** - Shows only changed regions with context
5. **Uploads artifacts** - Stores diff images on `_ci` branch (content-addressed)
6. **Comments on PR** - Posts expandable comparison gallery
7. **Commits screenshots** - Updates your PR with new screenshots

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
- uses: netbrain/visual-regression-action@v1
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    playwright-command: npm test
    fail-on-changes: true
```

### Comment Only (No Auto-Commit)

```yaml
- uses: netbrain/visual-regression-action@v1
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    playwright-command: npm test
    commit-screenshots: false
```

### Custom Directory and Build Step

```yaml
- name: Build site
  run: npm run build

- uses: netbrain/visual-regression-action@v1
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    playwright-command: npm run test:visual
    working-directory: frontend
    screenshot-directory: e2e/screenshots
    install-deps: false
```

## Outputs

Use these in subsequent workflow steps:

```yaml
- name: Visual Regression
  id: vr
  uses: netbrain/visual-regression-action@v1
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    playwright-command: npm test

- name: Check results
  run: |
    echo "Changes: ${{ steps.vr.outputs.has-changes }}"
    echo "Diffs: ${{ steps.vr.outputs.has-diffs }}"
    echo "Committed: ${{ steps.vr.outputs.screenshots-committed }}"
    echo "Commented: ${{ steps.vr.outputs.comment-posted }}"
```

## Requirements

- Playwright tests that save screenshots
- `contents: write` and `pull-requests: write` permissions
- Node.js project with `package.json`

## License

MIT

## Acknowledgments

Built with [Playwright](https://playwright.dev/), [odiff](https://github.com/dmtrKovalenko/odiff), and [ImageMagick](https://imagemagick.org/).
