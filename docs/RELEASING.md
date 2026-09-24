# Releasing leaderborder

A release is driven by a `vX.Y.Z` tag. The **Release** workflow builds the artifacts and creates the GitHub Release, then deploys the Worker. Publishing to npm and to the Homebrew tap is done by hand with the steps below. CI never publishes there.

What the Release workflow produces (assets of the GitHub Release `vX.Y.Z`):

| Asset | Use |
|---|---|
| `Leaderborder-X.Y.Z-arm64.dmg`, `Leaderborder-X.Y.Z-x64.dmg` | macOS app, Apple Silicon and Intel |
| `leaderborder-X.Y.Z.tgz` | npm package tarball (`npm pack` of `packages/client`) |
| `leaderborder.rb` | Homebrew formula (CLI), goes to `Formula/leaderborder.rb` in the tap |
| `leaderborder-cask.rb` | Homebrew cask (app), goes to `Casks/leaderborder.rb` in the tap |
| `SHA256SUMS` | checksums of all files above |

## One-time setup

### npm

1. Create an account on https://www.npmjs.com and enable two-factor authentication (Account > Two-Factor Authentication, mode "Authorization and writes").
2. Log in on the Mac you publish from:

   ```sh
   npm login
   npm whoami
   ```

3. Check the name is still free before the first release (a 404 is what you want):

   ```sh
   npm view leaderborder
   ```

### Homebrew tap

```sh
gh repo create xaverric/homebrew-tap --public --description "Homebrew tap for leaderborder"
git clone git@github.com:xaverric/homebrew-tap.git ~/src/homebrew-tap
cd ~/src/homebrew-tap
mkdir -p Formula Casks
printf '# xaverric/tap\n\n    brew install xaverric/tap/leaderborder\n    brew install --cask xaverric/tap/leaderborder\n' > README.md
git add README.md
git commit -m "Initial tap"
git push -u origin main
```

### Cloudflare API token for the Worker deploy

Cloudflare dashboard > My Profile > API Tokens > Create Token > template **Edit Cloudflare Workers**, then adjust the permissions to:

| Scope | Permission | Why |
|---|---|---|
| Account > Workers Scripts | Edit | `wrangler deploy` (script + static assets) |
| Account > D1 | Edit | `wrangler d1 migrations apply --remote` |
| Account > Account Settings | Read | wrangler account lookup |
| User > User Details | Read | wrangler account lookup |
| Zone > Zone | Read | custom domain `leaderborder.xaverric.cz` |
| Zone > Workers Routes | Edit | custom domain / routes, if declared in `wrangler.toml` |

Account Resources: include only your account. Zone Resources: include only `xaverric.cz`. Set a TTL if you want the token to expire.

### GitHub environment and secrets

The deploy job runs in the GitHub environment `production`. Create it and allow only `main` and release tags to deploy:

```sh
gh api -X PUT repos/xaverric/leaderborder/environments/production \
  -F "deployment_branch_policy[protected_branches]=false" \
  -F "deployment_branch_policy[custom_branch_policies]=true"
gh api -X POST repos/xaverric/leaderborder/environments/production/deployment-branch-policies -f name=main -f type=branch
gh api -X POST repos/xaverric/leaderborder/environments/production/deployment-branch-policies -f name='v*' -f type=tag
```

Store the Cloudflare values as environment secrets (`gh secret set` reads the value from stdin when `--body` is omitted, so the token never lands in your shell history):

```sh
gh secret set CLOUDFLARE_API_TOKEN --env production --repo xaverric/leaderborder
gh secret set CLOUDFLARE_ACCOUNT_ID --env production --repo xaverric/leaderborder --body a2a11f9660e380f8eda01796204aac34
```

Repository-level secrets with the same names work too. Without them the deploy job succeeds with a "Deploy skipped" notice.

Worker runtime secrets are separate and set once with wrangler (from `packages/worker`):

```sh
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler secret put SESSION_SECRET
```

### Optional: code signing and notarization

The app ships unsigned until an Apple Developer ID is available. To turn signing on:

1. Add repository secrets `CSC_LINK` (base64 of the Developer ID Application `.p12`), `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`:

   ```sh
   base64 -i DeveloperID.p12 | gh secret set CSC_LINK --repo xaverric/leaderborder
   gh secret set CSC_KEY_PASSWORD --repo xaverric/leaderborder
   gh secret set APPLE_ID --repo xaverric/leaderborder
   gh secret set APPLE_APP_SPECIFIC_PASSWORD --repo xaverric/leaderborder
   gh secret set APPLE_TEAM_ID --repo xaverric/leaderborder
   ```

