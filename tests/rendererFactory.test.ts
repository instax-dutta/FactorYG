import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { disposeEntityMesh } from '../src/render/EntityMeshFactory';
import { selectBackend, resolveRenderer, hasUsableWebGpu } from '../src/render/rendererFactory';

describe('renderer backend selection', () => {
  it('selects webgpu when available', () => {
    expect(selectBackend(true)).toBe('webgpu');

    const renderer = resolveRenderer(
      { webgpu: () => ({ kind: 'webgpu' }), webgl2: () => ({ kind: 'webgl2' }) },
      true,
    );
    expect(renderer.kind).toBe('webgpu');
  });

  it('only treats webgpu as available when an adapter can be acquired', async () => {
    await expect(hasUsableWebGpu({ requestAdapter: async () => ({}) })).resolves.toBe(true);
    await expect(hasUsableWebGpu({ requestAdapter: async () => null })).resolves.toBe(false);
    await expect(
      hasUsableWebGpu({
        requestAdapter: async () => {
          throw new Error('no adapter');
        },
      }),
    ).resolves.toBe(false);
    await expect(hasUsableWebGpu(undefined)).resolves.toBe(false);
  });

  it('does not stall the boot on a hanging adapter request', async () => {
    await expect(hasUsableWebGpu({ requestAdapter: () => new Promise(() => {}) }, 10)).resolves.toBe(false);
  });

  it('falls back to webgl2 when webgpu throws/unavailable', () => {
    expect(selectBackend(false)).toBe('webgl2');

    const renderer = resolveRenderer(
      {
        webgpu: () => {
          throw new Error('no adapter');
        },
        webgl2: () => ({ kind: 'webgl2' }),
      },
      true,
    );
    expect(renderer.kind).toBe('webgl2');
  });

  it('disposes grid and node-marker scene resources', () => {
    const root = new THREE.Group();
    const grid = new THREE.GridHelper(64, 64);
    const marker = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial(),
    );
    root.add(grid, marker);
    const gridMaterial = grid.material as THREE.Material;
    const gridGeometry = vi.spyOn(grid.geometry, 'dispose');
    const gridDispose = vi.spyOn(gridMaterial, 'dispose');
    const markerGeometry = vi.spyOn(marker.geometry, 'dispose');
    const markerDispose = vi.spyOn(marker.material as THREE.Material, 'dispose');

    disposeEntityMesh(root as unknown as THREE.Mesh);

    expect(gridGeometry).toHaveBeenCalledOnce();
    expect(gridDispose).toHaveBeenCalledOnce();
    expect(markerGeometry).toHaveBeenCalledOnce();
    expect(markerDispose).toHaveBeenCalledOnce();
  });
});
