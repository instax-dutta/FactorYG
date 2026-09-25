import Phaser from "phaser";
import { FactoryScene } from "./FactoryScene";
import { SimulationStore } from "../sim/store";

export function createFactoryGame(container: HTMLElement, store: SimulationStore): Phaser.Game {
  const width = Math.max(container.clientWidth, 1);
  const height = Math.max(container.clientHeight, 1);
  const config: Phaser.Types.Core.GameConfig = {
    type: Phaser.AUTO,
    parent: container,
    width,
    height,
    backgroundColor: "#101820",
    scale: {
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    render: {
      antialias: true,
    },
    scene: [new FactoryScene(store)],
  };

  return new Phaser.Game(config);
}
