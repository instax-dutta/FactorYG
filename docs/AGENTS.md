## Purpose

- Own durable Factor-Y design, implementation-plan, and release documentation.

## Ownership

- `docs/superpowers/specs/` contains approved product and architecture designs.
- `docs/superpowers/plans/` contains executable task plans and verification contracts.
- `performance-baseline.md` is the committed large-grid tick baseline: the measured environment, the per-scenario mean, p95 and maximum, and the portable contract the release gate asserts. It is the owning document for that gate, so a change to how the simulation is measured or to what the gate accepts updates this file.
- `release-checklist.md` is the release procedure for a Factor-I build: the ordered commands from clean install through art review, the two resets a player has, the prohibited non-goals and how each is checked, and the consequences a balance change has for a save already in a browser. It is the owning document for what a release requires, so a change to the required commands, to the browser suite's servers, or to the non-goal guard updates this file. It holds the procedure and not the result: the measured outcome of the most recent full verification belongs in the active plan's phase exit check and in that task's report, so a stale checklist cannot claim a green run.
- Documentation must remain aligned with the source specification and implemented behavior.

## Local Contracts

- Keep decisions, constraints, interfaces, phase boundaries, and verification commands current.
- Do not add diary entries, temporary research output, secrets, or generated dependency artifacts.
- Use stable relative paths when linking to source files and plans.
- The performance baseline records one environment and says plainly that its millisecond figures are machine-relative, so a second environment is added as a new dated run rather than by overwriting the first. The committed table is the only one the release gate parses, and it is identified by its heading rather than by row order.
- The release checklist states a check is satisfied only where a command or an automated guard proves it, and names the steps no command can perform rather than implying they are covered. A claim that an art sheet was reviewed, or that a sound is pleasant, is a human act and stays unclaimed until a human performs it.


## Work Guidance

- Update the owning document when a meaningful design or workflow contract changes.
- Keep the approved source spec at `factor-y-2d-spec.md` as the product baseline.

## Verification

- No documentation-only test command is defined yet.
- Run the repository verification commands listed in the active implementation plan when documentation accompanies code.

## Child DOX Index

- `superpowers/AGENTS.md` - design specifications and implementation plans.
- `performance-baseline.md` - committed large-grid tick baseline and the portable contract the release gate asserts.
- `release-checklist.md` - the release procedure, the prohibited non-goals, and the balance-change consequences for an existing save.
