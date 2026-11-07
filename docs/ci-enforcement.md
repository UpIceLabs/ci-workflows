# CI enforcement and reachability

Prefer enforcement in this order: impossible by construction, self-healing,
advisory reporting, then blocking gates. Every gate records an invariant that
could not yet be enforced by construction. New rules enter as advisory; promotion
requires recorded evidence that advisory reporting failed to prevent a breach.

| Tier | Policy |
| --- | --- |
| T0 | Tenancy, secrets, and migration version allocation block every PR without changed-surface filtering. Additional members require an explicit decision. |
| T1 | Correctness gates run for affected changes. |
| T2 | Advisory review findings; the default for new rules. |
| T3 | Continuous postsubmit checks for broad or expensive suites. |
| T4 | Delete obsolete checks or checks replaced by construction. |

An absent required check remains pending. It is not a passing verdict. An
unreachable gate must not count as enforced coverage. Do not widen a guard beyond
its owning design without a recorded decision, or bypass merge protections.
Constant failures need specific, owned baseline entries with written reasons and
expiry, rather than disabling the route. A defect stop condition must fail on the
base and pass after the repair for the intended reason.

## Checker interface

`node check-reachability.cjs REPOSITORY [MANIFEST]` reads
`.github/ci-checks.json` by default. It parses workflow YAML rather than counting
text matches. Each declaration names a workflow, job, and exact executable `run`
command or `uses` reference. A declaration can also specify a step ID.

The JSON report distinguishes automated reachability (PR or schedule) from
unconditional PR coverage. Missing declarations or malformed inputs exit 2;
unreachable checks or missing unconditional PR coverage exit 1; verified declared
coverage exits 0. This is a static route check, not proof that CI executed or that
a security test detects a real breach.

Local reusable workflows and explicitly mapped external libraries are followed recursively. Conditional jobs, filtered PR
triggers, jobs with dependencies, matrix jobs, and continue-on-error endpoints are conservatively
unproven. External libraries require an exact `OWNER/REPO@REF` source mapping. Declare the
actual security step in that library, rather than merely its caller: a checkout
step cannot stand in for a conditional scanner. Unknown libraries fail coverage.
The distributed action maps its own downloaded repository/ref automatically.
Other libraries can be audited locally with additional `--library` arguments.
Shell scripts and action internals are not interpreted: declare an exact executable
command/action and verify its behavior separately. Static coverage never proves a
live run or replaces a defect-specific stop condition.

Example declaration for a shared scanner:

```json
{
  "version": 1,
  "checks": [{
    "id": "secrets", "kind": "secret",
    "library": "ronniepinnell/ci-workflows@main",
    "workflow": ".github/workflows/secret-scan.yml",
    "job": "gitleaks", "uses": "gitleaks/gitleaks-action@v2"
  }]
}
```

```sh
node reachability/check-reachability.cjs /path/to/repo /path/to/repo/.github/ci-checks.json --library ronniepinnell/ci-workflows@main=/path/to/ci-workflows
```

The reusable `reachability.yml` workflow runs this checker in advisory mode by
default. Its warning is a failure finding, not passing evidence. `blocking: true`
is available after a recorded promotion decision. Security tests themselves stay
unconditional and blocking; advisory reachability does not weaken them.

Mutation tests remove the actual trigger and caller, and verify that the previously
reachable check becomes unreachable. Additional tests cover comment-only mentions,
conditional steps and jobs, changed-path filters, empty schedules, and cycles.

Invalid trigger shapes, absent runners, and missing required reusable inputs or
secrets cannot establish a route. Only standard numeric cron fields and the
implemented PR event types are proven; unsupported shapes remain unproven.
