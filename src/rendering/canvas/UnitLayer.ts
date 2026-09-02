import {
  CATEGORY_TOKEN,
  FORMATION_PROFILES,
  STRENGTH_ESTIMATE_GRANULARITY,
  TICKS_PER_SECOND,
  UNIT_STATS,
} from '../../game/config/battle';
import { UNIT_CATEGORIES, FACTION_PLAYER, type ArmyGroup, type UnitCategory } from '../../game/types/domain';
import { activeGroups, type GameState } from '../../game/simulation/GameState';
import { visibilityAt } from '../../game/simulation/Visibility';
import type { Camera } from './Camera';
import { PALETTE, moraleColor } from './palette';
import { LABEL_FONT, ROLE_SPRITES, bakeSprite } from './pixelart';
import type { RenderSnapshot } from './RenderSnapshot';

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

/**
 * The art grid, in world units.
 *
 * Every mark this layer makes is snapped to it, so unit blocks, selection
 * brackets and range fields land on the same lattice as the baked ground and
 * the whole field reads as one drawing rather than as sprites over vectors.
 */
const PIXEL = 6;

/** How far a regiment marches in ten seconds. The gold field shows exactly that. */
const MARCH_PREVIEW_SECONDS = 10;

/** Range fields are command feedback, not wallpaper; past this they are noise. */
const MAX_RANGE_FIELDS = 3;

function snap(value: number): number {
  return Math.round(value / PIXEL) * PIXEL;
}

/** The four corners a selection bracket is drawn into. */
const CORNERS: ReadonlyArray<readonly [number, number]> = [
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1],
];

const SHAPE: Record<UnitCategory, 'square' | 'circle' | 'triangle' | 'diamond'> = {
  infantry: 'square',
  spearman: 'square',
  heavy_infantry: 'square',
  archer: 'circle',
  handgunner: 'circle',
  scout: 'circle',
  surgeon: 'circle',
  cavalry: 'triangle',
  siege: 'diamond',
  cannon: 'diamond',
};

const SIZE: Record<UnitCategory, number> = {
  infantry: 9,
  spearman: 9,
  heavy_infantry: 11,
  archer: 8,
  handgunner: 9,
  scout: 7,
  surgeon: 7,
  cavalry: 13,
  siege: 17,
  // The largest thing on the field, and it should be: a battery is a landmark
  // rather than a formation, and the player has to be able to find his own.
  cannon: 20,
};

/**
 * Three shades per side keep categories distinguishable without a rainbow.
 *
 * Shape carries the arm and shade carries its weight: the dark tone is what a
 * commander must go round rather than through, the light tone is what dies if
 * he lets it be caught. Adding a fourth colour for every new troop type would
 * cost more legibility at command zoom than it bought.
 */
