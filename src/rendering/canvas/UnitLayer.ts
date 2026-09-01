import {
  CATEGORY_TOKEN,
  FORMATION_PROFILES,
  STRENGTH_ESTIMATE_GRANULARITY,
  TICKS_PER_SECOND,
} from '../../game/config/battle';
import { UNIT_CATEGORIES, FACTION_PLAYER, type ArmyGroup, type UnitCategory } from '../../game/types/domain';
import { activeGroups, type GameState } from '../../game/simulation/GameState';
import { visibilityAt } from '../../game/simulation/Visibility';
import type { Camera } from './Camera';
import { PALETTE, moraleColor } from './palette';

/**
 * Drawing the armies.
 *
 * The whole budget lives here, so units are batched by faction and category
 * into preallocated buffers and drawn with one fill per batch: fourteen fills
 * for eight thousand men. Level of detail switches to blocks and then to group
 * blobs as the camera pulls back, which is what keeps a huge battle legible
 * rather than turning it into noise.
 */

const CATEGORY_COUNT = UNIT_CATEGORIES.length;
const BATCH_COUNT = CATEGORY_COUNT * 2;
const CAPACITY = 10_000;

/**
 * Zoom below which individual men become blocks, then groups become blobs.
 *
 * The detail threshold used to sit at 0.5, well above the zoom anyone actually
 * commands from, so troop shape — the thing the counter matrix turns on — was
 * effectively never drawn. It is low enough now to be visible in normal play.
 */
const DETAIL_ZOOM = 0.34;
const BLOB_ZOOM = 0.2;

/** A group counts as in contact for this long after its last casualty. */
const ENGAGED_TICKS = TICKS_PER_SECOND * 3;

const SHAPE: Record<UnitCategory, 'square' | 'circle' | 'triangle' | 'diamond'> = {
  infantry: 'square',
  spearman: 'square',
  heavy_infantry: 'square',
  archer: 'circle',
  scout: 'circle',
  cavalry: 'triangle',
  siege: 'diamond',
};

const SIZE: Record<UnitCategory, number> = {
  infantry: 9,
  spearman: 9,
  heavy_infantry: 11,
  archer: 8,
  scout: 7,
  cavalry: 13,
  siege: 17,
};

/** Three shades per side keep categories distinguishable without a rainbow. */
function colorFor(faction: number, category: UnitCategory): string {
  const player = faction === FACTION_PLAYER;
  switch (category) {
    case 'heavy_infantry':
    case 'siege':
      return player ? PALETTE.playerDark : PALETTE.enemyDark;
    case 'archer':
    case 'scout':
    case 'cavalry':
      return player ? PALETTE.playerLight : PALETTE.enemyLight;
    default:
      return player ? PALETTE.player : PALETTE.enemy;
  }
}

export class UnitLayer {
  private readonly batchX: Float32Array[] = [];
  private readonly batchY: Float32Array[] = [];
  private readonly batchCount = new Int32Array(BATCH_COUNT);
  /** Scratch, cleared at the top of every use. Never carries state across frames. */
  private readonly roleCounts = new Int32Array(CATEGORY_COUNT);
  private readonly placedLabels: Array<{
    left: number;
    right: number;
    top: number;
    bottom: number;
  }> = [];

  public constructor() {
    for (let batch = 0; batch < BATCH_COUNT; batch += 1) {
      this.batchX.push(new Float32Array(CAPACITY));
      this.batchY.push(new Float32Array(CAPACITY));
    }
  }

  public draw(
    context: CanvasRenderingContext2D,
    camera: Camera,
    state: GameState,
    selected: ReadonlySet<string>,
  ): void {
    if (camera.zoom < BLOB_ZOOM) {
      this.drawBlobs(context, camera, state, selected);
      return;
    }

    this.fillBatches(camera, state);

    const detailed = camera.zoom >= DETAIL_ZOOM;
    for (let batch = 0; batch < BATCH_COUNT; batch += 1) {
      const count = this.batchCount[batch] ?? 0;
      if (count === 0) continue;

      const faction = batch < CATEGORY_COUNT ? 0 : 1;
      const category = UNIT_CATEGORIES[batch % CATEGORY_COUNT] as UnitCategory;
      const xs = this.batchX[batch];
      const ys = this.batchY[batch];
      if (xs === undefined || ys === undefined) continue;

      context.fillStyle = colorFor(faction, category);
      context.beginPath();

      if (detailed) {
        this.addDetailedShapes(context, SHAPE[category], SIZE[category], xs, ys, count);
      } else {
        // Below the detail threshold every man is the same small block; shape
        // is no longer readable, but density and colour still are.
        const size = Math.max(2.5 / camera.zoom, SIZE[category] * 0.8);
        const half = size / 2;
        for (let n = 0; n < count; n += 1) {
          context.rect((xs[n] ?? 0) - half, (ys[n] ?? 0) - half, size, size);
        }
      }
      context.fill();
    }

    this.drawGroupMarkers(context, camera, state, selected);
  }

