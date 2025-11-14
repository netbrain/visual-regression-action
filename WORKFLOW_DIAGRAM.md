# Workflow Diagrams

## Visual Regression Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                      PR Opened/Updated                           │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│              Checkout PR Branch (fetch-depth: 0)                 │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│            Install Dependencies (optional)                       │
│            npm ci                                                │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│         Fetch Base Branch Screenshots                            │
│         - git checkout origin/main -- screenshots/              │
│         - Move to screenshots-base/                              │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│           Run Playwright Tests                                   │
│           Execute: playwright-command                            │
│           Output: screenshots/*.png                              │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│           Compare Screenshots                                    │
│           For each screenshot:                                   │
│           1. Check dimensions match                              │
│           2. Resize if needed (extend canvas)                    │
│           3. Run odiff comparison                                │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ├─── No changes ───────────────────┐
                         │                                   │
                         ▼                                   │
                    Has changes?                             │
                         │                                   │
                         ├─── Yes                            │
                         │                                   │
                         ▼                                   │
┌─────────────────────────────────────────────────────────────────┐
│           Generate Visual Diffs                                  │
│           1. Create diff image (odiff)                           │
│           2. Create diff mask                                    │
│           3. Calculate bounding box                              │
│           4. Crop with padding                                   │
│           5. Combine: base | diff | new                          │
└────────────────────────┬────────────────────────────────────────┘
                         │                                   │
                         ▼                                   │
┌─────────────────────────────────────────────────────────────────┐
│      Upload to _ci Branch (if enabled)                           │
│      1. Calculate SHA256 hash                                    │
│      2. Check if exists in _ci                                   │
│      3. Upload if new                                            │
└────────────────────────┬────────────────────────────────────────┘
                         │                                   │
                         ▼                                   │
┌─────────────────────────────────────────────────────────────────┐
│         Post PR Comment (if enabled)                             │
│         - Expandable sections per screenshot                     │
│         - Side-by-side comparison                                │
│         - Links to full-res images                               │
└────────────────────────┬────────────────────────────────────────┘
                         │                                   │
                         ▼                                   │
┌─────────────────────────────────────────────────────────────────┐
│       Commit Screenshots (if enabled)                            │
│       1. Stash changes                                           │
│       2. Fetch and rebase onto latest PR                         │
│       3. Pop stash                                               │
│       4. Commit (amend or new)                                   │
│       5. Force-push with lease                                   │
└────────────────────────┬────────────────────────────────────────┘
                         │                                   │
                         ▼                                   ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Set Outputs                                  │
│                     - has-changes                                │
│                     - has-diffs                                  │
│                     - screenshots-committed                      │
│                     - comment-posted                             │
└─────────────────────────────────────────────────────────────────┘
```

## CI Branch Artifact Storage Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                  Diff Image Generated                            │
│                  (combined.png)                                  │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│              Calculate SHA256 Hash                               │
│              hash = sha256(combined.png)                         │
│              filename = {hash}.png                               │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│              Check if Exists in _ci Branch                       │
│              git ls-tree _ci | grep {hash}.png                   │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ├─── Exists ──────────────────┐
                         │                              │
                         ▼                              │
                    Not exists?                         │
                         │                              │
                         ├─── Yes                       │
                         │                              │
                         ▼                              │
┌─────────────────────────────────────────────────────────────────┐
│              Queue for Upload                                    │
│              images_to_upload.push({                             │
│                path: combined.png,                               │
│                hash: {hash}.png,                                 │
│                url: raw.githubusercontent.com/.../_{hash}.png   │
│              })                                                  │
└────────────────────────┬────────────────────────────────────────┘
                         │                              │
                         ▼                              │
┌─────────────────────────────────────────────────────────────────┐
│           Create Worktree for _ci Branch                         │
│           git worktree add /tmp/_ci_worktree _ci                 │
└────────────────────────┬────────────────────────────────────────┘
                         │                              │
                         ▼                              │
┌─────────────────────────────────────────────────────────────────┐
│           Copy All Queued Images                                 │
│           cp combined.png /tmp/_ci_worktree/{hash}.png           │
└────────────────────────┬────────────────────────────────────────┘
                         │                              │
                         ▼                              │
┌─────────────────────────────────────────────────────────────────┐
│           Commit and Push in Single Commit                       │
│           git add {hash}.png                                     │
│           git commit -m "Add N artifacts for PR #X"              │
│           git push origin _ci                                    │
└────────────────────────┬────────────────────────────────────────┘
                         │                              │
                         ▼                              │
┌─────────────────────────────────────────────────────────────────┐
│           Wait for CDN Propagation (5s)                          │
└────────────────────────┬────────────────────────────────────────┘
                         │                              │
                         ▼                              ▼
┌─────────────────────────────────────────────────────────────────┐
│           Return URL for PR Comment                              │
│           https://raw.githubusercontent.com/                     │
│             owner/repo/_ci/{hash}.png                            │
└─────────────────────────────────────────────────────────────────┘
```

## Diff Generation and Cropping Flow

```
┌─────────────────────────────────────────────────────────────────┐
│            Base Screenshot      New Screenshot                   │
│            (from main)          (from PR)                        │
└───────────────┬──────────────────────┬──────────────────────────┘
                │                      │
                └──────────┬───────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                 Check Dimensions                                 │
│                 base: 1920x1080                                  │
│                 new:  1920x1200                                  │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
                    Dimensions match?
                         │
                         ├─── No ──────────────────────┐
                         │                              │
                         ▼                              │
┌─────────────────────────────────────────────────────────────────┐
│            Extend Canvas to Max Dimensions                       │
│            max_width = max(1920, 1920) = 1920                    │
│            max_height = max(1080, 1200) = 1200                   │
│                                                                  │
│            mogrify -background white -gravity NorthWest \        │
│              -extent 1920x1200 base.png                          │
│            mogrify -background white -gravity NorthWest \        │
│              -extent 1920x1200 new.png                           │
└────────────────────────┬────────────────────────────────────────┘
                         │                              │
                         ▼                              │
┌─────────────────────────────────────────────────────────────────┐
│              Generate Diff with odiff                            │
│              odiff base.png new.png diff.png \                   │
│                --threshold 0.1                                   │
│                                                                  │
│              Exit code:                                          │
│              - 0  = identical                                    │
│              - 22 = pixel differences                            │
│              - 21 = layout difference                            │
└────────────────────────┬────────────────────────────────────────┘
                         │                              │
                         ▼                              │
                    Exit code == 22?                    │
                         │                              │
                         ├─── Yes                       │
                         │                              │
                         ▼                              │
┌─────────────────────────────────────────────────────────────────┐
│              Generate Diff Mask                                  │
│              odiff base.png new.png mask.png \                   │
│                --diff-mask --antialiasing                        │
└────────────────────────┬────────────────────────────────────────┘
                         │                              │
                         ▼                              │
┌─────────────────────────────────────────────────────────────────┐
│              Calculate Bounding Box                              │
│              convert mask.png -alpha extract -trim \             │
│                -format "%wx%h+%X+%Y" info:                       │
│                                                                  │
│              Output: 800x400+100+500                             │
│              (width x height + X + Y)                            │
└────────────────────────┬────────────────────────────────────────┘
                         │                              │
                         ▼                              │
┌─────────────────────────────────────────────────────────────────┐
│              Apply Padding and Min Height                        │
│              Y_pad = max(0, Y - padding)                         │
│              Y_pad = max(0, 500 - 50) = 450                      │
│                                                                  │
│              H_pad = H + 2 * padding                             │
│              H_pad = 400 + 2 * 50 = 500                          │
│                                                                  │
│              H_final = max(H_pad, min_height)                    │
│              H_final = max(500, 300) = 500                       │
│                                                                  │
│              Crop spec: 1920x500+0+450                           │
│              (full width, cropped height, no X crop)             │
└────────────────────────┬────────────────────────────────────────┘
                         │                              │
                         ▼                              │
┌─────────────────────────────────────────────────────────────────┐
│              Crop All Three Images                               │
│              convert base.png -crop 1920x500+0+450 base-crop.png│
│              convert diff.png -crop 1920x500+0+450 diff-crop.png│
│              convert new.png -crop 1920x500+0+450 new-crop.png  │
└────────────────────────┬────────────────────────────────────────┘
                         │                              │
                         ▼                              │
┌─────────────────────────────────────────────────────────────────┐
│              Combine Horizontally                                │
│              convert base-crop.png diff-crop.png new-crop.png \  │
│                +append combined.png                              │
│                                                                  │
│              Result: [Base | Diff | New]                         │
│              Width: 1920 * 3 = 5760                              │
│              Height: 500                                         │
└────────────────────────┬────────────────────────────────────────┘
                         │                              │
                         ▼                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              Upload to _ci Branch                                │
│              Post in PR Comment                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Screenshot Commit Flow

```
┌─────────────────────────────────────────────────────────────────┐
│              Screenshots Modified in Working Dir                 │
│              git status shows: M screenshots/*.png               │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│              Stash Screenshot Changes                            │
│              git stash push -u screenshots/                      │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│              Fetch Latest PR State                               │
│              git fetch origin ${{ github.head_ref }}             │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│              Rebase onto Latest                                  │
│              git rebase origin/${{ github.head_ref }}            │
│                                                                  │
│              Ensures we're on top of any new commits             │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│              Restore Screenshots                                 │
│              git stash pop                                       │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│              Commit Mode?                                        │
│              amend-commit: true/false                            │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ├─── amend = true ────────────┐
                         │                              │
                         ▼                              │
┌─────────────────────────────────────────────────────────────────┐
│         Get Original Commit Info                                 │
│         msg = git log -1 --pretty=%B                             │
│         author = git log -1 --pretty=format:"%an <%ae>"          │
└────────────────────────┬────────────────────────────────────────┘
                         │                              │
                         ▼                              │
┌─────────────────────────────────────────────────────────────────┐
│         Stage Screenshots                                        │
│         git add screenshots/                                     │
└────────────────────────┬────────────────────────────────────────┘
                         │                              │
                         ▼                              │
┌─────────────────────────────────────────────────────────────────┐
│         Amend Commit                   │    Create New Commit    │
│         git commit --amend \           │    git commit -m \      │
│           --no-edit \                  │      "Update visual..." │
│           --author="$author"           │                         │
└────────────────────────┬───────────────┴─────────────────────────┘
                         │                              │
                         ▼                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              Force Push with Lease                               │
│              git push --force-with-lease \                       │
│                origin ${{ github.head_ref }}                     │
│                                                                  │
│              --force-with-lease ensures:                         │
│              - Only pushes if remote matches expected state      │
│              - Prevents accidental overwrites                    │
│              - Safe for rebasing workflows                       │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│              PR Updated                                          │
│              - New commit with screenshots                       │
│              - GitHub shows image diffs                          │
│              - Workflow re-runs (if configured)                  │
└─────────────────────────────────────────────────────────────────┘
```

## Release Workflow Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                 Push to Main Branch                              │
│                 (action code or package.json changed)            │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│              Build Action (if needed)                            │
│              npm run build                                       │
│              Commit dist/ if changed                             │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│              Get Version from package.json                       │
│              VERSION = require('./package.json').version         │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│              Check if Tag Exists                                 │
│              git rev-parse v$VERSION                             │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ├─── Exists ──────────────────┐
                         │                              │
                         ▼                              │
                    Tag exists?                         │
                         │                              │
                         ├─── No → Create release       │
                         │                              │
                         ▼                              │
┌─────────────────────────────────────────────────────────────────┐
│         Analyze Commits for Version Bump                         │
│         LAST_TAG = git describe --tags --abbrev=0                │
│         COMMITS = git log $LAST_TAG..HEAD --pretty="%s"          │
│                                                                  │
│         Pattern matching:                                        │
│         - feat!: → major bump                                    │
│         - feat:  → minor bump                                    │
│         - fix:   → patch bump                                    │
└────────────────────────┬────────────────────────────────────────┘
                         │                              │
                         ▼                              │
                    Need bump?                          │
                         │                              │
                         ├─── Yes                       │
                         │                              │
                         ▼                              │
┌─────────────────────────────────────────────────────────────────┐
│              Bump Version                                        │
│              npm version [major|minor|patch]                     │
│              git push && git push --tags                         │
└────────────────────────┬────────────────────────────────────────┘
                         │                              │
                         ▼                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              Create/Update Major Version Tag                     │
│              MAJOR = version.split('.')[0]                       │
│              git tag -fa v$MAJOR                                 │
│              git push origin v$MAJOR --force                     │
│                                                                  │
│              Example: v1.2.3 → v1 tag                            │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│              Generate Changelog                                  │
│              git log $LAST_TAG..HEAD \                           │
│                --pretty="- %s (%h)" --no-merges                  │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│              Create GitHub Release                               │
│              gh release create v$VERSION \                       │
│                --title "v$VERSION" \                             │
│                --notes "$CHANGELOG"                              │
└─────────────────────────────────────────────────────────────────┘
```

## Showcase PR Maintenance Flow

```
┌─────────────────────────────────────────────────────────────────┐
│           Push to Main (action or example changed)               │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│              Check if Showcase Branch Exists                     │
│              git ls-remote --heads origin showcase-example       │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ├─── Exists ──────────────────┐
                         │                              │
                         ▼                              │
                    Branch exists?                      │
                         │                              │
                         ├─── No                        │
                         │                              │
                         ▼                              │
┌─────────────────────────────────────────────────────────────────┐
│         Create New Branch                                        │
│         git checkout -b showcase-example                         │
│         echo "<!-- Showcase -->" >> example/index.html           │
│         git add example/index.html                               │
│         git commit -m "Add showcase visual change"               │
│         git push origin showcase-example                         │
└────────────────────────┬────────────────────────────────────────┘
                         │                              │
                         ▼                              │
┌─────────────────────────────────────────────────────────────────┐
│         Rebase Branch onto Main             │                    │
│         git fetch origin showcase-example   │                    │
│         git checkout showcase-example       │                    │
│         git rebase origin/main              │                    │
│         git push --force-with-lease         │                    │
└────────────────────────┬────────────────────┘                    │
                         │                                         │
                         ▼                                         │
┌─────────────────────────────────────────────────────────────────┐
│              Check if PR Exists                                  │
│              gh pr list --head showcase-example \                │
│                --base main --json number                         │
└────────────────────────┬────────────────────────────────────────┘
                         │                              │
                         ├─── Exists ──────────────────┐│
                         │                              ││
                         ▼                              ││
                    PR exists?                          ││
                         │                              ││
                         ├─── No                        ││
                         │                              ││
                         ▼                              ││
┌─────────────────────────────────────────────────────────────────┐
│         Create PR                   │    Update PR Description   │
│         gh pr create \              │    gh pr edit $PR_NUMBER \ │
│           --title "Showcase..." \   │      --body "..."          │
│           --body "..." \            │                            │
│           --head showcase-example   │                            │
└────────────────────────┬────────────┴────────────────────────────┘
                         │                              │
                         ▼                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              Visual Regression Workflow Triggers                 │
│              - Runs on PR update                                 │
│              - Generates new screenshots                         │
│              - Posts updated diffs                               │
│              - Commits screenshots                               │
└─────────────────────────────────────────────────────────────────┘
```

## Cleanup Workflow Flow

```
┌─────────────────────────────────────────────────────────────────┐
│           Weekly Schedule (Sunday 00:00) or Manual Trigger       │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│              Checkout _ci Branch (full history)                  │
│              git checkout _ci --fetch-depth 0                    │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│              Calculate Cutoff Date                               │
│              RETENTION_DAYS = 30 (or workflow input)             │
│              CUTOFF = date -d "$RETENTION_DAYS days ago" +%s     │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│              Analyze Files                                       │
│              for FILE in *.png; do                               │
│                COMMIT_DATE = git log -1 --format=%ct -- $FILE    │
│                if [ $COMMIT_DATE -lt $CUTOFF ]; then             │
│                  DELETE_FILES++                                  │
│                  git rm $FILE                                    │
│                fi                                                │
│              done                                                │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
                   Any deletions?
                         │
                         ├─── No → Done
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│              Squash All Commits                                  │
│              COMMIT_COUNT = git rev-list --count HEAD            │
│              git checkout --orphan _ci-squashed-temp             │
│              git add -A                                          │
│              git commit -m "_ci cleanup"                         │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│              Force Push to _ci                                   │
│              git push -f origin HEAD:_ci                         │
│                                                                  │
│              Result: $COMMIT_COUNT commits → 1 commit            │
└─────────────────────────────────────────────────────────────────┘
```

## Key Design Patterns

### 1. Content-Addressed Storage
- Images named by SHA256 hash
- Same content = same filename = automatic deduplication
- No version control needed for artifacts

### 2. Git Worktrees
- Manage multiple branches without switching
- Parallel operations on different branches
- No risk of working directory contamination

### 3. Rebase-Before-Commit
- Always rebase onto latest PR state
- Prevents conflicts from concurrent updates
- Safe with force-with-lease

### 4. Graceful Degradation
- Each feature can fail independently
- Can't fetch base? Skip comparison
- Can't post comment? Still commit
- Can't commit? Still show output

### 5. Batch Operations
- Upload all images in single commit
- Combine cropping operations
- Minimize git operations

### 6. Idempotent Operations
- Running action multiple times = same result
- Content addressing prevents duplicates
- Safe to re-run on failures
