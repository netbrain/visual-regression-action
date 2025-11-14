import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as github from '@actions/github';
import * as fs from 'fs/promises';
import * as path from 'path';
import { existsSync } from 'fs';
import { createHash } from 'crypto';

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
  imgbbApiKey: string;
  imgbbExpiration?: number;
}

type ActionInputs = CaptureInputs | CompareInputs;

export function getInputs(): ActionInputs {
  const mode = core.getInput('mode', { required: true }) as 'capture' | 'compare';

  if (mode === 'capture') {
    return {
      mode: 'capture',
      playwrightCommand: core.getInput('playwright-command') || 'npm test',
      workingDirectory: core.getInput('working-directory') || '.',
      screenshotDirectory: core.getInput('screenshot-directory') || 'screenshots',
      artifactName: core.getInput('artifact-name') || 'screenshots',
      installDeps: core.getBooleanInput('install-deps')
    };
  } else {
    const imgbbApiKey = core.getInput('imgbb-api-key', { required: true });
    const imgbbExpirationStr = core.getInput('imgbb-expiration');
    const imgbbExpiration = imgbbExpirationStr ? parseInt(imgbbExpirationStr) : undefined;

    return {
      mode: 'compare',
      githubToken: core.getInput('github-token', { required: true }),
      workingDirectory: core.getInput('working-directory') || '.',
      baseArtifact: core.getInput('base-artifact') || 'screenshots-base',
      prArtifact: core.getInput('pr-artifact') || 'screenshots-pr',
      postComment: core.getBooleanInput('post-comment'),
      diffThreshold: parseFloat(core.getInput('diff-threshold')) || 0.1,
      cropPadding: parseInt(core.getInput('crop-padding')) || 50,
      cropMinHeight: parseInt(core.getInput('crop-min-height')) || 300,
      failOnChanges: core.getBooleanInput('fail-on-changes'),
      imgbbApiKey,
      imgbbExpiration
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
  const imagesToUpload: { path: string; hash: string; url: string }[] = [];

  // Compare screenshots
  for (const file of prPngs) {
    const baseImg = path.join(baseDir, file);
    const newImg = path.join(prDir, file);
    const diffImg = path.join(diffsDir, `${path.parse(file).name}-diff.png`);

    // If base doesn't exist, it's a new screenshot
    if (!basePngs.includes(file)) {
      core.info(`New screenshot: ${file}`);
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
        const cropWidth = parseInt(bboxMatch[1]);
        const cropHeight = parseInt(bboxMatch[2]);
        const cropX = parseInt(bboxMatch[3]);
        const cropY = parseInt(bboxMatch[4]);

        // Calculate crop region with padding
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

        // Combine horizontally
        const combinedImg = path.join(diffsDir, `${path.parse(file).name}-combined.png`);
        await exec.exec('convert', [baseCrop, diffCrop, newCrop, '+append', combinedImg]);

        core.info(`Created combined image: ${combinedImg}`);

        // Prepare for upload to ImgBB (URL will be set after upload)
        const hash = await getFileHash(combinedImg);
        const filename = `${hash}.png`;

        imagesToUpload.push({
          path: combinedImg,
          hash: filename,
          url: '' // Will be populated by ImgBB upload
        });
      }
    }
  }

  core.setOutput('has-diffs', hasDiffs.toString());
  core.endGroup();

  // Post PR comment if requested
  let commentPosted = false;
  if (inputs.postComment && hasDiffs && imagesToUpload.length > 0) {
    core.startGroup('Posting PR comment');

    // Upload images to ImgBB
    core.info('Uploading diff images to ImgBB...');
    await uploadToImgBB(inputs.imgbbApiKey, imagesToUpload, inputs.imgbbExpiration);

    // Build comment
    let comment = `## 📸 Visual Regression Changes Detected\n\n`;

    for (const img of imagesToUpload) {
      const basename = path.basename(img.path, '-combined.png');
      comment += `<details>\n`;
      comment += `<summary>📄 <strong>${basename}.png</strong> (click to expand)</summary>\n\n`;
      comment += `<div align="center">\n`;
      comment += `  <table>\n`;
      comment += `    <tr><td><strong>Original</strong></td><td><strong>Diff</strong></td><td><strong>New</strong></td></tr>\n`;
      comment += `  </table>\n`;
      comment += `  <img src="${img.url}" alt="${basename} comparison" width="100%">\n`;
      comment += `</div>\n\n`;
      comment += `</details>\n\n`;
    }

    comment += `---\n\n`;
    comment += `*Images show full width with vertical cropping to the changed region (${inputs.cropPadding}px padding above/below, minimum ${inputs.cropMinHeight}px height).*`;

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

async function uploadToImgBB(
  apiKey: string,
  images: { path: string; hash: string; url: string }[],
  expiration?: number
): Promise<void> {
  core.info(`Uploading ${images.length} images to ImgBB...`);
  if (expiration) {
    core.info(`Images will expire after ${expiration} seconds (${Math.round(expiration / 86400)} days)`);
  } else {
    core.info('Images will be stored permanently');
  }

  for (const img of images) {
    try {
      const imageData = await fs.readFile(img.path);
      const base64Image = imageData.toString('base64');

      const params: Record<string, string> = {
        key: apiKey,
        image: base64Image,
        name: img.hash.replace('.png', '')
      };

      if (expiration) {
        params.expiration = expiration.toString();
      }

      const response = await fetch('https://api.imgbb.com/1/upload', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams(params)
      });

      if (!response.ok) {
        throw new Error(`ImgBB upload failed: ${response.statusText}`);
      }

      const data = await response.json() as any;

      // Update the URL to use ImgBB's URL
      img.url = data.data.url;
      core.info(`✅ Uploaded ${path.basename(img.path)} → ${img.url}`);
    } catch (error) {
      core.warning(`Failed to upload ${img.path} to ImgBB: ${error}`);
      throw error;
    }
  }
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
