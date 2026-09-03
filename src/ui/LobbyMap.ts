import { MAP_HEIGHT, MAP_WIDTH } from '../game/config/battle';
import {
  BATTLE_MAPS,
  barrierCenterY,
  type BattleMapDefinition,
  type ZoneDefinition,
} from '../game/config/maps';
import type { GroupSpec, ScenarioDefinition } from '../game/config/scenario';
import type { UnitCategory } from '../game/types/domain';
import { PALETTE } from '../rendering/canvas/palette';
import {
  BUSH,
  COTTAGE,
  CRAG,
  HALL,
  ICON_CROWN,
  ROLE_SPRITES,
  TREE_DEAD,
  TREE_OAK,
  TREE_PINE,
  WATCHTOWER,
  artHash,
  paintSprite,
  type Sprite,
} from '../rendering/canvas/pixelart';

/**
 * The battlefield portrait on the War Council table.
 *
 * Drawn, not photographed. A fifth battlefield or a designed operation has no
 * hand-made picture, and the one screen where a Marshal's own battle most needs
 * looking at before it is fought cannot depend on an artist having been there
 * first. So this reads the map data and the operation's deployment and paints
 * the ground itself.
 *
 * It paints it the way the battlefield paints itself. `TerrainLayer` bakes the
 * field into one low-resolution index buffer — a material per art pixel — and
 * blows it up with nearest-neighbour sampling, which is what makes the game
 * read as authored pixel art rather than as green shapes that happen to be in
 * the right places. The portrait does the same at a coarser grain: 320 by 200
 * art pixels for eight thousand by five thousand of ground, resolved once and
 * enlarged six times.
 *
 * That grain is the whole design. The old portrait softened a small buffer and
 * stretched it, so woods and hills arrived as brown and green stains and the
 * river as a smooth band — a picture of a different game. Here a wood is a
 * floor of canopy with trees standing on it, a village is earth with cottages,
 * a hill carries its contours, and the water has a bank a pixel wide. Nothing
 * is blurred, so nothing has to apologise for its edges.
 *
 * The armies are counters rather than blocks: a faction plate carrying the
 * stencil of the arm most of the regiment carries, sized by the weight standing
 * there, and the kings crowned and ringed in gold on top of it.
 *
 * The buffers are cut once and reused. Choosing a different operation repaints
 * the whole portrait, and looking at another battle must not cost a stall —
 * sixty-four thousand art pixels and one enlargement is well inside a frame.
 */

/** World units per art pixel. Twenty-five gives the 320 x 200 chart grid. */
const ART_SCALE = 25;
const ART_WIDTH = Math.round(MAP_WIDTH / ART_SCALE);
const ART_HEIGHT = Math.round(MAP_HEIGHT / ART_SCALE);

/** Plate samples per art pixel: how chunky the enlarged pixel reads. */
const RES = 6;
const PLATE_WIDTH = ART_WIDTH * RES;
const PLATE_HEIGHT = ART_HEIGHT * RES;

/* Materials written into the index buffer, resolved to colour in one pass. */
const M_GRASS = 0;
const M_FIELD = 1;
const M_FOREST = 2;
const M_HILL = 3;
const M_CONTOUR = 4;
const M_WATER = 5;
const M_WATER_EDGE = 6;
const M_ROAD = 7;
const M_ROAD_EDGE = 8;
const M_DECK = 9;
const M_DECK_EDGE = 10;
const M_EARTH = 11;
const M_ROCK = 12;
const M_ROCK_EDGE = 13;
const MATERIAL_COUNT = 14;

/** A `Uint32Array` over `ImageData` needs the byte order the machine writes in. */
const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;

/**
 * The chart's own mark, so the plate reads as a survey and not as a viewport.
 *
 * North is up on every battlefield — the player looks up the map and the enemy
 * looks down — so the rose can be authored rather than derived.
 */
const COMPASS: Sprite = {
  rows: [
    '.o...o.',
    '.oo..o.',
    '.o.o.o.',
    '.o..oo.',
    '.o...o.',
    '.......',
    '...o...',
    '..ooo..',
    '.ooooo.',
    '...n...',
    '...n...',
    '..nnn..',
  ],
};

/** The parchment an arm's glyph is cut in on a faction counter. */
const STENCIL = '#efe7cd';

