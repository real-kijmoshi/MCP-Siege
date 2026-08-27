import { BUILDINGS, WORLD_HEIGHT, WORLD_WIDTH } from '../config/gameplay';
import type { BuildingType, Vector2D } from '../types/domain';
import type { GameSnapshot } from './GameState';

export interface PlacementCheck { valid: boolean; code?: string; message: string }

export function checkBuildingPlacement(
  state: Pick<GameSnapshot, 'buildings' | 'resourceNodes'>,
  buildingType: BuildingType,
  position: Vector2D,
): PlacementCheck {
  const definition = BUILDINGS[buildingType];
  if (!Number.isFinite(position.x) || !Number.isFinite(position.y) ||
      position.x < 50 || position.x > WORLD_WIDTH - 50 || position.y < 50 || position.y > WORLD_HEIGHT - 80) {
    return { valid: false, code: 'INVALID_PLACEMENT', message: 'Place the blueprint inside the buildable battlefield.' };
  }
  const collision = Object.values(state.buildings).some((building) =>
    Math.hypot(building.position.x - position.x, building.position.y - position.y) <
      BUILDINGS[building.type].footprint + definition.footprint);
  const blockedNode = Object.values(state.resourceNodes).some((node) =>
    node.remaining > 0 && Math.hypot(node.position.x - position.x, node.position.y - position.y) < definition.footprint + 55);
  return collision || blockedNode
    ? { valid: false, code: 'PLACEMENT_BLOCKED', message: 'That blueprint overlaps a structure or resource site.' }
    : { valid: true, message: 'Valid building location.' };
}
