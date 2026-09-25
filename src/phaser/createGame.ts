import Phaser from "phaser";
import { FactoryScene } from "./FactoryScene";
import { SimulationStore } from "../sim/store";
import type { SceneTelemetry } from "./telemetry";
import {
  createScaleConfig,
  DEFAULT_SURFACE_HEIGHT,
  DEFAULT_SURFACE_WIDTH,
} from "./scaleConfig";

export type FactoryGameReady = () => void;
export type FactoryGameTelemetry = (telemetry: SceneTelemetry) => void;

export function createFactoryGame(
  container: HTMLElement,
  store: SimulationStore,
  onReady: FactoryGameReady = () => undefined,
  onTelemetry: FactoryGameTelemetry = () => undefined,
): Phaser.Game {
  const scaleConfig = createScaleConfig(DEFAULT_SURFACE_WIDTH, DEFAULT_SURFACE_HEIGHT);
  const config: Phaser.Types.Core.GameConfig = {
    type: Phaser.AUTO,
    parent: container,
    width: scaleConfig.width,
    height: scaleConfig.height,
    backgroundColor: "#101820",
    scale: {
      mode: scaleConfig.mode,
      autoCenter: scaleConfig.autoCenter,
    },
    render: {
      antialias: true,
    },
    input: {
      activePointers: 2,
    },
    scene: [new FactoryScene(store, onReady, onTelemetry)],
  };

  return new Phaser.Game(config);
}