  private addDetailedShapes(
    context: CanvasRenderingContext2D,
    shape: 'square' | 'circle' | 'triangle' | 'diamond',
    size: number,
    xs: Float32Array,
    ys: Float32Array,
    count: number,
  ): void {
    const half = size / 2;
    for (let n = 0; n < count; n += 1) {
      const x = xs[n] ?? 0;
      const y = ys[n] ?? 0;
      switch (shape) {
        case 'square':
          context.rect(x - half, y - half, size, size);
          break;
        case 'circle':
          // moveTo first, or the arcs chain together into one long path.
          context.moveTo(x + half, y);
          context.arc(x, y, half, 0, Math.PI * 2);
          break;
        case 'triangle':
          context.moveTo(x, y - half);
          context.lineTo(x + half, y + half);
          context.lineTo(x - half, y + half);
          context.closePath();
          break;
        case 'diamond':
          context.moveTo(x, y - half);
          context.lineTo(x + half, y);
          context.lineTo(x, y + half);
          context.lineTo(x - half, y);
          context.closePath();
          break;
      }
    }
  }

  /** One pass over the pool, bucketing visible units into per-batch buffers. */
  private fillBatches(camera: Camera, state: GameState): void {
    this.batchCount.fill(0);

    const units = state.units;
    const bounds = camera.visibleBounds;
    const margin = 60;
    const left = bounds.left - margin;
    const right = bounds.right + margin;
    const top = bounds.top - margin;
    const bottom = bounds.bottom + margin;

    for (let index = 0; index < units.count; index += 1) {
      if (units.alive[index] !== 1) continue;

      const x = units.x[index] ?? 0;
      if (x < left || x > right) continue;
      const y = units.y[index] ?? 0;
      if (y < top || y > bottom) continue;

      const faction = units.owner[index] ?? 0;
      // The enemy is drawn only where the player can actually see them.
      if (faction !== FACTION_PLAYER && visibilityAt(state, 'player', x, y) !== 2) continue;

      const batch = (faction === FACTION_PLAYER ? 0 : CATEGORY_COUNT) + (units.category[index] ?? 0);
      const slot = this.batchCount[batch] ?? 0;
      if (slot >= CAPACITY) continue;
      const xs = this.batchX[batch];
      const ys = this.batchY[batch];
      if (xs === undefined || ys === undefined) continue;
      xs[slot] = x;
      ys[slot] = y;
      this.batchCount[batch] = slot + 1;
    }
  }

  /**
   * Far out, individual men are sub-pixel. Each group collapses to a single
   * blob sized by its strength, which is the view a commander actually wants.
   */
  private drawBlobs(
    context: CanvasRenderingContext2D,
    camera: Camera,
    state: GameState,
    selected: ReadonlySet<string>,
  ): void {
    for (const group of activeGroups(state)) {
      const isPlayer = group.ownerId === 'player';
      if (!isPlayer && visibilityAt(state, 'player', group.anchor.x, group.anchor.y) !== 2) continue;

      const radius = Math.max(34, Math.sqrt(group.members.length) * 6.2);
      const frontage = FORMATION_PROFILES[group.formation].frontage;
      const halfWidth = radius * Math.max(0.62, Math.min(1.7, Math.sqrt(frontage)));
      const halfDepth = radius * Math.max(0.52, Math.min(1.35, 0.82 / Math.sqrt(frontage)));

      // Strategic zoom shows regiment footprints rather than thousands of
      // sub-pixel soldiers. The shape still tells the truth: a line is broad,
      // a column deep, and a square compact.
      context.save();
      context.translate(group.anchor.x, group.anchor.y);
      // Formation frontage is perpendicular to its facing.
      context.rotate(group.facing + Math.PI / 2);
      context.fillStyle = isPlayer ? PALETTE.player : PALETTE.enemy;
      context.strokeStyle = isPlayer ? PALETTE.playerLight : PALETTE.enemyLight;
      context.globalAlpha = 0.82;
      context.lineWidth = 2 / camera.zoom;
      context.beginPath();
      context.ellipse(0, 0, halfWidth, halfDepth, 0, 0, Math.PI * 2);
      context.fill();
      context.globalAlpha = 0.92;
      context.stroke();
      context.restore();

    }
    this.drawGroupMarkers(context, camera, state, selected);
  }

