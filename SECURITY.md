# Security Policy

## Supported Versions

We release patches for security vulnerabilities in the following versions:

| Version | Supported          |
| ------- | ------------------ |
| 2.x     | :white_check_mark: |
| 1.x     | :x:                |

## Reporting a Vulnerability

If you discover a security vulnerability, please do **NOT** open a public issue.

Instead, please report it via one of the following methods:

1. **GitHub Security Advisories**: [Report a vulnerability](https://github.com/netbrain/visual-regression-action/security/advisories/new)
2. **Email**: Send details to the repository owner (find email in commit history)

### What to Include

Please include the following information in your report:

- Description of the vulnerability
- Steps to reproduce the issue
- Potential impact of the vulnerability
- Suggested fix (if any)

### Response Timeline

- **Initial Response**: Within 48 hours
- **Status Update**: Within 7 days
- **Fix Timeline**: Depends on severity
  - Critical: 7 days
  - High: 14 days
  - Medium: 30 days
  - Low: 60 days

## Security Considerations

### Running User Code

This action executes user-provided Playwright tests and commands. Users are responsible for:

- Securing their test code
- Not exposing secrets in screenshots
- Using appropriate branch protection rules

### Docker Image

The action uses a pre-built Docker image with:

- Node.js 22
- Playwright (auto-updated weekly)
- ImageMagick
- odiff

Image source: `ghcr.io/netbrain/visual-regression-action:latest`

### Permissions Required

The action requires:

- `contents: write` - To update the `_ci` branch with diff images
- `pull-requests: write` - To post PR comments

### Token Usage

The `github-token` input is used for:

- Fetching PR context
- Posting comments
- Pushing to `_ci` branch

The token is never logged or exposed in screenshots.

## Best Practices

1. **Use Branch Protection**: Require PR reviews before merging
2. **Limit Token Scope**: Use the default `GITHUB_TOKEN` (automatically scoped)
3. **Review Diffs**: Always review visual changes before approving PRs
4. **Secure Secrets**: Don't display sensitive data in your application during tests
5. **Pin Versions**: Use `@v2` tags instead of `@main` for stability

## Known Limitations

- Screenshots may contain sensitive UI elements - review before sharing
- The `_ci` branch is publicly readable if your repository is public
- Artifact retention is limited by GitHub Actions (default: 7 days)

## Dependency Security

We use:

- **Dependabot**: Automated dependency updates
- **npm audit**: Regular security scans
- **Playwright Updates**: Weekly automated updates

## Updates and Patches

Security patches are released as soon as possible after discovery. Update by:

```yaml
- uses: netbrain/visual-regression-action@v2
```

To get the latest security fixes within v2.x.