function colorFor(faction: number, category: UnitCategory): string {
  const player = faction === FACTION_PLAYER;
  switch (category) {
    case 'heavy_infantry':
    case 'siege':
    case 'cannon':
      return player ? PALETTE.playerDark : PALETTE.enemyDark;
    case 'archer':
    case 'handgunner':
    case 'scout':
    case 'surgeon':
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
  /** Dither fills and troop icons, built on first use and kept for the battle. */
  private readonly patterns = new Map<string, CanvasPattern>();
  private readonly icons = new Map<UnitCategory, HTMLCanvasElement>();

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
    previous?: RenderSnapshot,
    interpolation = 1,
    /**
     * Drawn between the troops and their labels.
     *
     * Place names have to sit over the unit blocks or a regiment standing on a
     * zone erases its name, and under the regiment labels or a place name
     * covers the one thing the commander needs more.
     */
    betweenBodiesAndLabels?: () => void,
  ): void {
    if (camera.zoom < BLOB_ZOOM) {
      this.drawBlobs(context, camera, state, selected, previous, interpolation, betweenBodiesAndLabels);
      return;
    }

    this.fillBatches(camera, state, previous, interpolation);

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

    betweenBodiesAndLabels?.();
    this.drawGroupMarkers(context, camera, state, selected, previous, interpolation);
  }

  /**
   * A man, as pixels.
   *
   * Shapes are built out of whole art-grid blocks rather than out of circles
   * and triangles, because a smooth arc among eight thousand chunky pixels is
   * the one thing that would give the style away. Silhouettes still differ per
   * category, which is what the counter matrix needs a commander to read.
   */
  private addDetailedShapes(
    context: CanvasRenderingContext2D,
    shape: 'square' | 'circle' | 'triangle' | 'diamond',
    size: number,
    xs: Float32Array,
    ys: Float32Array,
    count: number,
  ): void {
    // Sized to the man, not to the art grid, and drawn where he actually
    // stands. Snapping a whole regiment onto a six-unit lattice turned eight
    // hundred men into wallpaper: every block landed on the same rhythm as its
    // neighbours and the formation read as a pattern rather than as troops.
    const block = Math.max(2, Math.round(size / 2) * 2);
    const half = block / 2;
    const step = Math.max(2, Math.round(block / 2));

    for (let n = 0; n < count; n += 1) {
      const x = xs[n] ?? 0;
      const y = ys[n] ?? 0;
      switch (shape) {
        case 'square':
          context.rect(x - half, y - half, block, block);
          break;
        case 'circle':
          // A stubby cross: rounder than a block at this size, still all pixels.
          context.rect(x - half, y - step / 2, block, step);
          context.rect(x - step / 2, y - half, step, block);
          break;
        case 'triangle':
          // A wedge, widening towards the base, two rows of blocks.
          context.rect(x - step / 2, y - half, step, step);
          context.rect(x - half, y, block, step);
          break;
        case 'diamond':
          context.rect(x - step / 2, y - half, step, block);
          context.rect(x - half, y - step / 2, block, step);
          break;
      }
    }
  }

  /** One pass over the pool, bucketing visible units into per-batch buffers. */
  private fillBatches(
    camera: Camera,
    state: GameState,
    previous?: RenderSnapshot,
    interpolation = 1,
  ): void {
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

      const currentX = units.x[index] ?? 0;
      const currentY = units.y[index] ?? 0;
      const canInterpolate = previous !== undefined && previous.unitAlive[index] === 1;
      const x = canInterpolate
        ? (previous.unitX[index] ?? currentX) + (currentX - (previous.unitX[index] ?? currentX)) * interpolation
        : currentX;
      if (x < left || x > right) continue;
      const y = canInterpolate
        ? (previous.unitY[index] ?? currentY) + (currentY - (previous.unitY[index] ?? currentY)) * interpolation
        : currentY;
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
    previous?: RenderSnapshot,
    interpolation = 1,
    betweenBodiesAndLabels?: () => void,
  ): void {
    for (const group of activeGroups(state)) {
      const isPlayer = group.ownerId === 'player';
      const slot = state.groupIndexById.get(group.id) ?? -1;
      const x =
        previous !== undefined && slot >= 0
          ? (previous.groupX[slot] ?? group.anchor.x) +
            (group.anchor.x - (previous.groupX[slot] ?? group.anchor.x)) * interpolation
          : group.anchor.x;
      const y =
        previous !== undefined && slot >= 0
          ? (previous.groupY[slot] ?? group.anchor.y) +
            (group.anchor.y - (previous.groupY[slot] ?? group.anchor.y)) * interpolation
          : group.anchor.y;
      if (!isPlayer && visibilityAt(state, 'player', x, y) !== 2) continue;
      const radius = Math.max(34, Math.sqrt(group.members.length) * 6.2);
      const frontage = FORMATION_PROFILES[group.formation].frontage;
      const halfWidth = radius * Math.max(0.62, Math.min(1.7, Math.sqrt(frontage)));
      const halfDepth = radius * Math.max(0.52, Math.min(1.35, 0.82 / Math.sqrt(frontage)));

      // Strategic zoom shows regiment footprints rather than thousands of
      // sub-pixel soldiers. The shape still tells the truth: a line is broad,
      // a column deep, and a square compact.
      context.save();
      context.translate(x, y);
      // Formation frontage is perpendicular to its facing.
      context.rotate(group.facing + Math.PI / 2);
      // A hard-edged block, not an ellipse: at command zoom the field should
      // still look like a map of counters rather than a smear of blobs.
      const width = snap(halfWidth * 2);
      const depth = snap(halfDepth * 2);
      const edge = Math.max(PIXEL, 3 / camera.zoom);
      context.fillStyle = isPlayer ? PALETTE.playerDark : PALETTE.enemyDark;
      context.fillRect(-width / 2 - edge, -depth / 2 - edge, width + edge * 2, depth + edge * 2);
      context.fillStyle = isPlayer ? PALETTE.player : PALETTE.enemy;
      context.fillRect(-width / 2, -depth / 2, width, depth);
      context.fillStyle = isPlayer ? PALETTE.playerLight : PALETTE.enemyLight;
      context.fillRect(-width / 2, -depth / 2, width, edge);
      context.restore();

    }
    betweenBodiesAndLabels?.();
    this.drawGroupMarkers(context, camera, state, selected, previous, interpolation);
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
    previous?: RenderSnapshot,
    interpolation = 1,
  ): void {
    const bounds = camera.visibleBounds;
    const fontSize = 13 / camera.zoom;
    context.font = `700 ${fontSize}px ${LABEL_FONT}`;
    context.textAlign = 'center';
    context.textBaseline = 'bottom';

    // Draw order decides which labels survive a collision, so rank the groups
    // by what a commander most needs to read: what he has selected, then what
    // is in contact, then the largest formations.
    const visible: ArmyGroup[] = [];
    for (const group of activeGroups(state)) {
      const slot = state.groupIndexById.get(group.id) ?? -1;
      const x =
        previous !== undefined && slot >= 0
          ? (previous.groupX[slot] ?? group.anchor.x) +
            (group.anchor.x - (previous.groupX[slot] ?? group.anchor.x)) * interpolation
          : group.anchor.x;
      const y =
        previous !== undefined && slot >= 0
          ? (previous.groupY[slot] ?? group.anchor.y) +
            (group.anchor.y - (previous.groupY[slot] ?? group.anchor.y)) * interpolation
          : group.anchor.y;
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
      const slot = state.groupIndexById.get(group.id) ?? -1;
      const x =
        previous !== undefined && slot >= 0
          ? (previous.groupX[slot] ?? group.anchor.x) +
            (group.anchor.x - (previous.groupX[slot] ?? group.anchor.x)) * interpolation
          : group.anchor.x;
      const y =
        previous !== undefined && slot >= 0
          ? (previous.groupY[slot] ?? group.anchor.y) +
            (group.anchor.y - (previous.groupY[slot] ?? group.anchor.y)) * interpolation
          : group.anchor.y;
      const spread = Math.max(40, Math.sqrt(group.members.length) * 8);
      const labelY = y - spread - 10 / camera.zoom;
      // `lastCasualtyTick` starts at -1, so a bare subtraction reads every
      // regiment as engaged on the opening tick.
      const engaged =
        group.lastCasualtyTick >= 0 && state.currentTick - group.lastCasualtyTick < ENGAGED_TICKS;

      if (selected.has(group.id)) {
        if (isPlayer && selected.size <= MAX_RANGE_FIELDS) {
          this.drawRangeFields(context, state, group, x, y);
        }
        this.drawSelectionBracket(context, camera, state, x, y, spread);
      }

      // A contact ring, drawn for both sides and at every zoom. This is the
      // one mark that answers "where is the battle" from across the map.
      if (engaged) this.drawContactRing(context, camera, state, x, y, spread);

      const text = this.labelText(state, group, isPlayer);
      if (!this.claimLabel(camera, x, labelY, text.length)) continue;

      const unit = 1 / camera.zoom;
      const isSelected = selected.has(group.id);
      const iconSize = 14 * unit;
      const textWidth = context.measureText(text).width;
      const plateWidth = textWidth + iconSize + 14 * unit;
      const plateHeight = 18 * unit;
      const plateLeft = x - plateWidth / 2;
      const plateTop = labelY - plateHeight + 3 * unit;

      // A name over a dithered field needs a plate under it or it disappears.
      context.fillStyle = 'rgba(9, 12, 7, 0.82)';
      context.fillRect(plateLeft, plateTop, plateWidth, plateHeight);
      context.fillStyle = isSelected
        ? PALETTE.selection
        : isPlayer
          ? PALETTE.playerDark
          : PALETTE.enemyDark;
      context.fillRect(plateLeft, plateTop, plateWidth, unit);
      context.fillRect(plateLeft, plateTop + plateHeight - unit, plateWidth, unit);

      // The troop type, as its own silhouette. Three letters told a commander
      // what these men carried only if he already knew the abbreviations.
      const icon = this.roleIcon(this.primaryRole(state, group));
      context.imageSmoothingEnabled = false;
      context.drawImage(icon, plateLeft + 4 * unit, plateTop + 2 * unit, iconSize, iconSize);

      context.fillStyle = isSelected
        ? PALETTE.selection
        : isPlayer
          ? 'rgba(232, 226, 200, 0.86)'
          : 'rgba(255, 178, 170, 0.9)';
      context.fillText(text, x + iconSize / 2 + 2 * unit, labelY);

      // Morale is the player's own business; an enemy's is not observable.
      if (!isPlayer) continue;

      const barWidth = snap(84 * unit);
      const barHeight = Math.max(PIXEL / 2, 4 * unit);
      const barY = labelY + 5 * unit;
      context.fillStyle = 'rgba(0, 0, 0, 0.6)';
      context.fillRect(x - barWidth / 2 - unit, barY - unit, barWidth + unit * 2, barHeight + unit * 2);
      context.fillStyle = '#241f14';
      context.fillRect(x - barWidth / 2, barY, barWidth, barHeight);
      context.fillStyle = moraleColor(group.morale);
      // Whole blocks only, so the bar ticks down in steps like everything else.
      const filled = Math.round((barWidth * group.morale) / 100 / PIXEL) * PIXEL;
      context.fillRect(x - barWidth / 2, barY, filled, barHeight);
    }
  }

  /**
   * The route an order actually produced, as a line of marching blocks.
   *
   * Stepping the dashes along the path by hand rather than using a dashed
   * stroke keeps the march on the same lattice as the ground under it, and
   * costs about as much: a few dozen fills for a route across the map.
   */
  private drawOrderPath(
    context: CanvasRenderingContext2D,
    camera: Camera,
    group: ArmyGroup,
  ): void {
    if (group.path.length === 0) return;

    const unit = 1 / camera.zoom;
    const block = Math.max(PIXEL, snap(7 * unit));
    const gap = block * 2;

    context.save();
    context.globalAlpha = 0.85;
    context.fillStyle = PALETTE.selection;

    let fromX = group.anchor.x;
    let fromY = group.anchor.y;
    for (const waypoint of group.path) {
      const length = Math.hypot(waypoint.x - fromX, waypoint.y - fromY);
      const steps = Math.max(1, Math.floor(length / gap));
      for (let step = 0; step <= steps; step += 1) {
        const t = step / steps;
        context.fillRect(
          snap(fromX + (waypoint.x - fromX) * t) - block / 2,
          snap(fromY + (waypoint.y - fromY) * t) - block / 2,
          block,
          block,
        );
      }
      // A waypoint the route actually turns on, marked slightly heavier.
      context.fillRect(snap(waypoint.x) - block, snap(waypoint.y) - block, block * 2, block * 2);
      fromX = waypoint.x;
      fromY = waypoint.y;
    }
    context.restore();

    const destination = group.path[group.path.length - 1];
    if (destination !== undefined) this.drawDestination(context, camera, destination.x, destination.y);
  }

  /** Where the order ends: a gold pixel target, readable at any zoom. */
  private drawDestination(
    context: CanvasRenderingContext2D,
    camera: Camera,
    x: number,
    y: number,
  ): void {
    const unit = 1 / camera.zoom;
    const arm = Math.max(PIXEL * 2, snap(16 * unit));
    const thickness = Math.max(PIXEL, snap(4 * unit));
    const cx = snap(x);
    const cy = snap(y);

    context.save();
    context.fillStyle = 'rgba(9, 12, 7, 0.55)';
    context.fillRect(cx - arm - thickness, cy - thickness * 1.5, arm * 2 + thickness * 2, thickness * 3);
    context.fillStyle = PALETTE.selection;
    context.fillRect(cx - arm, cy - thickness / 2, arm * 2, thickness);
    context.fillRect(cx - thickness / 2, cy - arm, thickness, arm * 2);
    context.fillStyle = PALETTE.kingGold;
    context.fillRect(cx - thickness, cy - thickness, thickness * 2, thickness * 2);
    context.restore();
  }

  /* -------------------------------------------------------- pixel furniture */

  /**
   * A gold bracket around what the commander has selected.
   *
   * Four corner pieces rather than a ring: corners survive being drawn over a
   * melee, and they never read as a range circle, which the fields below are.
   */
  private drawSelectionBracket(
    context: CanvasRenderingContext2D,
    camera: Camera,
    state: GameState,
    x: number,
    y: number,
    spread: number,
  ): void {
    const unit = 1 / camera.zoom;
    const reach = snap(spread + 16 * unit);
    const arm = Math.max(PIXEL * 3, snap(reach * 0.42));
    const thickness = Math.max(PIXEL, snap(4 * unit));
    const cx = snap(x);
    const cy = snap(y);
    // A slow two-step breathe on the tick clock, so a selection is alive but
    // never strobes, and freezes with everything else when the battle pauses.
    const breathe = state.currentTick % 20 < 10 ? 0 : thickness;

    for (const corner of CORNERS) {
      const sx = corner[0];
      const sy = corner[1];
      const originX = cx + sx * (reach + breathe);
      const originY = cy + sy * (reach + breathe);
      const armLeft = originX - (sx > 0 ? arm : 0);
      const armTop = originY - (sy > 0 ? arm : 0);

      context.fillStyle = 'rgba(8, 10, 6, 0.55)';
      context.fillRect(armLeft - thickness, originY - thickness * 1.5, arm + thickness * 2, thickness * 3);
      context.fillStyle = PALETTE.selection;
      context.fillRect(armLeft, originY - (sy > 0 ? thickness : 0), arm, thickness);
      context.fillRect(originX - (sx > 0 ? thickness : 0), armTop, thickness, arm);
    }
  }

  /**
   * How far these men can march, and how far they can reach.
   *
   * Both are drawn as dithered pixel fields, which is the only honest way to
   * show a soft limit on a hard grid, and the only overlay that can sit on top
   * of the ground without hiding it.
   */
  private drawRangeFields(
    context: CanvasRenderingContext2D,
    state: GameState,
    group: ArmyGroup,
    x: number,
    y: number,
  ): void {
    const role = this.primaryRole(state, group);
    const stats = UNIT_STATS[role];
    const march = stats.speed * TICKS_PER_SECOND * MARCH_PREVIEW_SECONDS;

    const gold = this.ditherPattern(context, PALETTE.selection);
    if (gold !== null) {
      context.save();
      context.globalAlpha = 0.3;
      context.fillStyle = gold;
      context.beginPath();
      context.arc(x, y, march, 0, Math.PI * 2);
      context.fill();
      context.restore();
    }

    // A melee reach of fourteen world units is not worth a field; a siege
    // engine's is the single most important thing on the commander's screen.
    if (stats.range < 60) return;
    const crimson = this.ditherPattern(context, PALETTE.enemyLight);
    if (crimson === null) return;
    context.save();
    context.globalAlpha = 0.3;
    context.fillStyle = crimson;
    context.beginPath();
    context.arc(x, y, stats.range, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }

  /** A four-pixel checkerboard, locked to the world grid, cached per colour. */
  private ditherPattern(
    context: CanvasRenderingContext2D,
    color: string,
  ): CanvasPattern | null {
    const cached = this.patterns.get(color);
    if (cached !== undefined) return cached;

    const tile = document.createElement('canvas');
    tile.width = 4;
    tile.height = 4;
    const tileContext = tile.getContext('2d');
    if (tileContext === null) return null;
    tileContext.fillStyle = color;
    tileContext.fillRect(0, 0, 2, 2);
    tileContext.fillRect(2, 2, 2, 2);

    const pattern = context.createPattern(tile, 'repeat');
    if (pattern === null) return null;
    // One tile pixel to one art pixel, so the dither lines up with the ground.
    pattern.setTransform(new DOMMatrix().scale(PIXEL));
    this.patterns.set(color, pattern);
    return pattern;
  }

  /** Troop icons are baked once and blitted; they are drawn every frame. */
  private roleIcon(role: UnitCategory): HTMLCanvasElement {
    const cached = this.icons.get(role);
    if (cached !== undefined) return cached;
    const sprite = ROLE_SPRITES[role] ?? ROLE_SPRITES.infantry ?? { rows: [] };
    const baked = bakeSprite(sprite, 2);
    this.icons.set(role, baked);
    return baked;
  }

  /** The category most of a group's men carry. */
  private primaryRole(state: GameState, group: ArmyGroup): UnitCategory {
    this.roleCounts.fill(0);
    for (const index of group.members) {
      const ordinal = state.units.category[index] ?? 0;
      this.roleCounts[ordinal] = (this.roleCounts[ordinal] ?? 0) + 1;
    }
    let best = 0;
    for (let ordinal = 1; ordinal < CATEGORY_COUNT; ordinal += 1) {
      if ((this.roleCounts[ordinal] ?? 0) > (this.roleCounts[best] ?? 0)) best = ordinal;
    }
    return UNIT_CATEGORIES[best] as UnitCategory;
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
    return CATEGORY_TOKEN[this.primaryRole(state, group)];
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
    const block = Math.max(PIXEL, snap(5 / camera.zoom));
    // A ring of separate blocks rather than a stroked circle: it expands in
    // steps, which reads as an alarm rather than as a soft glow.
    const steps = 20;

    context.save();
    context.globalAlpha = 0.85 * (1 - phase);
    context.fillStyle = PALETTE.melee;
    for (let step = 0; step < steps; step += 1) {
      const angle = (step / steps) * Math.PI * 2;
      context.fillRect(
        snap(x + Math.cos(angle) * radius) - block / 2,
        snap(y + Math.sin(angle) * radius) - block / 2,
        block,
        block,
      );
    }
    context.restore();
  }
}

