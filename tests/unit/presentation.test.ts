import { describe, expect, it } from "vitest";
import { getCommandReasonMessage } from "../../src/ui/presentation";

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
] as const;

const UI_REACHABLE_REASONS = [
  ...new Set([...UNLOCK_REASONS, ...UPGRADE_REASONS, ...PRESTIGE_REASONS, ...EXPANSION_REASONS]),
];

const GENERIC_PREFIX = "The store refused that action";

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
