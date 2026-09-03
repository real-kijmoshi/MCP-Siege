import {
  CORPSE_LIFETIME_TICKS,
  FORMATION_PROFILES,
  STRENGTH_ESTIMATE_GRANULARITY,
  TICKS_PER_SECOND,
} from '../../game/config/battle';
import { UNIT_CATEGORIES, FACTION_PLAYER, type ArmyGroup, type UnitCategory } from '../../game/types/domain';
import { activeGroups, type GameState } from '../../game/simulation/GameState';
import { visibilityAt } from '../../game/simulation/Visibility';
import type { Camera } from './Camera';
import { PALETTE, moraleColor } from './palette';
import {
  FIGURES,
  FIGURE_BODY,
  FIGURE_LAYERS,
  FIGURE_METAL,
  FIGURE_SHADOW,
  FIGURE_SKIN,
  FIGURE_WOOD,
  LABEL_FONT,
  ROLE_SPRITES,
  artHash,
  bakeSprite,
  type FigureCell,
} from './pixelart';
import type { RenderSnapshot } from './RenderSnapshot';

/**
 * Drawing the armies.
 *
 * The whole budget lives here, so units are batched by faction and category
 * into preallocated buffers and drawn ink by ink: every shadow on the field in
 * one fill, every shaft in the next, each regiment's cloth in its own colour,
 * then all the skin and all the steel. Two dozen fills draw eight thousand
 * men, however many different kinds of troops are standing among them.
 *
 * Level of detail steps down as the camera pulls back — whole figures, then
 * their silhouettes alone, then blocks, then one blob per regiment — which is
 * what keeps a huge battle legible rather than turning it into noise.
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
// Keep the opening command view calm: at this scale individual soldier blocks
// are too small to identify and turn each regiment into a field of confetti.
// Formation footprints preserve frontage, depth, allegiance and position; the
// men resolve as soon as the commander deliberately zooms in.
const BLOB_ZOOM = 0.5;

/**
 * Zoom at which a man stops being a silhouette and becomes a whole figure.
 *
 * Below this a soldier is a few world units tall and his sword is thinner than
 * a screen pixel, so the extra cells would cost the frame and buy a smudge.
 * Above it the camera is showing a fraction of the country, which is precisely
 * when there are few enough men on screen to draw all of them properly.
 */
const FIGURE_ZOOM = 0.62;

/**
 * How many men may be drawn as whole figures before the layer falls back to
 * silhouettes.
 *
 * Whole figures are around three times the rectangles of a silhouette. Timing
 * `render` directly on a full battle of some 7,900 men, a frame drawing two
 * thousand of them as figures costs 3.2 ms against the 1.5 ms the plain blocks
 * cost, in a sixteen-millisecond frame — so this is a guard against a pile-up
 * far larger than anything measured, not a limit the ordinary battle reaches.
 */
const FIGURE_BUDGET = 2_500;

/**
 * How many figure cells fit across one unit block, per troop type.
 *
 * This is the one number that decides how big a drawn man is against the
 * ground he stands on, and it is per category because a horseman and a gun
 * carry far more art than a footman does: given the footman's grid they would
 * be drawn wider than the space the formation leaves them, and a squadron
 * would close up into a solid brown band instead of reading as horses.
 */
const FIGURE_GRID: Record<UnitCategory, number> = {
  infantry: 6,
  spearman: 6,
  heavy_infantry: 7,
  archer: 6,
  handgunner: 6,
  scout: 6,
  surgeon: 6,
  cavalry: 9,
  siege: 8,
  cannon: 8,
};

/** Below this much sideways speed a man is standing, not marching. */
const STRIDE_EPSILON = 0.02;

/**
 * How far a man may stand off his own slot, in world units.
 *
 * Eight hundred identical figures on eight hundred exact slots read as
 * wallpaper rather than as troops. A hand's breadth of scatter, hashed from
 * the soldier's own index so it never moves and never differs between two
 * players on the same seed, is enough to break the pattern without making a
 * dressed formation look slovenly. It uses the art hash and not the
 * simulation's own stream, which no drawing may touch.
 */
const FIGURE_SCATTER = 1.6;

/** How far below his own position a man's feet are planted, in figure cells. */
const FIGURE_FEET = 1.2;

