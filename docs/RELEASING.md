# Releasing leaderborder

A release is driven by a `vX.Y.Z` tag. The **Release** workflow builds the artifacts, attests their build provenance and creates the GitHub Release, then deploys the Worker once the owner approves the `production` deployment in the run. Publishing to npm and to the Homebrew tap is done by hand with the steps below. CI never publishes there.

What the Release workflow produces (assets of the GitHub Release `vX.Y.Z`):

| Asset | Use |
|---|---|
| `Leaderborder-X.Y.Z-arm64.dmg`, `Leaderborder-X.Y.Z-x64.dmg` | macOS app, Apple Silicon and Intel |
| `leaderborder-X.Y.Z.tgz` | npm package tarball (`npm pack` of `packages/client`) |
| `leaderborder.rb` | Homebrew formula (CLI), goes to `Formula/leaderborder.rb` in the tap |
| `leaderborder-cask.rb` | Homebrew cask (app), goes to `Casks/leaderborder.rb` in the tap |
| `SHA256SUMS` | checksums of all files above |

Every asset also gets a GitHub build provenance attestation (`actions/attest-build-provenance` in the `publish` job), verifiable with `gh attestation verify <asset> -R xaverric/leaderborder`.

## One-time setup

### npm

1. Create an account on https://www.npmjs.com and enable two-factor authentication (Account > Two-Factor Authentication, mode "Authorization and writes"). Keep that mode, it is what makes a leaked npm token useless for publishing.
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

Done: the tap lives at https://github.com/xaverric/homebrew-tap, cloned to `~/Documents/personal/homebrew-tap`. On a new machine:

```sh
git clone https://github.com/xaverric/homebrew-tap.git ~/Documents/personal/homebrew-tap
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
| Zone > Workers Routes | Edit | custom domain route declared in `wrangler.toml` |

Account Resources: include only your account. Zone Resources: include only the single zone `xaverric.cz` (this scopes both Zone permissions). Set an expiry (TTL) and rotate the token on each release cycle: create the new token, update the environment secret below, delete the old token.

### GitHub environment and secrets

Done: the deploy job runs in the GitHub environment `production`, which has a required reviewer (the owner) and a deployment branch policy that allows only `main` and `v*` tags. Every deploy waits in the Actions run until the reviewer approves it under "Review deployments". To recreate the branch policy on a new repository:

```sh
gh api -X PUT repos/xaverric/leaderborder/environments/production \
  -F "deployment_branch_policy[protected_branches]=false" \
  -F "deployment_branch_policy[custom_branch_policies]=true"
