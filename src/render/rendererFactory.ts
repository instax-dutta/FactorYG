import { WebGLRenderer } from 'three';
import type { WebGPURenderer } from 'three/webgpu';

export type RenderBackend = 'webgpu' | 'webgl2';
export type GameRenderer = WebGLRenderer | WebGPURenderer;

/** Pure backend choice, so fallback is testable without a GPU/canvas. */
export function selectBackend(webgpuAvailable: boolean): RenderBackend {
  return webgpuAvailable ? 'webgpu' : 'webgl2';
}

/**
 * Try the preferred factory and fall back if it throws. WebGPU is baseline on
 * modern browsers but WebGL2 remains the long-tail path, so a throwing
 * WebGPU path must never take the app down.
 */
export function resolveRenderer<T>(
  factories: { webgpu: () => T; webgl2: () => T },
  webgpuAvailable: boolean,
): T {
  if (webgpuAvailable) {
    try {
      return factories.webgpu();
    } catch {
      // fall through to the WebGL2 path
    }
  }
  return factories.webgl2();
}

export interface GpuProbe {
  requestAdapter(): Promise<unknown | null>;
}

export function isWebGpuAvailable(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator && !!navigator.gpu;
}

/**
 * `navigator.gpu` being present does not mean it works: headless/software
 * environments expose the API but return no adapter. Probe for a real adapter
 * (with a timeout so a hanging request cannot stall the boot) before choosing
 * the WebGPU path, otherwise the WebGL2 fallback would never be reached.
 */
export async function hasUsableWebGpu(gpu: GpuProbe | undefined, timeoutMs = 1500): Promise<boolean> {
  if (!gpu) return false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const adapter = await Promise.race([
      gpu.requestAdapter().catch(() => null),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
    return adapter != null;
  } catch {
    return false;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Real renderer creation. Construction is async (WebGPU needs adapter/device
 * init), so this is intentionally separate from the pure selection helpers.
 */
export async function createRenderer(): Promise<{
  backend: RenderBackend;
  renderer: GameRenderer;
}> {
  const usableWebGpu = isWebGpuAvailable()
    ? await hasUsableWebGpu(navigator.gpu as unknown as GpuProbe)
    : false;
  if (selectBackend(usableWebGpu) === 'webgpu') {
    try {
      const { WebGPURenderer } = await import('three/webgpu');
      const renderer = new WebGPURenderer({ antialias: true });
      await renderer.init();
      return { backend: 'webgpu', renderer };
    } catch {
      // fall through to the WebGL2 path
    }
  }

  return { backend: 'webgl2', renderer: new WebGLRenderer({ antialias: true }) };
}
