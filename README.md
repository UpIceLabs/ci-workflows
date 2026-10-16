# CI workflows

Portable GitHub Actions checks for public and private repositories. No tracker,
organization membership, deployment provider, or private service is required.

## Use a reviewed revision

Replace `REVIEWED_COMMIT_SHA` with a full 40-character commit from this repository.
Never use a moving branch for security-sensitive consumers. Update revisions
through reviewed dependency-update PRs, beginning with one pilot repository.

```yaml
name: Checks
on: [pull_request, push]
permissions:
  contents: read
jobs:
  secrets:
    uses: UpIceLabs/ci-workflows/.github/workflows/secret-scan.yml@REVIEWED_COMMIT_SHA
  python:
    uses: UpIceLabs/ci-workflows/.github/workflows/python-gates.yml@REVIEWED_COMMIT_SHA
```

Reusable workflows:

- `secret-scan.yml`: checksum-pinned Gitleaks CLI, full fetched history, redacted
  output. No organization license or caller secret needed. Failure blocks the job.
- `python-gates.yml`: install project dependencies, Ruff, pytest. Enabled tests
  fail when no tests are collected. Inputs: `python-version`, `working-directory`,
  `run-lint`, `run-tests`.
- `node-gates.yml`: npm ci, lint, typecheck, test. Missing enabled scripts fail.
  Inputs: `node-version`, `working-directory`, `run-lint`, `run-typecheck`, `run-tests`.

These initial workflows run on GitHub-hosted Ubuntu only. No runner-selection
input exists. Callers choose when workflows run; security scans should be invoked
on every PR without path filtering. Explicit `run-*` opt-outs are policy choices,
not passing checks. Repository dependencies and package scripts are executed;
run untrusted contributions only in disposable runners without privileged secrets.

## Reachability audit

The `reachability/` composite Action statically parses YAML and a repository's
`.github/ci-checks.json`. It checks declared security steps have unconditional
PR routes. It does not execute repository code, verify step semantics, inspect
live branch protection, or prove absence of vulnerabilities. Its process exits
nonzero for unreachable or invalid declarations; a caller may explicitly make it
advisory with `continue-on-error: true`, and must not describe that as enforcement.

```yaml
steps:
  - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4
    with:
      persist-credentials: false
  - uses: UpIceLabs/ci-workflows/reachability@REVIEWED_COMMIT_SHA
```

Example declaration for a local step:

```json
{"version":1,"checks":[{"id":"secrets","kind":"secret","workflow":".github/workflows/ci.yml","job":"verify","run":"gitleaks git --redact ."}]}
```

Remote reusable workflows need an exact `OWNER/REPO@REF=PATH` source mapping when
using the CLI; the composite Action automatically supplies its own library
revision. No remote library is downloaded implicitly. Unknown expressions,
matrices and dependency chains remain unproven. A PR can edit its own declaration;
protect CI policy changes with review and required checks outside this audit.

## Maintenance and security boundaries

- Keep permissions read-only; never use `pull_request_target` to execute PR code.
- Do not grant public projects access to persistent internal runner groups.
- Pin third-party Actions by full commit and downloaded binaries by checksum.
- Project dependency locking remains the consumer's responsibility. Python tool
  versions are pinned but their transitives are not hash-locked; this is not a
  fully hermetic build system.
- Require `verify` and `secret-scan / scan` on this library's main branch after
  checking their actual GitHub context names. Require review for workflow changes.
- Changes are distributed by consumer SHA updates, not automatic fleet-wide rollout.
- Generic utilities live here. Credentials, internal host inventories, deployment
  procedures, and operator logs belong in private repositories.

## Verify locally

Requires Node.js 22+, npm, Python 3.12+ and pytest.

```sh
npm ci --ignore-scripts --prefix reachability
npm test --prefix reachability
node --test tests/*.test.cjs
node reachability/check-reachability.cjs .
```

GitHub-hosted CI additionally installs the pinned tool versions and executes the
composite Action and full-history secret scan. A public-fork PR must be exercised
before claiming fork integration is verified.

## License

MIT; see LICENSE. Dependencies retain their own licenses. The package.json
`private` flag prevents accidental npm publication; it does not restrict GitHub use.
