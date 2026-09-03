import { MAP_HEIGHT, MAP_WIDTH } from '../../game/config/battle';
import type { BattleMapId, GroundTint, TerrainKind } from '../../game/config/maps';
import {
  ZONES,
  activeBattleMap,
  activeBattleMapId,
  activeCrossings,
  activeZones,
  barrierCenterAt,
  barrierHalfWidth,
  useBattleMap,
} from '../../game/simulation/Zones';
import type { ZoneId } from '../../game/types/domain';
import type { Camera } from './Camera';
import { PALETTE } from './palette';
import { LABEL_FONT } from './pixelart';

/**
 * The default tactical ground.
 *
 * This deliberately draws only information that changes a command: broad
 * terrain, roads, impassable barriers and crossings. The former decorative
 * renderer is preserved as `DetailedTerrainLayer` for a future style option.
 */
const MAP_SCALE = 8;
const WIDTH = Math.ceil(MAP_WIDTH / MAP_SCALE);
const HEIGHT = Math.ceil(MAP_HEIGHT / MAP_SCALE);

function terrainColor(terrain: TerrainKind, tint: GroundTint): string {
  switch (terrain) {
    case 'forest':
      return tint.forestCanopy ?? PALETTE.forestCanopy;
    case 'hill':
      return tint.hill ?? PALETTE.hill;
    case 'village':
      return tint.village ?? PALETTE.village;
    case 'ridge':
      return PALETTE.stoneDark;
    case 'open':
      return tint.openField ?? PALETTE.openField;
    default:
      return tint.grass ?? PALETTE.grass;
  }
}

/** Retained experiment; intentionally not used by the battlefield renderer. */
export class SchematicTerrainLayer {
  private builtFor: BattleMapId | undefined;
  private readonly bitmap: HTMLCanvasElement;

  public constructor(mapId?: BattleMapId) {
    this.bitmap = document.createElement('canvas');
    this.bitmap.width = WIDTH;
    this.bitmap.height = HEIGHT;
    if (mapId !== undefined) useBattleMap(mapId);
    this.rebuild();
  }

  public get artwork(): HTMLCanvasElement {
    return this.bitmap;
  }

  public syncTo(mapId: BattleMapId): void {
    if (this.builtFor === mapId) return;
    useBattleMap(mapId);
    this.rebuild();
  }

  private rebuild(): void {
    const context = this.bitmap.getContext('2d');
    if (context === null) return;
    const map = activeBattleMap();
    const tint = map.ground;
    this.builtFor = activeBattleMapId();
    context.clearRect(0, 0, WIDTH, HEIGHT);
    context.fillStyle = tint.grass ?? PALETTE.grass;
    context.fillRect(0, 0, WIDTH, HEIGHT);

    // Large, quiet shapes replace texture, props, buildings and scatter.
    for (const zone of activeZones()) {
      if (zone.crossing) continue;
      context.beginPath();
      context.ellipse(
        zone.center.x / MAP_SCALE,
        zone.center.y / MAP_SCALE,
        zone.radius / MAP_SCALE,
        (zone.radius * 0.78) / MAP_SCALE,
        0,
        0,
        Math.PI * 2,
      );
      context.fillStyle = terrainColor(zone.terrain, tint);
      context.fill();

      if (zone.terrain === 'hill') {
        context.strokeStyle = tint.hillContour ?? PALETTE.hillContour;
        context.lineWidth = 2;
        for (const size of [0.72, 0.44]) {
          context.beginPath();
          context.ellipse(
            zone.center.x / MAP_SCALE,
            zone.center.y / MAP_SCALE,
            (zone.radius * size) / MAP_SCALE,
            (zone.radius * size * 0.72) / MAP_SCALE,
            0,
            0,
            Math.PI * 2,
          );
          context.stroke();
        }
      }
    }

    // Roads are single clean strokes connecting authored tactical locations.
    context.lineCap = 'round';
    context.lineJoin = 'round';
    for (const route of map.roads) {
      context.beginPath();
      route.forEach((zoneId, index) => {
        const zone = ZONES[zoneId];
        const x = zone.center.x / MAP_SCALE;
        const y = zone.center.y / MAP_SCALE;
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });
      context.strokeStyle = PALETTE.earthDark;
      context.lineWidth = 9;
      context.stroke();
      context.strokeStyle = tint.road ?? PALETTE.road;
      context.lineWidth = 5;
      context.stroke();
    }

    this.paintBarrier(context, tint);
    this.paintMeres(context, tint);
    this.paintCrossings(context, tint);
    this.paintLandmarks(context, tint);
  }

