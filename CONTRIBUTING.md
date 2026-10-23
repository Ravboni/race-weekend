# Contributing to Race Weekend Viewer

Thanks for helping improve Race Weekend Viewer. The project is an unofficial app built to bring F1 TV to LG webOS televisions. Contributions should keep the app useful with a TV remote and compatible with the webOS browser and media runtime.

## Branch and release workflow

- `develop` is the default branch. Start work from `develop` and target contribution pull requests at `develop`.
- `main` is the promotion and release branch. Only the project owner promotes changes from `develop` to `main`.
- Only the project owner creates `v*` version tags and publishes releases. The release workflow accepts tags only when their commit is already on `main`.
- Contributors and coding assistants should not push to `main`, create version tags, or publish releases.

## Before you start

- Check existing issues and pull requests for related work before opening a new one.
- For a substantial change, open an issue first to discuss the approach.
- Keep changes focused, and describe the user-visible behavior they affect.
- Do not add credentials, account data, pairing codes, signed stream URLs, DRM challenges, license responses, or other secrets to the repository or an issue.

## Build locally

You need Node.js 20 or newer, npm, and the LG [webOS CLI](https://webostv.developer.lge.com/develop/tools/cli-installation).

```sh
npm install --global @webos-tools/cli
git clone https://github.com/Ravboni/race-weekend-viewer.git
cd race-weekend-viewer
git switch develop
./scripts/package.sh
```

The installable `.ipk` is written to `dist/`. The app is a small HTML, CSS, and JavaScript project; the packaging script stages the runtime files and invokes `ares-package`.

## Test on a TV

When a change affects the app, verify it on an LG webOS TV when possible. Include the TV model and webOS version in your notes. For remote navigation changes, check D-pad movement, OK, and Back behavior. For playback changes, include the event or feed type and relevant audio or subtitle selection details, without sharing account-specific URLs or data.

If you cannot test on a TV, say so in the pull request and describe what you were able to verify. Never claim TV compatibility based only on a desktop browser.

## Open a pull request

Include:

- What changed and why.
- How you built or checked the change, including whether it was tested on a TV.
- Screenshots or a short recording for visible UI changes, after checking that they do not expose account information or private stream details.
- Any known limitations or compatibility impact.

Use a clear title and keep the pull request focused. Do not bump the app version for an ordinary contribution; maintainers will choose the version and publish a release when appropriate.

## Report a bug safely

Include the app version, TV model, webOS version, steps to reproduce, and the visible error text. For playback issues, include the event and feed type if useful. Remove personal details from screenshots and logs. Never share passwords, pairing codes, account tokens, signed URLs, DRM challenges, license responses, or private account data.

## Project status and licensing

F1 TV and its services can change independently of this project, and stream compatibility can vary by event, account, region, TV model, and webOS version. The project has not declared a repository-wide license; third-party components retain their own licenses. Please discuss proposed reuse or licensing changes with the maintainers before contributing work that depends on an assumed project license.
