import { describe, expect, it } from 'vitest';
import { classifyConnection, classifyRun } from '../src/sim/connections';
import { projectPlacement } from '../src/sim/placement';
import { useUiStore } from '../src/ui/store';
import { Simulation } from '../src/sim/simulation';
import { startingUnlocks } from '../src/sim/techTree';

const emptyNeighbors = {
  north: null,
  east: null,
  south: null,
  west: null,
};

describe('placement connection quality', () => {
  it('classifies an isolated extractor as disconnected', () => {
    expect(
      classifyConnection(
        { type: 'extractor', rotation: 90 },
        emptyNeighbors,
      ),
    ).toBe('disconnected');
  });

  it('uses machine ports and rotations for required sides', () => {
    const extractor = { type: 'extractor' as const, rotation: 90 as const };
    const eastBelt = { type: 'belt' as const, rotation: 90 as const };
    const westBelt = { type: 'belt' as const, rotation: 90 as const };
    const eastDepot = { type: 'depot' as const, rotation: 0 as const };

    expect(
      classifyConnection(extractor, { ...emptyNeighbors, east: eastBelt }),
    ).toBe('connected');
    expect(
      classifyConnection(extractor, { ...emptyNeighbors, east: eastDepot }),
    ).toBe('connected');
    expect(
      classifyConnection(extractor, { ...emptyNeighbors, north: westBelt }),
    ).toBe('disconnected');

    const smelter = { type: 'smelter' as const, rotation: 90 as const };
    expect(
      classifyConnection(smelter, { ...emptyNeighbors, west: westBelt, east: eastDepot }),
    ).toBe('connected');
    expect(
      classifyConnection(smelter, { ...emptyNeighbors, west: westBelt }),
    ).toBe('partial');
    expect(classifyConnection(smelter, emptyNeighbors)).toBe('disconnected');

    expect(
      classifyConnection(
        { type: 'assembler', rotation: 90 },
        { ...emptyNeighbors, west: westBelt, east: eastDepot },
      ),
    ).toBe('connected');
    expect(
      classifyConnection(
        { type: 'silo', rotation: 90 },
        { ...emptyNeighbors, west: westBelt, east: eastDepot },
      ),
    ).toBe('connected');
    expect(
      classifyConnection(
        { type: 'silo', rotation: 90 },
        { ...emptyNeighbors, east: eastDepot },
      ),
    ).toBe('partial');
  });

  it('classifies depot, belt, splitter, and crossing by compatible neighbors', () => {
    const belt = { type: 'belt' as const, rotation: 90 as const };
    const eastBelt = { type: 'belt' as const, rotation: 90 as const };
    const westExtractor = { type: 'extractor' as const, rotation: 90 as const };
    const eastDepot = { type: 'depot' as const, rotation: 0 as const };
    const westDepot = { type: 'depot' as const, rotation: 0 as const };
    const splitter = { type: 'splitter' as const, rotation: 90 as const };
    const crossing = { type: 'crossing' as const, rotation: 0 as const };

    expect(classifyConnection({ type: 'depot', rotation: 0 }, { ...emptyNeighbors, west: westExtractor })).toBe(
      'connected',
    );
    expect(classifyConnection(belt, { ...emptyNeighbors, east: eastBelt })).toBe('connected');
    expect(classifyConnection(belt, { ...emptyNeighbors, west: westDepot })).toBe('disconnected');
    expect(classifyConnection(splitter, { ...emptyNeighbors, east: eastDepot })).toBe('connected');
    expect(classifyConnection(splitter, { ...emptyNeighbors, west: westDepot })).toBe('disconnected');
    expect(classifyConnection(crossing, { ...emptyNeighbors, west: westExtractor })).toBe('connected');
    expect(classifyConnection(crossing, emptyNeighbors)).toBe('disconnected');
  });

  it('treats a crossing as a four-direction output to a downstream consumer', () => {
    const crossing = { type: 'crossing' as const, rotation: 0 as const };
    const upstream = { type: 'extractor' as const, rotation: 90 as const };

    expect(
      classifyConnection(
        { type: 'depot', rotation: 0 },
        { ...emptyNeighbors, west: crossing },
      ),
    ).toBe('connected');
    expect(
      classifyConnection(crossing, { ...emptyNeighbors, west: upstream }),
    ).toBe('connected');

    const sim = new Simulation();
    sim.place('crossing', 10, 10, 0);
    expect(sim.previewAt('depot', 11, 10, 0)).toMatchObject({
      check: { ok: true },
      connection: 'connected',
      message: null,
    });
  });

  it('accepts the four neighbor views in directional order', () => {
    expect(
      classifyConnection(
        { type: 'extractor', rotation: 90 },
        [null, { type: 'belt', rotation: 90 }, null, null],
      ),
    ).toBe('connected');
  });

  it('classifies a proposed belt run against the whole batch', () => {
    const cells = [
      { cell: { x: 10, y: 10 }, rotation: 90 as const },
      { cell: { x: 11, y: 10 }, rotation: 90 as const },
    ];

    expect(classifyRun(cells, new Map())).toEqual(['connected', 'connected']);
  });

  it('does not mutate the existing entity map while classifying a run', () => {
    const existing = new Map([
      ['20,20', { type: 'depot' as const, rotation: 0 as const }],
    ]);
    const before = [...existing.entries()];
    classifyRun(
      [{ cell: { x: 20, y: 20 }, rotation: 90 as const }],
      existing,
    );
    expect([...existing.entries()]).toEqual(before);
  });
});

