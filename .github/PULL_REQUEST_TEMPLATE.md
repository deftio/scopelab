<!--
Thanks for contributing. CONTRIBUTING.md has the full detail; this is the
short version of what gets a PR merged quickly.
-->

## What this changes

<!-- One or two sentences. If it fixes an issue, say "Fixes #123". -->

## Why

<!-- What was wrong, or what could not be done before. -->

## Checklist

- [ ] `npm test` passes
- [ ] `npm run build:pages` still works
- [ ] I tried it in the browser with a camera (real or Chrome's fake camera)
- [ ] New or changed filters have a test that checks what they **do**, not only that they run
- [ ] UI changes use bitwrench (TACO, BCCL, `bw.patch` / `bw.toggleClass` / `bw.syncChildren`), with no `innerHTML` or `querySelector` edits
- [ ] Visual changes include a screenshot

## Notes for the reviewer

<!-- Optional. Anything you are unsure about, or alternatives you rejected. -->
