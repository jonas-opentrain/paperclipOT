# Hourly Bug Intake Triage Sweep

Canonical runtime entrypoint:

- `tools/customer-support/support-bug-intake.mjs`

Supported commands:

- `hourly`
- `chatwoot`
- `evidence`
- `issues`

The Paperclip-side entrypoint is stable on purpose. It restores one canonical
path for OpenTrain wrappers and other callers, while keeping the provider- and
repo-specific collector implementation relocatable.

Collector runtime resolution order:

1. `OPENTRAIN_SUPPORT_BUG_INTAKE_RUNTIME`
2. `OPEN_TRAIN_SUPPORT_BUG_INTAKE_RUNTIME`
3. `scripts/support-bug-intake-runtime.mjs` relative to the invoking repo
4. `tools/support-bug-intake-runtime.mjs` relative to the invoking repo

Current contract:

- `--help` must work without extra setup and prove that the canonical
  Paperclip entrypoint exists.
- Live runs fail closed with actionable guidance when no collector runtime is
  configured.
- The collector implementation can move independently of the Paperclip
  entrypoint as long as callers still reach this canonical path first.
