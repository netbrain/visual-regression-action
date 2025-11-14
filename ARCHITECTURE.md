# Architecture Overview

## Design Philosophy

This GitHub Action is designed with three core principles:

1. **Speed First** - Pre-built Docker image minimizes CI time
2. **Flexibility** - Extensive configuration options for different workflows
3. **Developer Experience** - Clear outputs, helpful comments, automatic updates

## Components

### 1. Docker Image (`Dockerfile`)

Based on Microsoft's official Playwright image with additional tools:

```
playwright:v1.48.0-jammy
├── Playwright + Chromium (pre-installed)
├── ImageMagick (for cropping/manipulation)
├── odiff (for pixel-perfect diffs)
├── Node.js 20
└── Action compiled code (dist/)
```

**Benefits:**
- No browser installation time (~30s saved)
- No ImageMagick/odiff installation (~10s saved)
- Consistent environment across runs
- Docker layer caching for fast rebuilds

### 2. Action Interface (`action.yml`)

Defines the GitHub Action API using Docker container runtime:

- **Inputs**: 15 configuration options
- **Outputs**: 4 status indicators
- **Runtime**: Docker (not composite or Node.js)

Why Docker runtime?
- Pre-built environment for speed
- Isolated execution context
- Easy local testing with `docker run`

### 3. Core Logic (`src/index.ts`)

TypeScript implementation with 7 main steps:

```typescript
1. Install dependencies (optional)
   ↓
2. Fetch base branch screenshots
   ↓
3. Run Playwright tests
   ↓
4. Compare and generate diffs
   ↓
5. Check for changes
   ↓
6. Post PR comment (with CI branch upload)
   ↓
7. Commit screenshots (optional)
```

**Key Features:**
- Content-addressed image storage
- Smart cropping with configurable padding
- Rebase-before-push for safety
- Comprehensive error handling

### 4. CI Artifact Branch

Dedicated `_ci` branch for diff image storage:

```
_ci/
├── README.md
└── <sha256>.png  (content-addressed)
```

**Why a separate branch?**
- No PR pollution with temporary images
- Content addressing = automatic deduplication
- GitHub CDN serves raw images fast
- Easy cleanup without affecting main history

**Storage Flow:**
```
1. Generate diff image
   ↓
2. Calculate SHA256 hash
   ↓
3. Check if hash exists in _ci
   ├── Yes → Reuse URL
   └── No → Upload to _ci
```

### 5. Example Site (`example/`)

Self-contained demo showcasing the action:

```
example/
├── index.html           (static site)
├── playwright.config.ts (Playwright config)
├── tests/               (visual regression tests)
└── screenshots/         (committed baselines)
```

Used by:
- Self-testing workflow (dogfooding)
- Showcase PR (live demo)
- Development/testing

## Workflows

### 1. Visual Regression (`visual-regression.yml`)

**Trigger**: PR changes to action code or example
**Purpose**: Test the action on itself

```
Steps:
1. Build action from source
2. Run action on example site
3. Generate screenshots
4. Post comment with diffs
5. Commit screenshots
```

### 2. Test Action (`test-action.yml`)

**Trigger**: PR changes to action code
**Purpose**: Validate build and Docker image

```
Steps:
1. Install deps
2. Build TypeScript
3. Verify dist/ is up to date
4. Test Docker build
5. Validate action.yml syntax
```

### 3. Maintain Showcase PR (`maintain-showcase-pr.yml`)

**Trigger**: Push to main with action changes
**Purpose**: Keep demo PR up to date

```
Steps:
1. Check if showcase branch exists
   ├── Yes → Rebase onto main
   └── No → Create from main
2. Push showcase branch
3. Create or update PR with description
```

This PR demonstrates the action in action! It:
- Auto-updates on every main branch change
- Shows real visual diffs in comments
- Serves as live documentation

### 4. Release (`release.yml`)

**Trigger**: Push to main with version changes
**Purpose**: Automated semantic versioning

```
Steps:
1. Build and commit dist/ if changed
2. Get version from package.json
3. Check if tag exists
   ├── No → Create release
   └── Yes → Analyze commits for bump
4. Bump version (major/minor/patch)
5. Create/update v{MAJOR} tag
6. Create GitHub release with changelog
```

**Conventional Commits:**
- `feat:` → minor bump
- `fix:` → patch bump
- `feat!:` / `fix!:` → major bump

### 5. Cleanup CI Artifacts (`cleanup-ci-artifacts.yml`)

**Trigger**: Weekly schedule or manual
**Purpose**: Remove old diff images from _ci branch

```
Steps:
1. Checkout _ci branch
2. Find files older than retention_days
3. Delete old files
4. Squash all commits into one
5. Force push to _ci
```

**Why squash?**
- Prevents _ci branch from growing unbounded
- Keeps GitHub responsive (no huge commit history)
- Still maintains current artifacts

## Data Flow

### Screenshot Commit Flow

```
PR opened/updated
  ↓
Action runs Playwright tests
  ↓
Screenshots generated in screenshots/
  ↓
Git detects changes
  ↓
Action stashes changes
  ↓
Action fetches latest PR state
  ↓
Action rebases onto latest
  ↓
Action pops stash
  ↓
Action commits (amend or new)
  ↓
Action force-pushes with lease
  ↓
PR updated with new screenshots
```

