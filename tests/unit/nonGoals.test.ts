import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SOUND_KEYS, getSoundAssetUrl } from "../../src/audio/assets";
import { MACHINES } from "../../src/content/machines";
import { RESOURCES } from "../../src/content/resources";

interface ApplicationFile {
  readonly relativePath: string;
  readonly text: string;
}

const ROOT = resolve(process.cwd());
const SOURCE_EXTENSIONS = [".ts", ".tsx", ".html"];
const SHIPPED_MACHINE_FIELDS = [
  "type",
  "footprint",
  "cost",
  "unlockCost",
  "inputBuffer",
  "outputBuffer",
  "bufferMode",
  "defaultProcessTicks",
  "ports",
  "spriteKey",
  "activeSpriteKey",
  "storageCapacity",
  "saleTerminal",
] as const;
const SHIPPED_PORT_FIELDS = ["id", "kind", "offset", "accepts"] as const;
const SHIPPED_MACHINE_TYPES = [
  "assembler",
  "belt",
  "depot",
  "extractor",
  "silo",
  "smelter",
] as const;

function collectSourceFiles(directory: string): ApplicationFile[] {
  const collected: ApplicationFile[] = [];

  for (const entry of readdirSync(directory)) {
    const absolutePath = join(directory, entry);
    if (statSync(absolutePath).isDirectory()) {
      collected.push(...collectSourceFiles(absolutePath));
      continue;
    }
    if (!SOURCE_EXTENSIONS.includes(extname(entry))) {
      continue;
    }
    collected.push({
      relativePath: relative(ROOT, absolutePath),
      text: readFileSync(absolutePath, "utf8"),
    });
  }

  return collected;
}

function collectFilesByExtension(directory: string, extension: string): string[] {
  const collected: string[] = [];

  for (const entry of readdirSync(directory)) {
    const absolutePath = join(directory, entry);
    if (statSync(absolutePath).isDirectory()) {
      collected.push(...collectFilesByExtension(absolutePath, extension));
    } else if (extname(entry) === extension) {
      collected.push(relative(ROOT, absolutePath));
    }
  }

  return collected;
}

const APPLICATION_FILES: readonly ApplicationFile[] = [
  ...collectSourceFiles(join(ROOT, "src")),
  {
    relativePath: "index.html",
    text: readFileSync(join(ROOT, "index.html"), "utf8"),
  },
];

function occurrences(pattern: RegExp): string[] {
  const found: string[] = [];

  for (const file of APPLICATION_FILES) {
    const lines = file.text.split("\n");
    for (const [index, line] of lines.entries()) {
      const match = pattern.exec(line);
      if (match !== null) {
        found.push(`${file.relativePath}:${index + 1} matched ${match[0]} in ${line.trim()}`);
      }
    }
  }

  return found;
}

function filesContaining(pattern: RegExp): string[] {
  return APPLICATION_FILES.filter((file) => pattern.test(file.text)).map(
    (file) => file.relativePath,
  );
}

function machineFieldOccurrences(pattern: RegExp): string[] {
  const found: string[] = [];

  for (const [type, definition] of Object.entries(MACHINES)) {
    for (const field of Object.keys(definition)) {
      if (pattern.test(`${type}.${field}`)) {
        found.push(`${type}.${field}`);
      }
    }
  }

  return found;
}

function portFieldOccurrences(pattern: RegExp): string[] {
  const found: string[] = [];

  for (const [type, definition] of Object.entries(MACHINES)) {
    for (const port of definition.ports) {
      for (const field of Object.keys(port)) {
        if (pattern.test(`${type}.${field}`)) {
          found.push(`${type}.${field}`);
        }
      }
    }
  }

  return found;
}

function contentIdOccurrences(pattern: RegExp): string[] {
  return [...Object.keys(MACHINES), ...Object.keys(RESOURCES)].filter((id) =>
    pattern.test(id),
  );
}

function expectNone(found: readonly string[], what: string): void {
  expect(found, `${what}:\n${found.join("\n")}`).toEqual([]);
}

