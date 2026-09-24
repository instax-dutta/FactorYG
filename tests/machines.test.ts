import { describe, it, expect } from 'vitest';
import {
  MACHINES,
  ROTATIONS,
  isRotation,
  rotateCW,
  rotationDelta,
} from '../src/sim/machines';

describe('machines table (Phase 1 set)', () => {
  it('extractor requires node tile and has 1 output direction', () => {
    const extractor = MACHINES.extractor;
    expect(extractor.requiresNode).toBe(true);
    expect(extractor.inputs).toBe(0);
    expect(extractor.outputs).toBe(1);
    // 10 ticks per item at 10tps = one ore per second. TUNE_AFTER_PLAYABLE.
    expect(extractor.ticksPerItem).toBe(10);
  });

  it('belt has 1 input and 1 output', () => {
    expect(MACHINES.belt.inputs).toBe(1);
    expect(MACHINES.belt.outputs).toBe(1);
    expect(MACHINES.belt.requiresNode).toBe(false);
    // A belt carries its item exactly one cell per tick.
    expect(MACHINES.belt.ticksPerItem).toBe(1);
  });

  it('depot accepts N inputs', () => {
    expect(MACHINES.depot.inputs).toBeGreaterThanOrEqual(2);
    expect(MACHINES.depot.outputs).toBe(0);
  });

  it('rotation is 90° increments (0/90/180/270 only)', () => {
    expect(ROTATIONS).toEqual([0, 90, 180, 270]);
    expect(isRotation(0)).toBe(true);
    expect(isRotation(90)).toBe(true);
    expect(isRotation(180)).toBe(true);
    expect(isRotation(270)).toBe(true);
    expect(isRotation(45)).toBe(false);
    expect(isRotation(360)).toBe(false);
    expect(isRotation(-90)).toBe(false);

    expect(rotateCW(0)).toBe(90);
    expect(rotateCW(270)).toBe(0);
  });

  it('smelter has 1-2 inputs and 1 output side', () => {
    const smelter = MACHINES.smelter;
    expect(smelter.inputs).toBeGreaterThanOrEqual(1);
    expect(smelter.inputs).toBeLessThanOrEqual(2);
    expect(smelter.outputs).toBe(1);
    expect(smelter.requiresNode).toBe(false);
    // Craft time is per recipe (iron vs copper), not per machine.
    expect(smelter.ticksPerItem).toBeNull();
  });

  it('assembler has 2+ inputs and 1 output', () => {
    const assembler = MACHINES.assembler;
    expect(assembler.inputs).toBeGreaterThanOrEqual(2);
    expect(assembler.outputs).toBe(1);
    expect(assembler.requiresNode).toBe(false);
    expect(assembler.ticksPerItem).toBeNull();
  });

  it('silo buffers any resource', () => {
    const silo = MACHINES.silo;
    // It exists to absorb overflow, so it must hold far more than a belt.
    expect(silo.bufferSize).toBeGreaterThan(MACHINES.belt.bufferSize);
    expect(silo.acceptsAnyInput).toBe(true);
    expect(silo.ports.input).toBe('all');
  });

  it('maps rotation to a unit grid direction', () => {
    const deltas = ROTATIONS.map((rotation) => rotationDelta(rotation));
    for (const delta of deltas) {
      expect(Math.abs(delta.x) + Math.abs(delta.y)).toBe(1);
    }
    // Every rotation points somewhere unique.
    expect(new Set(deltas.map((delta) => `${delta.x},${delta.y}`)).size).toBe(4);
  });

  it('declares where items enter and leave every machine', () => {
    // Ports are data, not per-instance logic: everything with an output takes
    // input from any side except the one it feeds, which is what allows belt
    // runs to turn corners.
    expect(MACHINES.belt.ports).toEqual({ input: 'all-but-output', output: 'facing' });
    expect(MACHINES.extractor.ports).toEqual({ input: 'none', output: 'facing' });
    expect(MACHINES.depot.ports).toEqual({ input: 'all', output: 'none' });
    expect(MACHINES.smelter.ports).toEqual({ input: 'all-but-output', output: 'facing' });
    expect(MACHINES.assembler.ports).toEqual({ input: 'all-but-output', output: 'facing' });
    expect(MACHINES.silo.ports).toEqual({ input: 'all', output: 'facing' });
  });

  it('lists every machine the v1 spec allows, plus the crossing and splitter that unblock act 3', () => {
    expect(Object.keys(MACHINES).sort()).toEqual(
      ['assembler', 'belt', 'crossing', 'depot', 'extractor', 'silo', 'smelter', 'splitter'].sort(),
    );
  });
});
