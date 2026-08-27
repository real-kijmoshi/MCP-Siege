import {
  BUILDING_VISION_RADIUS, FOG_CELL_SIZE, FOG_COLUMNS, FOG_ROWS, UNIT_VISION_RADIUS,
} from '../config/gameplay';
import type { Vector2D } from '../types/domain';
import type { GameState, PlayerVisibilityState } from './GameState';

export const FOG_CELL_COUNT = FOG_COLUMNS * FOG_ROWS;

function cellIndex(column: number, row: number): number {
  return row * FOG_COLUMNS + column;
}

function revealCircle(visibility: PlayerVisibilityState, position: Vector2D, radius: number): void {
  const minColumn = Math.max(0, Math.floor((position.x - radius) / FOG_CELL_SIZE));
  const maxColumn = Math.min(FOG_COLUMNS - 1, Math.floor((position.x + radius) / FOG_CELL_SIZE));
  const minRow = Math.max(0, Math.floor((position.y - radius) / FOG_CELL_SIZE));
  const maxRow = Math.min(FOG_ROWS - 1, Math.floor((position.y + radius) / FOG_CELL_SIZE));
  const allowance = radius + FOG_CELL_SIZE * 0.72;
  for (let row = minRow; row <= maxRow; row += 1) {
    for (let column = minColumn; column <= maxColumn; column += 1) {
      const centerX = (column + 0.5) * FOG_CELL_SIZE;
      const centerY = (row + 0.5) * FOG_CELL_SIZE;
      if (Math.hypot(centerX - position.x, centerY - position.y) > allowance) continue;
      const index = cellIndex(column, row);
      visibility.visible[index] = true;
      visibility.explored[index] = true;
    }
  }
}

export function updateVisibility(state: GameState): void {
  for (const playerId of Object.keys(state.players).sort()) {
    const visibility = state.visibility[playerId] ?? { explored: [], visible: [] };
    visibility.explored.length = FOG_CELL_COUNT;
    visibility.visible = Array.from<boolean>({ length: FOG_CELL_COUNT }).fill(false);
    for (let index = 0; index < FOG_CELL_COUNT; index += 1) visibility.explored[index] ??= false;
    state.visibility[playerId] = visibility;

    for (const unit of Object.values(state.units).filter((entity) => entity.ownerId === playerId).sort((a, b) => a.id.localeCompare(b.id))) {
      revealCircle(visibility, unit.position, unit.type === 'villager' ? UNIT_VISION_RADIUS : UNIT_VISION_RADIUS + 70);
    }
    for (const building of Object.values(state.buildings).filter((entity) => entity.ownerId === playerId).sort((a, b) => a.id.localeCompare(b.id))) {
      const radius = building.type === 'watch_tower' ? BUILDING_VISION_RADIUS + 180 : BUILDING_VISION_RADIUS;
      revealCircle(visibility, building.position, radius);
    }
    for (const site of Object.values(state.strategicSites).filter((entity) => entity.controllingPlayerId === playerId).sort((a, b) => a.id.localeCompare(b.id))) {
      revealCircle(visibility, site.position, site.type === 'abandoned_watch_tower' ? 720 : 430);
    }
  }
}

export function visibilityAt(state: GameState, playerId: string, position: Vector2D): 'unexplored' | 'explored' | 'visible' {
  const column = Math.max(0, Math.min(FOG_COLUMNS - 1, Math.floor(position.x / FOG_CELL_SIZE)));
  const row = Math.max(0, Math.min(FOG_ROWS - 1, Math.floor(position.y / FOG_CELL_SIZE)));
  const visibility = state.visibility[playerId];
  const index = cellIndex(column, row);
  if (visibility?.visible[index]) return 'visible';
  if (visibility?.explored[index]) return 'explored';
  return 'unexplored';
}