const MULTIPLAYER_PATTERN =
  /\b(?:multiplayer|co-?op|lobbies|lobby|matchmaking|opponent|rival|peers|webrtc|broadcastchannel|invite-?code|joinserver|room[ -]?(?:id|code|key|owner|member|list)|(?:join|leave|create|host|open|close)\w*[ -]?room)\b/i;
const ABSOLUTE_URL_PATTERN = /\b(?:https?|wss?|ftp|ftps):\/\//i;
const TRANSPORT_PATTERN =
  /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|BroadcastChannel|importScripts|serviceWorker|Worker)\b/;
const COMBAT_PATTERN =
  /\b(?:combat|enemy|enemies|monster|monsters|creature|creatures|hitpoints|healthpoints|damagetaken|attackpower|weapons?|projectiles?|turret|turrets|spawnwave)\b/i;
const POWER_PATTERN =
  /\b(?:power|powerdraw|energies|energy|megawatt|kilowatt|watt|wattage|voltage|amperage|pylon|pylons|turbine|turbines|generator|generators|fuelcell)\b/i;
const FLUID_PATTERN =
  /\b(?:fluid|fluids|liquid|liquids|pipe|pipes|piped|piping|tank|tanks|pump|pumps|barrel|barrels|conduit|conduits|valve|valves|hose|slurry)\b/i;
const MODULE_SLOT_PATTERN =
  /\b(?:moduleslots?|module[ -]slots?|equipmodule|installedmodule|installmodule|unlockmodule|moduleinventory|slotcount|inventory[ -]?slots?)\b/i;
