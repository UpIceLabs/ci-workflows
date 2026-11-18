# CI library

Keep this package independent of private infrastructure and task trackers.
Run the README verification commands for code changes. Preserve failure exit
codes and explicit non-enforcement status for advisory checks. Changes to GitHub
workflows require review and real hosted CI evidence before release. Never add
secrets or privileged PR execution here, and do not make this library's own CI
depend on a persistent self-hosted runner. The reusable gates do take a `runs-on`
input, with a `vars.CI_RUNNER` fallback and `ubuntu-latest` as the default, so
callers (CEO decision, 2026-11-06, BEN-17190) choose their own runner; keep the
default hosted and keep the three workflows' expressions identical. Pin
third-party Actions and document consumer-facing compatibility changes.

Permissions are read-only by default. The one named exception is the opt-in
`cancel` job in `stuck-run-reaper.yml`, which has job-level `actions: write`
because cancelling a run needs it; the `report` job and the workflow level stay
read-only, and a caller must grant `actions: write` itself to enable it.