gh api -X POST repos/xaverric/leaderborder/environments/production/deployment-branch-policies -f name=main -f type=branch
gh api -X POST repos/xaverric/leaderborder/environments/production/deployment-branch-policies -f name='v*' -f type=tag
```

Add the required reviewer in Settings > Environments > production > Deployment protection rules > Required reviewers.

The Cloudflare values are environment secrets on `production`, never repository-level secrets: a repository secret is available to workflow runs on any branch, an environment secret only to a job that passed the environment's rules. `gh secret set` reads the value from stdin when `--body` is omitted, so the token never lands in your shell history:

```sh
gh secret set CLOUDFLARE_API_TOKEN --env production --repo xaverric/leaderborder
gh secret set CLOUDFLARE_ACCOUNT_ID --env production --repo xaverric/leaderborder
```

The Release workflow calls `deploy.yml` with `secrets: inherit`; the secrets are resolved inside the called workflow's `production` job. Without them the deploy job succeeds with a "Deploy skipped" notice. A manual run of **Deploy worker** (`workflow_dispatch`) deploys only from `main`.

Worker runtime secrets are separate and set once with wrangler (from `packages/worker`):

```sh
npx wrangler secret put GITHUB_CLIENT_SECRET
openssl rand -base64 32 | npx wrangler secret put SESSION_SECRET
```

`SESSION_SECRET` must have at least 32 characters, the Worker refuses shorter values.

### Who can sign in

Access is deny-by-default. `ALLOWED_GITHUB_LOGINS` and `ALLOWED_GITHUB_ORGS` in `packages/worker/wrangler.toml` list the GitHub logins and organizations that may sign in; with both empty nobody can. A fully public leaderboard needs an explicit `PUBLIC_ACCESS = "1"`. Changing the lists signs everyone out, because web sessions and device tokens are bound to the access policy. Device tokens expire after 90 days and web sessions after 7 days, users then sign in again.

Block a single user (web and device access stop immediately), from `packages/worker`:

```sh
npx wrangler d1 execute leaderborder --remote --command "UPDATE users SET blocked_at = datetime('now') WHERE login = '<login>'"
```

Users can delete their account and all its data themselves on the Devices page of the web app or with `DELETE /api/me`.

### GitHub CLI token

Authenticate `gh` with a fine-grained personal access token (GitHub Settings > Developer settings > Personal access tokens > Fine-grained tokens) limited to the two repositories `xaverric/leaderborder` and `xaverric/homebrew-tap`. Permissions: Contents and Pull requests read and write, Actions read and write, Secrets and Environments read and write while you set the Cloudflare secrets, Administration read and write only while you change rulesets or environments. Set an expiry, run `gh auth login` and paste the token when asked. Do not use a classic token with the `repo` and `workflow` scopes for daily work, it covers every repository of the account.

### Commit and tag signing

Release commits and `v*` tags must be signed. A ruleset lets only repository admins create `v*` tags, and a second ruleset requiring signed commits on `main` gets enabled once the owner's SSH signing key is uploaded to GitHub (Settings > SSH and GPG keys > New SSH key > key type "Signing Key"). Configure git in this checkout to sign with that key:

```sh
git config gpg.format ssh
git config user.signingkey ~/.ssh/id_ed25519.pub
git config commit.gpgsign true
git config tag.gpgsign true
```

GitHub then shows the commits and tags as "Verified".

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

2. Nothing to change in `packages/client/electron-builder.yml`: `mac.hardenedRuntime: true` is already set and no signing identity is pinned, so electron-builder uses the Developer ID certificate from `CSC_LINK`.

The Release workflow switches to the signed steps automatically when `CSC_LINK` is set: it passes the five secrets to electron-builder, which signs and notarizes both DMGs. Otherwise it builds unsigned.

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

   The tag must equal `v` + the version in `packages/client/package.json`, otherwise the workflow stops at the first step. Only repository admins can push `v*` tags, and with `commit.gpgsign` and `tag.gpgsign` on (see Commit and tag signing) both the commit and the annotated tag are signed.

4. Wait for the Release workflow:

   ```sh
   gh run list --workflow release.yml --limit 1
   gh run watch "$(gh run list --workflow release.yml --limit 1 --json databaseId --jq '.[0].databaseId')" --exit-status
   ```

   The last job, **Deploy worker**, pauses until the `production` deployment is approved. Open the run (`gh run view <id> --web`), click "Review deployments" and approve `production`.

5. Download and verify the release assets:

   ```sh
   mkdir -p ~/Downloads/leaderborder-X.Y.Z && cd ~/Downloads/leaderborder-X.Y.Z
   gh release download vX.Y.Z --repo xaverric/leaderborder
   shasum -a 256 -c SHA256SUMS
   for f in *.dmg *.tgz *.rb SHA256SUMS; do gh attestation verify "$f" -R xaverric/leaderborder; done
   ```

   `gh attestation verify` proves the asset was built by the Release workflow of this repository at the tagged commit.

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

Provenance: `npm publish --provenance --access public` links the package to the workflow run that built it, but it works only from a CI OIDC context (GitHub Actions), not from a laptop. Until npm Trusted Publishing is set up for `leaderborder`, publish locally with 2FA as above and keep `--access public`. Once Trusted Publishing is configured, the publish moves into a workflow that runs `npm publish --provenance --access public` and the local steps go away. 2FA for writes stays required either way.

Verify:

```sh
npm view leaderborder version
npx leaderborder@X.Y.Z --version
```

### Publish to the Homebrew tap

```sh
cd ~/Documents/personal/homebrew-tap
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

The Release workflow ends with the **Deploy worker** job (D1 migrations, then `wrangler deploy`), which runs after you approve the `production` deployment. Check it and the site:

