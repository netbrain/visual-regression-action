import { getInputs, runCapture, runCompare } from '../src/index';
import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as github from '@actions/github';
import * as fs from 'fs/promises';

jest.mock('@actions/core');
jest.mock('@actions/exec');
jest.mock('@actions/github');
jest.mock('fs/promises', () => ({
  readdir: jest.fn(),
  mkdir: jest.fn(),
  readFile: jest.fn(),
  writeFile: jest.fn(),
  copyFile: jest.fn()
}));
jest.mock('fs');

const mockCore = core as jest.Mocked<typeof core>;
const mockExec = exec as jest.Mocked<typeof exec>;
const mockFs = fs as jest.Mocked<typeof fs>;

describe('Visual Regression Action', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Setup default mock implementations
    (mockCore.getInput as jest.Mock) = jest.fn();
    (mockCore.getBooleanInput as jest.Mock) = jest.fn();
    mockCore.setOutput = jest.fn();
    mockCore.setFailed = jest.fn();
    mockCore.warning = jest.fn();
    mockCore.info = jest.fn();
    mockCore.startGroup = jest.fn();
    mockCore.endGroup = jest.fn();

    (mockExec.exec as jest.Mock) = jest.fn().mockResolvedValue(0);
  });

  describe('getInputs', () => {
    it('should parse capture mode inputs', () => {
      (mockCore.getInput as jest.Mock).mockImplementation((name: string) => {
        const inputs: Record<string, string> = {
          'mode': 'capture',
          'playwright-command': 'npm run test:visual',
          'working-directory': './frontend',
          'screenshot-directory': 'screenshots',
          'artifact-name': 'screenshots-pr'
        };
        return inputs[name] || '';
      });

      (mockCore.getBooleanInput as jest.Mock).mockImplementation((name: string) => {
        return name === 'install-deps';
      });

      const inputs = getInputs();

      expect(inputs.mode).toBe('capture');
      if (inputs.mode === 'capture') {
        expect(inputs.playwrightCommand).toBe('npm run test:visual');
        expect(inputs.workingDirectory).toBe('./frontend');
        expect(inputs.screenshotDirectory).toBe('screenshots');
        expect(inputs.artifactName).toBe('screenshots-pr');
        expect(inputs.installDeps).toBe(true);
      }
    });

    it('should parse compare mode inputs', () => {
      (mockCore.getInput as jest.Mock).mockImplementation((name: string, options?: any) => {
        const inputs: Record<string, string> = {
          'mode': 'compare',
          'github-token': 'test-token',
          'base-artifact': 'screenshots-base',
          'pr-artifact': 'screenshots-pr',
          'r2-account-id': 'test-account-id',
          'r2-access-key-id': 'test-access-key',
          'r2-secret-access-key': 'test-secret',
          'r2-bucket-name': 'test-bucket',
          'r2-public-url': 'https://pub-test.r2.dev',
          'diff-threshold': '0.1',
          'crop-padding': '50',
          'crop-min-height': '300',
          'output-format': 'side-by-side',
          'gif-frame-delay': '1000'
        };
        return inputs[name] || '';
      });

      (mockCore.getBooleanInput as jest.Mock).mockImplementation((name: string) => {
        return name === 'post-comment' || name === 'include-diff-in-output';
      });

      const inputs = getInputs();

      expect(inputs.mode).toBe('compare');
      if (inputs.mode === 'compare') {
        expect(inputs.githubToken).toBe('test-token');
        expect(inputs.baseArtifact).toBe('screenshots-base');
        expect(inputs.prArtifact).toBe('screenshots-pr');
        expect(inputs.r2AccountId).toBe('test-account-id');
        expect(inputs.r2AccessKeyId).toBe('test-access-key');
        expect(inputs.r2SecretAccessKey).toBe('test-secret');
        expect(inputs.r2BucketName).toBe('test-bucket');
        expect(inputs.r2PublicUrl).toBe('https://pub-test.r2.dev');
        expect(inputs.diffThreshold).toBe(0.1);
        expect(inputs.cropPadding).toBe(50);
        expect(inputs.cropMinHeight).toBe(300);
        expect(inputs.postComment).toBe(true);
        expect(inputs.outputFormat).toBe('side-by-side');
        expect(inputs.gifFrameDelay).toBe(1000);
        expect(inputs.includeDiffInOutput).toBe(true);
      }
    });

    it('should use default values when not provided', () => {
      (mockCore.getInput as jest.Mock).mockImplementation((name: string) => {
        return name === 'mode' ? 'capture' : '';
      });

      (mockCore.getBooleanInput as jest.Mock).mockReturnValue(false);

      const inputs = getInputs();

      expect(inputs.mode).toBe('capture');
      if (inputs.mode === 'capture') {
        expect(inputs.playwrightCommand).toBe('npm test');
        expect(inputs.workingDirectory).toBe('.');
        expect(inputs.screenshotDirectory).toBe('screenshots');
        expect(inputs.artifactName).toBe('screenshots');
      }
    });
  });

  describe('runCapture', () => {
    it('should install dependencies when install-deps is true', async () => {
      const inputs = {
        mode: 'capture' as const,
        playwrightCommand: 'npm test',
        workingDirectory: '.',
        screenshotDirectory: 'screenshots',
        artifactName: 'screenshots',
        installDeps: true
      };

      const fsMock = require('fs');
      fsMock.existsSync = jest.fn().mockReturnValue(true);
      (mockFs.readdir as jest.Mock).mockResolvedValue(['test.png', 'test2.png']);

      await runCapture(inputs);

      expect(mockExec.exec).toHaveBeenCalledWith('npm', ['ci']);
    });

    it('should skip installing dependencies when install-deps is false', async () => {
      const inputs = {
        mode: 'capture' as const,
        playwrightCommand: 'npm test',
        workingDirectory: '.',
        screenshotDirectory: 'screenshots',
        artifactName: 'screenshots',
        installDeps: false
      };

      const fsMock = require('fs');
      fsMock.existsSync = jest.fn().mockReturnValue(true);
      (mockFs.readdir as jest.Mock).mockResolvedValue(['test.png']);

      await runCapture(inputs);

      const npmCiCalls = (mockExec.exec as jest.Mock).mock.calls.filter(
        call => call[0] === 'npm' && call[1]?.[0] === 'ci'
      );
      expect(npmCiCalls.length).toBe(0);
    });

    it('should run playwright tests', async () => {
      const inputs = {
        mode: 'capture' as const,
        playwrightCommand: 'npm run test:visual',
        workingDirectory: '.',
        screenshotDirectory: 'screenshots',
        artifactName: 'screenshots',
        installDeps: false
      };

      const fsMock = require('fs');
      fsMock.existsSync = jest.fn().mockReturnValue(true);
      (mockFs.readdir as jest.Mock).mockResolvedValue(['screenshot.png']);

      await runCapture(inputs);

      expect(mockExec.exec).toHaveBeenCalledWith('bash', ['-c', 'npm run test:visual']);
    });

    it('should throw error if screenshot directory not found', async () => {
      const inputs = {
        mode: 'capture' as const,
        playwrightCommand: 'npm test',
        workingDirectory: '.',
        screenshotDirectory: 'screenshots',
        artifactName: 'screenshots',
        installDeps: false
      };

      const fsMock = require('fs');
      fsMock.existsSync = jest.fn().mockReturnValue(false);

      await expect(runCapture(inputs)).rejects.toThrow('Screenshot directory not found');
    });

    it('should throw error if no PNG files found', async () => {
      const inputs = {
        mode: 'capture' as const,
        playwrightCommand: 'npm test',
        workingDirectory: '.',
        screenshotDirectory: 'screenshots',
        artifactName: 'screenshots',
        installDeps: false
      };

      const fsMock = require('fs');
      fsMock.existsSync = jest.fn().mockReturnValue(true);
      (mockFs.readdir as jest.Mock).mockResolvedValue(['readme.txt', 'index.html']);

      await expect(runCapture(inputs)).rejects.toThrow('No .png files found');
    });

    it('should set output with screenshot count and directory', async () => {
      const inputs = {
        mode: 'capture' as const,
        playwrightCommand: 'npm test',
        workingDirectory: '.',
        screenshotDirectory: 'screenshots',
        artifactName: 'screenshots',
        installDeps: false
      };

      const fsMock = require('fs');
      fsMock.existsSync = jest.fn().mockReturnValue(true);
      (mockFs.readdir as jest.Mock).mockResolvedValue(['test1.png', 'test2.png', 'test3.png']);

      await runCapture(inputs);

      expect(mockCore.setOutput).toHaveBeenCalledWith('screenshot-count', '3');
      expect(mockCore.setOutput).toHaveBeenCalledWith('screenshot-directory', expect.stringContaining('screenshots'));
    });
  });

  describe('runCompare', () => {
    beforeEach(() => {
      const mockContext = {
        payload: {
          pull_request: {
            number: 123,
            head: { ref: 'feature' },
            base: { ref: 'main' }
          }
        },
        repo: { owner: 'test', repo: 'test' }
      };

      Object.defineProperty(github, 'context', {
        get: () => mockContext,
        configurable: true
      });

      (github.getOctokit as jest.Mock) = jest.fn().mockReturnValue({
        rest: {
          issues: {
            createComment: jest.fn().mockResolvedValue({}),
            listComments: jest.fn().mockResolvedValue({ data: [] })
          }
        }
      });
    });

    it('should skip comparison if not in PR context', async () => {
      Object.defineProperty(github, 'context', {
        get: () => ({ payload: {} }),
        configurable: true
      });

      const inputs = {
        mode: 'compare' as const,
        githubToken: 'test-token',
        workingDirectory: '.',
        baseArtifact: 'screenshots-base',
        prArtifact: 'screenshots-pr',
        postComment: true,
        r2AccountId: 'test-account-id',
        r2AccessKeyId: 'test-access-key',
        r2SecretAccessKey: 'test-secret',
        r2BucketName: 'test-bucket',
        r2PublicUrl: 'https://pub-test.r2.dev',
        outputFormat: 'side-by-side' as const,
        gifFrameDelay: 1000,
        includeDiffInOutput: true,
        diffThreshold: 0.1,
        cropPadding: 50,
        cropMinHeight: 300,
        failOnChanges: false
      };

      await runCompare(inputs);

      expect(mockCore.warning).toHaveBeenCalledWith(expect.stringContaining('pull request context'));
    });

    it('should set has-diffs output to false when no differences found', async () => {
      const inputs = {
        mode: 'compare' as const,
        githubToken: 'test-token',
        workingDirectory: '.',
        baseArtifact: 'screenshots-base',
        prArtifact: 'screenshots-pr',
        postComment: true,
        r2AccountId: 'test-account-id',
        r2AccessKeyId: 'test-access-key',
        r2SecretAccessKey: 'test-secret',
        r2BucketName: 'test-bucket',
        r2PublicUrl: 'https://pub-test.r2.dev',
        outputFormat: 'side-by-side' as const,
        gifFrameDelay: 1000,
        includeDiffInOutput: true,
        diffThreshold: 0.1,
        cropPadding: 50,
        cropMinHeight: 300,
        failOnChanges: false
      };

      const fsMock = require('fs');
      fsMock.existsSync = jest.fn().mockReturnValue(true);
      (mockFs.readdir as jest.Mock)
        .mockResolvedValueOnce(['test.png']) // base dir
        .mockResolvedValueOnce(['test.png']); // pr dir

      (mockExec.exec as jest.Mock).mockImplementation((cmd, args, options) => {
        if (cmd === 'identify') {
          const stdout = options?.listeners?.stdout;
          if (stdout) stdout(Buffer.from('1280x720'));
          return Promise.resolve(0);
        }
        if (cmd === 'odiff') {
          return Promise.resolve(0); // No differences
        }
        return Promise.resolve(0);
      });

      await runCompare(inputs);

      expect(mockCore.setOutput).toHaveBeenCalledWith('has-diffs', 'false');
    });

    it('should detect new screenshots', async () => {
      const inputs = {
        mode: 'compare' as const,
        githubToken: 'test-token',
        workingDirectory: '.',
        baseArtifact: 'screenshots-base',
        prArtifact: 'screenshots-pr',
        postComment: false, // Disable comment posting to avoid R2 upload
        r2AccountId: 'test-account-id',
        r2AccessKeyId: 'test-access-key',
        r2SecretAccessKey: 'test-secret',
        r2BucketName: 'test-bucket',
        r2PublicUrl: 'https://pub-test.r2.dev',
        outputFormat: 'side-by-side' as const,
        gifFrameDelay: 1000,
        includeDiffInOutput: true,
        diffThreshold: 0.1,
        cropPadding: 50,
        cropMinHeight: 300,
        failOnChanges: false
      };

      const fsMock = require('fs');
      fsMock.existsSync = jest.fn().mockReturnValue(true);
      (mockFs.readdir as jest.Mock)
        .mockResolvedValueOnce(['old.png']) // base dir
        .mockResolvedValueOnce(['old.png', 'new.png']); // pr dir

      // Mock readFile for hash generation of new screenshot
      (mockFs.readFile as jest.Mock).mockResolvedValue(Buffer.from('fake-image-data'));

      (mockExec.exec as jest.Mock).mockImplementation((cmd, args, options) => {
        if (cmd === 'identify') {
          const stdout = options?.listeners?.stdout;
          if (stdout) stdout(Buffer.from('1280x720'));
          return Promise.resolve(0);
        }
        if (cmd === 'odiff') {
          return Promise.resolve(0); // No differences
        }
        return Promise.resolve(0);
      });

      await runCompare(inputs);

      expect(mockCore.info).toHaveBeenCalledWith(expect.stringContaining('New screenshot: new.png'));
    });

    it('should fail when fail-on-changes is true and diffs found', async () => {
      const inputs = {
        mode: 'compare' as const,
        githubToken: 'test-token',
        workingDirectory: '.',
        baseArtifact: 'screenshots-base',
        prArtifact: 'screenshots-pr',
        postComment: false,
        r2AccountId: 'test-account-id',
        r2AccessKeyId: 'test-access-key',
        r2SecretAccessKey: 'test-secret',
        r2BucketName: 'test-bucket',
        r2PublicUrl: 'https://pub-test.r2.dev',
        outputFormat: 'side-by-side' as const,
        gifFrameDelay: 1000,
        includeDiffInOutput: true,
        diffThreshold: 0.1,
        cropPadding: 50,
        cropMinHeight: 300,
        failOnChanges: true
      };

      const fsMock = require('fs');
      fsMock.existsSync = jest.fn().mockReturnValue(true);
      (mockFs.readdir as jest.Mock)
        .mockResolvedValueOnce(['test.png'])
        .mockResolvedValueOnce(['test.png']);

      (mockExec.exec as jest.Mock).mockImplementation((cmd, args, options) => {
        if (cmd === 'identify') {
          const stdout = options?.listeners?.stdout;
          if (stdout) stdout(Buffer.from('1280x720'));
          return Promise.resolve(0);
        }
        if (cmd === 'odiff') {
          return Promise.resolve(22); // Differences found
        }
        return Promise.resolve(0);
      });

      await runCompare(inputs);

      expect(mockCore.setFailed).toHaveBeenCalledWith('Visual changes detected');
    });
  });
});
