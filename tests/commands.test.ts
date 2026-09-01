import { describe, expect, it } from 'vitest';
import { SimulationEngine } from '../src/game/simulation/Engine';
import { findGroup } from '../src/game/simulation/GameState';

describe('production command boundaries', () => {
  it('rejects a whole multi-group order atomically when one regiment cannot obey', () => {
    const engine = new SimulationEngine();
    const state = engine.getState();
    const legion = findGroup(state, 'legion_i')!;
    const scouts = findGroup(state, 'scouts')!;
    scouts.routing = true;
    scouts.morale = 0;

    const originalFormation = legion.formation;
    const originalOrder = legion.order;
    const command = engine.dispatch('human', {
      type: 'order_groups',
      playerId: 'player',
      groupIds: ['legion_i', 'scouts'],
      order: 'move',
      destination: { x: 3000, y: 3600 },
      formation: 'wedge',
    });

    engine.step();
    const result = engine.getCommandResult(command.id);
    expect(result?.ok).toBe(false);
    if (result?.ok === false) expect(result.code).toBe('GROUP_ROUTING');
    expect(legion.formation).toBe(originalFormation);
    expect(legion.order).toEqual(originalOrder);
    expect(legion.path).toHaveLength(0);
  });

  it('queues waypoints through a typed command without mutating on dispatch', () => {
    const engine = new SimulationEngine();
    const group = findGroup(engine.getState(), 'legion_i')!;

    engine.dispatch('human', {
      type: 'order_groups',
      playerId: 'player',
      groupIds: [group.id],
      order: 'move',
      destination: { x: 2500, y: 3600 },
    });
    engine.step();
    const firstWaypoint = { ...group.path[0]! };
    const beforeAppend = group.path.length;

    const queued = engine.dispatch('human', {
      type: 'order_groups',
      playerId: 'player',
      groupIds: [group.id],
      order: 'move',
      destination: { x: 5600, y: 3600 },
      append: true,
    });
    expect(group.path).toHaveLength(beforeAppend);

    engine.step();
    expect(engine.getCommandResult(queued.id)?.ok).toBe(true);
    expect(group.path.length).toBeGreaterThan(beforeAppend);
    expect(group.path[0]).toEqual(firstWaypoint);
    expect(group.order.destination).toEqual({ x: 5600, y: 3600 });
  });

  it('accepts and acknowledges orders while battle time is paused', () => {
    const engine = new SimulationEngine();
    const group = findGroup(engine.getState(), 'legion_i')!;
    const tick = engine.getState().currentTick;
    const command = engine.dispatch('human', {
      type: 'order_groups',
      playerId: 'player',
      groupIds: [group.id],
      order: 'move',
      destination: { x: 3000, y: 3600 },
    });

    const results = engine.flushQueuedCommands();

    expect(results).toHaveLength(1);
    expect(engine.getCommandResult(command.id)?.ok).toBe(true);
    expect(engine.getState().currentTick).toBe(tick);
    expect(group.order.kind).toBe('move');
    expect(group.path.length).toBeGreaterThan(0);
  });

  it('rejects locations from another battlefield without changing the regiment', () => {
    const engine = new SimulationEngine({ scenarioId: 'riverwatch' });
    const group = findGroup(engine.getState(), 'legion_i')!;
    const command = engine.dispatch('debug', {
      type: 'order_groups',
      playerId: 'player',
      groupIds: [group.id],
      order: 'attack_zone',
      targetZone: 'cinder_gap',
    });

    engine.step();
    const result = engine.getCommandResult(command.id);
    expect(result?.ok).toBe(false);
    if (result?.ok === false) expect(result.message).toContain('not on this battlefield');
    expect(group.order.kind).toBe('idle');
    expect(group.path).toHaveLength(0);
  });
});