```sh
gh run view "$(gh run list --workflow release.yml --limit 1 --json databaseId --jq '.[0].databaseId')"
curl -fsS https://leaderborder.xaverric.cz/api/config
curl -fsS https://leaderborder.xaverric.cz/api/public/stats
git rev-parse "vX.Y.Z^{commit}"
```

`/api/config` returns `build`, the commit the deploy job passed to wrangler as `GIT_SHA`. It must equal the commit the tag points to.

## Rollback

- **npm:** do not unpublish (it blocks the version number forever and breaks installs). Deprecate the bad version and publish a fixed patch release:

  ```sh
  npm deprecate leaderborder@X.Y.Z "Broken release, use X.Y.(Z+1)"
  ```

  If `latest` must point back to the previous version right away: `npm dist-tag add leaderborder@<previous> latest`.

- **Homebrew tap:** revert the release commit, users then get the previous formula and cask:

  ```sh
  cd ~/Documents/personal/homebrew-tap
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

  D1 migrations are forward only. Undo a schema change with a new migration. If a migration damaged data, restore the database to a minute before the deploy with D1 Time Travel and then fix forward (the restore also rewinds the `d1_migrations` table, so the corrected migration applies on the next deploy):

  ```sh
  npx wrangler d1 time-travel info leaderborder --timestamp "2026-09-24T10:00:00Z"
  npx wrangler d1 time-travel restore leaderborder --timestamp "2026-09-24T10:00:00Z"
  ```

## Static analysis and security reports

- **CodeQL** (`codeql.yml`), **Semgrep**, **ESLint security rules** and **zizmor** (`static-analysis.yml`) and **OpenSSF Scorecard** (`scorecard.yml`) upload their findings to GitHub Code Scanning on every push to `main`, on pull requests and weekly. Review them under Security > Code scanning; dismiss false positives there with a reason, do not silence rules in code.
- **Dependency review** (`dependency-review.yml`) fails a pull request that adds a dependency with a high or critical advisory or a GPL/AGPL license.
- **Weekly security report** (`security-report.yml`, Mondays) posts a summary of open code scanning alerts, Dependabot alerts and `npm audit` into the rolling issue "Security report". Run it on demand with `gh workflow run security-report.yml`.
- **SonarCloud** (`sonarcloud.yml`) runs when the `SONAR_TOKEN` repository secret exists. One-time setup: sign in at https://sonarcloud.io with GitHub, import `xaverric/leaderborder` into the organization `xaverric` (project key `xaverric_leaderborder`, matching `sonar-project.properties`), disable Sonar's "Automatic Analysis" for the project (CI analysis and automatic analysis cannot both be on), create a project token and store it with `gh secret set SONAR_TOKEN` (paste the value when prompted). The dashboard lives at https://sonarcloud.io/project/overview?id=xaverric_leaderborder and Sonar comments on pull requests.
- Adding a new third-party action requires allowing it under Settings > Actions > General (the repository only allows GitHub, verified creators and an explicit list) and pinning it to a full commit SHA.

## Incident and recovery

- **Leaked Cloudflare API token:** Cloudflare dashboard > My Profile > API Tokens > the token > Roll (or Delete and create a new one with the permissions above), then store the new value with `gh secret set CLOUDFLARE_API_TOKEN --env production --repo xaverric/leaderborder`. Check the account audit log for deploys you did not make and redeploy from `main` if in doubt.
- **Leaked or suspect `SESSION_SECRET`:** rotate it from `packages/worker`. This signs every web user out at once. At least 32 characters, the Worker refuses shorter values:

  ```sh
  openssl rand -base64 32 | npx wrangler secret put SESSION_SECRET
  ```

- **Abusive user:** block the login with the SQL under "Who can sign in". Web and device access stop immediately.
- **Bad migration or damaged data:** restore with D1 Time Travel as described under Rollback > Worker, then fix forward with a new migration.
- **Alerting:** configure Cloudflare notifications for 5xx and 429 spikes of the Worker in the dashboard (Notifications > Add > Workers), so an outage or an abuse wave does not go unnoticed.
