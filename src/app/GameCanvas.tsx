import { useRef } from "react";

export function GameCanvas() {
  const canvasRef = useRef<HTMLDivElement>(null);

  return <div ref={canvasRef} data-testid="game-canvas" />;
}

export default GameCanvas;