/**
 * The gait.
 *
 * A marching man swaps his legs and rises a little on the step, on a two-frame
 * cycle: at this size a leg is two pixels, and anything smoother than a swap
 * would be a blur rather than a step. The phase is taken from the tick clock
 * and not from the frame clock, so the whole army halts mid-stride when the
 * battle is paused, as every other moving thing on this map does; and it is
 * offset by the soldier's own index, so a regiment does not march in lockstep
 * like one animation played eight hundred times.
 */
const GAIT_TICKS = 4;
const GAIT_SWING = 0.45;
const GAIT_BOB = 0.5;

/** Below this speed, squared, a man is standing rather than marching. */
const MARCH_EPSILON_SQUARED = 0.05 * 0.05;

/**
 * The four inks a figure shares with the ground it stands on. Cloth is missing
 * because cloth is the regiment's own colour, and comes from `colorFor`.
 */
const FIGURE_INK: readonly string[] = [
  PALETTE.shadow,
  PALETTE.timber,
  '',
  PALETTE.sand,
  // Dressed stone rather than the lighter shade above it: a helmet wants the
  // brighter grey, but a cannon is mostly barrel, and in the bright grey a
  // battery read as a row of white bars laid on the grass.
  PALETTE.stone,
];

/**
 * Figure art, flattened for the hot loop.
 *
 * Each category's cells are split by ink and packed into a flat `[x, y, w, h]`
 * run, with the silhouette cells first so that command zoom can simply draw a
 * prefix of the same art rather than carry a second set of drawings that could
 * drift away from it.
 */
interface FigureGeometry {
  readonly quads: Float32Array;
  /** Per cell: -1 and 1 are the two legs, 0 is everything that does not swing. */
  readonly stride: Int8Array;
  /** Per cell: 1 for the ground shadow, which stays put while the man steps. */
  readonly planted: Uint8Array;
  readonly count: number;
  readonly coreCount: number;
}

const EMPTY_GEOMETRY: FigureGeometry = {
  quads: new Float32Array(0),
  stride: new Int8Array(0),
  planted: new Uint8Array(0),
  count: 0,
  coreCount: 0,
};

function packFigure(cells: readonly FigureCell[], layer: number): FigureGeometry {
  const mine = cells.filter((cell) => cell.layer === layer);
  const ordered = [
    ...mine.filter((cell) => cell.core === true),
    ...mine.filter((cell) => cell.core !== true),
  ];
  const quads = new Float32Array(ordered.length * 4);
  const stride = new Int8Array(ordered.length);
  const planted = new Uint8Array(ordered.length);
  ordered.forEach((cell, index) => {
    quads[index * 4] = cell.x;
    quads[index * 4 + 1] = cell.y;
    quads[index * 4 + 2] = cell.w;
    quads[index * 4 + 3] = cell.h;
    stride[index] = cell.stride ?? 0;
    planted[index] = cell.planted === true ? 1 : 0;
  });
  return {
    quads,
    stride,
    planted,
    count: ordered.length,
    coreCount: ordered.filter((cell) => cell.core === true).length,
  };
}

/** `[category ordinal][layer]`, built once at load. Art, so never written to. */
const FIGURE_GEOMETRY: ReadonlyArray<readonly FigureGeometry[]> = UNIT_CATEGORIES.map(
  (category) => {
    const cells = FIGURES[category];
    if (cells === undefined) return new Array<FigureGeometry>(FIGURE_LAYERS).fill(EMPTY_GEOMETRY);
    const layers: FigureGeometry[] = [];
    for (let layer = 0; layer < FIGURE_LAYERS; layer += 1) layers.push(packFigure(cells, layer));
    return layers;
  },
);

/** A group counts as in contact for this long after its last casualty. */
const ENGAGED_TICKS = TICKS_PER_SECOND * 3;

/** How many ticks a man takes to collapse onto the ground once he falls. */
const CORPSE_FALL_TICKS = 5;

/**
 * The art grid, in world units.
 *
 * Every mark this layer makes is snapped to it, so unit blocks, selection
 * brackets and range fields land on the same lattice as the baked ground and
 * the whole field reads as one drawing rather than as sprites over vectors.
 */