  /**
   * Labels, selection rings and contact markers.
   *
   * Every group that can be seen gets a label, not only friendly ones: a bare
   * red blob told a commander nothing about what was bearing down on him. The
   * two hard problems here are crowding — at strategic zoom a dozen labels used
   * to pile into unreadable mush — and knowing where the fighting actually is,
   * which no amount of zooming out could previously show.
   */
  private drawGroupMarkers(
    context: CanvasRenderingContext2D,
    camera: Camera,
    state: GameState,
    selected: ReadonlySet<string>,
  ): void {
    const bounds = camera.visibleBounds;
    const fontSize = 13 / camera.zoom;
    context.font = `600 ${fontSize}px ui-monospace, "SF Mono", Menlo, monospace`;
    context.textAlign = 'center';
    context.textBaseline = 'bottom';

    // Draw order decides which labels survive a collision, so rank the groups
    // by what a commander most needs to read: what he has selected, then what
    // is in contact, then the largest formations.
    const visible: ArmyGroup[] = [];
    for (const group of activeGroups(state)) {
      const { x, y } = group.anchor;
      if (x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom) continue;
      if (group.ownerId !== 'player' && visibilityAt(state, 'player', x, y) !== 2) continue;
      visible.push(group);
    }
    visible.sort((a, b) => this.labelPriority(state, b, selected) - this.labelPriority(state, a, selected));

    this.placedLabels.length = 0;

    // A selected regiment answers an order immediately with its real route,
    // including crossing and obstacle waypoints. This is command feedback, not
    // hidden information: it is the route the player's own order just created.
    if (selected.size <= 4) {
      for (const group of visible) {
        if (selected.has(group.id)) this.drawOrderPath(context, camera, group);
      }
    } else {
      // A whole-army order should not turn the map into ten identical green
      // spiderwebs. One destination marker confirms the shared intent; paths
      // return when the commander narrows the selection.
      const lead = visible.find((group) => selected.has(group.id) && group.path.length > 0);
      const destination = lead?.path[lead.path.length - 1];
      if (destination !== undefined) this.drawDestination(context, camera, destination.x, destination.y);
    }

    for (const group of visible) {
      const isPlayer = group.ownerId === 'player';
      const { x, y } = group.anchor;
      const spread = Math.max(40, Math.sqrt(group.members.length) * 8);
      const labelY = y - spread - 10 / camera.zoom;
      // `lastCasualtyTick` starts at -1, so a bare subtraction reads every
      // regiment as engaged on the opening tick.
      const engaged =
        group.lastCasualtyTick >= 0 && state.currentTick - group.lastCasualtyTick < ENGAGED_TICKS;

      if (selected.has(group.id)) {
        context.strokeStyle = PALETTE.selection;
        context.lineWidth = 2.5 / camera.zoom;
        context.beginPath();
        context.arc(x, y, spread + 14 / camera.zoom, 0, Math.PI * 2);
        context.stroke();
      }

      // A contact ring, drawn for both sides and at every zoom. This is the
      // one mark that answers "where is the battle" from across the map.
      if (engaged) this.drawContactRing(context, camera, state, x, y, spread);

      const text = this.labelText(state, group, isPlayer);
      if (!this.claimLabel(camera, x, labelY, text.length)) continue;

      context.fillStyle = selected.has(group.id)
        ? PALETTE.selection
        : isPlayer
          ? 'rgba(226, 238, 226, 0.78)'
          : 'rgba(255, 178, 170, 0.86)';
      context.fillText(text, x, labelY);

      // Morale is the player's own business; an enemy's is not observable.
      if (!isPlayer) continue;

      const barWidth = 84 / camera.zoom;
      const barHeight = 4 / camera.zoom;
      const barY = labelY + 4 / camera.zoom;
      context.fillStyle = 'rgba(0, 0, 0, 0.45)';
      context.fillRect(x - barWidth / 2, barY, barWidth, barHeight);
      context.fillStyle = moraleColor(group.morale);
      context.fillRect(x - barWidth / 2, barY, (barWidth * group.morale) / 100, barHeight);
    }
  }

