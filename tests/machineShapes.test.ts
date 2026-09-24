import { describe, it, expect } from 'vitest';
import { machineFootprint, outputMarkerOffset } from '../src/render/machineShapes';
import { MACHINES, ROTATIONS, rotationDelta, type MachineType } from '../src/sim/machines';
import { createEntityMesh } from '../src/render/EntityMeshFactory';

const TYPES = Object.keys(MACHINES) as MachineType[];

describe('machine shapes', () => {
  it('gives every machine a positive, cell-sized body', () => {
    for (const type of TYPES) {
      const { size, lift } = machineFootprint(type);
      expect({ type, fits: size.x > 0 && size.x <= 1 && size.z > 0 && size.z <= 1 }).toEqual({
        type,
        fits: true,
      });
      expect({ type, stands: size.y > 0 && lift > 0 }).toEqual({ type, stands: true });
    }
  });

  it('gives each machine type its own silhouette', () => {
    // The ghost is tinted by validity only, so shape is what tells a player which
    // machine is about to land: two identical silhouettes would be unreadable.
    const shapes = TYPES.map((type) => {
      const { size } = machineFootprint(type);
      return `${size.x}x${size.y}x${size.z}`;
    });
    expect(new Set(shapes).size).toBe(TYPES.length);
  });

  it('keeps belts flat and silos tall', () => {
    const belt = machineFootprint('belt');
    const silo = machineFootprint('silo');

    // The crossing rides below the belt line on purpose: its flow is not the
    // facing a silhouette suggests, so it must read as something else entirely.
    for (const type of TYPES.filter((entry) => entry !== 'belt' && entry !== 'crossing')) {
      expect({ type, flat: belt.size.y < machineFootprint(type).size.y }).toEqual({
        type,
        flat: true,
      });
    }
    expect(machineFootprint('crossing').size.y).toBeLessThan(belt.size.y);
    expect(silo.size.y).toBeGreaterThan(machineFootprint('assembler').size.y);
  });

  it('stands the real mesh on the same footprint the ghost previews', () => {
    for (const type of TYPES) {
      const { lift } = machineFootprint(type);
      expect({ type, lift: createEntityMesh(type, 90).position.y }).toEqual({ type, lift: lift });
    }
  });

  it('puts the output marker on the side the machine actually outputs', () => {
    const distance = 0.5;
    const expected: Record<number, { x: number; z: number }> = {
      0: { x: 0, z: -distance }, // north
      90: { x: distance, z: 0 }, // east
      180: { x: 0, z: distance }, // south
      270: { x: -distance, z: 0 }, // west
    };

    for (const rotation of ROTATIONS) {
      expect({ rotation, at: outputMarkerOffset(rotation, distance) }).toEqual({
        rotation,
        at: expected[rotation],
      });
    }
  });

  it('agrees with the grid direction the sim uses for that rotation', () => {
    // World axes match the grid's (see `cellToWorld`), so a mismatch here would
    // print the marker on the wrong side of a machine that outputs elsewhere.
    for (const rotation of ROTATIONS) {
      const delta = rotationDelta(rotation);
      const offset = outputMarkerOffset(rotation, 0.75);
      expect({ rotation, offset }).toEqual({ rotation, offset: { x: delta.x * 0.75, z: delta.y * 0.75 } });
    }
  });
});
