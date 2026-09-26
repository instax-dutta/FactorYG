import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MACHINES } from "../../content/machines";
import { getRecipe, RECIPES } from "../../content/recipes";
import { getResource } from "../../content/resources";
import type { MachineType, RecipeId, UnlockRequirement } from "../../content/types";
import { UNLOCKS } from "../../content/unlocks";
import type { SimulationStore } from "../../sim/store";
import type { SimulationSnapshot } from "../../sim/types";
import { useSimulationSnapshot } from "../hooks/useSimulationSnapshot";
import { getCommandReasonMessage, getMachineLabel } from "../presentation";

interface TechTreeProps {
  store: SimulationStore;
}

interface EntryBase {
  readonly key: string;
  readonly label: string;
  readonly cost: number;
  readonly requirement: UnlockRequirement | undefined;
}

interface MachineEntry extends EntryBase {
  readonly kind: "machine";
  readonly id: MachineType;
}

interface RecipeEntry extends EntryBase {
  readonly kind: "recipe";
  readonly id: string;
}

type TechEntry = MachineEntry | RecipeEntry;

type EntryState =
  | "unlocked"
  | "included"
  | "available"
  | "prerequisite-locked"
  | "unaffordable"
  | "unavailable";

interface ResolvedEntry {
  readonly entry: TechEntry;
  readonly state: EntryState;
  readonly reason: string | undefined;
  readonly missing: readonly string[];
}

interface Rejection {
  readonly snapshot: SimulationSnapshot;
  readonly label: string;
  readonly reason: string;
}

const machineUnlocks: Readonly<Partial<Record<MachineType, UnlockRequirement>>> =
  UNLOCKS.machineUnlocks;
const recipeUnlocks: Readonly<Partial<Record<RecipeId, UnlockRequirement>>> = UNLOCKS.recipeUnlocks;

const MACHINE_ENTRIES: readonly MachineEntry[] = buildMachineEntries();
const RECIPE_ENTRIES: readonly RecipeEntry[] = buildRecipeEntries();

const numberFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
});

const focusableSelector =
  "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex=\"-1\"])";

