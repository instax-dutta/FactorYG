import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sceneSource = readFileSync(
  resolve(process.cwd(), "src", "phaser", "FactoryScene.ts"),
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

  it("routes storage full through the same notice path as a completed sale", () => {
    const handler = renderEventHandlerSource();
    expect(handler).toMatch(/case "storageFull":\s*this\.renderNotice\(event\.worldX, event\.worldY\);/);
    expect(handler).toMatch(/case "saleCompleted":\s*this\.renderNotice\(event\.worldX, event\.worldY\);/);
  });

  it("keeps the render event switch exhaustive so a new variant cannot be dropped silently", () => {
    const handler = renderEventHandlerSource();
    expect(handler).toMatch(/default:/);
    expect(handler).toMatch(/this\.assertUnreachableRenderEvent\(event\)/);
    expect(sceneSource).toMatch(/assertUnreachableRenderEvent\(event: never\): never/);
  });
});
