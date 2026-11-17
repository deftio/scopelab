# Security Policy

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Use GitHub's private vulnerability reporting:

> [Report a vulnerability](https://github.com/deftio/scopelab/security/advisories/new)

That creates a private advisory visible only to you and the maintainer. If you
cannot use it, email <deftio@deftio.com> with "scopelab security" in the
subject.

ScopeLab is maintained by one person. Expect an acknowledgement within a week.
You will be credited in the advisory and the fix's commit message unless you ask
not to be.

## Supported versions

Only the current `main` branch, which is what
[deftio.github.io/scopelab](https://deftio.github.io/scopelab/) serves. There
are no releases or maintenance branches.

## How ScopeLab handles your data

This shapes what counts as a vulnerability:

- **Video stays on your machine.** Frames go from the camera to a `<canvas>`
  and are processed in the page. Nothing is uploaded. The hosted site is a
  static GitHub Pages site with no backend.
- **Captures** live in the browser's memory until you download them. Only
  `npm start` (the local server) also writes them to the `captures/` folder.
- **The local server (`server.js`)** listens on `127.0.0.1` only. It serves the
  page and accepts `POST /api/save` from that page, writing to `captures/` with
  a sanitised, flat file name restricted to `.png`, `.jpg`, `.webm` and `.mp4`.
- **WebUSB** is used read-only, to show a paired device's descriptors. The page
  does not claim interfaces or send control transfers.
- **Runtime dependencies:** one, [bitwrench](https://github.com/deftio/bitwrench),
  pinned by `package-lock.json` and copied into the site at build time.
  Nothing is loaded from a CDN.

## What is in scope

- A way for a web page or another origin to make the **local server** read or
  write files outside `captures/`, or to reach it from outside the machine.
- Anything that makes the **hosted site** send camera frames, captures or USB
  descriptors anywhere.
- Script injection through anything the page displays: camera labels, USB
  descriptor strings, capture file names.
- The **build and deploy pipeline**: anything that would let a third party
  change what GitHub Pages serves.

Out of scope:

- `npm run dev` (`bwcli serve`). It is a development tool and is not hardened
  for untrusted networks.
- Running `npm start` with `HOST` set to a public interface. The server is built
  for `127.0.0.1`.
- Findings from automated scanners with no demonstrated exploit path. Please
  include a concrete reproduction.

## Security posture

### In this repository (reviewable in git)

- **GitHub Actions are pinned to commit SHAs**, not floating tags, with the
  version as a comment so Dependabot can still propose updates.
- **`npm ci --ignore-scripts`** in CI and in the Pages build. Dependency
  lifecycle scripts are the classic install-time attack, and nothing here needs
  them.
- **Every workflow declares its own `permissions:`.** Only the Pages deploy job
  gets `pages: write` and `id-token: write`.
- **The lockfile is committed and CI uses `npm ci`**, so dependency versions are
  integrity-pinned and any change shows up in a diff.

### In GitHub repository settings (not visible in git)

| Setting | Intended state |
|---|---|
| Private vulnerability reporting | **enabled** (the channel above) |
| Dependabot alerts | **enabled** |
| Dependabot security updates (PRs) | disabled. Version updates are grouped monthly instead (`.github/dependabot.yml`) |
| Secret scanning and push protection | **enabled** |
| Default workflow permissions | **read** |
| Pages source | **GitHub Actions** |

These don't travel with the code. If the repository is forked, migrated or
recreated, set them again.
