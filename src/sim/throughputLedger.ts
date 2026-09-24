import { TICK_HZ, THROUGHPUT_WINDOW_TICKS } from '../config/constants';
import type { ResourceId } from './worldgen';

export interface ChainInfo {
  id: string;
  outputResource: ResourceId;
  steadyStateThroughput: number;
}

interface SaleSample {
  tick: number;
  resource: ResourceId;
}

interface SeededChain {
  chain: ChainInfo;
  tick: number;
}

export class ProductionLedger {
  private readonly windowTicks: number;
  private samples: SaleSample[] = [];
  private seeds = new Map<ResourceId, SeededChain>();
  private measurementStarts = new Map<ResourceId, number>();

  constructor(windowTicks = THROUGHPUT_WINDOW_TICKS) {
    this.windowTicks = windowTicks;
  }

  recordSale(resource: ResourceId, tick: number): void {
    const hasCurrentSample = this.samples.some(
      (sample) =>
        sample.resource === resource &&
        sample.tick >= tick - this.windowTicks &&
        sample.tick <= tick,
    );
    if (!hasCurrentSample) this.measurementStarts.set(resource, tick);
    this.samples.push({ tick, resource });
    this.prune(tick);
  }

  snapshot(tick: number): ChainInfo[] {
    this.prune(tick);
    const byResource = new Map<ResourceId, SaleSample[]>();
    for (const sample of this.samples) {
      const samples = byResource.get(sample.resource) ?? [];
      samples.push(sample);
      byResource.set(sample.resource, samples);
    }

    const resources = new Set<ResourceId>([
      ...byResource.keys(),
      ...this.seeds.keys(),
    ]);
    const result: ChainInfo[] = [];
    for (const resource of resources) {
      const samples = byResource.get(resource) ?? [];
      const firstTick = this.measurementStarts.get(resource);
      const complete = firstTick !== undefined && tick - firstTick >= this.windowTicks;
      if (complete) {
        result.push({
          id: `sold-${resource}`,
          outputResource: resource,
          steadyStateThroughput: samples.length / (this.windowTicks / TICK_HZ),
        });
        continue;
      }

      const seed = this.seeds.get(resource);
      if (
        seed &&
        tick >= seed.tick &&
        tick - seed.tick <= this.windowTicks
      ) {
        result.push({
          id: `sold-${resource}`,
          outputResource: seed.chain.outputResource,
          steadyStateThroughput: seed.chain.steadyStateThroughput,
        });
      }
    }

    return result.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  seed(chains: readonly ChainInfo[], currentTick: number): void {
    this.seeds.clear();
    const throughputByResource = new Map<ResourceId, number>();
    for (const chain of chains) {
      throughputByResource.set(
        chain.outputResource,
        (throughputByResource.get(chain.outputResource) ?? 0) + chain.steadyStateThroughput,
      );
    }
    for (const [outputResource, steadyStateThroughput] of throughputByResource) {
      this.seeds.set(outputResource, {
        chain: { id: `sold-${outputResource}`, outputResource, steadyStateThroughput },
        tick: currentTick,
      });
    }
  }

  clear(): void {
    this.samples = [];
    this.seeds.clear();
    this.measurementStarts.clear();
  }

  private prune(currentTick: number): void {
    const firstIncludedTick = currentTick - this.windowTicks;
    this.samples = this.samples.filter(
      (sample) => sample.tick >= firstIncludedTick && sample.tick <= currentTick,
    );
    const resources = new Set(this.samples.map((sample) => sample.resource));
    for (const resource of this.measurementStarts.keys()) {
      if (!resources.has(resource)) this.measurementStarts.delete(resource);
    }
  }
}