/**
 * An arm's glyph as a stencil, in two inks.
 *
 * The roster draws those glyphs on a dark panel, where their greys and steels
 * separate. On a saturated faction counter they turn to mud, so every ink that
 * carries the silhouette is flattened to one parchment. The two that carry a
 * glyph's *inside* — the boss of the heavy shield, the pupil of the scout's
 * eye, the infantryman's legs — are cut back to the counter's own dark instead,
 * because a stencil with nothing punched out of it is a blob.
 */
function stencilInk(shade: string): Record<string, string> {
  return {
    P: STENCIL,
    Q: STENCIL,
    W: STENCIL,
    w: STENCIL,
    k: STENCIL,
    A: shade,
    B: shade,
    '#': shade,
  };
}

function channels(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

function pack(red: number, green: number, blue: number): number {
  return LITTLE_ENDIAN
    ? ((0xff << 24) | (blue << 16) | (green << 8) | red) >>> 0
    : ((red << 24) | (green << 16) | (blue << 8) | 0xff) >>> 0;
}

function tint(map: BattleMapDefinition, key: keyof BattleMapDefinition['ground'], fallback: string): string {
  return map.ground[key] ?? fallback;
}

/**
 * A tone between two inks, so a map's own colours make their own second shade.
 *
 * The ground is drawn in patches of two tones, and taking the lighter one from
 * the shared palette scattered spring green over ash country: every map that
 * authors its own earth has to author its own highlight with it.
 */
function blend(from: string, to: string, amount: number): string {
  const a = channels(from);
  const b = channels(to);
  const mix = (low: number, high: number): string =>
    Math.round(low + (high - low) * amount)
      .toString(16)
      .padStart(2, '0');
  return `#${mix(a[0], b[0])}${mix(a[1], b[1])}${mix(a[2], b[2])}`;
}

function artX(x: number): number {
  return Math.round(x / ART_SCALE);
}

function artY(y: number): number {
  return Math.round(y / ART_SCALE);
}

/** A stable salt per zone, so the same ground grows the same trees every time. */
function saltOf(id: string): number {
  return id.length * 131 + id.charCodeAt(0) * 7;
}

function groupStrength(group: GroupSpec): number {
  let total = 0;
  for (const [, count] of group.composition) total += count;
  return total;
}

/** Strength read as the size of the counter, so a portrait shows weight. */
function counterSize(strength: number): number {
  if (strength >= 800) return 14;
  if (strength >= 400) return 12;
  if (strength >= 150) return 11;
  return 10;
}

/** The arm most of the regiment carries. One glyph has to stand for all of it. */
function primaryRole(group: GroupSpec): UnitCategory {
  let role: UnitCategory = 'infantry';
  let best = -1;
  for (const [category, count] of group.composition) {
    if (count > best) {
      best = count;
      role = category;
    }
  }
  return role;
}

interface Prop {
  /** Art pixels, so the scatter is sorted and stamped in the grid it lands on. */
  x: number;
  y: number;
  sprite: Sprite;
}

export class LobbyMap {
  private readonly context: CanvasRenderingContext2D | null;
  /** The chart at its true size. Everything is drawn here, then enlarged once. */
  private readonly art: HTMLCanvasElement;
  private readonly artContext: CanvasRenderingContext2D | null;
  private readonly materials = new Uint8Array(ART_WIDTH * ART_HEIGHT);
  private readonly image: ImageData | null;
  private readonly pixels: Uint32Array | null;
  private props: Prop[] = [];

  public constructor(canvas: HTMLCanvasElement) {
    canvas.width = PLATE_WIDTH;
    canvas.height = PLATE_HEIGHT;
    this.context = canvas.getContext('2d');

    this.art = document.createElement('canvas');
    this.art.width = ART_WIDTH;
    this.art.height = ART_HEIGHT;
    this.artContext = this.art.getContext('2d');
    this.image = this.artContext === null ? null : this.artContext.createImageData(ART_WIDTH, ART_HEIGHT);
    this.pixels = this.image === null ? null : new Uint32Array(this.image.data.buffer);
  }

  public draw(operation: ScenarioDefinition): void {
    const context = this.context;
    const art = this.artContext;
    if (context === null || art === null) return;
    const map = BATTLE_MAPS[operation.mapId];

    this.materials.fill(M_GRASS);
    this.props = [];

    this.paintZoneGround(map);
    this.paintWater(map);
    this.paintRoads(map);
    this.paintCrossings(map);
    this.markEdges();
    this.resolveMaterials(map);

    art.imageSmoothingEnabled = false;
    this.scatterProps(map);
    this.paintProps(art);
    this.paintCompass(art);
    this.paintArmies(art, operation);

    // One enlargement, nearest-neighbour: the art pixel is the unit of this
    // picture, and any smoothing here would dissolve exactly what was drawn.
    context.imageSmoothingEnabled = false;
    context.drawImage(this.art, 0, 0, PLATE_WIDTH, PLATE_HEIGHT);
    this.paintFrame(context);
  }

  /* ------------------------------------------------------------- the ground */

  /** Zone bodies: fields, woodland floor, hillsides, village earth, rock. */
  private paintZoneGround(map: BattleMapDefinition): void {
    for (const zone of map.zones) {
      const cx = zone.center.x / ART_SCALE;
      const cy = zone.center.y / ART_SCALE;
      const radius = zone.radius / ART_SCALE;
      const salt = saltOf(zone.id);

      switch (zone.terrain) {
        case 'open':
          this.blob(cx, cy, radius * 0.92, radius * 0.66, M_FIELD, 0.16, salt);
          break;
        case 'forest':
          this.blob(cx, cy, radius * 0.98, radius * 0.86, M_FOREST, 0.2, salt);
          break;
        case 'hill':
          // Three shrinking rings, each outlined. A hill is read on a chart by
          // its contours, not by being a lighter brown than the field it is in.
          for (let ring = 0; ring < 3; ring += 1) {
            const scale = 1 - ring * 0.24;
            this.blob(cx, cy, radius * scale, radius * scale * 0.64, M_HILL, 0.12, salt + ring);
            this.outline(cx, cy, radius * scale, radius * scale * 0.64, M_CONTOUR, salt + ring);
          }
          break;
        case 'village':
          this.blob(cx, cy, radius * 0.78, radius * 0.66, M_EARTH, 0.18, salt);
          break;
        case 'ridge':
          this.blob(cx, cy, radius * 0.9, radius * 0.6, M_ROCK, 0.14, salt);
          break;
        default:
          break;
      }
    }
  }

  /** The barrier and every standing mere. */
  private paintWater(map: BattleMapDefinition): void {
    const barrier = map.barrier;
    if (barrier !== undefined) {
      const rock = barrier.kind === 'ridge';
      const half = barrier.halfWidth / ART_SCALE;
      for (let x = 0; x < ART_WIDTH; x += 1) {
        const center = barrierCenterY(barrier, x * ART_SCALE) / ART_SCALE;
        // A ragged bank. A ruler-straight edge is the one thing that would give
        // the whole chart away as generated.
        const top = Math.round(center - half + (artHash(x, 11) - 0.5) * 1.1);
        const bottom = Math.round(center + half + (artHash(x, 29) - 0.5) * 1.1);
        for (let y = top; y <= bottom; y += 1) this.set(x, y, rock ? M_ROCK : M_WATER);
      }
    }

    for (const mere of map.meres) {
      this.blob(
        mere.center.x / ART_SCALE,
        mere.center.y / ART_SCALE,
        mere.radius / ART_SCALE,
        (mere.radius * 0.78) / ART_SCALE,
        M_WATER,
        0.26,
        mere.name.length * 7,
      );
    }
  }

  /**
   * Worn tracks between the places armies actually march between.
   *
   * The whole net's verges are laid before any of its metalling. Stamped road
   * by road, every step's verge buried the core the step before it had just
   * put down, and the net came out as a web of dark earth with no road in it.
   */
  private paintRoads(map: BattleMapDefinition): void {
    for (const material of [M_ROAD_EDGE, M_ROAD]) {
      for (const road of map.roads) {
        const points = road
          .map((id) => map.zones.find((zone) => zone.id === id))
          .filter((zone): zone is ZoneDefinition => zone !== undefined)
          .map((zone) => zone.center);
        for (let index = 0; index < points.length - 1; index += 1) {
          const from = points[index];
          const to = points[index + 1];
          if (from === undefined || to === undefined) continue;
          this.track(from.x, from.y, to.x, to.y, material);
        }
      }
    }
  }

  /**
   * The few places the barrier can be passed.
   *
   * Over water that is carpentry: a timber deck with plank seams and a rail
   * along each bank. Through rock it is not — a pass is trodden earth between
   * broken stone, and a plank bridge laid over a mountain spine was the one
   * thing on the ashfall chart that could not be believed.
   */
  private paintCrossings(map: BattleMapDefinition): void {
    const barrier = map.barrier;
    if (barrier === undefined) return;
    const half = barrier.halfWidth / ART_SCALE;
    const rock = barrier.kind === 'ridge';

    for (const zone of map.zones) {
      if (!zone.crossing) continue;
      const cx = artX(zone.center.x);
      const center = barrierCenterY(barrier, zone.center.x) / ART_SCALE;
      const reach = Math.max(4, Math.round(Math.min(zone.radius * 1.05, 640) / ART_SCALE / 2));
      const top = Math.round(center - half - 2);
      const bottom = Math.round(center + half + 2);

      for (let x = cx - reach; x <= cx + reach; x += 1) {
        for (let y = top; y <= bottom; y += 1) {
          const shoulder = x === cx - reach || x === cx + reach;
          if (rock) this.set(x, y, shoulder ? M_ROCK_EDGE : M_EARTH);
          else this.set(x, y, shoulder ? M_DECK_EDGE : M_DECK);
        }
      }

      if (rock) {
        // Two ruts worn the way the carts go, and nothing else: a defile is
        // ground that has been walked flat, not a structure.
        for (const offset of [-2, 2]) {
          for (let y = top; y <= bottom; y += 1) this.set(cx + offset, y, M_ROAD);
        }
      } else {
        // Deck boards, and a rail along each bank, so a bridge reads as
        // carpentry rather than as a brown bar laid over the water.
        for (let x = cx - reach + 2; x < cx + reach; x += 3) {
          for (let y = top; y <= bottom; y += 1) this.set(x, y, M_DECK_EDGE);
        }
        for (let x = cx - reach; x <= cx + reach; x += 1) {
          this.set(x, top, M_DECK_EDGE);
          this.set(x, bottom, M_DECK_EDGE);
        }
      }
    }
  }

  /**
   * A one-pixel rim wherever water or rock meets anything else.
   *
   * A bank on the water and a lit crest on the ridge. Both are the same trick,
   * and both are what stop the one impassable feature of a map from reading as
   * a coloured bar someone laid across the country.
   */
  private markEdges(): void {
    const source = this.materials.slice();
    for (let y = 1; y < ART_HEIGHT - 1; y += 1) {
      for (let x = 1; x < ART_WIDTH - 1; x += 1) {
        const index = y * ART_WIDTH + x;
        const material = source[index];
        if (material !== M_WATER && material !== M_ROCK) continue;
        if (
          source[index - 1] !== material ||
          source[index + 1] !== material ||
          source[index - ART_WIDTH] !== material ||
          source[index + ART_WIDTH] !== material
        ) {
          this.materials[index] = material === M_WATER ? M_WATER_EDGE : M_ROCK_EDGE;
        }
      }
    }
  }

  /* --------------------------------------------------------- painting math */

  private set(x: number, y: number, material: number): void {
    if (x < 0 || y < 0 || x >= ART_WIDTH || y >= ART_HEIGHT) return;
    this.materials[y * ART_WIDTH + x] = material;
  }

  /**
   * An ellipse broken into pixel steps by the art hash.
   *
   * The ragged term is what separates a wood from a debug shape: the silhouette
   * frays at the grain of the chart rather than at its resolution.
   */
  private blob(
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    material: number,
    ragged: number,
    salt: number,
  ): void {
    const left = Math.floor(cx - rx - 2);
    const right = Math.ceil(cx + rx + 2);
    const top = Math.floor(cy - ry - 2);
    const bottom = Math.ceil(cy + ry + 2);

    for (let y = top; y <= bottom; y += 1) {
      for (let x = left; x <= right; x += 1) {
        const dx = (x - cx) / Math.max(1, rx);
        const dy = (y - cy) / Math.max(1, ry);
        const noise = (artHash(x + salt, y - salt) - 0.5) * ragged;
        if (dx * dx + dy * dy + noise < 1) this.set(x, y, material);
      }
    }
  }

  private outline(cx: number, cy: number, rx: number, ry: number, material: number, salt: number): void {
    const steps = Math.max(24, Math.round((rx + ry) * 3));
    for (let step = 0; step < steps; step += 1) {
      const angle = (step / steps) * Math.PI * 2;
      const wobble = 1 + (artHash(step + salt, salt) - 0.5) * 0.08;
      this.set(
        Math.round(cx + Math.cos(angle) * rx * wobble),
        Math.round(cy + Math.sin(angle) * ry * wobble),
        material,
      );
    }
  }

  /**
   * A track between two places: a pixel of metalling with a verge either side.
   *
   * A real road is thirty world units wide and would be a fifth of a pixel
   * here, so the width is a chart's exaggeration rather than a measurement. The
   * wander is not an exaggeration: a surveyed straight line between two zone
   * centres is what made the old roads read as a wiring diagram laid over the
   * country rather than as ground anyone had walked.
   */
  private track(fromX: number, fromY: number, toX: number, toY: number, material: number): void {
    const ax = fromX / ART_SCALE;
    const ay = fromY / ART_SCALE;
    const bx = toX / ART_SCALE;
    const by = toY / ART_SCALE;
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) * 2));
    const spread = material === M_ROAD_EDGE ? 1 : 0;

    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps;
      const wander = (artHash(step, 5) - 0.5) * 1.4;
      const x = ax + (bx - ax) * t + wander * 0.35;
      const y = ay + (by - ay) * t + wander * 0.35;

      for (let oy = -spread; oy <= spread; oy += 1) {
        for (let ox = -spread; ox <= spread; ox += 1) {
          const px = Math.round(x + ox);
          const py = Math.round(y + oy);
          if (px < 0 || py < 0 || px >= ART_WIDTH || py >= ART_HEIGHT) continue;
          const existing = this.materials[py * ART_WIDTH + px];
          // A track never paints over water or a bridge deck.
          if (existing === M_WATER || existing === M_DECK || existing === M_DECK_EDGE) continue;
          this.set(px, py, material);
        }
      }
    }
  }

  /** Index buffer to pixels, two shades per material in broad quiet patches. */
  private resolveMaterials(map: BattleMapDefinition): void {
    const context = this.artContext;
    const image = this.image;
    const pixels = this.pixels;
    if (context === null || image === null || pixels === null) return;

    const grass = tint(map, 'grass', PALETTE.grass);
    const field = tint(map, 'openField', PALETTE.openField);

    const ramp: Array<[string, string]> = new Array(MATERIAL_COUNT).fill(['#000000', '#000000']);
    ramp[M_GRASS] = [grass, blend(grass, field, 0.3)];
    ramp[M_FIELD] = [field, blend(field, grass, 0.32)];
    ramp[M_FOREST] = [PALETTE.forest, tint(map, 'forestCanopy', PALETTE.forestCanopy)];
    ramp[M_HILL] = [tint(map, 'hill', PALETTE.hill), tint(map, 'hill', PALETTE.hill)];
    ramp[M_CONTOUR] = [
      tint(map, 'hillContour', PALETTE.hillContour),
      tint(map, 'hillContour', PALETTE.hillContour),
    ];
    ramp[M_WATER] = [tint(map, 'river', PALETTE.river), tint(map, 'riverEdge', PALETTE.riverEdge)];
    ramp[M_WATER_EDGE] = [tint(map, 'riverEdge', PALETTE.riverEdge), PALETTE.foam];
    ramp[M_ROAD] = [tint(map, 'road', PALETTE.road), PALETTE.sandDark];
    ramp[M_ROAD_EDGE] = [PALETTE.earthDark, PALETTE.earth];
    ramp[M_DECK] = [tint(map, 'crossing', PALETTE.crossing), PALETTE.timber];
    ramp[M_DECK_EDGE] = [PALETTE.timberDark, PALETTE.timberDark];
    ramp[M_EARTH] = [PALETTE.earth, PALETTE.earthDark];
    ramp[M_ROCK] = [PALETTE.stoneDark, PALETTE.stone];
    ramp[M_ROCK_EDGE] = [PALETTE.stone, PALETTE.stoneLight];

    const inks = ramp.map(([low, high]) => {
      const a = channels(low);
      const b = channels(high);
      return [pack(a[0], a[1], a[2]), pack(b[0], b[1], b[2])] as const;
    });

    for (let y = 0; y < ART_HEIGHT; y += 1) {
      for (let x = 0; x < ART_WIDTH; x += 1) {
        const index = y * ART_WIDTH + x;
        const pair = inks[this.materials[index] ?? M_GRASS] ?? inks[M_GRASS];
        if (pair === undefined) continue;
        // Patches two pixels across rather than a per-pixel dither: at this
        // size a checkerboard would be static, and the armies have to stay
        // legible standing on it.
        pixels[index] = artHash(x >> 1, y >> 1) > 0.82 ? pair[1] : pair[0];
      }
    }

    context.putImageData(image, 0, 0);
  }

  /* --------------------------------------------------------------- scatter */

  /** What stands on the ground: woods, villages, watchtowers, broken rock. */
  private scatterProps(map: BattleMapDefinition): void {
    for (const zone of map.zones) {
      const salt = saltOf(zone.id);
      const cx = zone.center.x / ART_SCALE;
      const cy = zone.center.y / ART_SCALE;
      const radius = zone.radius / ART_SCALE;

      if (zone.terrain === 'forest') {
        const count = Math.min(24, Math.max(6, Math.round(radius * 0.62)));
        for (let n = 0; n < count; n += 1) {
          const angle = artHash(salt + n, 3) * Math.PI * 2;
          const distance = Math.sqrt(artHash(salt + n, 5)) * radius * 0.88;
          const pick = artHash(salt + n, 7);
          this.props.push({
            x: cx + Math.cos(angle) * distance,
            y: cy + Math.sin(angle) * distance,
            sprite: pick > 0.9 ? TREE_DEAD : pick > 0.45 ? TREE_PINE : TREE_OAK,
          });
        }
        // A fringe of scrub, so a wood does not end on a hard line.
        for (let n = 0; n < count; n += 1) {
          const angle = artHash(salt + n, 13) * Math.PI * 2;
          this.props.push({
            x: cx + Math.cos(angle) * radius,
            y: cy + Math.sin(angle) * radius * 0.94,
            sprite: BUSH,
          });
        }
      }

      if (zone.terrain === 'village') {
        const count = Math.min(9, Math.max(4, Math.round(radius * 0.4)));
        for (let n = 0; n < count; n += 1) {
          const angle = artHash(salt + n, 17) * Math.PI * 2;
          const distance = Math.sqrt(artHash(salt + n, 19)) * radius * 0.62;
          this.props.push({
            x: cx + Math.cos(angle) * distance,
            y: cy + Math.sin(angle) * distance,
            sprite: artHash(salt + n, 23) > 0.74 ? HALL : COTTAGE,
          });
        }
      }

      if (zone.terrain === 'hill') {
        // High ground you can find by eye, which is what a hill is for.
        this.props.push({ x: cx, y: cy - radius * 0.1, sprite: WATCHTOWER });
        for (let n = 0; n < 2; n += 1) {
          const angle = artHash(salt + n, 41) * Math.PI * 2;
          this.props.push({
            x: cx + Math.cos(angle) * radius * 0.7,
            y: cy + Math.sin(angle) * radius * 0.6,
            sprite: CRAG,
          });
        }
      }

      if (zone.terrain === 'ridge') {
        this.props.push({ x: cx, y: cy, sprite: CRAG });
      }
    }

    // Rubble along an impassable spine, so it never reads as a dry river.
    const barrier = map.barrier;
    if (barrier?.kind === 'ridge') {
      const half = barrier.halfWidth / ART_SCALE;
      for (let x = 6; x < ART_WIDTH; x += 9) {
        const center = barrierCenterY(barrier, x * ART_SCALE) / ART_SCALE;
        for (let row = 0; row < 2; row += 1) {
          this.props.push({
            x: x + (artHash(x, row) - 0.5) * 4,
            y: center + (row - 0.5) * half * 1.2 + (artHash(x, row + 40) - 0.5) * 2,
            sprite: CRAG,
          });
        }
      }
    }
  }

  /** Painted back to front, so a cottage lower on the chart stands in front. */
  private paintProps(context: CanvasRenderingContext2D): void {
    const ordered = [...this.props].sort((a, b) => a.y - b.y);
    for (const prop of ordered) {
      paintSprite(context, prop.sprite, Math.round(prop.x), Math.round(prop.y), 1);
    }
  }

  /* -------------------------------------------------------------- markings */

  private paintCompass(context: CanvasRenderingContext2D): void {
    context.globalAlpha = 0.62;
    paintSprite(context, COMPASS, 14, ART_HEIGHT - 8, 1);
    context.globalAlpha = 1;
  }

  /**
   * Both orders of battle, as counters.
   *
   * A plate the size of the weight standing there, the stencil of the arm most
   * of the regiment carries, and a shadow under it so the counter sits on the
   * country rather than in it. The enemy is laid down first: where two
   * deployments overlap, a Marshal should see his own.
   */
  private paintArmies(context: CanvasRenderingContext2D, operation: ScenarioDefinition): void {
    for (const [groups, fill, shade, light] of [
      [operation.enemyGroups, PALETTE.enemy, PALETTE.enemyDark, PALETTE.enemyLight] as const,
      [operation.playerGroups, PALETTE.player, PALETTE.playerDark, PALETTE.playerLight] as const,
    ]) {
      for (const group of groups) {
        const size = counterSize(groupStrength(group));
        const x = artX(group.anchor.x) - Math.floor(size / 2);
        const y = artY(group.anchor.y) - Math.floor(size / 2);

        context.fillStyle = 'rgba(8, 10, 6, 0.42)';
        context.fillRect(x + 1, y + 2, size, size);
        context.fillStyle = shade;
        context.fillRect(x, y, size, size);
        context.fillStyle = fill;
        context.fillRect(x + 1, y + 1, size - 2, size - 2);
        // One lit edge along the top: the plate has a thickness to it.
        context.fillStyle = light;
        context.fillRect(x + 1, y + 1, size - 2, 1);

        const sprite = ROLE_SPRITES[primaryRole(group)] ?? ROLE_SPRITES.infantry;
        if (sprite !== undefined) {
          paintSprite(context, sprite, x + size / 2, y + size / 2 + 4, 1, stencilInk(shade));
        }
      }
    }

    // The kings last, so nothing is ever drawn over the objective.
    for (const king of operation.kingSpecs) {
      const guard =
        operation.playerGroups.find((group) => group.id === king.guardGroupId) ??
        operation.enemyGroups.find((group) => group.id === king.guardGroupId);
      if (guard === undefined) continue;
      const size = counterSize(groupStrength(guard));
      const x = artX(guard.anchor.x) - Math.floor(size / 2);
      const y = artY(guard.anchor.y) - Math.floor(size / 2);

      // A gold ring around the guard, and the crown over it. Gold is reserved
      // for the objective, and the objective is the one thing worth finding on
      // this chart before the battle has started.
      context.fillStyle = PALETTE.kingGold;
      context.fillRect(x - 1, y - 1, size + 2, 1);
      context.fillRect(x - 1, y + size, size + 2, 1);
      context.fillRect(x - 1, y, 1, size);
      context.fillRect(x + size, y, 1, size);
      paintSprite(context, ICON_CROWN, x + size / 2, y - 2, 1);
    }
  }

  /** A dark vignette and a hard border: the portrait is a plate, not a window. */
  private paintFrame(context: CanvasRenderingContext2D): void {
    context.globalAlpha = 0.07;
    context.strokeStyle = '#080b07';
    context.lineWidth = RES;
    for (let ring = 0; ring < 10; ring += 1) {
      const inset = ring * RES + RES / 2;
      context.strokeRect(inset, inset, PLATE_WIDTH - inset * 2, PLATE_HEIGHT - inset * 2);
    }
    context.globalAlpha = 1;
    context.strokeStyle = PALETTE.mapEdge;
    context.lineWidth = RES / 2;
    context.strokeRect(RES / 4, RES / 4, PLATE_WIDTH - RES / 2, PLATE_HEIGHT - RES / 2);
  }
}
