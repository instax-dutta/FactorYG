import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  getCommandReasonMessage,
  getSaveRecoveryMessage,
  saveRecoveryFallback,
} from "../../src/ui/presentation";

const UNLOCK_REASONS = [
  "unknownUnlock",
  "alreadyUnlocked",
  "prerequisiteLocked",
  "insufficientCurrency",
] as const;

const UPGRADE_REASONS = ["entityNotFound", "unsupportedMachine", "insufficientCurrency"] as const;

const PRESTIGE_REASONS = ["insufficientLifetimeCurrency"] as const;

const EXPANSION_REASONS = [
  "outOfRange",
  "invalidGridStep",
  "expansionLocked",
  "gridShrink",
  "gridAlreadyExpanded",
  "entityOutOfBounds",
  "nodeOutOfBounds",
  "insufficientExpansionCost",
] as const;

const UI_REACHABLE_REASONS = [
  ...new Set([...UNLOCK_REASONS, ...UPGRADE_REASONS, ...PRESTIGE_REASONS, ...EXPANSION_REASONS]),
];

const GENERIC_PREFIX = "The store refused that action";

const commandsSource = readFileSync(resolve(process.cwd(), "src", "sim", "commands.ts"), "utf8");

const migrateSource = readFileSync(resolve(process.cwd(), "src", "persistence", "migrate.ts"), "utf8");

function commandReasons(): string[] {
  return [
    ...new Set(
      [...commandsSource.matchAll(/reason: "([A-Za-z]+)"/g)].map((match) => match[1] ?? ""),
    ),
  ].sort();
}

function saveFailureReasons(): string[] {
  const declaration = migrateSource.match(/export type SaveFailureReason =([^;]+);/);

  if (declaration === null || declaration[1] === undefined) {
    throw new Error("SaveFailureReason declaration not found in migrate.ts");
  }

  return [...declaration[1].matchAll(/"([A-Za-z]+)"/g)]
    .map((match) => match[1] ?? "")
    .sort();
}

describe("getCommandReasonMessage", () => {
  it("words every refusal the shipped UI can surface instead of echoing the reason", () => {
    for (const reason of UI_REACHABLE_REASONS) {
      const message = getCommandReasonMessage(reason);

      expect(message, reason).not.toContain(reason);
      expect(message, reason).not.toBe(`${GENERIC_PREFIX}: ${reason}.`);
      expect(message.endsWith("."), reason).toBe(true);
    }
  });

  it("words every grid expansion refusal the command can return", () => {
    for (const reason of EXPANSION_REASONS) {
      expect(getCommandReasonMessage(reason), reason).not.toContain("The store refused");
    }
  });

  it("lists every refusal a shipped command can return as reachable", () => {
    const reasons = commandReasons();

    expect(reasons.length).toBeGreaterThan(0);
    for (const reason of reasons) {
      expect(UI_REACHABLE_REASONS, reason).toContain(reason);
    }
  });

  it("gives every refusal a shipped command can return its own sentence", () => {
    for (const reason of commandReasons()) {
      const message = getCommandReasonMessage(reason);

      expect(message, reason).not.toBe(`${GENERIC_PREFIX}: ${reason}.`);
      expect(message, reason).not.toContain(reason);
    }
  });

  it("tells the player a locked plot needs a prestige rather than naming the refusal", () => {
    const message = getCommandReasonMessage("expansionLocked");

    expect(message).toContain("Prestige");
    expect(message).not.toContain("locked expansion");
  });

  it("keeps the generic copy for a reason it has never heard of", () => {
    expect(getCommandReasonMessage("someFutureReason")).toBe(
      `${GENERIC_PREFIX}: someFutureReason.`,
    );
  });

  it("keeps the generic copy when the store refuses without naming a reason", () => {
    expect(getCommandReasonMessage(undefined)).toBe(`${GENERIC_PREFIX}.`);
  });

  it("keeps copy for a command the store has not wired yet", () => {
    expect(getCommandReasonMessage("notImplemented")).not.toContain("notImplemented");
  });
});

describe("getSaveRecoveryMessage", () => {
  it("words every save rejection the persistence layer can report", () => {
    const reasons = saveFailureReasons();

    expect(reasons.length).toBeGreaterThan(0);
    for (const reason of reasons) {
      const message = getSaveRecoveryMessage(reason);

      expect(message, reason).not.toBe(saveRecoveryFallback);
      expect(message, reason).not.toContain(reason);
      expect(message.endsWith("."), reason).toBe(true);
    }
  });

  it("gives each save rejection its own sentence rather than one shared shrug", () => {
    const messages = saveFailureReasons().map((reason) => getSaveRecoveryMessage(reason));

    expect(new Set(messages).size).toBe(messages.length);
  });

  it("names the run as unread rather than a technical state", () => {
    for (const reason of saveFailureReasons()) {
      const message = getSaveRecoveryMessage(reason);

      expect(message, reason).toMatch(/saved run|this browser/i);
    }
  });

  it("keeps plain copy for a rejection a future build adds", () => {
    const message = getSaveRecoveryMessage("someFutureReason");

    expect(message).toBe(saveRecoveryFallback);
    expect(message).not.toContain("someFutureReason");
  });

  it("keeps plain copy when no reason is reported at all", () => {
    expect(getSaveRecoveryMessage(undefined)).toBe(saveRecoveryFallback);
  });
});
