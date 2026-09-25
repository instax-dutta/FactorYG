## Purpose

Own approved Factor-I implementation plans.

## Ownership

- `plans/` contains task-level TDD plans, phase boundaries, interfaces, and verification commands.

## Local Contracts

- Plans state exact files, interfaces, red/green commands, and atomic commit boundaries.
- Plan text must match implemented file names and current architecture.
- Deferred work is recorded explicitly rather than hidden behind ambiguous tasks.

## Work Guidance

- Update the plan when a task dependency or durable contract changes.
- Keep phase exit criteria executable and aligned with the design specifications.

## Verification

- No documentation-only test command is defined.
- Run the commands named by the active plan when plan text accompanies code.

## Child DOX Index

- No child boundaries currently exist under `docs/superpowers/plans/`.
