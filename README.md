visual-regression-action

Automated Playwright visual regression with screenshot diffs, smart cropping, PR comments, and CI artifact storage.

This GitHub Action provides a complete end-to-end visual regression workflow for pull requests.
It detects visual changes using Playwright + odiff, generates cropped diffs that highlight only the changed regions, uploads artifacts to a dedicated CI branch using content-addressed filenames, and comments on the PR with expandable previews.

Ideal for maintaining UI consistency in Astro, React, Svelte, Vue, or any Playwright-based frontend project.
