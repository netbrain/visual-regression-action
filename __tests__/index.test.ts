// Mock all external dependencies BEFORE imports
jest.mock('@actions/core');
jest.mock('@actions/exec');
jest.mock('@actions/github');
jest.mock('fs/promises');
jest.mock('fs');

import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as github from '@actions/github';
import * as fs from 'fs/promises';
import { getInputs, run } from '../src/index';

const mockCore = core as jest.Mocked<typeof core>;
const mockExec = exec as jest.Mocked<typeof exec>;
const mockFs = fs as any; // Use any to allow setting mock functions

describe('Visual Regression Action', () => {
  let mockContext: any;
  let mockOctokit: any;

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup default mock implementations
    (mockCore.getInput as jest.Mock) = jest.fn((name: string) => {
      const inputs: Record<string, string> = {
        'github-token': 'mock-token',
        'playwright-command': 'npm test',
        'working-directory': '.',
        'screenshot-directory': 'screenshots',
        'base-branch': 'main',
        'ci-branch-name': '_ci',
        'diff-threshold': '0.1',
        'crop-padding': '50',
        'crop-min-height': '300'
      };
      return inputs[name] || '';
    });

    (mockCore.getBooleanInput as jest.Mock) = jest.fn((name: string) => {
      const boolInputs: Record<string, boolean> = {
        'commit-screenshots': true,
        'post-comment': true,
        'use-ci-branch': true,
        'install-deps': false,
        'fail-on-changes': false,
        'amend-commit': true
      };
      return boolInputs[name] || false;
    });

    mockCore.setOutput = jest.fn();
    mockCore.setFailed = jest.fn();
    mockCore.warning = jest.fn();
    mockCore.info = jest.fn();
    mockCore.startGroup = jest.fn();
    mockCore.endGroup = jest.fn();

    (mockExec.exec as jest.Mock) = jest.fn().mockResolvedValue(0);

    // Setup mock context
    mockContext = {
      payload: {
        pull_request: {
          number: 123,
          head: { ref: 'feature-branch' },
          base: { ref: 'main' }
        }
      },
      repo: {
        owner: 'test-owner',
        repo: 'test-repo'
      }
    };

    // Mock github.context using Object.defineProperty to handle readonly
    Object.defineProperty(github, 'context', {
      get: () => mockContext,
      configurable: true
    });

    // Setup mock Octokit
    mockOctokit = {
      rest: {
        repos: {
          getContent: jest.fn(),
          createOrUpdateFileContents: jest.fn()
        },
        issues: {
          createComment: jest.fn(),
          listComments: jest.fn().mockResolvedValue({ data: [] }),
          updateComment: jest.fn()
        }
      }
    };

    (github.getOctokit as jest.Mock) = jest.fn().mockReturnValue(mockOctokit);

    // Reset fs mock functions
    const fsMock = require('fs');
    fsMock.promises.mkdir.mockReset().mockResolvedValue(undefined);
    fsMock.promises.readdir.mockReset().mockResolvedValue([]);
    fsMock.promises.rename.mockReset().mockResolvedValue(undefined);
    fsMock.promises.unlink.mockReset().mockResolvedValue(undefined);
    fsMock.promises.readFile.mockReset().mockResolvedValue(Buffer.from(''));
    fsMock.promises.writeFile.mockReset().mockResolvedValue(undefined);
    fsMock.existsSync.mockReset().mockReturnValue(false);
  });

  describe('getInputs', () => {
    it('should parse all required inputs correctly', () => {
      const inputs = getInputs();

      expect(mockCore.getInput).toHaveBeenCalledWith('github-token', { required: true });
      expect(mockCore.getInput).toHaveBeenCalledWith('playwright-command', { required: true });
      expect(inputs.githubToken).toBe('mock-token');
      expect(inputs.playwrightCommand).toBe('npm test');
    });

    it('should use default values for optional inputs', () => {
      (mockCore.getInput as jest.Mock).mockImplementation((name: string) => {
        if (name === 'github-token') return 'token';
        if (name === 'playwright-command') return 'npm test';
        return '';
      });

      const inputs = getInputs();

      expect(inputs.workingDirectory).toBe('.');
      expect(inputs.screenshotDirectory).toBe('screenshots');
      expect(inputs.ciBranchName).toBe('_ci');
      expect(inputs.diffThreshold).toBe(0.1);
      expect(inputs.cropPadding).toBe(50);
      expect(inputs.cropMinHeight).toBe(300);
    });

    it('should parse numeric inputs correctly', () => {
      (mockCore.getInput as jest.Mock).mockImplementation((name: string) => {
        const inputs: Record<string, string> = {
          'github-token': 'token',
          'playwright-command': 'npm test',
          'diff-threshold': '0.5',
          'crop-padding': '100',
          'crop-min-height': '500'
        };
        return inputs[name] || '';
      });

      const inputs = getInputs();

      expect(inputs.diffThreshold).toBe(0.5);
      expect(inputs.cropPadding).toBe(100);
      expect(inputs.cropMinHeight).toBe(500);
    });
  });

  describe('run - validation', () => {
    it('should warn and return if not running in a PR context', async () => {
      mockContext.payload.pull_request = undefined;

      await run();

      expect(mockCore.warning).toHaveBeenCalledWith(expect.stringContaining('pull request'));
    });

    it('should proceed if running in a PR context', async () => {
      // Mock exec to succeed for all git/playwright commands
      (mockExec.exec as jest.Mock).mockResolvedValue(0);
      const fsMock = require('fs');
      fsMock.promises.readdir.mockResolvedValue([]);

      await run();

      expect(mockCore.setFailed).not.toHaveBeenCalledWith(expect.stringContaining('pull request'));
    });
  });

  describe('run - dependency installation', () => {
    it('should install dependencies when install-deps is true', async () => {
      (mockCore.getBooleanInput as jest.Mock).mockImplementation((name: string) => {
        return name === 'install-deps';
      });

      (mockExec.exec as jest.Mock).mockResolvedValue(0);
      const fsMock = require('fs');
      fsMock.promises.readdir.mockResolvedValue([]);

      await run();

      expect(mockExec.exec).toHaveBeenCalledWith('npm', ['ci']);
    });

    it('should skip installation when install-deps is false', async () => {
      (mockCore.getBooleanInput as jest.Mock).mockImplementation((name: string) => {
        return name !== 'install-deps';
      });

      (mockExec.exec as jest.Mock).mockResolvedValue(0);
      const fsMock = require('fs');
      fsMock.promises.readdir.mockResolvedValue([]);

      await run();

      const npmCiCalls = (mockExec.exec as jest.Mock).mock.calls.filter(
        call => call[0] === 'npm' && call[1]?.[0] === 'ci'
      );
      expect(npmCiCalls.length).toBe(0);
    });
  });

  describe('run - base screenshot fetching', () => {
    it('should fetch base screenshots from base branch when available', async () => {
      (mockExec.exec as jest.Mock).mockResolvedValue(0);
      const fsMock = require('fs');
      fsMock.promises.readdir.mockResolvedValue([]);

      await run();

      expect(mockExec.exec).toHaveBeenCalledWith('git', ['fetch', 'origin', 'main']);
      expect(mockExec.exec).toHaveBeenCalledWith(
        'git',
        expect.arrayContaining(['show', expect.stringContaining('origin/main:screenshots/')]),
        expect.any(Object)
      );
    });

    it('should handle missing base screenshots gracefully', async () => {
      (mockExec.exec as jest.Mock).mockImplementation((cmd, args) => {
        if (cmd === 'git' && args?.[0] === 'show') {
          return Promise.resolve(1); // Simulate missing base
        }
        return Promise.resolve(0);
      });

      const fsMock = require('fs');
      fsMock.promises.readdir.mockResolvedValue([]);
      fsMock.existsSync.mockReturnValue(false);

      await run();

      // Should complete without crashing
      expect(mockCore.setFailed).not.toHaveBeenCalled();
    });

    it('should continue when base branch does not exist', async () => {
      (mockExec.exec as jest.Mock).mockImplementation((cmd, args) => {
        if (cmd === 'git' && args?.[0] === 'fetch') {
          return Promise.resolve(1); // Simulate missing branch
        }
        return Promise.resolve(0);
      });

      const fsMock = require('fs');
      fsMock.promises.readdir.mockResolvedValue([]);

      await run();

      expect(mockCore.setFailed).not.toHaveBeenCalled();
    });
  });

  describe('run - Playwright execution', () => {
    it('should execute the Playwright command', async () => {
      (mockExec.exec as jest.Mock).mockResolvedValue(0);
      const fsMock = require('fs');
      fsMock.promises.readdir.mockResolvedValue([]);

      await run();

      expect(mockExec.exec).toHaveBeenCalledWith(
        'bash',
        ['-c', 'npm test']
      );
    });
  });

  describe('run - screenshot comparison', () => {
    it('should compare screenshots using odiff', async () => {
      (mockExec.exec as jest.Mock).mockImplementation((cmd, args, options) => {
        // Mock git show to succeed (indicates base screenshots exist)
        if (cmd === 'git' && args?.[0] === 'show') {
          return Promise.resolve(0); // exitCode 0 = success
        }
        // Mock identify for dimensions
        if (cmd === 'identify') {
          const stdout = options?.listeners?.stdout;
          if (stdout) {
            stdout(Buffer.from('1280x720'));
          }
        }
        return Promise.resolve(0);
      });

      const fsMock = require('fs');
      fsMock.existsSync.mockReturnValue(true);
      fsMock.promises.readdir
        .mockResolvedValueOnce(['test.png'])  // Base screenshot files in screenshotDir (line 107)
        .mockResolvedValueOnce(['test.png']); // New screenshot files in screenshotBaseDirAbs (line 147)

      await run();

      const odiffCalls = (mockExec.exec as jest.Mock).mock.calls.filter(
        call => call[0] === 'odiff'
      );
      expect(odiffCalls.length).toBeGreaterThan(0);
    });

    it('should mark files as different when odiff detects changes', async () => {
      (mockExec.exec as jest.Mock).mockImplementation((cmd, args, options) => {
        // Mock git show to succeed
        if (cmd === 'git' && args?.[0] === 'show') {
          return Promise.resolve(0);
        }
        // Mock identify for dimensions
        if (cmd === 'identify') {
          const stdout = options?.listeners?.stdout;
          if (stdout) {
            stdout(Buffer.from('1280x720'));
          }
        }
        // Mock odiff to detect differences
        if (cmd === 'odiff') {
          return Promise.resolve(1); // Non-zero = differences detected
        }
        return Promise.resolve(0);
      });

      const fsMock = require('fs');
      fsMock.existsSync.mockReturnValue(true);
      fsMock.promises.readdir
        .mockResolvedValueOnce(['test.png'])  // Base screenshot files
        .mockResolvedValueOnce(['test.png']); // New screenshot files

      await run();

      expect(mockCore.setOutput).toHaveBeenCalledWith('has-diffs', 'true');
    });

    it('should mark files as identical when odiff finds no changes', async () => {
      (mockExec.exec as jest.Mock).mockResolvedValue(0);
      const fsMock = require('fs');
      fsMock.promises.readdir
        .mockResolvedValueOnce(['test.png'])
        .mockResolvedValueOnce(['test.png']);

      await run();

      // Should complete without marking as different
      expect(mockCore.setFailed).not.toHaveBeenCalled();
    });
  });

  describe('run - bbox parsing', () => {
    it('should correctly parse bbox with double plus signs', () => {
      const bbox = '1280x253++0++0';
      const match = bbox.match(/(\d+)x(\d+)\+?\+?(-?\d+)\+?\+?(-?\d+)/);

      expect(match).toBeTruthy();
      expect(match![1]).toBe('1280');
      expect(match![2]).toBe('253');
      expect(match![3]).toBe('0');
      expect(match![4]).toBe('0');
    });

    it('should correctly parse bbox with single plus signs', () => {
      const bbox = '1280x253+10+20';
      const match = bbox.match(/(\d+)x(\d+)\+?\+?(-?\d+)\+?\+?(-?\d+)/);

      expect(match).toBeTruthy();
      expect(match![1]).toBe('1280');
      expect(match![2]).toBe('253');
      expect(match![3]).toBe('10');
      expect(match![4]).toBe('20');
    });

    it('should correctly parse bbox with negative offsets', () => {
      const bbox = '1280x253+-10+-20';
      const match = bbox.match(/(\d+)x(\d+)\+?\+?(-?\d+)\+?\+?(-?\d+)/);

      expect(match).toBeTruthy();
      expect(match![1]).toBe('1280');
      expect(match![2]).toBe('253');
      expect(match![3]).toBe('-10');
      expect(match![4]).toBe('-20');
    });
  });

  describe('run - screenshot cropping', () => {
    it('should crop screenshots to the changed region', async () => {
      (mockExec.exec as jest.Mock).mockImplementation((cmd, args, options) => {
        // Mock git show to succeed
        if (cmd === 'git' && args?.[0] === 'show') {
          return Promise.resolve(0);
        }
        // Simulate ImageMagick returning bbox
        if (cmd === 'convert' && args?.includes('-format') && args?.includes('%@')) {
          const stdout = options?.listeners?.stdout;
          if (stdout) {
            stdout(Buffer.from('1280x253++0++0'));
          }
        }
        // Simulate ImageMagick identify for dimensions
        if (cmd === 'identify') {
          const stdout = options?.listeners?.stdout;
          if (stdout) {
            stdout(Buffer.from('1280x720'));
          }
        }
        // Simulate odiff detecting differences
        if (cmd === 'odiff') {
          return Promise.resolve(1);
        }
        return Promise.resolve(0);
      });

      const fsMock = require('fs');
      fsMock.existsSync.mockReturnValue(true);
      fsMock.promises.readdir
        .mockResolvedValueOnce(['test.png'])  // Base screenshots
        .mockResolvedValueOnce(['test.png']); // New screenshots

      await run();

      const convertCalls = (mockExec.exec as jest.Mock).mock.calls.filter(
        call => call[0] === 'convert' && call[1]?.includes('-crop')
      );
      expect(convertCalls.length).toBeGreaterThan(0);
    });

    it('should apply padding to cropped regions', async () => {
      (mockCore.getInput as jest.Mock).mockImplementation((name: string) => {
        const inputs: Record<string, string> = {
          'github-token': 'token',
          'playwright-command': 'npm test',
          'crop-padding': '100'
        };
        return inputs[name] || '';
      });

      (mockExec.exec as jest.Mock).mockImplementation((cmd, args, options) => {
        // Mock git show to succeed
        if (cmd === 'git' && args?.[0] === 'show') {
          return Promise.resolve(0);
        }
        if (cmd === 'convert' && args?.includes('-format') && args?.includes('%@')) {
          const stdout = options?.listeners?.stdout;
          if (stdout) {
            stdout(Buffer.from('1280x253+0+100'));
          }
        }
        if (cmd === 'identify') {
          const stdout = options?.listeners?.stdout;
          if (stdout) {
            stdout(Buffer.from('1280x720'));
          }
        }
        if (cmd === 'odiff') {
          return Promise.resolve(1);
        }
        return Promise.resolve(0);
      });

      const fsMock = require('fs');
      fsMock.existsSync.mockReturnValue(true);
      fsMock.promises.readdir
        .mockResolvedValueOnce(['test.png'])  // Base screenshots
        .mockResolvedValueOnce(['test.png']); // New screenshots

      await run();

      // Verify convert was called with crop parameters
      const cropCalls = (mockExec.exec as jest.Mock).mock.calls.filter(
        call => call[0] === 'convert' && call[1]?.includes('-crop')
      );
      expect(cropCalls.length).toBeGreaterThan(0);
    });
  });

  describe('run - screenshot committing', () => {
    it('should commit screenshots when commit-screenshots is true', async () => {
      (mockCore.getBooleanInput as jest.Mock).mockImplementation((name: string) => {
        return name === 'commit-screenshots';
      });

      (mockExec.exec as jest.Mock).mockImplementation((cmd, args, options) => {
        if (cmd === 'git' && args?.[0] === 'status' && args?.[1] === '--porcelain') {
          const stdout = options?.listeners?.stdout;
          if (stdout) {
            stdout(Buffer.from('M  screenshots/test.png\n'));
          }
          return Promise.resolve(0);
        }
        return Promise.resolve(0);
      });

      const fsMock = require('fs');
      fsMock.existsSync.mockReturnValue(false);
      fsMock.promises.readdir
        .mockResolvedValueOnce(['test.png'])
        .mockResolvedValueOnce([]);

      await run();

      const gitCommitCalls = (mockExec.exec as jest.Mock).mock.calls.filter(
        call => call[0] === 'git' && call[1]?.[0] === 'commit'
      );
      expect(gitCommitCalls.length).toBeGreaterThan(0);
    });

    it('should skip committing when commit-screenshots is false', async () => {
      (mockCore.getBooleanInput as jest.Mock).mockImplementation((name: string) => {
        return name !== 'commit-screenshots';
      });

      (mockExec.exec as jest.Mock).mockResolvedValue(0);
      const fsMock = require('fs'); fsMock.promises.readdir.mockResolvedValue([]);

      await run();

      const gitCommitCalls = (mockExec.exec as jest.Mock).mock.calls.filter(
        call => call[0] === 'git' && call[1]?.[0] === 'commit'
      );
      expect(gitCommitCalls.length).toBe(0);
    });

    it('should push screenshots to remote', async () => {
      (mockCore.getBooleanInput as jest.Mock).mockImplementation((name: string) => {
        return name === 'commit-screenshots';
      });

      (mockExec.exec as jest.Mock).mockImplementation((cmd, args, options) => {
        if (cmd === 'git' && args?.[0] === 'status' && args?.[1] === '--porcelain') {
          const stdout = options?.listeners?.stdout;
          if (stdout) {
            stdout(Buffer.from('M  screenshots/test.png\n'));
          }
          return Promise.resolve(0);
        }
        return Promise.resolve(0);
      });

      const fsMock = require('fs');
      fsMock.existsSync.mockReturnValue(false);
      fsMock.promises.readdir
        .mockResolvedValueOnce(['test.png'])
        .mockResolvedValueOnce([]);

      await run();

      const gitPushCalls = (mockExec.exec as jest.Mock).mock.calls.filter(
        call => call[0] === 'git' && call[1]?.[0] === 'push'
      );
      expect(gitPushCalls.length).toBeGreaterThan(0);
    });
  });

  describe('run - PR commenting', () => {
    it('should post a comment when post-comment is true', async () => {
      (mockCore.getBooleanInput as jest.Mock).mockImplementation((name: string) => {
        return name === 'post-comment';
      });

      (mockExec.exec as jest.Mock).mockImplementation((cmd, args, options) => {
        // Mock git show to succeed
        if (cmd === 'git' && args?.[0] === 'show') {
          return Promise.resolve(0);
        }
        if (cmd === 'identify') {
          const stdout = options?.listeners?.stdout;
          if (stdout) {
            stdout(Buffer.from('1280x720'));
          }
        }
        if (cmd === 'odiff') {
          return Promise.resolve(1); // Differences detected
        }
        return Promise.resolve(0);
      });

      const fsMock = require('fs');
      fsMock.existsSync.mockReturnValue(true);
      fsMock.promises.readdir
        .mockResolvedValueOnce(['test.png'])  // Base screenshots
        .mockResolvedValueOnce(['test.png']); // New screenshots

      await run();

      expect(mockOctokit.rest.issues.createComment).toHaveBeenCalled();
    });

    it('should skip commenting when post-comment is false', async () => {
      (mockCore.getBooleanInput as jest.Mock).mockImplementation((name: string) => {
        return name !== 'post-comment';
      });

      (mockExec.exec as jest.Mock).mockResolvedValue(0);
      const fsMock = require('fs'); fsMock.promises.readdir.mockResolvedValue([]);

      await run();

      expect(mockOctokit.rest.issues.createComment).not.toHaveBeenCalled();
    });
  });

  describe('run - output setting', () => {
    it('should set all outputs correctly', async () => {
      (mockExec.exec as jest.Mock).mockResolvedValue(0);
      const fsMock = require('fs'); fsMock.promises.readdir.mockResolvedValue([]);

      await run();

      expect(mockCore.setOutput).toHaveBeenCalledWith('has-changes', expect.any(String));
      expect(mockCore.setOutput).toHaveBeenCalledWith('has-diffs', expect.any(String));
      expect(mockCore.setOutput).toHaveBeenCalledWith('screenshots-committed', expect.any(String));
      expect(mockCore.setOutput).toHaveBeenCalledWith('comment-posted', expect.any(String));
    });
  });

  describe('run - error handling', () => {
    it('should set failed status when an error occurs', async () => {
      (mockExec.exec as jest.Mock).mockRejectedValue(new Error('Test error'));

      await run();

      expect(mockCore.setFailed).toHaveBeenCalledWith(expect.stringContaining('Test error'));
    });

    it('should handle git errors gracefully', async () => {
      (mockExec.exec as jest.Mock).mockImplementation((cmd) => {
        if (cmd === 'git') {
          return Promise.reject(new Error('Git error'));
        }
        return Promise.resolve(0);
      });

      await run();

      expect(mockCore.setFailed).toHaveBeenCalled();
    });
  });

  describe('run - fail-on-changes behavior', () => {
    it('should fail the action when fail-on-changes is true and diffs are detected', async () => {
      (mockCore.getBooleanInput as jest.Mock).mockImplementation((name: string) => {
        return name === 'fail-on-changes';
      });

      (mockExec.exec as jest.Mock).mockImplementation((cmd, args, options) => {
        // Mock git show to succeed
        if (cmd === 'git' && args?.[0] === 'show') {
          return Promise.resolve(0);
        }
        if (cmd === 'identify') {
          const stdout = options?.listeners?.stdout;
          if (stdout) {
            stdout(Buffer.from('1280x720'));
          }
        }
        if (cmd === 'odiff') {
          return Promise.resolve(1); // Differences detected
        }
        return Promise.resolve(0);
      });

      const fsMock = require('fs');
      fsMock.existsSync.mockReturnValue(true);
      fsMock.promises.readdir
        .mockResolvedValueOnce(['test.png'])  // Base screenshots
        .mockResolvedValueOnce(['test.png']); // New screenshots

      await run();

      expect(mockCore.setFailed).toHaveBeenCalledWith('Visual changes detected');
    });

    it('should not fail when fail-on-changes is false', async () => {
      (mockCore.getBooleanInput as jest.Mock).mockImplementation((name: string) => {
        return name !== 'fail-on-changes';
      });

      (mockExec.exec as jest.Mock).mockImplementation((cmd) => {
        if (cmd === 'odiff') {
          return Promise.resolve(1);
        }
        return Promise.resolve(0);
      });

      const fsMock = require('fs'); fsMock.promises.readdir
        .mockResolvedValueOnce(['test.png'])
        .mockResolvedValueOnce(['test.png']);

      await run();

      expect(mockCore.setFailed).not.toHaveBeenCalledWith('Visual changes detected');
      expect(mockCore.info).toHaveBeenCalledWith(expect.stringContaining('complete'));
    });
  });
});