  private drawOrderPath(
    context: CanvasRenderingContext2D,
    camera: Camera,
    group: ArmyGroup,
  ): void {
    if (group.path.length === 0) return;

    context.save();
    context.strokeStyle = PALETTE.selection;
    context.fillStyle = PALETTE.selection;
    context.globalAlpha = 0.78;
    context.lineWidth = 2.5 / camera.zoom;
    context.setLineDash([12 / camera.zoom, 8 / camera.zoom]);
    context.beginPath();
    context.moveTo(group.anchor.x, group.anchor.y);
    for (const waypoint of group.path) context.lineTo(waypoint.x, waypoint.y);
    context.stroke();
    context.setLineDash([]);

    const destination = group.path[group.path.length - 1];
    if (destination !== undefined) this.addDestinationPath(context, camera, destination.x, destination.y);
    context.restore();
  }

  private addDestinationPath(
    context: CanvasRenderingContext2D,
    camera: Camera,
    x: number,
    y: number,
  ): void {
    context.lineWidth = 2 / camera.zoom;
    context.beginPath();
    context.arc(x, y, 16 / camera.zoom, 0, Math.PI * 2);
    context.stroke();
    context.beginPath();
    context.arc(x, y, 4 / camera.zoom, 0, Math.PI * 2);
    context.fill();
  }

  private drawDestination(
    context: CanvasRenderingContext2D,
    camera: Camera,
    x: number,
    y: number,
  ): void {
    context.save();
    context.strokeStyle = PALETTE.selection;
    context.fillStyle = PALETTE.selection;
    context.globalAlpha = 0.78;
    this.addDestinationPath(context, camera, x, y);
    context.restore();
  }

  private labelPriority(
    state: GameState,
    group: ArmyGroup,
    selected: ReadonlySet<string>,
  ): number {
    if (selected.has(group.id)) return 1_000_000;
    if (group.lastCasualtyTick >= 0 && state.currentTick - group.lastCasualtyTick < ENGAGED_TICKS) {
      return 500_000 + group.members.length;
    }
    return group.members.length;
  }

  /**
   * The dominant troop type of a group, as a three-letter token.
   *
   * Recomputed per frame from the pool rather than cached, because a group's
   * composition shifts as it takes casualties and a stale token would lie
   * about exactly the matchup the player is trying to read.
   */
  private roleToken(state: GameState, group: ArmyGroup): string {
    this.roleCounts.fill(0);
    for (const index of group.members) {
      const ordinal = state.units.category[index] ?? 0;
      this.roleCounts[ordinal] = (this.roleCounts[ordinal] ?? 0) + 1;
    }
    let best = 0;
    for (let ordinal = 1; ordinal < CATEGORY_COUNT; ordinal += 1) {
      if ((this.roleCounts[ordinal] ?? 0) > (this.roleCounts[best] ?? 0)) best = ordinal;
    }
    return CATEGORY_TOKEN[UNIT_CATEGORIES[best] as UnitCategory];
  }

  private labelText(state: GameState, group: ArmyGroup, isPlayer: boolean): string {
    const token = this.roleToken(state, group);
    if (isPlayer) return `${token} ${group.name}  ${group.members.length}`;
    // An enemy count is an estimate by eye, rounded exactly as intelligence
    // rounds it, so the map never tells the player more than the Marshal gets.
    const estimate =
      Math.round(group.members.length / STRENGTH_ESTIMATE_GRANULARITY) *
      STRENGTH_ESTIMATE_GRANULARITY;
    return `${token} ${group.name}  ~${estimate}`;
  }

  /**
   * Reserves screen space for a label, refusing it if it would collide.
   *
   * Cheap by construction: at most one rectangle per visible group, tested
   * against the handful already placed.
   */
  private claimLabel(camera: Camera, worldX: number, worldY: number, characters: number): boolean {
    const at = camera.worldToScreen(worldX, worldY);
    const halfWidth = characters * 4 + 6;
    const left = at.x - halfWidth;
    const right = at.x + halfWidth;
    const top = at.y - 22;
    const bottom = at.y + 2;

    for (const rect of this.placedLabels) {
      if (left < rect.right && right > rect.left && top < rect.bottom && bottom > rect.top) {
        return false;
      }
    }
    this.placedLabels.push({ left, right, top, bottom });
    return true;
  }

  /** A pulsing ring marking a formation currently taking losses. */
  private drawContactRing(
    context: CanvasRenderingContext2D,
    camera: Camera,
    state: GameState,
    x: number,
    y: number,
    spread: number,
  ): void {
    // Ticks, not wall-clock: the pulse freezes when the battle is paused,
    // which is correct — nothing is happening.
    const phase = (state.currentTick % 20) / 20;
    const radius = spread + (6 + phase * 16) / camera.zoom;
    context.save();
    context.globalAlpha = 0.75 * (1 - phase);
    context.strokeStyle = PALETTE.melee;
    context.lineWidth = 3 / camera.zoom;
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.stroke();
    context.restore();
  }
}
