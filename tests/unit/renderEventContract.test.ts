import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sceneSource = readFileSync(
  resolve(process.cwd(), "src", "phaser", "FactoryScene.ts"),
  "utf8",
);

const telemetrySource = readFileSync(
  resolve(process.cwd(), "src", "phaser", "telemetry.ts"),
  "utf8",
);

function renderEventHandlerSource(): string {
  const start = sceneSource.indexOf("private handleRenderEvent(");
  const end = sceneSource.indexOf("\n  private ", start + 1);
  return sceneSource.slice(start, end);
}

describe("render event handling contract", () => {
  it("consumes the storage full event instead of dropping it", () => {
    expect(renderEventHandlerSource()).toMatch(/case "storageFull":/);
  });

  it("routes storage full to the notice and a sale to its own depot burst, never sharing one visual", () => {
    const handler = renderEventHandlerSource();
    expect(handler).toMatch(/case "storageFull":\s*this\.renderNotice\(event\.worldX, event\.worldY\);/);
    expect(handler).toMatch(
      /case "saleCompleted":\s*if \(this\.vfxRenderer\.apply\(event\)\) \{\s*this\.renderTelemetry\.markDirty\(\);\s*\}\s*break;/,
    );
    expect(handler).not.toMatch(/case "saleCompleted":\s*this\.renderNotice\(/);
  });

  it("keeps the vfx renderer off the blocked producer and off the storage notice", () => {
    const handler = renderEventHandlerSource();
    const blockedHandler = handler.slice(
      handler.indexOf('case "blockedFull":'),
      handler.indexOf('case "storageFull":'),
    );
    const storageHandler = handler.slice(
      handler.indexOf('case "storageFull":'),
      handler.indexOf('case "saleCompleted":'),
    );

    expect(blockedHandler).not.toMatch(/vfxRenderer/);
    expect(storageHandler).not.toMatch(/vfxRenderer/);
  });

  it("gives the smelter heat its own overlay view rather than the machine sprite's own channels", () => {
    const scene = readFileSync(resolve(process.cwd(), "src", "phaser", "render", "VfxRenderer.ts"), "utf8");
    expect(scene).toMatch(/HEATED_MACHINE_TYPES/);
    expect(scene).toMatch(/setTint/);
    expect(scene).not.toMatch(/setAngle|baseTint|tintTopLeft/);
    expect(scene).toMatch(/SMELTER_HEAT_ASSET_KEY = "vfx\.heat"/);
    expect(scene).toMatch(/SALE_BURST_ASSET_KEY = "vfx\.coin"/);
  });

  it("keeps the render event switch exhaustive so a new variant cannot be dropped silently", () => {
    const handler = renderEventHandlerSource();
    expect(handler).toMatch(/default:/);
    expect(handler).toMatch(/this\.assertUnreachableRenderEvent\(event\)/);
    expect(sceneSource).toMatch(/assertUnreachableRenderEvent\(event: never\): never/);
  });

  it("routes a blocked producer through its own blink path and never through the sale notice", () => {
    const handler = renderEventHandlerSource();
    expect(handler).toMatch(/case "blockedFull":/);
    expect(handler).toMatch(/case "blockedFull":\s*this\.setEntityBlocked\(event\.entityId\);/);
    expect(handler).not.toMatch(/case "blockedFull":\s*this\.renderNotice\(/);
    expect(handler).not.toMatch(/case "saleCompleted":\s*this\.setEntityBlocked\(/);
  });

  it("never shares the one-shot sale spark with the blocked machine blink", () => {
    const blockedHandler = sceneSource.slice(
      sceneSource.indexOf("private setEntityBlocked("),
      sceneSource.indexOf("\n  private ", sceneSource.indexOf("private setEntityBlocked(") + 1),
    );
    expect(blockedHandler).toMatch(/this\.machineBlinker\.start\(/);
    expect(blockedHandler).not.toMatch(/renderNotice|vfx\.spark|this\.tweens\.add\(/);
  });

  it("clears the blink when the machine is removed, when the store unblocks it, or on shutdown", () => {
    const removedHandler = sceneSource.slice(
      sceneSource.indexOf('case "entityRemoved":'),
      sceneSource.indexOf("\n      case", sceneSource.indexOf('case "entityRemoved":') + 1),
    );
    expect(removedHandler).toMatch(/this\.machineBlinker\.stop\(event\.entityId\)/);

    const reconcile = sceneSource.slice(
      sceneSource.indexOf("private refreshBlockedMachines("),
      sceneSource.indexOf("\n  private ", sceneSource.indexOf("private refreshBlockedMachines(") + 1),
    );
    expect(reconcile).toMatch(/this\.store\.getBlockedMachineIds\(\)/);
    expect(reconcile).toMatch(/this\.machineBlinker\.stop\(entityId\)/);

    expect(sceneSource).toMatch(/this\.machineBlinker\?\.destroy\(\)/);
  });

  it("never stops a blink from a machine state change, because a blocked machine is also idle", () => {
    const handler = renderEventHandlerSource();
    const stateChanged = handler.slice(
      handler.indexOf('case "machineStateChanged":'),
      handler.indexOf('case "beltItemChanged":'),
    );
    expect(stateChanged).not.toMatch(/machineBlinker/);
  });

  it("publishes the blinking machine ids so a browser test can observe the blink", () => {
    expect(sceneSource).toMatch(/blockedEntityIds: \[\.\.\.this\.machineBlinker\.getBlinkingEntityIds\(\)\]\.sort\(/);
    expect(telemetrySource).toMatch(/readonly blockedEntityIds: readonly string\[\]/);
  });
});
