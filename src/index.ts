import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as github from '@actions/github';
import * as fs from 'fs/promises';
import * as path from 'path';
import { existsSync } from 'fs';
import { createHash } from 'crypto';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

interface CaptureInputs {
  mode: 'capture';
  playwrightCommand: string;
  workingDirectory: string;
  screenshotDirectory: string;
  artifactName: string;
  installDeps: boolean;
}

interface CompareInputs {
  mode: 'compare';
  githubToken: string;
  workingDirectory: string;
  baseArtifact: string;
  prArtifact: string;
  postComment: boolean;
  diffThreshold: number;
  cropPadding: number;
  cropMinHeight: number;
  failOnChanges: boolean;
  r2AccountId: string;
  r2AccessKeyId: string;
  r2SecretAccessKey: string;
  r2BucketName: string;
  r2PublicUrl: string;
  outputFormat: 'side-by-side' | 'animated-gif';
  gifFrameDelay: number;
  includeDiffInOutput: boolean;
}

type ActionInputs = CaptureInputs | CompareInputs;

// Helper function to parse boolean inputs more leniently
function parseBooleanInput(name: string, defaultValue: boolean = false): boolean {
  const value = core.getInput(name);
  if (!value) return defaultValue;
  return value.toLowerCase() === 'true';
}

export function getInputs(): ActionInputs {
  const mode = core.getInput('mode', { required: true }) as 'capture' | 'compare';

  if (mode === 'capture') {
    return {
      mode: 'capture',
      playwrightCommand: core.getInput('playwright-command') || 'npm test',
      workingDirectory: core.getInput('working-directory') || '.',
      screenshotDirectory: core.getInput('screenshot-directory') || 'screenshots',
      artifactName: core.getInput('artifact-name') || 'screenshots',
      installDeps: parseBooleanInput('install-deps', true)
    };
  } else {
    return {
      mode: 'compare',
      githubToken: core.getInput('github-token'),
      workingDirectory: core.getInput('working-directory') || '.',
      baseArtifact: core.getInput('base-artifact') || 'screenshots-base',
      prArtifact: core.getInput('pr-artifact') || 'screenshots-pr',
      postComment: parseBooleanInput('post-comment', true),
      diffThreshold: parseFloat(core.getInput('diff-threshold')) || 0.1,
      cropPadding: parseInt(core.getInput('crop-padding')) || 50,
      cropMinHeight: parseInt(core.getInput('crop-min-height')) || 300,
      failOnChanges: parseBooleanInput('fail-on-changes', false),
      // R2 config is optional: without it the comparison still runs and the PR
      // comment is posted without hosted images (e.g. dependabot-triggered
      // runs, which don't receive the repository's Actions secrets).
      r2AccountId: core.getInput('r2-account-id'),
      r2AccessKeyId: core.getInput('r2-access-key-id'),
      r2SecretAccessKey: core.getInput('r2-secret-access-key'),
      r2BucketName: core.getInput('r2-bucket-name'),
      r2PublicUrl: core.getInput('r2-public-url'),
      outputFormat: (core.getInput('output-format') || 'side-by-side') as 'side-by-side' | 'animated-gif',
      gifFrameDelay: parseInt(core.getInput('gif-frame-delay')) || 1000,
      includeDiffInOutput: parseBooleanInput('include-diff-in-output', false)
    };
  }
}

export async function runCapture(inputs: CaptureInputs): Promise<void> {
  core.startGroup('Capture Mode - Taking screenshots');

  // Change to working directory
  process.chdir(inputs.workingDirectory);

  // Install dependencies if requested
  if (inputs.installDeps) {
    core.info('Installing dependencies...');
    await exec.exec('npm', ['ci']);

    // Install Playwright browsers matching the package.json version
    core.info('Installing Playwright browsers...');
    await exec.exec('npx', ['playwright', 'install', '--with-deps']);
  }

  // Run Playwright tests
  core.info(`Running Playwright tests: ${inputs.playwrightCommand}`);
  await exec.exec('bash', ['-c', inputs.playwrightCommand]);

  // Verify screenshots exist
  const screenshotDir = path.resolve(inputs.screenshotDirectory);
  if (!existsSync(screenshotDir)) {
    throw new Error(`Screenshot directory not found: ${screenshotDir}`);
  }

  const files = await fs.readdir(screenshotDir);
  const pngFiles = files.filter(f => f.endsWith('.png'));

  if (pngFiles.length === 0) {
    throw new Error(`No .png files found in ${screenshotDir}`);
  }

  core.info(`Found ${pngFiles.length} screenshot(s): ${pngFiles.join(', ')}`);

  // Upload as artifact (GitHub Actions will handle this via actions/upload-artifact)
  core.info(`Screenshots ready for upload as artifact: ${inputs.artifactName}`);
  core.setOutput('screenshot-count', pngFiles.length.toString());
  core.setOutput('screenshot-directory', screenshotDir);

  core.endGroup();
}

