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
  Inputs: `runs-on`, `timeout-minutes` (default 10).
- `python-gates.yml`: install project dependencies, Ruff, pytest. Enabled tests
  fail when no tests are collected. Inputs: `python-version`, `working-directory`,
  `run-lint`, `run-tests`, `runs-on`, `timeout-minutes` (default 15).
- `node-gates.yml`: npm ci, lint, typecheck, test. Missing enabled scripts fail.
  Inputs: `node-version`, `working-directory`, `run-lint`, `run-typecheck`, `run-tests`, `runs-on`, `timeout-minutes` (default 15).
- `stuck-run-reaper.yml` (report only, read-only permissions everywhere) and
  `stuck-run-reaper-cancel.yml` (reports and cancels; the only workflow requesting
  `actions: write`, so only callers that choose it grant that permission). Both
  list the calling repository's runs that are queued longer than
  `queued-max-minutes` (default 120, from createdAt) or in_progress longer than
  `in-progress-max-minutes` (default 180, from startedAt), excluding their own
  run, up to 500 runs per status. They need the `gh` CLI on the runner (they fail
  with a clear message if it is missing; install it on self-hosted runners).
  Inputs: `queued-max-minutes`, `in-progress-max-minutes`, `exclude-workflows`
  (newline or comma list of workflow names or file names to skip, for deploy or
  nightly workflows that legitimately run longer than the thresholds), `runs-on`
  (REQUIRED, no default: hosted spend is frozen, so pass an allowed non-merge
  self-hosted runner such as `'["self-hosted","auditor"]'`; deliberately not
  `CI_RUNNER`, so the reaper does not queue behind the runs it reaps),
  `timeout-minutes` (default 5).

## Starter caller workflow

Copy `templates/ci-caller.yml` into the consumer repository and replace
`REVIEWED_COMMIT_SHA`. It sets a PR concurrency group that cancels superseded
PR runs only, a `timeout-minutes` on every job, an explicit `runs-on`
placeholder on each gate (hosted spend is frozen; no implicit ubuntu-latest), and
pinned calls to the gates. It does not call the reaper. A third-party consumer's own jobs need their own `timeout-minutes`:
a reusable gate's input only bounds the gate's job.

The reaper is a separate caller file (`templates/stuck-run-reaper-caller.yml`)
because it runs on `schedule`. Enable cancelling only after reviewing a
report-only run, then switch the caller to `stuck-run-reaper-cancel.yml` (the
commented variant in the template) and grant `actions: write` on that job.

## Runner selection

Every reusable workflow takes a `runs-on` string input. The runner is chosen in
this order:

1. The caller's `runs-on` input, a single label (`ubuntu-latest`) or a JSON array
   of labels (`'["self-hosted","linux-ci"]'`).
2. The caller's repository or organization variable `CI_RUNNER`, in the same format.
3. `ubuntu-latest`.

With no input and no `CI_RUNNER`, every workflow runs on GitHub-hosted Ubuntu, as
before. `CI_RUNNER` is read from the calling repository's variables, so set it
only where you mean every gate in that repository to move. Self-hosted use is
optional, and hosted runs remain the confirmation path.

```yaml
jobs:
  python:
    uses: UpIceLabs/ci-workflows/.github/workflows/python-gates.yml@REVIEWED_COMMIT_SHA
    with:
      runs-on: '["self-hosted","linux-ci"]'
```

Callers choose when workflows run; security scans should be invoked
on every PR without path filtering. Explicit `run-*` opt-outs are policy choices,
not passing checks. Repository dependencies and package scripts are executed;
run untrusted contributions only in disposable runners without privileged secrets.
This library does not provide or manage runners. A persistent self-hosted runner
that runs pull request code from forks or other untrusted sources is outside the
supported use; see the boundaries below.

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
- Do not grant public projects access to persistent internal runner groups, and
  do not point `runs-on` or `CI_RUNNER` at one for untrusted pull requests.
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