describe('placement projection', () => {
  it('keeps a legal disconnected machine accepted with an actionable message', () => {
    expect(projectPlacement('belt', { ok: true }, 'disconnected')).toEqual({
      check: { ok: true },
      connection: 'disconnected',
      message: 'Disconnected - this machine will idle',
    });
  });

  it('keeps the existing check shape and maps structural refusals to reasons', () => {
    expect(projectPlacement('belt', { ok: false, reason: 'occupied' }, 'disconnected')).toEqual({
      check: { ok: false, reason: 'occupied' },
      connection: 'disconnected',
      message: 'Cell occupied',
    });
    expect(projectPlacement('extractor', { ok: false, reason: 'no-resource-node' }, 'disconnected')).toEqual({
      check: { ok: false, reason: 'no-resource-node' },
      connection: 'disconnected',
      message: 'Extractor needs a resource node',
    });
    expect(projectPlacement('assembler', { ok: false, reason: 'locked' }, 'disconnected')).toEqual({
      check: { ok: false, reason: 'locked' },
      connection: 'disconnected',
      message: 'Unlock Assembler in Tech',
    });
  });

  it('publishes the projection through the UI store', () => {
    const preview = projectPlacement('belt', { ok: true }, 'disconnected');
    useUiStore.getState().setPlacementStatus(preview);
    expect(useUiStore.getState().placementStatus).toEqual(preview);
    useUiStore.getState().setPlacementStatus(null);
    expect(useUiStore.getState().placementStatus).toBeNull();
  });

  it('keeps structural checks separate from connection quality in the simulation', () => {
    const sim = new Simulation({ unlocked: startingUnlocks() });
    const locked = sim.previewAt('assembler', 30, 30, 90);
    expect(locked).toEqual({
      check: { ok: false, reason: 'locked' },
      connection: 'disconnected',
      message: 'Unlock Assembler in Tech',
    });

    const noNode = sim.previewAt('extractor', 30, 30, 90);
    expect(noNode.check).toEqual({ ok: false, reason: 'no-resource-node' });
    expect(noNode.message).toBe('Extractor needs a resource node');

    sim.place('belt', 30, 30, 90);
    expect(sim.previewAt('depot', 30, 30, 0).check).toEqual({ ok: false, reason: 'occupied' });

    const connectedSim = new Simulation();
    connectedSim.place('belt', 23, 24, 90);
    expect(connectedSim.previewAt('extractor', 22, 24, 90)).toMatchObject({
      check: { ok: true },
      connection: 'connected',
      message: null,
    });
  });
});