export async function runCompare(inputs: CompareInputs): Promise<void> {
  const context = github.context;
  const octokit = github.getOctokit(inputs.githubToken);

  if (!context.payload.pull_request) {
    core.warning('Not running in a pull request context - skipping comparison');
    return;
  }

  const prNumber = context.payload.pull_request.number;

  core.startGroup('Compare Mode - Analyzing screenshots');

  // Change to working directory
  process.chdir(inputs.workingDirectory);

  // Download artifacts (GitHub Actions downloads them to specific paths)
  const baseDir = path.resolve('screenshots-base');
  const prDir = path.resolve('screenshots-pr');
  const diffsDir = path.resolve('screenshots-diffs');

  // Create diffs directory
  await fs.mkdir(diffsDir, { recursive: true });

  // Get list of screenshots from both directories
  const baseFiles = existsSync(baseDir) ? await fs.readdir(baseDir) : [];
  const prFiles = existsSync(prDir) ? await fs.readdir(prDir) : [];

  const basePngs = baseFiles.filter(f => f.endsWith('.png'));
  const prPngs = prFiles.filter(f => f.endsWith('.png'));

  core.info(`Base screenshots: ${basePngs.length}`);
  core.info(`PR screenshots: ${prPngs.length}`);

  if (prPngs.length === 0) {
    throw new Error('No screenshots found in PR artifact');
  }

  let hasDiffs = false;
  const imagesToUpload: { path: string; hash: string; url: string; isNew?: boolean; isDeleted?: boolean }[] = [];
  const deletedScreenshots: string[] = [];

  // Compare screenshots
  for (const file of prPngs) {
    const baseImg = path.join(baseDir, file);
    const newImg = path.join(prDir, file);
    const diffImg = path.join(diffsDir, `${path.parse(file).name}-diff.png`);

    // If base doesn't exist, it's a new screenshot
    if (!basePngs.includes(file)) {
      core.info(`New screenshot: ${file}`);
      hasDiffs = true;

      // Upload the new screenshot so it can be viewed in PR
      const hash = await getFileHash(newImg);
      const filename = `${hash}.png`;

      imagesToUpload.push({
        path: newImg,
        hash: filename,
        url: '',
        isNew: true
      });
      continue;
    }

    // Get dimensions
    const baseDims = await getImageDimensions(baseImg);
    const newDims = await getImageDimensions(newImg);

    // Extend if dimensions don't match
    if (baseDims.width !== newDims.width || baseDims.height !== newDims.height) {
      core.info(`Extending canvases for ${file} (${baseDims.width}x${baseDims.height} vs ${newDims.width}x${newDims.height})`);
      const maxWidth = Math.max(baseDims.width, newDims.width);
      const maxHeight = Math.max(baseDims.height, newDims.height);

      await exec.exec('convert', [baseImg, '-gravity', 'northwest', '-extent', `${maxWidth}x${maxHeight}`, baseImg]);
      await exec.exec('convert', [newImg, '-gravity', 'northwest', '-extent', `${maxWidth}x${maxHeight}`, newImg]);
    }

    // Run odiff
    const exitCode = await exec.exec('odiff', [
      baseImg,
      newImg,
      diffImg,
      '--threshold', inputs.diffThreshold.toString()
    ], { ignoreReturnCode: true });

    if (exitCode === 22) {
      core.info(`Visual changes detected in ${file}`);
      hasDiffs = true;

      // Generate diff mask for cropping
      const diffMask = path.join(diffsDir, `${path.parse(file).name}-diff-mask.png`);
      await exec.exec('odiff', [
        baseImg,
        newImg,
        diffMask,
        '--diff-mask',
        '--threshold', inputs.diffThreshold.toString(),
        '--antialiasing'
      ], { ignoreReturnCode: true });

      // Check if diff mask was created (odiff with --diff-mask skips output if images are identical after antialiasing)
      if (!existsSync(diffMask)) {
        core.info(`Images are identical after antialiasing for ${file} - skipping diff processing`);
        continue;
      }

      // Get bounding box
      let bboxOutput = '';
      await exec.exec('convert', [
        diffMask,
        '-alpha', 'extract',
        '-trim',
        '-format', '%wx%h+%X+%Y',
        'info:'
      ], {
        listeners: {
          stdout: (data: Buffer) => { bboxOutput += data.toString(); }
        }
      });

      core.info(`Bbox output: ${bboxOutput}`);

      // Parse bbox (handle double plus signs like 1280x253++0++0)
      const bboxMatch = bboxOutput.match(/(\d+)x(\d+)\+?\+?(-?\d+)\+?\+?(-?\d+)/);

      if (bboxMatch) {
        core.info(`Match result: MATCHED`);
        const cropHeight = parseInt(bboxMatch[2]);
        const cropY = parseInt(bboxMatch[4]);

        // Calculate crop region with padding (full width, cropped vertically)
        const imgDims = await getImageDimensions(newImg);
        const finalHeight = Math.max(cropHeight + (inputs.cropPadding * 2), inputs.cropMinHeight);
        const finalY = Math.max(0, cropY - inputs.cropPadding);

        const cropGeometry = `${imgDims.width}x${finalHeight}+0+${finalY}`;
        core.info(`Cropping to: ${cropGeometry}`);

        // Crop all three images
        const baseCrop = path.join(diffsDir, `${path.parse(file).name}-base-crop.png`);
        const diffCrop = path.join(diffsDir, `${path.parse(file).name}-diff-crop.png`);
        const newCrop = path.join(diffsDir, `${path.parse(file).name}-new-crop.png`);

        await exec.exec('convert', [baseImg, '-crop', cropGeometry, '+repage', baseCrop]);
        await exec.exec('convert', [diffImg, '-crop', cropGeometry, '+repage', diffCrop]);
        await exec.exec('convert', [newImg, '-crop', cropGeometry, '+repage', newCrop]);

        // Create output based on format
        let outputPath: string;
        let outputExt: string;

        // Build frame list based on includeDiffInOutput
        const frames = inputs.includeDiffInOutput
          ? [baseCrop, diffCrop, newCrop]  // base → diff → new
          : [baseCrop, newCrop];  // base → new only

        if (inputs.outputFormat === 'animated-gif') {
          // Create animated GIF
          outputPath = path.join(diffsDir, `${path.parse(file).name}-animated.gif`);
          outputExt = '.gif';

          // Convert milliseconds to centiseconds (ImageMagick delay unit)
          const delayCentiseconds = Math.round(inputs.gifFrameDelay / 10);

          core.info(`Creating animated GIF with ${inputs.gifFrameDelay}ms delay per frame (${inputs.includeDiffInOutput ? 'base → diff → new' : 'base → new'})`);
          await exec.exec('convert', [
            '-delay', delayCentiseconds.toString(),
            '-loop', '0',
            ...frames,
            outputPath
          ]);
        } else {
          // Combine horizontally (side-by-side)
          outputPath = path.join(diffsDir, `${path.parse(file).name}-combined.png`);
          outputExt = '.png';

          await exec.exec('convert', [...frames, '+append', outputPath]);
        }

        core.info(`Created ${inputs.outputFormat} image: ${outputPath}`);

        // Prepare for upload to R2
        const hash = await getFileHash(outputPath);
        const filename = `${hash}${outputExt}`;

        imagesToUpload.push({
          path: outputPath,
          hash: filename,
          url: '' // Will be populated by R2 upload
        });
      }
    }
  }

  // Check for deleted screenshots (exist in base but not in PR)
  for (const file of basePngs) {
    if (!prPngs.includes(file)) {
      core.info(`Deleted screenshot: ${file}`);
      hasDiffs = true;
      deletedScreenshots.push(file);

      // Upload the deleted screenshot from base so reviewers can see what was removed
      const baseImg = path.join(baseDir, file);
      const hash = await getFileHash(baseImg);
      const filename = `${hash}.png`;

      imagesToUpload.push({
        path: baseImg,
        hash: filename,
        url: '',
        isDeleted: true
      });
    }
  }

  core.setOutput('has-diffs', hasDiffs.toString());
  core.endGroup();

  // Post PR comment if requested
  let commentPosted = false;
  if (inputs.postComment && hasDiffs && (imagesToUpload.length > 0 || deletedScreenshots.length > 0)) {
    core.startGroup('Posting PR comment');

    // Upload images to R2 when configured. Upload problems must not fail the
    // job: the comparison verdict is already computed and image hosting is
    // auxiliary, so degrade to a comment without images instead.
    let imagesAvailable = false;
    if (imagesToUpload.length > 0) {
      if (hasR2Config(inputs)) {
        try {
          core.info('Uploading diff images to Cloudflare R2...');
          await uploadToR2(inputs, imagesToUpload);
          imagesAvailable = true;
        } catch (error) {
          core.warning(`R2 upload failed - posting comment without images: ${error}`);
        }
      } else {
        core.info('R2 not configured - posting comment without hosted images');
      }
    }

    // Build comment
    let comment = `## 📸 Visual Regression Changes Detected\n\n`;

    // Separate screenshots by type
    const newScreenshots = imagesToUpload.filter(img => img.isNew);
    const deletedScreenshotsWithImages = imagesToUpload.filter(img => img.isDeleted);
    const modifiedScreenshots = imagesToUpload.filter(img => !img.isNew && !img.isDeleted);

    // Show modified screenshots
    if (modifiedScreenshots.length > 0) {
      comment += `### 🔄 Modified Screenshots (${modifiedScreenshots.length})\n\n`;
      for (const img of modifiedScreenshots) {
        // Handle both .png and .gif extensions
        const ext = path.extname(img.path);
        const basename = path.basename(img.path, ext === '.gif' ? '-animated.gif' : '-combined.png');
        comment += renderScreenshotEntry(img, basename, `${basename} comparison`);
      }
    }

    // Show new screenshots
    if (newScreenshots.length > 0) {
      comment += `### 🆕 New Screenshots (${newScreenshots.length})\n\n`;
      comment += `*These screenshots were added in this PR (not present in the base branch)*\n\n`;
      for (const img of newScreenshots) {
        const basename = path.basename(img.path, '.png');
        comment += renderScreenshotEntry(img, basename, basename);
      }
    }

    // Show deleted screenshots
    if (deletedScreenshotsWithImages.length > 0) {
      comment += `### 🗑️ Deleted Screenshots (${deletedScreenshotsWithImages.length})\n\n`;
      comment += `*These screenshots were removed in this PR (present in base branch but not in this PR)*\n\n`;
      for (const img of deletedScreenshotsWithImages) {
        const basename = path.basename(img.path, '.png');
        comment += renderScreenshotEntry(img, basename, basename);
      }
    }

    comment += `---\n\n`;
    if (imagesToUpload.length > 0 && !imagesAvailable) {
      comment += `*Diff images are not available for this run (R2 upload not configured or failed). Run the visual test suite locally to inspect the changes.*\n\n`;
    }
    comment += `*Modified images show visual diffs with cropping to the changed region (${inputs.cropPadding}px padding above/below, minimum ${inputs.cropMinHeight}px height).*`;

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

  core.setOutput('comment-posted', commentPosted.toString());

  // Fail if requested
  if (inputs.failOnChanges && hasDiffs) {
    core.setFailed('Visual changes detected');
  }

  core.info('✅ Visual regression comparison complete');
}

export async function getImageDimensions(imagePath: string): Promise<{ width: number; height: number }> {
  let output = '';
  await exec.exec('identify', ['-format', '%wx%h', imagePath], {
    listeners: {
      stdout: (data: Buffer) => { output += data.toString(); }
    }
  });

  const match = output.match(/(\d+)x(\d+)/);
  if (!match) {
    throw new Error(`Failed to parse image dimensions from: ${output}`);
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

// hasR2Config reports whether all R2 inputs are present. Partial config is
// treated as absent: a wrong endpoint fails slower and noisier than no upload.
function hasR2Config(inputs: CompareInputs): boolean {
  return Boolean(
    inputs.r2AccountId &&
    inputs.r2AccessKeyId &&
    inputs.r2SecretAccessKey &&
    inputs.r2BucketName &&
    inputs.r2PublicUrl
  );
}

// renderScreenshotEntry renders one screenshot section of the PR comment.
// Entries without a hosted URL (upload skipped or failed) degrade to a plain
// listing instead of a broken <img> tag.
function renderScreenshotEntry(
  img: { path: string; url: string },
  basename: string,
  alt: string
): string {
  if (!img.url) {
    return `- 📄 **${basename}.png** *(diff image not available)*\n`;
  }
  let entry = `<details>\n`;
  entry += `<summary>📄 <strong>${basename}.png</strong> (click to expand)</summary>\n\n`;
  entry += `<div align="center">\n`;
  entry += `  <img src="${img.url}" alt="${alt}" width="100%">\n`;
  entry += `</div>\n\n`;
  entry += `</details>\n\n`;
  return entry;
}

async function uploadToR2(
  inputs: CompareInputs,
  images: { path: string; hash: string; url: string }[]
): Promise<void> {
  core.info(`Uploading ${images.length} images to Cloudflare R2...`);

  // Create S3 client for R2
  const s3Client = new S3Client({
    region: 'auto',
    endpoint: `https://${inputs.r2AccountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: inputs.r2AccessKeyId,
      secretAccessKey: inputs.r2SecretAccessKey
    }
  });

  // Group images by hash to deduplicate uploads
  const imagesByHash = new Map<string, { path: string; hash: string; url: string }[]>();
  for (const img of images) {
    if (!imagesByHash.has(img.hash)) {
      imagesByHash.set(img.hash, []);
    }
    imagesByHash.get(img.hash)!.push(img);
  }

  const uniqueHashes = imagesByHash.size;
  const duplicateCount = images.length - uniqueHashes;

  if (duplicateCount > 0) {
    core.info(`Found ${duplicateCount} duplicate(s). Uploading ${uniqueHashes} unique image(s) instead of ${images.length}.`);
  }

  // Upload only unique hashes in parallel
  const results = await Promise.allSettled(
    Array.from(imagesByHash.entries()).map(async ([hash, imgs]) => {
      // Upload the first image with this hash
      const firstImg = imgs[0];
      const imageData = await fs.readFile(firstImg.path);
      const key = `${hash}`;

      // Determine content type based on file extension
      const contentType = hash.endsWith('.gif') ? 'image/gif' : 'image/png';

      const command = new PutObjectCommand({
        Bucket: inputs.r2BucketName,
        Key: key,
        Body: imageData,
        ContentType: contentType
      });

      await s3Client.send(command);

      // Update URL for all images sharing this hash
      const url = `${inputs.r2PublicUrl}/${key}`;
      for (const img of imgs) {
        img.url = url;
      }

      const fileNames = imgs.map(img => path.basename(img.path)).join(', ');
      core.info(`✅ Uploaded ${hash} → ${url}`);
      if (imgs.length > 1) {
        core.info(`   Shared by ${imgs.length} files: ${fileNames}`);
      }

      return hash;
    })
  );

  // Check for failures
  const failures = results.filter(r => r.status === 'rejected');
  if (failures.length > 0) {
    failures.forEach((f, i) => {
      if (f.status === 'rejected') {
        core.error(`Upload ${i + 1} failed: ${f.reason}`);
      }
    });
    throw new Error(`${failures.length} of ${uniqueHashes} uploads failed`);
  }

  core.info(`Successfully uploaded ${uniqueHashes} unique image(s) to R2 (${images.length} total references)`);
}

export async function run(): Promise<void> {
  try {
    const inputs = getInputs();

    if (inputs.mode === 'capture') {
      await runCapture(inputs);
    } else {
      await runCompare(inputs);
    }
  } catch (error) {
    core.setFailed(`Action failed: ${error}`);
  }
}

run();
