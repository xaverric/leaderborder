# Security policy

leaderborder is a personal open-source project. Reports are welcome and handled on a best-effort basis.

## Supported versions

Only the latest release gets fixes: the newest `v*` tag on [GitHub Releases](https://github.com/xaverric/leaderborder/releases/latest) and the `latest` tag on npm. Upgrade before reporting.

## Reporting a vulnerability

Use GitHub Private Vulnerability Reporting on this repository: [Report a vulnerability](https://github.com/xaverric/leaderborder/security/advisories/new). Do not open a public issue and do not post details in discussions or pull requests.

Include what you found, how to reproduce it and which component and version are affected. Expect a first reply within a few days. There is no bug bounty.

## Scope

- the Worker and website at https://leaderborder.xaverric.cz (`packages/worker`)
- the `leaderborder` npm package and CLI (`packages/client`)
- the Homebrew formula and cask in [xaverric/homebrew-tap](https://github.com/xaverric/homebrew-tap)
- the DMG published on GitHub Releases

Out of scope: the tokscale engine (report to [junhoyeo/tokscale](https://github.com/junhoyeo/tokscale)), GitHub and Cloudflare themselves, and findings that require an already compromised Mac.

## What to expect

Confirmed reports are fixed in a new release and the advisory is published afterwards, with credit if you want it. Details stay private until the fix is out.
