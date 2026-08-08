# ci-workflows

Reusable GitHub Actions workflows shared across all `ronniepinnell` repos.
Acts like an org `.github` repo without needing an org: the repo's Actions
access setting is set to **"Accessible from repositories owned by ronniepinnell"**,
so any repo under this account can call these via `workflow_call`.

## Usage

In a caller repo's workflow:

```yaml
jobs:
  gates:
    uses: ronniepinnell/ci-workflows/.github/workflows/node-gates.yml@main
    with:
      node-version: "22"
      runs-on: '["self-hosted","mothership"]'   # or "ubuntu-latest"
```

## Workflows

| Workflow | Purpose | Key inputs |
|---|---|---|
| `node-gates.yml` | npm ci → lint → typecheck → test | `node-version`, `working-directory`, `run-*` toggles, `runs-on` |
| `python-gates.yml` | install → ruff → pytest | `python-version`, `working-directory`, `run-*` toggles, `runs-on` |
| `secret-scan.yml` | gitleaks full-history scan | `runs-on` |

All workflows take a `runs-on` input so callers can route jobs to the
self-hosted runners (`mothership`, `auditor`) instead of paid GitHub minutes.

## Conventions

- Pin callers to `@main`; this repo treats `main` as stable.
- Changes here roll out to every caller on their next run — keep changes
  backward-compatible or add a new workflow file instead.
- Runner registration for new repos: `scripts/infra/register-runner.sh` in
  the benchsight repo (personal accounts require per-repo registration).