  /**
   * A few large symbols make terrain recognizable without restoring the old
   * carpet of tiny props. Each zone gets at most five marks.
   */
  private paintLandmarks(context: CanvasRenderingContext2D, tint: GroundTint): void {
    const map = activeBattleMap();
    for (const zone of activeZones()) {
      const x = zone.center.x / MAP_SCALE;
      const y = zone.center.y / MAP_SCALE;
      const radius = zone.radius / MAP_SCALE;

      if (zone.terrain === 'forest') {
        const trees: ReadonlyArray<readonly [number, number, number]> = [
          [-0.42, 0.18, 1],
          [-0.18, -0.2, 0.85],
          [0.08, 0.12, 1.12],
          [0.34, -0.16, 0.92],
          [0.44, 0.3, 0.76],
        ];
        for (const [dx, dy, size] of trees) {
          const tx = x + dx * radius;
          const ty = y + dy * radius;
          context.fillStyle = PALETTE.timberDark;
          context.fillRect(tx - 1, ty, 2, 7 * size);
          context.fillStyle = tint.forestCanopy ?? PALETTE.forestCanopy;
          context.beginPath();
          context.moveTo(tx, ty - 15 * size);
          context.lineTo(tx - 9 * size, ty + 2 * size);
          context.lineTo(tx + 9 * size, ty + 2 * size);
          context.closePath();
          context.fill();
          context.strokeStyle = PALETTE.shadow;
          context.lineWidth = 1.5;
          context.stroke();
        }
      }

      if (zone.terrain === 'village') {
        const houses: ReadonlyArray<readonly [number, number]> = [
          [-0.32, -0.16],
          [0, -0.28],
          [0.3, -0.08],
          [-0.18, 0.24],
          [0.22, 0.28],
        ];
        for (const [dx, dy] of houses) {
          const hx = x + dx * radius;
          const hy = y + dy * radius;
          context.fillStyle = PALETTE.tentClothDark;
          context.fillRect(hx - 6, hy - 2, 12, 9);
          context.fillStyle = tint.villageRoof ?? PALETTE.villageRoof;
          context.beginPath();
          context.moveTo(hx - 8, hy - 2);
          context.lineTo(hx, hy - 9);
          context.lineTo(hx + 8, hy - 2);
          context.closePath();
          context.fill();
        }
      }

      if (zone.id === map.playerHomeZone || zone.id === map.enemyHomeZone) {
        const enemy = zone.id === map.enemyHomeZone;
        context.strokeStyle = enemy ? PALETTE.enemyDark : PALETTE.playerDark;
        context.lineWidth = 3;
        context.beginPath();
        context.arc(x, y, radius * 0.66, Math.PI * 0.08, Math.PI * 0.92);
        context.stroke();
        for (const offset of [-0.28, 0, 0.28]) {
          const tx = x + offset * radius;
          context.fillStyle = PALETTE.tentClothDark;
          context.fillRect(tx - 7, y + 3, 14, 7);
          context.fillStyle = enemy ? PALETTE.enemy : PALETTE.player;
          context.beginPath();
          context.moveTo(tx - 9, y + 3);
          context.lineTo(tx, y - 7);
          context.lineTo(tx + 9, y + 3);
          context.closePath();
          context.fill();
        }
      }
    }
  }

  private paintBarrier(context: CanvasRenderingContext2D, tint: GroundTint): void {
    const barrier = activeBattleMap().barrier;
    if (barrier === undefined) return;
    const half = barrierHalfWidth() / MAP_SCALE;
    const step = 40;
    context.beginPath();
    for (let x = 0; x <= MAP_WIDTH; x += step) {
      const y = barrierCenterAt(x) / MAP_SCALE - half;
      if (x === 0) context.moveTo(0, y);
      else context.lineTo(x / MAP_SCALE, y);
    }
    for (let x = MAP_WIDTH; x >= 0; x -= step) {
      context.lineTo(x / MAP_SCALE, barrierCenterAt(x) / MAP_SCALE + half);
    }
    context.closePath();
    context.fillStyle =
      barrier.kind === 'river' ? tint.river ?? PALETTE.river : PALETTE.stoneDark;
    context.fill();
    context.strokeStyle =
      barrier.kind === 'river' ? tint.riverEdge ?? PALETTE.riverEdge : PALETTE.stone;
    context.lineWidth = 3;
    context.stroke();
  }

