# CI library

Keep this package independent of private infrastructure and task trackers.
Run the README verification commands for code changes. Preserve failure exit
codes and explicit non-enforcement status for advisory checks. Changes to GitHub
workflows require review and real hosted CI evidence before release. Never add
persistent self-hosted runners, secrets, or privileged PR execution here. Pin
third-party Actions and document consumer-facing compatibility changes.