export function TechTree({ store }: TechTreeProps) {
  const snapshot = useSimulationSnapshot(store);
  const [open, setOpen] = useState(false);
  const [rejection, setRejection] = useState<Rejection | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setRejection(null);
  }, []);

  const purchase = useCallback(
    (entry: TechEntry) => {
      const result =
        entry.kind === "machine"
          ? store.dispatch({ type: "unlockMachine", machine: entry.id })
          : store.dispatch({ type: "unlockRecipe", recipeId: entry.id });

      setRejection(
        result.ok
          ? null
          : {
              snapshot: store.getSnapshot(),
              label: entry.label,
              reason: result.reason ?? "unknownUnlock",
            },
      );
    },
    [store],
  );

  useEffect(() => {
    if (!open || typeof document === "undefined") {
      return undefined;
    }

    const dialog = dialogRef.current;
    if (dialog === null) {
      return undefined;
    }

    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const portalElement = dialog.parentElement === document.body ? dialog : dialog.parentElement;
    const background = Array.from(document.body.children).filter(
      (child): child is HTMLElement =>
        child instanceof HTMLElement &&
        child !== portalElement &&
        !(portalElement?.contains(child) ?? false),
    );
    const backgroundStates = background.map((element) => ({
      element,
      inertAttribute: element.getAttribute("inert"),
      ariaHiddenAttribute: element.getAttribute("aria-hidden"),
    }));
    for (const { element } of backgroundStates) {
      element.setAttribute("inert", "");
      element.setAttribute("aria-hidden", "true");
    }

    closeRef.current?.focus();

    const handleKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close();
        return;
      }
      if (event.key !== "Tab") {
        return;
      }

      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector)).filter(
        (element) => element.getAttribute("aria-hidden") !== "true",
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (first === undefined || last === undefined) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const activeElement = document.activeElement;
      if (!(activeElement instanceof Node) || !dialog.contains(activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
        return;
      }
      if (event.shiftKey && activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      for (const state of backgroundStates) {
        if (state.inertAttribute === null) {
          state.element.removeAttribute("inert");
        } else {
          state.element.setAttribute("inert", state.inertAttribute);
        }
        if (state.ariaHiddenAttribute === null) {
          state.element.removeAttribute("aria-hidden");
        } else {
          state.element.setAttribute("aria-hidden", state.ariaHiddenAttribute);
        }
      }
      if (previousFocus?.isConnected === true) {
        previousFocus.focus();
      }
    };
  }, [close, open]);

  return (
    <>
      <button
        type="button"
        aria-label="Tech tree"
        aria-expanded={open}
        aria-controls="tech-tree-dialog"
        data-testid="tech-tree-toggle"
        onClick={() => {
          setOpen((isOpen) => !isOpen);
        }}
        style={toggleStyle}
      >
        Tech tree
      </button>
      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={dialogRef}
              id="tech-tree-dialog"
              role="dialog"
              aria-modal={true}
              aria-labelledby="tech-tree-title"
              data-testid="tech-tree"
              tabIndex={-1}
              style={backdropStyle}
            >
              <section aria-label="Tech tree unlocks" style={panelStyle}>
                <header style={panelHeaderStyle}>
                  <h2 id="tech-tree-title" style={{ margin: 0, fontSize: "1.25rem" }}>
                    Tech tree
                  </h2>
                  <button
                    ref={closeRef}
                    type="button"
                    aria-label="Close tech tree"
                    data-testid="tech-tree-close"
                    onClick={close}
                    style={buttonStyle}
                  >
                    Close
                  </button>
                </header>
                {rejection === null || rejection.snapshot !== snapshot ? null : (
                  <p
                    role="alert"
                    data-testid="tech-tree-error"
                    data-reason={rejection.reason}
                    style={alertStyle}
                  >
                    {rejection.label}: {getCommandReasonMessage(rejection.reason)}
                  </p>
                )}
                <div style={sectionStyle}>
                  <TechSection
                    label="Machines"
                    testId="tech-tree-machines"
                    entries={MACHINE_ENTRIES}
                    snapshot={snapshot}
                    store={store}
                    onPurchase={purchase}
                  />
                  <TechSection
                    label="Recipes"
                    testId="tech-tree-recipes"
                    entries={RECIPE_ENTRIES}
                    snapshot={snapshot}
                    store={store}
                    onPurchase={purchase}
                  />
                </div>
              </section>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

interface TechSectionProps {
  readonly label: string;
  readonly testId: string;
  readonly entries: readonly TechEntry[];
  readonly snapshot: SimulationSnapshot;
  readonly store: SimulationStore;
  readonly onPurchase: (entry: TechEntry) => void;
}

function TechSection({ label, testId, entries, snapshot, store, onPurchase }: TechSectionProps) {
  return (
    <section aria-label={label} data-testid={testId} style={{ marginBottom: 20 }}>
      <h3 style={{ margin: "0 0 8px", fontSize: "1rem" }}>{label}</h3>
      <ul style={listStyle}>
        {entries.map((entry) => {
          const resolved = resolveEntry(entry, snapshot, store);
          const purchasable = resolved.state === "available";

          return (
            <li
              key={entry.key}
              data-testid={`tech-tree-entry-${entry.key}`}
              data-state={resolved.state}
              data-cost={entry.cost}
              data-reason={resolved.reason}
              data-missing={resolved.missing.join(",")}
              style={entryStyle}
            >
              <div style={entryHeaderStyle}>
                <strong>{entry.label}</strong>
                <span data-testid={`tech-tree-cost-${entry.key}`}>
                  {entry.requirement === undefined ? "Included" : formatNumber(entry.cost)}
                </span>
              </div>
              <span
                data-testid={`tech-tree-requires-${entry.key}`}
                style={requiresStyle}
              >
                {describePrerequisites(entry)}
              </span>
              <button
                type="button"
                aria-label={`Unlock ${entry.label}`}
                data-testid={`tech-tree-unlock-${entry.key}`}
                disabled={!purchasable}
                title={resolveMessage(resolved)}
                onClick={() => {
                  onPurchase(entry);
                }}
                style={purchasable ? buttonStyle : disabledButtonStyle}
              >
                Unlock
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function resolveEntry(
  entry: TechEntry,
  snapshot: SimulationSnapshot,
  store: SimulationStore,
): ResolvedEntry {
  const owned =
    entry.kind === "machine"
      ? snapshot.unlockedMachines.includes(entry.id)
      : snapshot.unlockedRecipes.includes(entry.id);

  if (owned) {
    return { entry, state: "unlocked", reason: undefined, missing: [] };
  }

  if (entry.requirement === undefined) {
    return { entry, state: "included", reason: undefined, missing: [] };
  }

  const preflight =
    entry.kind === "machine"
      ? store.canUnlock({ kind: "machine", machine: entry.id })
      : store.canUnlock({ kind: "recipe", recipeId: entry.id });
  const missing = findMissing(entry, snapshot);

  if (preflight.ok) {
    return { entry, state: "available", reason: undefined, missing };
  }

  const reason = preflight.reason ?? "unknownUnlock";
  const state: EntryState =
    reason === "prerequisiteLocked"
      ? "prerequisite-locked"
      : reason === "insufficientCurrency"
        ? "unaffordable"
        : "unavailable";

  return { entry, state, reason, missing };
}

function resolveMessage(resolved: ResolvedEntry): string {
  if (resolved.state === "unlocked") {
    return "Already unlocked.";
  }
  if (resolved.state === "included") {
    return "Available from the start.";
  }
  if (resolved.state === "available") {
    return `Unlock for ${formatNumber(resolved.entry.cost)}`;
  }

  return getCommandReasonMessage(resolved.reason);
}

function buildMachineEntries(): readonly MachineEntry[] {
  return (Object.keys(MACHINES) as MachineType[])
    .map((type) => {
      const requirement = machineUnlocks[type];

      return {
        kind: "machine" as const,
        id: type,
        key: `machine-${type}`,
        label: getMachineLabel(type),
        cost: requirement?.cost ?? MACHINES[type].unlockCost,
        requirement,
      };
    })
    .sort(byCostThenId);
}

function buildRecipeEntries(): readonly RecipeEntry[] {
  return (Object.keys(RECIPES) as RecipeId[])
    .map((id) => {
      const requirement = recipeUnlocks[id];

      return {
        kind: "recipe" as const,
        id,
        key: `recipe-${id}`,
        label: getRecipeLabel(id),
        cost: requirement?.cost ?? RECIPES[id].unlockCost,
        requirement,
      };
    })
    .sort(byCostThenId);
}

function byCostThenId(left: TechEntry, right: TechEntry): number {
  return left.cost - right.cost || left.id.localeCompare(right.id);
}

function findMissing(entry: TechEntry, snapshot: SimulationSnapshot): readonly string[] {
  if (entry.requirement === undefined) {
    return [];
  }

  const missing: string[] = [];
  for (const machine of entry.requirement.requiresMachines) {
    if (!snapshot.unlockedMachines.includes(machine)) {
      missing.push(machine);
    }
  }
  for (const recipe of entry.requirement.requiresRecipes) {
    if (!snapshot.unlockedRecipes.includes(recipe)) {
      missing.push(recipe);
    }
  }

  return missing;
}

function describePrerequisites(entry: TechEntry): string {
  if (entry.requirement === undefined) {
    return "No prerequisites";
  }

  const labels = [
    ...entry.requirement.requiresMachines.map(getMachineLabel),
    ...entry.requirement.requiresRecipes.map(getRecipeLabel),
  ];

  return labels.length === 0 ? "No prerequisites" : `Requires ${labels.join(", ")}`;
}

function getRecipeLabel(id: string): string {
  const recipe = getRecipe(id);

  return recipe === undefined ? id : (getResource(recipe.output.resource)?.label ?? id);
}

function formatNumber(value: number): string {
  return Number.isFinite(value) ? numberFormatter.format(value) : "0";
}

const toggleStyle = {
  position: "absolute" as const,
  top: 400,
  left: 24,
  zIndex: 3,
  width: 240,
  minHeight: 38,
  border: "1px solid #58758a",
  borderRadius: 6,
  background: "#263746",
  color: "#f5f7fa",
  cursor: "pointer",
  font: "inherit",
  pointerEvents: "auto" as const,
};

const backdropStyle = {
  position: "fixed" as const,
  inset: 0,
  zIndex: 1000,
  display: "grid",
  placeItems: "center",
  padding: 24,
  background: "rgba(4, 8, 12, 0.68)",
  color: "#f5f7fa",
  fontFamily: "system-ui, sans-serif",
  pointerEvents: "auto" as const,
};

const panelStyle = {
  boxSizing: "border-box" as const,
  width: "min(520px, calc(100vw - 48px))",
  maxHeight: "calc(100vh - 48px)",
  overflowY: "auto" as const,
  padding: 24,
  border: "1px solid rgba(229, 242, 246, 0.35)",
  borderRadius: 10,
  background: "#101820",
  boxShadow: "0 18px 48px rgba(0, 0, 0, 0.4)",
  pointerEvents: "auto" as const,
};

const panelHeaderStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 16,
  marginBottom: 16,
};

const sectionStyle = {
  display: "grid",
  gap: 16,
};

const alertStyle = {
  margin: "0 0 16px",
  padding: "10px 12px",
  border: "1px solid #a4553f",
  borderRadius: 6,
  background: "rgba(120, 45, 30, 0.35)",
  color: "#f7d9d0",
  fontSize: "0.9rem",
};

const listStyle = {
  display: "grid",
  gap: 8,
  margin: 0,
  padding: 0,
  listStyle: "none",
};

const entryStyle = {
  display: "grid",
  gap: 4,
  padding: "10px 12px",
  border: "1px solid rgba(229, 242, 246, 0.22)",
  borderRadius: 6,
  background: "rgba(22, 32, 42, 0.9)",
};

const entryHeaderStyle = {
  display: "flex",
  alignItems: "baseline",
  justifyContent: "space-between",
  gap: 12,
};

const requiresStyle = {
  color: "#aab7bf",
  fontSize: "0.8rem",
};

const buttonStyle = {
  justifySelf: "start",
  minHeight: 34,
  padding: "0 12px",
  border: "1px solid #36c5b5",
  borderRadius: 5,
  background: "#1f4b4a",
  color: "#f5f7fa",
  cursor: "pointer",
  font: "inherit",
};

const disabledButtonStyle = {
  ...buttonStyle,
  border: "1px solid #58758a",
  background: "#34424c",
  color: "#c2cbd1",
  cursor: "not-allowed",
};

export default TechTree;
