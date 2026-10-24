# Contributing to Race Weekend

Thanks for helping improve Race Weekend. The project is an unofficial app built to bring F1 TV to LG webOS televisions. Contributions should keep the app useful with a TV remote and compatible with the webOS browser and media runtime.

## Branch and release workflow

- `develop` is the default integration branch. Start each change from the latest `develop` and use a short-lived working branch.
- Every change must be submitted as a pull request (PR). Do not commit or push changes directly to `develop` or `main`.
- Ordinary change PRs target `develop`. After review, they are merged into `develop`.
- When a set of changes is ready for a release, the project owner opens a separate promotion PR from `develop` to `main`. Only the project owner may open or merge this promotion PR.
- Only the project owner creates `v*` version tags and publishes releases. The release workflow accepts tags only when their commit is already on `main`.
- Contributors and coding assistants must not push directly to `main`, merge a promotion PR, create version tags, or publish releases.

The normal flow is:

```text
latest develop
    └── working branch ── PR ──> develop
                                  │
                         owner opens promotion PR
                                  └───────────────> main ── owner tags and publishes release
```

## Before you start

- Check existing issues and pull requests for related work before opening a new one.
- For a substantial change, open an issue first to discuss the approach.
- Keep changes focused, and describe the user-visible behavior they affect.
- Do not add credentials, account data, pairing codes, signed stream URLs, DRM challenges, license responses, or other secrets to the repository or an issue.

## Build locally

You need Node.js 20 or newer, npm, and the LG [webOS CLI](https://webostv.developer.lge.com/develop/tools/cli-installation).

```sh
npm install --global @webos-tools/cli
git clone https://github.com/Ravboni/race-weekend.git
cd race-weekend
git switch develop
./scripts/package.sh
```

The installable `.ipk` is written to `dist/`. The app is a small HTML, CSS, and JavaScript project; the packaging script stages the runtime files and invokes `ares-package`.

## Test on a TV

When a change affects the app, verify it on an LG webOS TV when possible. Include the TV model and webOS version in your notes. For remote navigation changes, check D-pad movement, OK, and Back behavior. For playback changes, include the event or feed type and relevant audio or subtitle selection details, without sharing account-specific URLs or data.

If you cannot test on a TV, say so in the pull request and describe what you were able to verify. Never claim TV compatibility based only on a desktop browser.

## Branch and PR names

- Use a lowercase, kebab-case working branch with a type prefix:
  - `feat/` for a user-facing capability.
  - `fix/` for a defect correction.
  - `docs/` for documentation.
  - `refactor/` for behavior-preserving code changes.
  - `chore/` for maintenance and tooling.
- Name ordinary PRs with a Conventional Commit style title: `<type>(<scope>): <imperative summary>`. Keep the scope short and omit it when it adds no clarity.
- Use the same types as branch prefixes. Examples: `feat(player): add audio track selection`, `fix(nav): keep focus inside the tab bar`, and `docs: explain TV installation`.
- Promotion PRs are named `promote: develop -> main (vX.Y.Z)`. The project owner chooses the version and handles any release-specific version changes. A promotion PR must target `main` and use `develop` as its source.

## Required PR structure

GitHub pre-fills this structure for new PRs. Complete every section that applies; write `N/A` with a short reason when a section does not apply.

- **Summary:** What changed and why? Describe user-visible behavior.
- **Change type:** Feature, fix, documentation, refactor, or maintenance.
- **Verification:** Commands or checks run and their results. Say clearly whether it was tested on a TV; if so, include the model and webOS version. If not, say so and describe other verification.
- **UI or playback evidence:** Screenshots or a short recording for visible changes, or the event/feed and selected audio/subtitle details for playback changes. Remove account data and private stream details.
- **Compatibility and limitations:** Known risks, webOS/device impact, or `N/A` with a reason.
- **Promotion details:** Ordinary PRs must target `develop`. For a promotion PR, summarize the release contents and target version, confirm the source is `develop` and target is `main`, and list any release checks. Only the project owner completes this section and merges the promotion.

Ordinary change PRs must not bump the app version, create tags, or include release publication steps. The project owner handles those during promotion and release.

## Before you request review

- Keep the PR focused and confirm its target is `develop` (or `main` for an owner-only promotion PR).
- Check that the PR title follows the naming rules above.
- Check that all required PR sections are complete.
- For a substantial change, open an issue first to discuss the approach.

## Report a bug safely

Include the app version, TV model, webOS version, steps to reproduce, and the visible error text. For playback issues, include the event and feed type if useful. Remove personal details from screenshots and logs. Never share passwords, pairing codes, account tokens, signed URLs, DRM challenges, license responses, or private account data.

## Project status and licensing

F1 TV and its services can change independently of this project, and stream compatibility can vary by event, account, region, TV model, and webOS version. The project has not declared a repository-wide license; third-party components retain their own licenses. Please discuss proposed reuse or licensing changes with the maintainers before contributing work that depends on an assumed project license.
