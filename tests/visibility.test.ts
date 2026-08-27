import { describe, expect, it } from 'vitest';
import { FOG_CELL_SIZE, FOG_COLUMNS } from '../src/game/config/gameplay';
import { GameQueries } from '../src/game/queries/GameQueries';
import { SimulationEngine } from '../src/game/simulation/Engine';

function fogIndex(x: number, y: number): number {
  return Math.floor(y / FOG_CELL_SIZE) * FOG_COLUMNS + Math.floor(x / FOG_CELL_SIZE);
}

describe('fog-of-war projections', () => {
  it('hides the enemy initially, remembers scouted terrain, and reveals only current contacts', () => {
    const engine = new SimulationEngine();
    const queries = new GameQueries(() => engine.getSnapshot());
    const opening = queries.getWorldView('player_kingdom');

    expect(opening.units.every((unit) => unit.ownerId === 'player_kingdom')).toBe(true);
    expect(opening.buildings.map((building) => building.id)).toEqual(['building_player_town_hall']);
    expect(opening.fog.cells).toContain(0);
    expect(opening.fog.cells).toContain(2);

    engine.dispatch('human', {
      type: 'move_units', playerId: 'player_kingdom', unitIds: ['unit_player_villager_01'],
      destination: { x: 1600, y: 930 },
    });
    for (let tick = 0; tick < 560; tick += 1) engine.step();
    expect(queries.getWorldView('player_kingdom').fog.cells[fogIndex(1600, 930)]).toBe(2);

    engine.dispatch('human', {
      type: 'move_units', playerId: 'player_kingdom', unitIds: ['unit_player_villager_01'],
      destination: { x: 2540, y: 390 },
    });
    for (let tick = 0; tick < 620; tick += 1) engine.step();
    const scouted = queries.getWorldView('player_kingdom');

    expect(scouted.fog.cells[fogIndex(1600, 930)]).toBe(1);
    expect(scouted.buildings.some((building) => building.ownerId === 'enemy_kingdom')).toBe(true);
    expect(queries.getGameOverview('player_kingdom').visibleThreatSummary).not.toBe('No enemy forces currently visible.');
  });
});
