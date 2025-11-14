import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as github from '@actions/github';
import * as fs from 'fs/promises';
import * as path from 'path';
import { existsSync } from 'fs';
import { createHash } from 'crypto';

interface ActionInputs {
  githubToken: string;
  playwrightCommand: string;
  workingDirectory: string;
  screenshotDirectory: string;
  baseBranch: string;
  commitScreenshots: boolean;
  postComment: boolean;
  useCiBranch: boolean;
  ciBranchName: string;
  diffThreshold: number;
  cropPadding: number;
  cropMinHeight: number;
  installDeps: boolean;
  failOnChanges: boolean;
  amendCommit: boolean;
}

function getInputs(): ActionInputs {
  return {
    githubToken: core.getInput('github-token', { required: true }),
    playwrightCommand: core.getInput('playwright-command', { required: true }),
    workingDirectory: core.getInput('working-directory') || '.',
    screenshotDirectory: core.getInput('screenshot-directory') || 'screenshots',
    baseBranch: core.getInput('base-branch') || process.env.GITHUB_BASE_REF || 'main',
    commitScreenshots: core.getBooleanInput('commit-screenshots'),
    postComment: core.getBooleanInput('post-comment'),
    useCiBranch: core.getBooleanInput('use-ci-branch'),
    ciBranchName: core.getInput('ci-branch-name') || '_ci',
    diffThreshold: parseFloat(core.getInput('diff-threshold')) || 0.1,
    cropPadding: parseInt(core.getInput('crop-padding')) || 50,
    cropMinHeight: parseInt(core.getInput('crop-min-height')) || 300,
    installDeps: core.getBooleanInput('install-deps'),
    failOnChanges: core.getBooleanInput('fail-on-changes'),
    amendCommit: core.getBooleanInput('amend-commit')
  };
}

