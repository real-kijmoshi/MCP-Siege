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

  it('deploys heterogeneous regiments into distinct semantic slots atomically', () => {
    const engine = new SimulationEngine();
    const legion = findGroup(engine.getState(), 'legion_i')!;
    const archers = findGroup(engine.getState(), 'archers_i')!;
    const command = engine.dispatch('human', {
      type: 'deploy_formation',
      playerId: 'player',
      targetZone: 'central_field',
      assignments: [
        {
          groupId: legion.id,
          slot: 'front_left',
          order: 'attack_zone',
          formation: 'double_line',
          stance: 'aggressive',
        },
        {
          groupId: archers.id,
          slot: 'rear_right',
          order: 'defend_zone',
          formation: 'line',
          stance: 'hold_ground',
        },
      ],
    });

    expect(legion.order.kind).toBe('idle');
    expect(archers.order.kind).toBe('idle');
    engine.step();

    expect(engine.getCommandResult(command.id)?.ok).toBe(true);
    expect(legion.order.kind).toBe('attack_zone');
    expect(archers.order.kind).toBe('defend_zone');
    expect(legion.formation).toBe('double_line');
    expect(archers.formation).toBe('line');
    expect(legion.order.destination).not.toEqual(archers.order.destination);
    expect(legion.path.length).toBeGreaterThan(0);
    expect(archers.path.length).toBeGreaterThan(0);
  });

  it('rejects a whole custom deployment when one regiment cannot obey', () => {
    const engine = new SimulationEngine();
    const legion = findGroup(engine.getState(), 'legion_i')!;
    const scouts = findGroup(engine.getState(), 'scouts')!;
    const originalFormation = legion.formation;
    scouts.routing = true;
    scouts.morale = 0;
    const command = engine.dispatch('webmcp', {
      type: 'deploy_formation',
      playerId: 'player',
      targetZone: 'central_field',
      assignments: [
        { groupId: legion.id, slot: 'center', order: 'defend_zone', formation: 'wedge' },
        { groupId: scouts.id, slot: 'far_left', order: 'move', formation: 'loose' },
      ],
    });

    engine.step();
    expect(engine.getCommandResult(command.id)?.ok).toBe(false);
    expect(legion.order.kind).toBe('idle');
    expect(legion.formation).toBe(originalFormation);
    expect(legion.path).toHaveLength(0);
  });

  it('detaches one troop category without exposing or losing soldiers', () => {
    const engine = new SimulationEngine();
    const state = engine.getState();
    const source = findGroup(state, 'reserve_i')!;
    const originalStrength = source.members.length;
    const originalArchers = source.members.filter(
      (index) => state.units.categoryOf(index) === 'archer',
    ).length;
    expect(originalArchers).toBeGreaterThan(1);

    const command = engine.dispatch('webmcp', {
      type: 'detach_category',
      playerId: 'player',
      groupId: source.id,
      category: 'archer',
      percent: 50,
      newGroupName: 'Reserve Bow Wing',
    });
    engine.step();
    const result = engine.getCommandResult(command.id);
    expect(result?.ok).toBe(true);
    if (result?.ok !== true) return;

    const detachment = findGroup(state, result.data.newGroupId!)!;
    expect(detachment.members.length).toBeGreaterThan(0);
    expect(detachment.members.every((index) => state.units.categoryOf(index) === 'archer')).toBe(true);
    expect(source.members.length + detachment.members.length).toBe(originalStrength);
    expect(
      source.members.filter((index) => state.units.categoryOf(index) === 'archer').length,
    ).toBe(originalArchers - detachment.members.length);
  });
});
