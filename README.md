# 📸 Visual Regression Action

Automated Playwright visual regression with screenshot diffs, smart cropping, PR comments, and CI artifact storage.

This GitHub Action provides a complete end-to-end visual regression workflow for pull requests. It detects visual changes using Playwright + odiff, generates cropped diffs that highlight only the changed regions, uploads artifacts to a dedicated CI branch using content-addressed filenames, and comments on the PR with expandable previews.

Ideal for maintaining UI consistency in any web project that Playwright can render - static sites, SPAs, server-rendered apps, or full-stack frameworks.

## ✨ Features

- 🎯 **Zero-config visual regression** - Works out of the box with sensible defaults
- ⚡ **Lightning fast** - Pre-built Docker image with Playwright, odiff, and ImageMagick
- 📸 **Smart screenshot comparison** - Automatic dimension matching and content-addressed storage
- 🔍 **Intelligent diff highlighting** - Crops to changed regions with configurable padding
- 💬 **Beautiful PR comments** - Expandable image galleries with side-by-side comparisons
- 🎨 **Flexible configuration** - Extensive options for thresholds, cropping, and commit behavior
- 🚀 **Optimized for CI** - Minimal setup time, maximum execution speed
- 🔄 **Content-addressed artifacts** - Automatic deduplication via SHA256 hashing

## 🚀 Quick Start

### 1. Add Playwright tests to your project

```typescript
// tests/visual-regression.spec.ts
import { test } from '@playwright/test';

test('Homepage screenshot', async ({ page }) => {
  await page.goto('/');
  await page.screenshot({
    path: 'screenshots/homepage.png',
    fullPage: true,
    animations: 'disabled'
  });
});
```

### 2. Create a workflow file

```yaml
# .github/workflows/visual-regression.yml
name: Visual Regression Testing

on:
  pull_request:
    types: [opened, synchronize, reopened]

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

### 3. Open a PR and watch the magic happen!

The action will:
1. Run your Playwright tests to capture screenshots
2. Compare them with the base branch
3. Generate visual diffs for any changes
4. Post a comment with before/after comparisons
5. Commit updated screenshots back to your PR

## 📖 Usage Examples

### Basic Setup

```yaml
- uses: netbrain/visual-regression-action@v1
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    playwright-command: npm test
```

### Custom Screenshot Directory

```yaml
- uses: netbrain/visual-regression-action@v1
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    playwright-command: npx playwright test
    screenshot-directory: e2e/screenshots
    working-directory: frontend
```

### Disable Automatic Commits (Comment Only)

```yaml
- uses: netbrain/visual-regression-action@v1
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    playwright-command: npm run test:visual
    commit-screenshots: false
    post-comment: true
```

### Fail on Visual Changes

```yaml
- uses: netbrain/visual-regression-action@v1
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    playwright-command: npm test
    fail-on-changes: true
```

### Custom Diff Threshold and Cropping

```yaml
- uses: netbrain/visual-regression-action@v1
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    playwright-command: npm test
    diff-threshold: '0.05'      # 5% pixel difference tolerance
    crop-padding: '100'          # 100px padding around changes
    crop-min-height: '500'       # Minimum 500px crop height
```

### Advanced Configuration

```yaml
- uses: netbrain/visual-regression-action@v1
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    playwright-command: npm run test:e2e
    working-directory: packages/web
    screenshot-directory: screenshots
    base-branch: develop
    commit-screenshots: true
    post-comment: true
    use-ci-branch: true
    ci-branch-name: _ci-artifacts
    diff-threshold: '0.1'
    crop-padding: '50'
    crop-min-height: '300'
    install-deps: true
    fail-on-changes: false
    amend-commit: true
```

## ⚙️ Configuration Options

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `github-token` | GitHub token for API access | No | `${{ github.token }}` |
| `playwright-command` | Command to run Playwright tests | **Yes** | - |
| `working-directory` | Working directory (where package.json is) | No | `.` |
| `screenshot-directory` | Directory where screenshots are saved | No | `screenshots` |
| `base-branch` | Base branch to compare against | No | PR base branch |
| `commit-screenshots` | Commit updated screenshots to PR | No | `true` |
| `post-comment` | Post visual diff comment on PR | No | `true` |
| `use-ci-branch` | Use _ci branch for artifact storage | No | `true` |
| `ci-branch-name` | Name of CI artifacts branch | No | `_ci` |
| `diff-threshold` | Odiff threshold (0.0-1.0) | No | `0.1` |
| `crop-padding` | Vertical padding around diffs (px) | No | `50` |
| `crop-min-height` | Minimum crop height (px) | No | `300` |
| `install-deps` | Install npm dependencies | No | `true` |
| `fail-on-changes` | Fail if visual changes detected | No | `false` |
| `amend-commit` | Amend existing commit vs new commit | No | `true` |

## 📤 Outputs

| Output | Description |
|--------|-------------|
| `has-changes` | Whether visual changes were detected (`true`/`false`) |
| `has-diffs` | Whether visual diffs were generated (`true`/`false`) |
| `screenshots-committed` | Whether screenshots were committed to PR (`true`/`false`) |
| `comment-posted` | Whether PR comment was posted (`true`/`false`) |

### Using Outputs

```yaml
- name: Visual Regression Testing
  id: visual-regression
  uses: netbrain/visual-regression-action@v1
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    playwright-command: npm test

- name: Check results
  run: |
    if [ "${{ steps.visual-regression.outputs.has-diffs }}" = "true" ]; then
      echo "Visual changes detected!"
    fi