async function run(): Promise<void> {
  try {
    const inputs = getInputs();
    const context = github.context;

    if (!context.payload.pull_request) {
      core.warning('This action is designed to run on pull requests');
      return;
    }

    const prNumber = context.payload.pull_request.number;
    const headRef = context.payload.pull_request.head.ref;
    const octokit = github.getOctokit(inputs.githubToken);

    // Change to working directory
    process.chdir(inputs.workingDirectory);
    core.info(`Working directory: ${process.cwd()}`);

    // Step 1: Install dependencies if requested
    if (inputs.installDeps) {
      core.startGroup('Installing dependencies');
      await exec.exec('npm', ['ci']);
      core.endGroup();
    }

    // Step 2: Fetch base branch screenshots for comparison
    core.startGroup('Fetching base branch screenshots');
    const screenshotBaseDirAbs = path.resolve(inputs.screenshotDirectory);
    const screenshotsBaseDir = path.join(process.cwd(), 'screenshots-base');
    await fs.mkdir(screenshotsBaseDir, { recursive: true });

    let hasBase = false;
    try {
      // Check if screenshots exist in base branch
      await exec.exec('git', ['fetch', 'origin', inputs.baseBranch]);
      const exitCode = await exec.exec('git', [
        'show',
        `origin/${inputs.baseBranch}:${inputs.screenshotDirectory}/`,
      ], { ignoreReturnCode: true });

      if (exitCode === 0) {
        // Checkout screenshots from base branch
        await exec.exec('git', [
          'checkout',
          `origin/${inputs.baseBranch}`,
          '--',
          inputs.screenshotDirectory
        ], { ignoreReturnCode: true });

        // Move to screenshots-base directory
        const screenshotDir = path.resolve(inputs.screenshotDirectory);
        if (existsSync(screenshotDir)) {
          const files = await fs.readdir(screenshotDir);
          for (const file of files) {
            if (file.endsWith('.png')) {
              await fs.rename(
                path.join(screenshotDir, file),
                path.join(screenshotsBaseDir, file)
              );
            }
          }
          hasBase = true;
        }
      }

      // Restore to PR branch state
      await exec.exec('git', [
        'checkout',
        headRef,
        '--',
        inputs.screenshotDirectory
      ], { ignoreReturnCode: true });
    } catch (error) {
      core.warning(`Failed to fetch base screenshots: ${error}`);
    }
    core.endGroup();

    // Step 3: Run Playwright tests to generate screenshots
    core.startGroup('Running Playwright tests');
    await exec.exec('bash', ['-c', inputs.playwrightCommand]);
    core.endGroup();

    // Step 4: Compare screenshots and generate diffs
    let hasDiffs = false;
    const diffsDir = path.join(screenshotBaseDirAbs, 'diffs');
    await fs.mkdir(diffsDir, { recursive: true });

    const imagesToUpload: { path: string; hash: string; url: string }[] = [];

    if (hasBase) {
      core.startGroup('Comparing screenshots and generating diffs');

      const screenshotFiles = await fs.readdir(screenshotBaseDirAbs);
      for (const file of screenshotFiles) {
        if (!file.endsWith('.png') || file.includes('diff')) continue;

        const newImg = path.join(screenshotBaseDirAbs, file);
        const baseImg = path.join(screenshotsBaseDir, file);

        if (!existsSync(baseImg)) {
          core.info(`New screenshot detected: ${file}`);
          continue;
        }

        // Get dimensions
        const baseDims = await getImageDimensions(baseImg);
        const newDims = await getImageDimensions(newImg);

        // Resize if dimensions differ
        if (baseDims.width !== newDims.width || baseDims.height !== newDims.height) {
          core.info(`Dimension mismatch for ${file}: base=${baseDims.width}x${baseDims.height} new=${newDims.width}x${newDims.height}`);

          const maxW = Math.max(baseDims.width, newDims.width);
          const maxH = Math.max(baseDims.height, newDims.height);

          await exec.exec('mogrify', [
            '-background', 'white',
            '-gravity', 'NorthWest',
            '-extent', `${maxW}x${maxH}`,
            baseImg
          ]);
          await exec.exec('mogrify', [
            '-background', 'white',
            '-gravity', 'NorthWest',
            '-extent', `${maxW}x${maxH}`,
            newImg
          ]);
        }

        // Generate diff with odiff
        const diffImg = path.join(diffsDir, `${path.parse(file).name}-diff.png`);
        const exitCode = await exec.exec('odiff', [
          baseImg,
          newImg,
          diffImg,
          '--threshold', inputs.diffThreshold.toString()
        ], { ignoreReturnCode: true });

        if (exitCode === 22) {
          core.info(`Visual changes detected in ${file}`);
          hasDiffs = true;

          // Get diff mask and crop regions
          const diffMask = path.join(diffsDir, `${path.parse(file).name}-diff-mask.png`);
          await exec.exec('odiff', [
            baseImg,
            newImg,
            diffMask,
            '--diff-mask',
            '--threshold', inputs.diffThreshold.toString(),
            '--antialiasing'
          ], { ignoreReturnCode: true });

          // Get bounding box of changes
          let output = '';
          await exec.exec('convert', [
            diffMask,
            '-alpha', 'extract',
            '-trim',
            '-format', '%wx%h+%X+%Y',
            'info:'
          ], {
            listeners: {
              stdout: (data: Buffer) => { output += data.toString(); }
            }
          });

          const bbox = output.trim();
          const match = bbox.match(/(\d+)x(\d+)\+(\d+)\+(\d+)/);

          if (match) {
            const [, width, height, x, y] = match.map(Number);
            const imgDims = await getImageDimensions(newImg);

            // Calculate crop with padding
            const yPad = Math.max(0, y - inputs.cropPadding);
            let heightWithPadding = height + inputs.cropPadding * 2;
            heightWithPadding = Math.max(heightWithPadding, inputs.cropMinHeight);

            // Ensure we don't exceed bounds
            const maxY = imgDims.height - heightWithPadding;
            const finalY = Math.min(yPad, Math.max(0, maxY));
            const finalHeight = Math.min(heightWithPadding, imgDims.height - finalY);

            const cropSpec = `${imgDims.width}x${finalHeight}+0+${finalY}`;

            // Crop all three images
            const baseCrop = path.join(diffsDir, `${path.parse(file).name}-base-crop.png`);
            const diffCrop = path.join(diffsDir, `${path.parse(file).name}-diff-crop.png`);
            const newCrop = path.join(diffsDir, `${path.parse(file).name}-new-crop.png`);
            const combined = path.join(diffsDir, `${path.parse(file).name}-combined.png`);

            await exec.exec('convert', [baseImg, '-crop', cropSpec, '+repage', baseCrop]);
            await exec.exec('convert', [diffImg, '-crop', cropSpec, '+repage', diffCrop]);
            await exec.exec('convert', [newImg, '-crop', cropSpec, '+repage', newCrop]);

            // Combine horizontally
            await exec.exec('convert', [baseCrop, diffCrop, newCrop, '+append', combined]);

            core.info(`Created combined image: ${combined}`);
          }

          await fs.unlink(diffMask).catch(() => {});
        } else if (exitCode === 0) {
          core.info(`No visual changes in ${file}`);
          await fs.unlink(diffImg).catch(() => {});
        }
      }
      core.endGroup();
    }

    // Step 5: Check for screenshot changes
    let hasChanges = false;
    try {
      let gitOutput = '';
      await exec.exec('git', ['status', '--porcelain', inputs.screenshotDirectory], {
        listeners: {
          stdout: (data: Buffer) => { gitOutput += data.toString(); }
        }
      });
      hasChanges = gitOutput.trim().length > 0;
    } catch (error) {
      core.warning(`Failed to check for changes: ${error}`);
    }

    // Step 6: Post PR comment with diffs
    let commentPosted = false;
    if (hasDiffs && inputs.postComment) {
      core.startGroup('Generating and posting PR comment');

      // Build comment markdown
      let comment = '## 📸 Visual Regression Changes Detected\n\n';

      const diffFiles = await fs.readdir(diffsDir);
      const combinedFiles = diffFiles.filter(f => f.endsWith('-combined.png'));

      for (const file of combinedFiles) {
        const basename = file.replace('-combined.png', '');
        const combinedPath = path.join(diffsDir, file);

        // Get image URL (upload to CI branch if enabled)
        let imageUrl = '';
        if (inputs.useCiBranch) {
          const hash = await getFileHash(combinedPath);
          const filename = `${hash}.png`;
          imageUrl = `https://raw.githubusercontent.com/${context.repo.owner}/${context.repo.repo}/${inputs.ciBranchName}/${filename}`;

          imagesToUpload.push({
            path: combinedPath,
            hash: filename,
            url: imageUrl
          });
        }

        comment += `<details>\n`;
        comment += `<summary>📄 <strong>${basename}.png</strong> (click to expand)</summary>\n\n`;
        comment += `<div align="center">\n`;
        comment += `  <table>\n`;
        comment += `    <tr><td><strong>Original</strong></td><td><strong>Diff</strong></td><td><strong>New</strong></td></tr>\n`;
        comment += `  </table>\n`;
        if (imageUrl) {
          comment += `  <img src="${imageUrl}" alt="${basename} comparison" width="100%">\n`;
        }
        comment += `</div>\n\n`;
        comment += `</details>\n\n`;
      }

      comment += `---\n\n`;
      comment += `*Images show full width with vertical cropping to the changed region (${inputs.cropPadding}px padding above/below, minimum ${inputs.cropMinHeight}px height). Full-page screenshots are available in \`${inputs.screenshotDirectory}/\` directory.*`;

      // Upload images to CI branch if needed
      if (inputs.useCiBranch && imagesToUpload.length > 0) {
        await uploadToCiBranch(inputs, imagesToUpload, prNumber);

        // Wait for CDN propagation
        core.info('Waiting 5 seconds for CDN propagation...');
        await new Promise(resolve => setTimeout(resolve, 5000));
      }

      // Post comment
      try {
        await octokit.rest.issues.createComment({
          owner: context.repo.owner,
          repo: context.repo.repo,
          issue_number: prNumber,
          body: comment
        });
        commentPosted = true;
        core.info('PR comment posted successfully');
      } catch (error) {
        core.warning(`Failed to post PR comment: ${error}`);
      }

      core.endGroup();
    }

    // Step 7: Commit screenshots if requested
    let screenshotsCommitted = false;
    if (hasChanges && inputs.commitScreenshots) {
      core.startGroup('Committing screenshots');

      try {
        // Remove diffs directory
        await exec.exec('rm', ['-rf', path.join(inputs.screenshotDirectory, 'diffs')]);

        // Configure git
        await exec.exec('git', ['config', '--local', 'user.email', 'github-actions[bot]@users.noreply.github.com']);
        await exec.exec('git', ['config', '--local', 'user.name', 'github-actions[bot]']);

        // Stash screenshots
        await exec.exec('git', ['stash', 'push', '-u', inputs.screenshotDirectory]);

        // Fetch and rebase
        await exec.exec('git', ['fetch', 'origin', headRef]);
        await exec.exec('git', ['rebase', `origin/${headRef}`]);

        // Restore screenshots
        await exec.exec('git', ['stash', 'pop']);

        // Stage screenshots
        await exec.exec('git', ['add', inputs.screenshotDirectory]);

        if (inputs.amendCommit) {
          // Get original commit info
          let originalMsg = '';
          let originalAuthor = '';

          await exec.exec('git', ['log', '-1', '--pretty=%B'], {
            listeners: {
              stdout: (data: Buffer) => { originalMsg += data.toString(); }
            }
          });

          await exec.exec('git', ['log', '-1', '--pretty=format:%an <%ae>'], {
            listeners: {
              stdout: (data: Buffer) => { originalAuthor += data.toString(); }
            }
          });

          // Amend commit
          await exec.exec('git', ['commit', '--amend', '--no-edit', `--author=${originalAuthor}`]);
        } else {
          // Create new commit
          await exec.exec('git', ['commit', '-m', 'Update visual regression screenshots']);
        }

        // Push
        await exec.exec('git', ['push', '--force-with-lease', 'origin', headRef]);

        screenshotsCommitted = true;
        core.info('Screenshots committed successfully');
      } catch (error) {
        core.warning(`Failed to commit screenshots: ${error}`);
      }

      core.endGroup();
    }

    // Set outputs
    core.setOutput('has-changes', hasChanges.toString());
    core.setOutput('has-diffs', hasDiffs.toString());
    core.setOutput('screenshots-committed', screenshotsCommitted.toString());
    core.setOutput('comment-posted', commentPosted.toString());

    // Fail if requested
    if (inputs.failOnChanges && hasDiffs) {
      core.setFailed('Visual changes detected');
    } else {
      core.info('✅ Visual regression testing complete');
    }

  } catch (error) {
    core.setFailed(`Action failed: ${error}`);
  }
}

