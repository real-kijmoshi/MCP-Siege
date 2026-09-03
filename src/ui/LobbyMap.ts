import { MAP_HEIGHT, MAP_WIDTH } from '../game/config/battle';
import { BATTLE_MAPS, barrierCenterY, type BattleMapDefinition } from '../game/config/maps';
import type { GroupSpec, ScenarioDefinition } from '../game/config/scenario';
import { PALETTE } from '../rendering/canvas/palette';
import { ICON_CROWN, artHash, paintSprite } from '../rendering/canvas/pixelart';

/**
 * The battlefield portrait on the War Council table.
 *
 * Drawn, not photographed. The old home screen showed four hand-made images of
 * four maps, which meant a fifth battlefield had no portrait and a designed
 * operation had none at all — the one screen where a Marshal's own battle most
 * needs to be looked at before it is fought.
 *
 * So this reads the map data and the operation's deployment and paints them
 * with the game's own palette, at one canvas pixel per art pixel on a fixed
 * 320 × 200 buffer that CSS then scales up without smoothing. Every operation
 * gets a true portrait of the ground it is fought on, including one written
 * thirty seconds ago by an agent.
 */

const BUFFER_WIDTH = 320;
/** Derived, so the portrait keeps the field's proportions whatever it becomes. */
const BUFFER_HEIGHT = Math.round((BUFFER_WIDTH * MAP_HEIGHT) / MAP_WIDTH);
/** Map units per portrait pixel. Both axes share it, so nothing is stretched. */
const SCALE = MAP_WIDTH / BUFFER_WIDTH;

function tint(map: BattleMapDefinition, key: keyof BattleMapDefinition['ground'], fallback: string): string {
  return map.ground[key] ?? fallback;
}

function toPixelX(x: number): number {
  return Math.round(x / SCALE);
}

function toPixelY(y: number): number {
  return Math.round(y / SCALE);
}

/** Strength read as a block a few pixels across, so a portrait shows weight. */
function blockSize(strength: number): number {
  if (strength >= 800) return 5;
  if (strength >= 400) return 4;
  if (strength >= 150) return 3;
  return 2;
}

function groupStrength(group: GroupSpec): number {
  let total = 0;
  for (const [, count] of group.composition) total += count;
  return total;
}

export class LobbyMap {
  private readonly context: CanvasRenderingContext2D | null;

  public constructor(private readonly canvas: HTMLCanvasElement) {
    canvas.width = BUFFER_WIDTH;
    canvas.height = BUFFER_HEIGHT;
    this.context = canvas.getContext('2d');
    if (this.context !== null) this.context.imageSmoothingEnabled = false;
  }

  public draw(operation: ScenarioDefinition): void {
    const context = this.context;
    if (context === null) return;
    const map = BATTLE_MAPS[operation.mapId];

    this.paintGround(context, map);
    this.paintZones(context, map);
    this.paintBarrier(context, map);
    this.paintRoads(context, map);
    this.paintArmies(context, operation);
    this.paintFrame(context);
  }

  /** Two greens dithered against each other, exactly as the battlefield is. */
  private paintGround(context: CanvasRenderingContext2D, map: BattleMapDefinition): void {
    const grass = tint(map, 'grass', PALETTE.grass);
    const field = tint(map, 'openField', PALETTE.openField);
    context.fillStyle = grass;
    context.fillRect(0, 0, BUFFER_WIDTH, BUFFER_HEIGHT);
    context.fillStyle = field;
    for (let y = 0; y < BUFFER_HEIGHT; y += 1) {
      for (let x = 0; x < BUFFER_WIDTH; x += 1) {
        if (artHash(x, y) > 0.62) context.fillRect(x, y, 1, 1);
      }
    }
  }

  private paintZones(context: CanvasRenderingContext2D, map: BattleMapDefinition): void {
    for (const mere of map.meres) {
      this.disc(context, mere.center.x, mere.center.y, mere.radius, tint(map, 'river', PALETTE.river));
    }

    for (const zone of map.zones) {
      const radius = zone.radius;
      if (zone.terrain === 'forest') {
        this.speckledDisc(context, zone, tint(map, 'forestCanopy', PALETTE.forestCanopy), PALETTE.forest);
      } else if (zone.terrain === 'hill') {
        this.speckledDisc(context, zone, tint(map, 'hill', PALETTE.hill), tint(map, 'hillContour', PALETTE.hillContour));
      } else if (zone.terrain === 'village') {
        this.disc(context, zone.center.x, zone.center.y, radius * 0.7, tint(map, 'village', PALETTE.village));
        context.fillStyle = tint(map, 'villageRoof', PALETTE.villageRoof);
        for (let roof = 0; roof < 5; roof += 1) {
          const angle = roof * 1.9;
          const reach = radius * 0.42;
          context.fillRect(
            toPixelX(zone.center.x + Math.cos(angle) * reach),
            toPixelY(zone.center.y + Math.sin(angle) * reach),
            2,
            2,
          );
        }
      }
    }
  }