const RESPONSIVE_PATTERN =
  /@media|matchMedia|innerWidth|innerHeight|orientationchange|screen\.orientation|["']resize["']/;
const TOUCH_EVENT_PATTERN = /\btouch(?:start|end|move|cancel)\b|\bontouch(?:start|end|move|cancel)\b/i;
const MONETIZATION_PATTERN =
  /\b(?:stripe|paddle|paypal|braintree|checkout|billing|subscription|subscriptions|monetiz\w*|paywall|premium|microtransaction|freemium|inapppurchase|in-?app-?purchase|iap)\b/i;
const ACCOUNT_PATTERN =
  /\b(?:accounts?|login|logins|signin|sign-?ins|signup|sign-?ups|oauth|openid|jwt|bearer|profiles?|backend|credentials?|password|passwords|passwd|accountant)\b/i;

describe("release non-goals", () => {
  it("scans every shipped application source file rather than a sample", () => {
    const scanned = APPLICATION_FILES.map((file) => file.relativePath);

    expect(scanned.length).toBeGreaterThan(20);
    expect(scanned).toContain(join("src", "app", "App.tsx"));
    expect(scanned).toContain(join("src", "sim", "store.ts"));
    expect(scanned).toContain(join("src", "content", "machines.ts"));
    expect(scanned).toContain(join("src", "phaser", "createGame.ts"));
    expect(scanned).toContain("index.html");
  });

  it("ships no multiplayer, co-op, or peer-to-peer surface", () => {
    expectNone(occurrences(MULTIPLAYER_PATTERN), "multiplayer vocabulary in shipped source");
  });

  it("reaches no host other than the page's own origin", () => {
    const transportFiles = filesContaining(TRANSPORT_PATTERN);
    expect(
      transportFiles,
      `only the same-origin audio asset decoder may use a network transport, found one in: ${transportFiles.join(", ")}`,
    ).toEqual([join("src", "audio", "browserPlayer.ts")]);
    expect(occurrences(/\bfetch\b/)).toHaveLength(1);

    expectNone(
      occurrences(ABSOLUTE_URL_PATTERN),
      "absolute URLs in shipped source",
    );

    const urls = SOUND_KEYS.map((key) => getSoundAssetUrl(key));
    expectNone(
      urls.filter((url) => !url.startsWith("/") || url.startsWith("//") || url.includes(":")),
      "sound asset URLs that are not same-origin relative paths",
    );
  });

  it("ships no combat, enemy, or health content", () => {
    expectNone(occurrences(COMBAT_PATTERN), "combat vocabulary in shipped source");
    expectNone(contentIdOccurrences(COMBAT_PATTERN), "combat vocabulary in content ids");
    expectNone(machineFieldOccurrences(COMBAT_PATTERN), "combat fields on machine definitions");
    expect(
      Object.keys(MACHINES).sort(),
      `machine types beyond the six shipped: ${Object.keys(MACHINES).join(", ")}`,
    ).toEqual([...SHIPPED_MACHINE_TYPES]);
  });

  it("pins the machine and port field sets so a prohibited system cannot add a field unnoticed", () => {
    const fields = new Set(
      Object.values(MACHINES).flatMap((definition) => Object.keys(definition)),
    );
    expect(
      [...fields].sort(),
      `machine definition fields beyond the shipped set: ${[...fields].sort().join(", ")}`,
    ).toEqual([...SHIPPED_MACHINE_FIELDS].sort());

    const ports = Object.values(MACHINES).flatMap((definition) => definition.ports);
    const portFields = new Set(ports.flatMap((port) => Object.keys(port)));
    expect(
      [...portFields].sort(),
      `port definition fields beyond the shipped set: ${[...portFields].sort().join(", ")}`,
    ).toEqual([...SHIPPED_PORT_FIELDS].sort());

    const kinds = new Set(ports.map((port) => port.kind));
    expect([...kinds].sort()).toEqual(["input", "output"]);
  });

  it("ships no power grid system", () => {
    expectNone(occurrences(POWER_PATTERN), "power vocabulary in shipped source");
    expectNone(contentIdOccurrences(POWER_PATTERN), "power vocabulary in content ids");
    expectNone(machineFieldOccurrences(POWER_PATTERN), "power fields on machine definitions");
    expectNone(portFieldOccurrences(POWER_PATTERN), "power fields on port definitions");
  });

  it("ships no fluid or pipe system", () => {
    expectNone(occurrences(FLUID_PATTERN), "fluid vocabulary in shipped source");
    expectNone(contentIdOccurrences(FLUID_PATTERN), "fluid vocabulary in content ids");
    expectNone(machineFieldOccurrences(FLUID_PATTERN), "fluid fields on machine definitions");
  });

  it("ships no machine module slots", () => {
    expectNone(occurrences(MODULE_SLOT_PATTERN), "module slot vocabulary in shipped source");
    expectNone(contentIdOccurrences(MODULE_SLOT_PATTERN), "module slot vocabulary in content ids");
    expectNone(
      machineFieldOccurrences(MODULE_SLOT_PATTERN),
      "module slot fields on machine definitions",
    );
  });

  it("ships no responsive layout system", () => {
    expectNone(occurrences(RESPONSIVE_PATTERN), "responsive layout primitives in shipped source");

    const stylesheets = collectFilesByExtension(join(ROOT, "src"), ".css").concat(
      existsSync(join(ROOT, "public")) ? collectFilesByExtension(join(ROOT, "public"), ".css") : [],
    );
    expectNone(stylesheets, "stylesheet files that could carry a breakpoint");
  });

  it("ships no touch controls", () => {
    expectNone(occurrences(TOUCH_EVENT_PATTERN), "touch event handling in shipped source");
    expect(
      filesContaining(/touchAction/i),
      "touchAction belongs to the Phaser canvas surface alone",
    ).toEqual([join("src", "app", "GameCanvas.tsx")]);
  });

  it("ships no monetization or in-app purchase surface", () => {
    expectNone(occurrences(MONETIZATION_PATTERN), "monetization vocabulary in shipped source");
  });

  it("ships no backend account or cloud sync surface", () => {
    expectNone(occurrences(ACCOUNT_PATTERN), "account and cloud sync vocabulary in shipped source");
  });
});