### Diff Image Flow

```
Base screenshots fetched
  ↓
New screenshots captured
  ↓
odiff compares pixel-by-pixel
  ↓
Diff mask generated
  ↓
Bounding box calculated
  ↓
Images cropped with padding
  ↓
Combined side-by-side
  ↓
SHA256 hash calculated
  ↓
Check if exists in _ci branch
  ├── Yes → Reuse URL
  └── No → Upload to _ci
        ↓
      Wait for CDN (5s)
        ↓
      Post PR comment with URL
```

## Configuration Strategy

### Sensible Defaults

The action works with minimal configuration:

```yaml
uses: netbrain/visual-regression-action@v1
with:
  github-token: ${{ secrets.GITHUB_TOKEN }}
  playwright-command: npm test
```

All other options have defaults that work for 80% of use cases.

### Progressive Enhancement

Users can enable features as needed:

**Level 1: Basic**
- Just run tests and commit screenshots

**Level 2: Comments**
- Enable `post-comment: true` for PR diffs

**Level 3: CI Branch**
- Enable `use-ci-branch: true` for CDN-hosted diffs

**Level 4: Custom**
- Tune thresholds, cropping, commit behavior

## Performance Optimization

### Docker Layer Caching

Dockerfile structured for optimal caching:

```dockerfile
FROM playwright:v1.48.0  # Cached by GitHub
RUN apt-get install...   # Cached after first run
RUN npm install...       # Cached if package.json unchanged
COPY dist/               # Only invalidated when action changes
```

### Parallel Operations

Where possible, operations run in parallel:
- Fetch base screenshots while installing deps
- Check _ci branch while building comment
- Multiple image uploads in single commit

### Minimal Git Operations

- Shallow fetches (`--depth=1`)
- Worktrees instead of branch switching
- Batch commits (not per-file)
- Force-with-lease (no fetch before push)

## Testing Strategy

### Self-Testing

The action tests itself on every PR:
- Actual Playwright tests run
- Real screenshots generated
- Actual PR comments posted
- Real commits created

### Example Site

Deliberately simple to test quickly:
- Pure HTML/CSS (no build step)
- 3 viewport sizes only
- Fast loading times

### Test Workflow

Validates action integrity:
- TypeScript compiles
- dist/ is up to date
- Docker image builds
- action.yml is valid

## Security Considerations

### Token Permissions

Minimal required permissions:
```yaml
permissions:
  contents: write        # For committing screenshots
  pull-requests: write   # For posting comments
```

### Force-Push Safety

Uses `--force-with-lease` instead of `--force`:
- Fails if remote has changed unexpectedly
- Prevents accidental history loss
- Safe for rebasing workflows

### Input Validation

All inputs validated and sanitized:
- Numeric inputs parsed with fallbacks
- Boolean inputs use official getters
- Paths resolved to prevent traversal

## Extensibility

### Future Enhancements

Architecture supports:
- [ ] Multi-browser testing (Firefox, Safari)
- [ ] Parallel test execution
- [ ] Custom diff colors/styling
- [ ] Slack/Teams notifications
- [ ] Artifact retention policies
- [ ] Screenshot annotations

### Plugin System

Could add hooks for:
- Pre-screenshot callbacks
- Custom diff algorithms
- Alternative storage backends
- Custom comment templates

## Comparison with Alternatives

### vs Percy/Chromatic

**Advantages:**
- Free (no SaaS costs)
- Self-hosted (no data leaves GitHub)
- Customizable (full control)
- Open source

**Trade-offs:**
- Less UI polish
- Manual baseline management
- No visual diff service
- Requires CI minutes

### vs GitHub Actions Artifacts

**Advantages:**
- Permanent storage (not 90 days)
- Content-addressed (deduplication)
- CDN delivery (faster loading)
- Git-based (version control)

**Trade-offs:**
- Branch pollution
- Manual cleanup needed
- No built-in UI

## Monitoring & Debugging

### Action Outputs

Use outputs for conditional logic:

```yaml
- id: vrt
  uses: netbrain/visual-regression-action@v1

- if: steps.vrt.outputs.has-diffs == 'true'
  run: echo "Changes detected!"
```

### Logs

Structured logging with groups:
- Each step in a collapsible group
- Debug info for troubleshooting
- Clear success/failure messages

### Failure Modes

Graceful degradation:
- Can't fetch base? Skip comparison
- Can't post comment? Still commit
- Can't commit? Still show output
- Can't upload to _ci? Use artifacts

## Maintenance

### Dependencies

- **Playwright**: Update Dockerfile base image
- **odiff**: Pinned version in Dockerfile
- **Actions**: Dependabot for GitHub Actions
- **npm**: Regular security updates

### Versioning

- **Major**: Breaking changes to inputs/outputs
- **Minor**: New features, backward compatible
- **Patch**: Bug fixes only

Tags maintained:
- `v1.2.3` - Specific version
- `v1` - Latest v1.x.x (auto-updated)

This allows users to:
- Pin to specific version for stability
- Use major version for auto-updates