  private paintMeres(context: CanvasRenderingContext2D, tint: GroundTint): void {
    for (const mere of activeBattleMap().meres) {
      context.beginPath();
      context.arc(
        mere.center.x / MAP_SCALE,
        mere.center.y / MAP_SCALE,
        mere.radius / MAP_SCALE,
        0,
        Math.PI * 2,
      );
      context.fillStyle = tint.river ?? PALETTE.river;
      context.fill();
      context.strokeStyle = tint.riverEdge ?? PALETTE.riverEdge;
      context.lineWidth = 3;
      context.stroke();
    }
  }

  private paintCrossings(context: CanvasRenderingContext2D, tint: GroundTint): void {
    const river = activeBattleMap().barrier?.kind === 'river';
    for (const crossing of activeCrossings()) {
      const x = crossing.center.x / MAP_SCALE;
      const y = barrierCenterAt(crossing.center.x) / MAP_SCALE;
      const width = Math.min(crossing.radius * 1.05, 520) / MAP_SCALE;
      const height = Math.max(barrierHalfWidth() * 2.35, 180) / MAP_SCALE;
      context.fillStyle = river
        ? tint.crossingEdge ?? PALETTE.crossingEdge
        : tint.grass ?? PALETTE.grass;
      context.fillRect(x - width / 2 - 2, y - height / 2, width + 4, height);
      context.fillStyle = river
        ? tint.crossing ?? PALETTE.crossing
        : tint.road ?? PALETTE.road;
      context.fillRect(x - width / 2, y - height / 2, width, height);
      if (river) {
        context.strokeStyle = PALETTE.timberDark;
        context.lineWidth = 1;
        for (let board = x - width / 2 + 4; board < x + width / 2; board += 6) {
          context.beginPath();
          context.moveTo(board, y - height / 2);
          context.lineTo(board, y + height / 2);
          context.stroke();
        }
      }
    }
  }

  public draw(context: CanvasRenderingContext2D, _camera: Camera, _tick = 0): void {
    context.imageSmoothingEnabled = false;
    context.drawImage(this.bitmap, 0, 0, MAP_WIDTH, MAP_HEIGHT);
  }

  public drawLabels(
    context: CanvasRenderingContext2D,
    camera: Camera,
    hoveredZone: ZoneId | undefined,
  ): void {
    const bounds = camera.visibleBounds;
    const unit = 1 / camera.zoom;
    const hovered = hoveredZone === undefined ? undefined : ZONES[hoveredZone];
    if (hovered !== undefined) {
      context.strokeStyle = hovered.crossing ? PALETTE.crossingLabel : PALETTE.selection;
      context.lineWidth = 3 * unit;
      context.beginPath();
      context.arc(hovered.center.x, hovered.center.y, hovered.radius, 0, Math.PI * 2);
      context.stroke();
    }

    context.font = `700 ${14 * unit}px ${LABEL_FONT}`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    for (const zone of activeZones()) {
      if (!zone.crossing && zone.id !== hoveredZone) continue;
      if (
        zone.center.x < bounds.left ||
        zone.center.x > bounds.right ||
        zone.center.y < bounds.top ||
        zone.center.y > bounds.bottom
      ) continue;
      const label = zone.name.toUpperCase();
      const y = zone.center.y - Math.min(zone.radius * 0.58, 230);
      const width = context.measureText(label).width + 16 * unit;
      const height = 20 * unit;
      context.fillStyle = 'rgba(10, 14, 9, 0.84)';
      context.fillRect(zone.center.x - width / 2, y - height / 2, width, height);
      context.fillStyle = zone.crossing ? PALETTE.crossingLabel : PALETTE.selection;
      context.fillText(label, zone.center.x, y);
    }
  }
}
