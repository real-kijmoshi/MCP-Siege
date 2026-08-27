import { describe, expect, it } from 'vitest';
import type { WorkerAssignments } from '../src/game/types/domain';
import { SimulationEngine } from '../src/game/simulation/Engine';

interface ScheduledAssignment {
  tick: number;
  assignments: WorkerAssignments;
}

function runReplay(seed: number, schedule: ScheduledAssignment[]): string {
  const engine = new SimulationEngine(seed);
  for (let tick = 0; tick < 80; tick += 1) {
    for (const item of schedule.filter((candidate) => candidate.tick === tick)) {
      engine.dispatch('human', {
        type: 'assign_workers',
        playerId: 'player_kingdom',
        assignments: item.assignments,
      });
    }
    engine.step();
  }
  return JSON.stringify(engine.getSnapshot());
}

describe('replay determinism', () => {
  it('produces the same state for the same seed and ordered commands', () => {
    const schedule: ScheduledAssignment[] = [
      { tick: 3, assignments: { food: 6, wood: 4, stone: 1, iron: 1 } },
      { tick: 19, assignments: { food: 2, wood: 3, stone: 3, iron: 4 } },
      { tick: 45, assignments: { food: 5, wood: 5, stone: 2, iron: 0 } },
    ];

    expect(runReplay(42, schedule)).toBe(runReplay(42, schedule));
  });
});