const PIXEL = 6;

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
  /** 1 where a man is drawn mirrored, because he is facing left. */
  private readonly batchFlip: Uint8Array[] = [];
  /** Which half of the stride a man is on: 1, -1, or 0 where he is standing. */
  private readonly batchGait: Int8Array[] = [];
  private readonly batchCount = new Int32Array(BATCH_COUNT);
  /** How many men the last `fillBatches` actually put on screen. */
  private visibleUnits = 0;
  /** Scratch, cleared at the top of every use. Never carries state across frames. */
  private readonly roleCounts = new Int32Array(CATEGORY_COUNT);
  private readonly placedLabels: Array<{
    left: number;
    right: number;
    top: number;
    bottom: number;
  }> = [];
  /** Dither fills and troop icons, built on first use and kept for the battle. */
  private readonly icons = new Map<UnitCategory, HTMLCanvasElement>();

  public constructor() {
    for (let batch = 0; batch < BATCH_COUNT; batch += 1) {
      this.batchX.push(new Float32Array(CAPACITY));
      this.batchY.push(new Float32Array(CAPACITY));
      this.batchFlip.push(new Uint8Array(CAPACITY));
      this.batchGait.push(new Int8Array(CAPACITY));
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

    this.drawCorpses(context, camera, state, interpolation);
    this.fillBatches(camera, state, previous, interpolation);

    if (camera.zoom >= DETAIL_ZOOM) {
      // Whole men when the camera is close enough for a sword to be worth a
      // pixel and there are few enough of them on screen to be worth the
      // frame; their silhouettes alone otherwise.
      const whole = camera.zoom >= FIGURE_ZOOM && this.visibleUnits <= FIGURE_BUDGET;
      this.drawFigures(context, !whole);
    } else {
      // Below the detail threshold a man is one small block; his shape is no
      // longer readable, but the density and the colour of the mass still are.
      for (let batch = 0; batch < BATCH_COUNT; batch += 1) {
        const count = this.batchCount[batch] ?? 0;
        if (count === 0) continue;
        const category = UNIT_CATEGORIES[batch % CATEGORY_COUNT] as UnitCategory;
        const xs = this.batchX[batch];
        const ys = this.batchY[batch];
        if (xs === undefined || ys === undefined) continue;

        context.fillStyle = colorFor(batch < CATEGORY_COUNT ? 0 : 1, category);
        context.beginPath();
        const size = Math.max(2.5 / camera.zoom, SIZE[category] * 0.8);
        const half = size / 2;
        for (let n = 0; n < count; n += 1) {
          context.rect((xs[n] ?? 0) - half, (ys[n] ?? 0) - half, size, size);
        }
        context.fill();
      }
    }

    betweenBodiesAndLabels?.();
    this.drawGroupMarkers(context, camera, state, selected, previous, interpolation);
  }

  /**
   * The fallen, drawn before the living so the next rank covers them.
   *
   * A corpse collapses over a handful of ticks from a tall bar into a flat
   * body, greys out as it does so, and then fades over the rest of its life.
   * The animation runs on the tick clock like every other effect, so it freezes
   * when the battle is paused.
   */
  private drawCorpses(
    context: CanvasRenderingContext2D,
    camera: Camera,
    state: GameState,
    interpolation: number,
  ): void {
    const corpses = state.corpses;
    if (corpses.length === 0) return;

    const bounds = camera.visibleBounds;
    const margin = 40;
    const left = bounds.left - margin;
    const right = bounds.right + margin;
    const top = bounds.top - margin;
    const bottom = bounds.bottom + margin;

    for (const corpse of corpses) {
      if (corpse.x < left || corpse.x > right || corpse.y < top || corpse.y > bottom) continue;
      if (corpse.owner !== FACTION_PLAYER && visibilityAt(state, 'player', corpse.x, corpse.y) !== 2) {
        continue;
      }

      const age = Math.max(0, state.currentTick - corpse.deathTick - (1 - interpolation));
      const life = Math.max(0, 1 - age / CORPSE_LIFETIME_TICKS);
      if (life <= 0) continue;

      const category: UnitCategory = corpse.category;
      const block = SIZE[category];
      const p = Math.min(1, age / CORPSE_FALL_TICKS);
      // Collapse: a standing bar folds into a body laid flat on the ground.
      const height = Math.max(2, block * (0.9 - 0.55 * p));
      const width = block * (0.4 + 0.6 * p);
      const bx = corpse.x - width / 2;
      const by = corpse.y - height;

      // Faction cloth first, then gray drawn over it, taking hold as he falls.
      context.globalAlpha = life;
      context.fillStyle = colorFor(corpse.owner, category);
      context.fillRect(bx, by, width, height);
      context.globalAlpha = life * p;
      context.fillStyle = PALETTE.stoneDark;
      context.fillRect(bx, by, width, height);

      // A small head square at the leading end, gray and fading with the body.
      const head = Math.max(2, block * 0.3);
      context.globalAlpha = life * (0.4 + 0.6 * p);
      context.fillStyle = PALETTE.stone;
      const hx = corpse.flip === 1 ? bx : bx + width - head;
      context.fillRect(hx, by - head, head, head);
    }

    context.globalAlpha = 1;
  }

  /**
   * The army, drawn one ink at a time.
   *
   * Painting a man at a time would mean a fill per man; painting an ink at a
   * time means every shadow on the field goes down together, then every shaft,
   * then each regiment's cloth in its own colour, then all the skin and all
   * the steel. That is four fills plus one per regiment colour, whatever the
   * mixture of troops, and it is also the correct order to draw a man in: a
   * lance behind its rider, a helmet over his face.
   *
   * The cost is that the order is global rather than per man, so one soldier's
   * spear passes in front of the man in the rank ahead of him. At this scale
   * that reads as a hedge of spears over a block of troops, which is what a
   * body of spearmen looks like, and it saves sorting eight thousand men every
   * frame to fix something nobody would otherwise notice.
   */
  private drawFigures(context: CanvasRenderingContext2D, coreOnly: boolean): void {
    for (let layer = 0; layer < FIGURE_LAYERS; layer += 1) {
      if (layer === FIGURE_BODY) {
        // Cloth is the one ink a soldier does not share with the ground: it is
        // his own side's colour, so it is drawn per batch rather than per ink.
        for (let batch = 0; batch < BATCH_COUNT; batch += 1) {
          if ((this.batchCount[batch] ?? 0) === 0) continue;
          const category = UNIT_CATEGORIES[batch % CATEGORY_COUNT] as UnitCategory;
          context.fillStyle = colorFor(batch < CATEGORY_COUNT ? 0 : 1, category);
          context.beginPath();
          this.addFigureLayer(context, batch, layer, coreOnly);
          context.fill();
        }
        continue;
      }

      const ink = FIGURE_INK[layer];
      if (ink === undefined || ink === '') continue;
      context.fillStyle = ink;
      context.beginPath();
      for (let batch = 0; batch < BATCH_COUNT; batch += 1) {
        if ((this.batchCount[batch] ?? 0) === 0) continue;
        this.addFigureLayer(context, batch, layer, coreOnly);
      }
      context.fill();
    }
  }

  /**
   * One ink of one batch's figures, mirrored to the way each man faces and
   * stepped to where he is in his stride.
   *
   * The gait is applied in figure space, before the mirror, so a man marching
   * west swings the same leg forward as a man marching east. It is skipped
   * entirely at command zoom: the legs are not drawn there, and bobbing a
   * two-pixel silhouette would only make the mass shimmer.
   */
  private addFigureLayer(
    context: CanvasRenderingContext2D,
    batch: number,
    layer: number,
    coreOnly: boolean,
  ): void {
    const count = this.batchCount[batch] ?? 0;
    const ordinal = batch % CATEGORY_COUNT;
    const geometry = FIGURE_GEOMETRY[ordinal]?.[layer];
    if (geometry === undefined) return;
    const cells = coreOnly ? geometry.coreCount : geometry.count;
    if (cells === 0) return;

    const xs = this.batchX[batch];
    const ys = this.batchY[batch];
    const flips = this.batchFlip[batch];
    const gaits = this.batchGait[batch];
    if (xs === undefined || ys === undefined || flips === undefined || gaits === undefined) {
      return;
    }

    const category = UNIT_CATEGORIES[ordinal] as UnitCategory;
    const block = Math.max(2, Math.round(SIZE[category] / 2) * 2);
    const grid = block / FIGURE_GRID[category];
    const quads = geometry.quads;
    const strides = geometry.stride;
    const planted = geometry.planted;

    for (let n = 0; n < count; n += 1) {
      const originX = xs[n] ?? 0;
      // A man stands on his own position rather than being centred on it, so
      // his shadow lands where the simulation says his feet are.
      const ground = (ys[n] ?? 0) + FIGURE_FEET * grid;
      const facingLeft = flips[n] === 1;
      const gait = coreOnly ? 0 : gaits[n] ?? 0;
      const lift = gait > 0 ? GAIT_BOB * grid : 0;

      for (let cell = 0; cell < cells; cell += 1) {
        const at = cell * 4;
        const swing = (strides[cell] ?? 0) * gait * GAIT_SWING;
        const cellX = (quads[at] ?? 0) + swing;
        const cellY = quads[at + 1] ?? 0;
        const width = (quads[at + 2] ?? 0) * grid;
        const height = (quads[at + 3] ?? 0) * grid;
        const left = facingLeft
          ? originX - (cellX * grid + width)
          : originX + cellX * grid;
        const rise = planted[cell] === 1 ? 0 : lift;
        context.rect(left, ground - cellY * grid - height - rise, width, height);
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
    this.visibleUnits = 0;

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
      const flips = this.batchFlip[batch];
      const gaits = this.batchGait[batch];
      if (xs === undefined || ys === undefined || flips === undefined || gaits === undefined) {
        continue;
      }
      xs[slot] = x + (artHash(index, 0x51ed) - 0.5) * FIGURE_SCATTER;
      ys[slot] = y + (artHash(index, 0x2f19) - 0.5) * FIGURE_SCATTER;
      // A man faces the way he is marching, and when he is standing still, the
      // way his regiment is turned. An army holding a line therefore faces its
      // enemy rather than all facing east out of the drawing.
      const velocityX = units.velocityX[index] ?? 0;
      const velocityY = units.velocityY[index] ?? 0;
      let facingLeft = velocityX < 0;
      if (Math.abs(velocityX) < STRIDE_EPSILON) {
        const group = state.groups[units.group[index] ?? -1];
        facingLeft = group !== undefined && Math.cos(group.facing) < 0;
      }
      flips[slot] = facingLeft ? 1 : 0;
      // Men on their feet step; men standing in the line do not, so a halted
      // formation is still rather than jogging on the spot. Which foot a man
      // leads with is hashed rather than taken from the parity of his index,
      // which would put every neighbour in a rank on the opposite foot and
      // leave the whole line zigzagging instead of marching.
      const marching = velocityX * velocityX + velocityY * velocityY > MARCH_EPSILON_SQUARED;
      const lead = artHash(index, 0x9e37) < 0.5 ? 0 : 1;
      gaits[slot] = marching
        ? (((state.currentTick / GAIT_TICKS) | 0) + lead) % 2 === 0
          ? 1
          : -1
        : 0;
      this.batchCount[batch] = slot + 1;
      this.visibleUnits += 1;
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
        this.drawSelectionBracket(context, camera, state, x, y, spread);
      }

      // A contact ring, drawn for both sides and at every zoom. This is the
      // one mark that answers "where is the battle" from across the map.
      if (engaged) this.drawContactRing(context, camera, state, x, y, spread);

      const isSelected = selected.has(group.id);
      const text = this.labelText(state, group, isPlayer, isSelected);
      if (!this.claimLabel(camera, x, labelY, text.length)) continue;

      const unit = 1 / camera.zoom;
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
      if (!isPlayer || (!isSelected && !engaged)) continue;

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

  private labelText(
    state: GameState,
    group: ArmyGroup,
    isPlayer: boolean,
    isSelected: boolean,
  ): string {
    if (isPlayer) return isSelected ? `${group.name}  ${group.members.length}` : group.name;
    // An enemy count is an estimate by eye, rounded exactly as intelligence
    // rounds it, so the map never tells the player more than the Marshal gets.
    const estimate =
      Math.round(group.members.length / STRENGTH_ESTIMATE_GRANULARITY) *
      STRENGTH_ESTIMATE_GRANULARITY;
    return `${group.name}  ~${estimate}`;
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