  /** The one feature that makes a map's geography binding, and its gaps. */
  private paintBarrier(context: CanvasRenderingContext2D, map: BattleMapDefinition): void {
    const barrier = map.barrier;
    if (barrier !== undefined) {
      const body = barrier.kind === 'ridge' ? PALETTE.stoneDark : tint(map, 'river', PALETTE.river);
      const edge = barrier.kind === 'ridge' ? PALETTE.stone : tint(map, 'riverEdge', PALETTE.riverEdge);
      for (let x = 0; x < BUFFER_WIDTH; x += 1) {
        const centre = barrierCenterY(barrier, x * SCALE);
        const top = toPixelY(centre - barrier.halfWidth);
        const height = Math.max(1, toPixelY(centre + barrier.halfWidth) - top);
        context.fillStyle = edge;
        context.fillRect(x, top - 1, 1, height + 2);
        context.fillStyle = body;
        context.fillRect(x, top, 1, height);
      }
    }

    for (const zone of map.zones) {
      if (!zone.crossing) continue;
      const width = Math.max(4, Math.round((zone.radius * 1.2) / SCALE));
      const x = toPixelX(zone.center.x) - Math.round(width / 2);
      const y = toPixelY(zone.center.y);
      context.fillStyle = tint(map, 'crossingEdge', PALETTE.crossingEdge);
      context.fillRect(x - 1, y - 4, width + 2, 9);
      context.fillStyle = tint(map, 'crossing', PALETTE.crossing);
      context.fillRect(x, y - 3, width, 7);
    }
  }

  private paintRoads(context: CanvasRenderingContext2D, map: BattleMapDefinition): void {
    context.fillStyle = tint(map, 'road', PALETTE.road);
    for (const road of map.roads) {
      for (let leg = 1; leg < road.length; leg += 1) {
        const from = map.zones.find((zone) => zone.id === road[leg - 1]);
        const to = map.zones.find((zone) => zone.id === road[leg]);
        if (from === undefined || to === undefined) continue;
        const steps = Math.ceil(
          Math.hypot(to.center.x - from.center.x, to.center.y - from.center.y) / SCALE,
        );
        for (let step = 0; step <= steps; step += 1) {
          const t = step / steps;
          context.fillRect(
            toPixelX(from.center.x + (to.center.x - from.center.x) * t),
            toPixelY(from.center.y + (to.center.y - from.center.y) * t),
            1,
            1,
          );
        }
      }
    }
  }

  /** Both orders of battle, as blocks whose size is the weight standing there. */
  private paintArmies(context: CanvasRenderingContext2D, operation: ScenarioDefinition): void {
    for (const [groups, fill, shade] of [
      [operation.enemyGroups, PALETTE.enemy, PALETTE.enemyDark] as const,
      [operation.playerGroups, PALETTE.player, PALETTE.playerDark] as const,
    ]) {
      for (const group of groups) {
        const size = blockSize(groupStrength(group));
        const x = toPixelX(group.anchor.x) - Math.floor(size / 2);
        const y = toPixelY(group.anchor.y) - Math.floor(size / 2);
        context.fillStyle = shade;
        context.fillRect(x - 1, y - 1, size + 2, size + 2);
        context.fillStyle = fill;
        context.fillRect(x, y, size, size);
      }
    }

    // The kings last, so nothing is ever drawn over the objective.
    for (const king of operation.kingSpecs) {
      const guard =
        operation.playerGroups.find((group) => group.id === king.guardGroupId) ??
        operation.enemyGroups.find((group) => group.id === king.guardGroupId);
      if (guard === undefined) continue;
      paintSprite(context, ICON_CROWN, toPixelX(guard.anchor.x), toPixelY(guard.anchor.y) - 4, 1);
    }
  }

  /** A dark vignette and a hard border: the portrait is a plate, not a window. */
  private paintFrame(context: CanvasRenderingContext2D): void {
    context.globalAlpha = 0.06;
    context.strokeStyle = '#080b07';
    for (let inset = 0; inset < 10; inset += 1) {
      context.strokeRect(
        inset + 0.5,
        inset + 0.5,
        BUFFER_WIDTH - inset * 2 - 1,
        BUFFER_HEIGHT - inset * 2 - 1,
      );
    }
    context.globalAlpha = 1;
    context.strokeStyle = PALETTE.mapEdge;
    context.strokeRect(0.5, 0.5, BUFFER_WIDTH - 1, BUFFER_HEIGHT - 1);
  }

  private disc(
    context: CanvasRenderingContext2D,
    centerX: number,
    centerY: number,
    radius: number,
    fill: string,
  ): void {
    const px = toPixelX(centerX);
    const py = toPixelY(centerY);
    const pr = Math.max(1, Math.round(radius / SCALE));
    context.fillStyle = fill;
    for (let y = -pr; y <= pr; y += 1) {
      const span = Math.floor(Math.sqrt(Math.max(0, pr * pr - y * y)));
      context.fillRect(px - span, py + y, span * 2 + 1, 1);
    }
  }

  /**
   * A disc broken up by the art hash, so woods and hills are not circles.
   *
   * The edge is eaten away increasingly towards the rim and the interior is
   * dithered with a second ink — the same two tricks the terrain bake uses, at
   * a twenty-fifth of the scale.
   */
  private speckledDisc(
    context: CanvasRenderingContext2D,
    zone: BattleMapDefinition['zones'][number],
    fill: string,
    detail: string,
  ): void {
    const px = toPixelX(zone.center.x);
    const py = toPixelY(zone.center.y);
    const pr = Math.max(1, Math.round(zone.radius / SCALE));
    for (let y = -pr; y <= pr; y += 1) {
      for (let x = -pr; x <= pr; x += 1) {
        const distance = Math.hypot(x, y) / pr;
        if (distance > 1) continue;
        const noise = artHash(px + x, py + y);
        // Rim pixels survive less and less often, which frays the outline.
        if (distance > 0.55 && noise < (distance - 0.55) * 2.1) continue;
        context.fillStyle = noise > 0.68 ? detail : fill;
        context.fillRect(px + x, py + y, 1, 1);
      }
    }
  }
}