```

## 🎯 How It Works

### 1. Screenshot Capture
- Runs your Playwright tests to generate screenshots
- Saves them to the configured `screenshot-directory`

### 2. Baseline Comparison
- Fetches screenshots from the base branch for comparison
- Automatically handles dimension mismatches by extending canvases

### 3. Diff Generation
- Uses [odiff](https://github.com/dmtrKovalenko/odiff) for pixel-perfect comparison
- Generates diff images highlighting changed pixels
- Creates diff masks to identify change regions

### 4. Smart Cropping
- Analyzes diff masks to find changed regions
- Crops to the vertical extent of changes (full width preserved)
- Adds configurable padding for context
- Enforces minimum height for readability
- Combines base, diff, and new images horizontally

### 5. Artifact Storage
- Calculates SHA256 hash of each diff image
- Uploads to `_ci` branch using content-addressed filenames
- Automatic deduplication (same image = same hash = no duplicate)
- Weekly cleanup of old artifacts via scheduled workflow

### 6. PR Comment
- Posts expandable comment with visual comparisons
- Each screenshot gets its own collapsible section
- Shows base, diff, and new side-by-side
- Links to full-resolution images in artifact branch

### 7. Screenshot Commit
- Commits updated screenshots back to PR branch
- Can amend existing commit or create new one
- Rebases onto latest PR state before pushing
- Uses force-with-lease for safety

## 🐳 Docker Architecture

This action uses a pre-built Docker image for maximum speed:

```dockerfile
FROM mcr.microsoft.com/playwright:v1.48.0-jammy

# Pre-installed dependencies:
# - Playwright with Chromium
# - ImageMagick for image manipulation
# - odiff for pixel-perfect diffs
# - Node.js 20 runtime
```

Benefits:
- ⚡ **No installation time** - Everything is pre-built
- 🎯 **Consistent environment** - Same versions every time
- 🚀 **Fast execution** - No npm install, no browser downloads
- 📦 **Small layer deltas** - Docker layer caching optimized

## 🔄 CI Artifact Branch

The action uses a dedicated `_ci` branch for storing diff images:

### Structure
```
_ci/
├── README.md
├── a3dbc947...png  # SHA256 hash as filename
├── f8e2b1d4...png
└── c9a7d3f2...png
```

### Benefits
- **Content-addressed storage** - Same image = same filename = automatic deduplication
- **No PR pollution** - Diff images don't clutter your working branches
- **Fast CDN delivery** - GitHub's raw.githubusercontent.com serves images quickly
- **Automatic cleanup** - Scheduled workflow removes old artifacts

### Cleanup Workflow

Add this workflow to automatically clean up old artifacts:

```yaml
# .github/workflows/cleanup-ci-artifacts.yml
name: Cleanup CI Artifacts

on:
  schedule:
    - cron: '0 0 * * 0'  # Weekly on Sundays
  workflow_dispatch:
    inputs:
      retention_days:
        description: 'Days to retain artifacts'
        default: '30'
        type: number

permissions:
  contents: write

jobs:
  cleanup:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          ref: _ci
          fetch-depth: 0

      # Cleanup script removes files older than retention_days
      # Squashes all commits into one to keep history clean
```

See [cleanup-ci-artifacts.yml](.github/workflows/cleanup-ci-artifacts.yml) for the complete implementation.

## 📚 Complete Example

Here's a full working example for an Astro project:

```yaml
name: Visual Regression Testing

on:
  pull_request:
    types: [opened, synchronize, reopened]
    paths:
      - 'src/**'
      - 'public/**'
      - 'tests/**'
      - 'astro.config.mjs'
      - 'tailwind.config.*'
      - 'playwright.config.ts'

permissions:
  contents: write
  pull-requests: write

jobs:
  visual-regression:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout PR branch
        uses: actions/checkout@v4
        with:
          ref: ${{ github.head_ref }}
          token: ${{ secrets.GITHUB_TOKEN }}
          fetch-depth: 0

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Build site
        run: npm run build

      - name: Run visual regression
        uses: netbrain/visual-regression-action@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          playwright-command: npm run test:visual
          screenshot-directory: screenshots
          commit-screenshots: true
          post-comment: true
          diff-threshold: '0.1'
          install-deps: false
```

## 🛠️ Development

### Building the Action

```bash
# Install dependencies
npm ci

# Build TypeScript
npm run build

# Lint code
npm run lint

# Build Docker image
docker build -t visual-regression-action:test .
```

### Running Locally

```bash
# Build the example site
cd example
npm ci
npx playwright install --with-deps chromium

# Run tests
npm test

# Start dev server
npm start
```

### Testing Changes

1. Make changes to `src/index.ts`
2. Run `npm run build` to compile
3. Commit both source and `dist/` changes
4. Push to a branch and open a PR
5. The action will run on itself!

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

### Conventional Commits

We use conventional commits for automatic semantic versioning:

- `feat:` - New feature (minor version bump)
- `fix:` - Bug fix (patch version bump)
- `feat!:` or `fix!:` - Breaking change (major version bump)
- `docs:` - Documentation only
- `chore:` - Maintenance tasks

Example:
```
feat: add support for custom diff colors

This commit adds a new input parameter `diff-color` that allows
users to customize the highlight color used in diff images.
```

## 📝 License

Apache-2.0

## 🙏 Acknowledgments

- [Playwright](https://playwright.dev/) - Browser automation
- [odiff](https://github.com/dmtrKovalenko/odiff) - Image comparison
- [ImageMagick](https://imagemagick.org/) - Image manipulation
- Inspired by [eik-it/export.fish-site](https://github.com/eik-it/export.fish-site) visual regression workflow

## 🔗 Links

- [GitHub Marketplace](https://github.com/marketplace/actions/visual-regression-testing)
- [Example PR](../../pulls) - See the action in action!
- [Issues](../../issues) - Report bugs or request features
- [Discussions](../../discussions) - Ask questions or share ideas

---

**Built with ❤️ by NetBrain AS**
