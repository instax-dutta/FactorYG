## Purpose

- Own durable Factor-Y design, implementation-plan, and release documentation.

## Ownership

- `docs/superpowers/specs/` contains approved product and architecture designs.
- `docs/superpowers/plans/` contains executable task plans and verification contracts.
- `performance-baseline.md` is the committed large-grid tick baseline: the measured environment, the per-scenario mean, p95 and maximum, and the portable contract the release gate asserts. It is the owning document for that gate, so a change to how the simulation is measured or to what the gate accepts updates this file.
- Documentation must remain aligned with the source specification and implemented behavior.

## Local Contracts

- Keep decisions, constraints, interfaces, phase boundaries, and verification commands current.
- Do not add diary entries, temporary research output, secrets, or generated dependency artifacts.
- Use stable relative paths when linking to source files and plans.
- The performance baseline records one environment and says plainly that its millisecond figures are machine-relative, so a second environment is added as a new dated run rather than by overwriting the first. The committed table is the only one the release gate parses, and it is identified by its heading rather than by row order.

## Work Guidance

- Update the owning document when a meaningful design or workflow contract changes.
- Keep the approved source spec at `factor-y-2d-spec.md` as the product baseline.

## Verification

- No documentation-only test command is defined yet.
- Run the repository verification commands listed in the active implementation plan when documentation accompanies code.

## Child DOX Index

- `superpowers/AGENTS.md` - design specifications and implementation plans.
- `performance-baseline.md` - committed large-grid tick baseline and the portable contract the release gate asserts.