async function getImageDimensions(imagePath: string): Promise<{ width: number; height: number }> {
  let output = '';
  await exec.exec('identify', ['-format', '%wx%h', imagePath], {
    listeners: {
      stdout: (data: Buffer) => { output += data.toString(); }
    }
  });

  const match = output.match(/(\d+)x(\d+)/);
  if (!match) {
    throw new Error(`Failed to get dimensions for ${imagePath}`);
  }

  return {
    width: parseInt(match[1]),
    height: parseInt(match[2])
  };
}

async function getFileHash(filePath: string): Promise<string> {
  const content = await fs.readFile(filePath);
  return createHash('sha256').update(content).digest('hex');
}

async function uploadToCiBranch(
  inputs: ActionInputs,
  images: { path: string; hash: string; url: string }[],
  prNumber: number
): Promise<void> {
  core.info(`Uploading ${images.length} images to ${inputs.ciBranchName} branch...`);

  const worktreeDir = `/tmp/_ci_worktree_${Date.now()}`;

  try {
    // Check if CI branch exists
    const exitCode = await exec.exec('git', [
      'ls-remote',
      '--heads',
      'origin',
      inputs.ciBranchName
    ], { ignoreReturnCode: true });

    if (exitCode === 0) {
      // Fetch existing branch
      await exec.exec('git', ['fetch', 'origin', `${inputs.ciBranchName}:${inputs.ciBranchName}`, '--depth=1']);
      await exec.exec('git', ['worktree', 'add', worktreeDir, inputs.ciBranchName]);
    } else {
      // Create new orphan branch
      await exec.exec('git', ['worktree', 'add', '--detach', worktreeDir]);
      process.chdir(worktreeDir);
      await exec.exec('git', ['checkout', '--orphan', inputs.ciBranchName]);
      await exec.exec('git', ['rm', '-rf', '.'], { ignoreReturnCode: true });

      // Create README
      const readme = `# CI Artifacts Storage

This branch stores content-addressed CI artifacts (visual regression diff images).

## Structure
- All images stored at root level
- Filenames: \`<sha256-hash>.<extension>\` (e.g., \`a3dbc947...png\`)
- Automatic deduplication via content addressing

## Retention
- Retention policy managed by cleanup workflow
- See \`.github/workflows/cleanup-ci-artifacts.yml\` for details
`;
      await fs.writeFile(path.join(worktreeDir, 'README.md'), readme);

      await exec.exec('git', ['add', 'README.md']);
      await exec.exec('git', ['config', 'user.name', 'github-actions[bot]']);
      await exec.exec('git', ['config', 'user.email', 'github-actions[bot]@users.noreply.github.com']);
      await exec.exec('git', ['commit', '-m', 'Initialize _ci branch for artifacts']);
      await exec.exec('git', ['push', 'origin', inputs.ciBranchName]);
    }

    // Copy images to worktree
    process.chdir(worktreeDir);
    await exec.exec('git', ['config', 'user.name', 'github-actions[bot]']);
    await exec.exec('git', ['config', 'user.email', 'github-actions[bot]@users.noreply.github.com']);

    for (const img of images) {
      await fs.copyFile(img.path, path.join(worktreeDir, img.hash));
      await exec.exec('git', ['add', img.hash]);
    }

    // Commit and push
    await exec.exec('git', ['commit', '-m', `Add ${images.length} artifacts for PR ${prNumber}`]);
    await exec.exec('git', ['push', 'origin', inputs.ciBranchName]);

    core.info(`✅ Uploaded ${images.length} images in single commit`);
  } finally {
    // Clean up worktree
    process.chdir('/');
    await exec.exec('git', ['worktree', 'remove', worktreeDir, '--force'], { ignoreReturnCode: true });
  }
}

run();