2. Remove `mac.identity: null` from `packages/client/electron-builder.yml` and enable `mac.hardenedRuntime: true`.

When `CSC_LINK` is set, the Release workflow passes the secrets to electron-builder, which signs and notarizes both DMGs. Otherwise it builds unsigned.

## Release steps

Replace `X.Y.Z` with the new version everywhere.

1. Start from an up-to-date `main` with a clean tree and green CI:

   ```sh
   git switch main
   git pull --ff-only
   git status
   npm ci
   npm run lint
   npm test
   ```

2. Bump the version of the published package (updates `packages/client/package.json` and `package-lock.json`, no tag yet):

   ```sh
   npm version X.Y.Z -w leaderborder --no-git-tag-version
   ```

3. Commit, tag and push:

   ```sh
   git add packages/client/package.json package-lock.json
   git commit -m "Release vX.Y.Z"
   git tag -a vX.Y.Z -m "vX.Y.Z"
   git push origin main
   git push origin vX.Y.Z
   ```

   The tag must equal `v` + the version in `packages/client/package.json`, otherwise the workflow stops at the first step.

4. Wait for the Release workflow:

   ```sh
   gh run list --workflow release.yml --limit 1
   gh run watch "$(gh run list --workflow release.yml --limit 1 --json databaseId --jq '.[0].databaseId')" --exit-status
   ```

5. Download and verify the release assets:

   ```sh
   mkdir -p ~/Downloads/leaderborder-X.Y.Z && cd ~/Downloads/leaderborder-X.Y.Z
   gh release download vX.Y.Z --repo xaverric/leaderborder
   shasum -a 256 -c SHA256SUMS
   ```

### Publish to npm

From the downloaded release asset (preferred, it is exactly the tarball Homebrew uses):

```sh
cd ~/Downloads/leaderborder-X.Y.Z
tar -tzf leaderborder-X.Y.Z.tgz | head
npm publish ./leaderborder-X.Y.Z.tgz --access public
```

Or from a clean checkout of the tag:

```sh
git clone --branch vX.Y.Z --depth 1 https://github.com/xaverric/leaderborder.git /tmp/leaderborder-X.Y.Z
cd /tmp/leaderborder-X.Y.Z
npm ci
npm publish -w leaderborder --access public
```

npm asks for the 2FA one-time password. You can pass it directly with `--otp 123456`.

Verify:

```sh
npm view leaderborder version
npx leaderborder@X.Y.Z --version
```

### Publish to the Homebrew tap

```sh
cd ~/src/homebrew-tap
git pull --ff-only
cp ~/Downloads/leaderborder-X.Y.Z/leaderborder.rb Formula/leaderborder.rb
cp ~/Downloads/leaderborder-X.Y.Z/leaderborder-cask.rb Casks/leaderborder.rb
git add Formula/leaderborder.rb Casks/leaderborder.rb
git commit -m "leaderborder X.Y.Z"
git push
```

Verify:

```sh
brew update
brew install xaverric/tap/leaderborder
leaderborder --version
brew test xaverric/tap/leaderborder
brew install --cask xaverric/tap/leaderborder
open -a Leaderborder
```

For an upgrade of an existing install use `brew upgrade xaverric/tap/leaderborder` and `brew upgrade --cask xaverric/tap/leaderborder`.

### Check the Worker

The Release workflow ends with the **Deploy worker** job (D1 migrations, then `wrangler deploy`). Check it and the site:

```sh
gh run view "$(gh run list --workflow release.yml --limit 1 --json databaseId --jq '.[0].databaseId')"
curl -fsS https://leaderborder.xaverric.cz/api/config
curl -fsS https://leaderborder.xaverric.cz/api/public/stats
```

## Rollback

- **npm:** do not unpublish (it blocks the version number forever and breaks installs). Deprecate the bad version and publish a fixed patch release:

  ```sh
  npm deprecate leaderborder@X.Y.Z "Broken release, use X.Y.(Z+1)"
  ```

  If `latest` must point back to the previous version right away: `npm dist-tag add leaderborder@<previous> latest`.

- **Homebrew tap:** revert the release commit, users then get the previous formula and cask:

  ```sh
  cd ~/src/homebrew-tap
  git revert --no-edit HEAD
  git push
  ```

- **GitHub Release:** mark it as a pre-release so it stops being "latest" (keep the assets while the tap still points to them):

  ```sh
  gh release edit vX.Y.Z --repo xaverric/leaderborder --prerelease
  ```

- **Worker:** roll back to the previous deployment from `packages/worker`:

  ```sh
  npx wrangler deployments list
  npx wrangler rollback
  ```

  D1 migrations are forward only. Undo a schema change with a new migration.
