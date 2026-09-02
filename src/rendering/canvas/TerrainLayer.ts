import { MAP_HEIGHT, MAP_WIDTH } from '../../game/config/battle';
import type { BattleMapId } from '../../game/config/maps';
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
import {
  BUSH,
  COTTAGE,
  CRAG,
  HALL,
  MINE,
  TREE_DEAD,
  TREE_OAK,
  TREE_PINE,
  WATCHTOWER,
  WAYPOST,
  LABEL_FONT,
  artHash,
  paintSprite,
  type Sprite,
} from './pixelart';

/**
 * The ground, as pixel art.
 *
 * The whole battlefield is baked once per map into a single low-resolution
 * bitmap and then blown up with nearest-neighbour sampling, which is what makes
 * it read as authored pixel art rather than as smooth vector shapes that happen
 * to be green. One `drawImage` a frame replaces the several hundred culled
 * shape fills this layer used to cost, so the new look is also the cheaper one.
 *
 * Everything that moves — water, banners, torch light, chimney smoke — is drawn
 * over that bitmap in world space and driven by the simulation tick, never by
 * wall-clock time, so the field freezes when the battle is paused.
 */

/** World units per art pixel. Six keeps the grain chunky and the bake small. */
const ART_SCALE = 6;
const ART_WIDTH = Math.ceil(MAP_WIDTH / ART_SCALE);
const ART_HEIGHT = Math.ceil(MAP_HEIGHT / ART_SCALE);

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
const M_SAND = 13;
const MATERIAL_COUNT = 14;

interface Prop {
  /** World coordinates. */
  x: number;
  y: number;
  sprite: Sprite;
}

interface Banner {
  x: number;
  y: number;
  /** Pole height in world units. */
  height: number;
  cloth: string;
  crest: string;
}

interface Torch {
  x: number;
  y: number;
  seed: number;
}

interface Chimney {
  x: number;
  y: number;
  seed: number;
}

export class TerrainLayer {
  private builtFor: BattleMapId | undefined;
  private readonly bitmap: HTMLCanvasElement;
  private readonly materials = new Uint8Array(ART_WIDTH * ART_HEIGHT);
  private props: Prop[] = [];
  private banners: Banner[] = [];
  private torches: Torch[] = [];
  private chimneys: Chimney[] = [];
  /** Water pixels, in world coordinates, sampled for the shimmer overlay. */
  private ripples: Array<{ x: number; y: number; seed: number }> = [];

  public constructor(mapId?: BattleMapId) {
    this.bitmap = document.createElement('canvas');
    this.bitmap.width = ART_WIDTH;
    this.bitmap.height = ART_HEIGHT;
    if (mapId !== undefined) useBattleMap(mapId);
    this.rebuild();
  }

  /** The baked ground, shared with the minimap so both show one picture. */
  public get artwork(): HTMLCanvasElement {
    return this.bitmap;
  }

  /** Rebuilds only when the battle is being fought somewhere else. */
  public syncTo(mapId: BattleMapId): void {
    if (this.builtFor === mapId) return;
    useBattleMap(mapId);
    this.rebuild();
  }

  /* ------------------------------------------------------------- the bake */

  private rebuild(): void {
    const map = activeBattleMap();
    this.builtFor = activeBattleMapId();
    // Authored ground colouring over the shared palette: ash country is not the
    // colour of harvest country, and the map should say so before anything moves.
    const colors = { ...PALETTE, ...map.ground };

    this.materials.fill(M_GRASS);
    this.props = [];
    this.banners = [];
    this.torches = [];
    this.chimneys = [];
    this.ripples = [];

    this.paintZoneGround();
    this.paintWater();
    this.paintRoads();
    this.paintCrossings();
    this.markWaterEdges();
    this.resolveMaterials(colors);
    this.scatterProps();
    this.paintProps();
  }

  /** Zone bodies: fields, woodland floor, hillsides, village earth, rock. */
  private paintZoneGround(): void {
    for (const zone of activeZones()) {
      const cx = zone.center.x / ART_SCALE;
      const cy = zone.center.y / ART_SCALE;
      const radius = zone.radius / ART_SCALE;

      switch (zone.terrain) {
        case 'open':
          // Tilled strips rather than a flat wash, laid out from a stable hash
          // so a field looks the same on every load.
          this.fillBlob(cx, cy, radius * 0.92, radius * 0.66, M_FIELD, 0.34, zone.id);
          break;
        case 'forest':
          this.fillBlob(cx, cy, radius * 0.98, radius * 0.86, M_FOREST, 0.4, zone.id);
          break;
        case 'hill':
          for (let ring = 0; ring < 3; ring += 1) {
            const scale = 1 - ring * 0.24;
            this.fillBlob(cx, cy, radius * scale, radius * scale * 0.64, M_HILL, 0.22, zone.id + ring);
            this.outlineBlob(cx, cy, radius * scale, radius * scale * 0.64, M_CONTOUR, zone.id + ring);
          }
          break;
        case 'village':
          this.fillBlob(cx, cy, radius * 0.82, radius * 0.7, M_EARTH, 0.36, zone.id);
          break;
        case 'ridge':
          this.fillBlob(cx, cy, radius * 0.9, radius * 0.6, M_ROCK, 0.3, zone.id);
          break;
        default:
          break;
      }
    }
  }

  /** The barrier and every standing mere. */
  private paintWater(): void {
    const map = activeBattleMap();
    const rock = map.barrier?.kind === 'ridge';

    if (map.barrier !== undefined) {
      const half = barrierHalfWidth() / ART_SCALE;
      for (let x = 0; x < ART_WIDTH; x += 1) {
        const center = barrierCenterAt(x * ART_SCALE) / ART_SCALE;
        // A ragged bank. A ruler-straight edge is the one thing that would give
        // the whole bake away as generated.
        const wobbleTop = (artHash(x, 11) - 0.5) * 2.2;
        const wobbleBottom = (artHash(x, 29) - 0.5) * 2.2;
        const top = Math.round(center - half + wobbleTop);
        const bottom = Math.round(center + half + wobbleBottom);
        for (let y = top; y <= bottom; y += 1) this.set(x, y, rock ? M_ROCK : M_WATER);
      }
    }

    for (const mere of map.meres) {
      this.fillBlob(
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

  /** Worn tracks between the places armies actually march between. */
  private paintRoads(): void {
    for (const route of activeBattleMap().roads) {
      const points = route.map((id) => ZONES[id].center);
      for (let index = 0; index < points.length - 1; index += 1) {
        const from = points[index];
        const to = points[index + 1];
        if (from === undefined || to === undefined) continue;
        this.stampLine(from.x, from.y, to.x, to.y, 2, M_ROAD, M_ROAD_EDGE);
      }
    }
  }

  /** Bridges and fords: a timber deck laid across the barrier. */
  private paintCrossings(): void {
    if (activeBattleMap().barrier === undefined) return;
    const half = barrierHalfWidth() / ART_SCALE;

    for (const crossing of activeCrossings()) {
      const cx = Math.round(crossing.center.x / ART_SCALE);
      const centerY = barrierCenterAt(crossing.center.x) / ART_SCALE;
      const halfWidth = Math.round(Math.min(crossing.radius * 1.05, 520) / ART_SCALE / 2);
      const top = Math.round(centerY - half - 4);
      const bottom = Math.round(centerY + half + 4);

      for (let x = cx - halfWidth; x <= cx + halfWidth; x += 1) {
        for (let y = top; y <= bottom; y += 1) {
          const edge = x === cx - halfWidth || x === cx + halfWidth;
          this.set(x, y, edge ? M_DECK_EDGE : M_DECK);
        }
      }
      // Plank seams, so a bridge reads as carpentry rather than as a brown bar.
      for (let x = cx - halfWidth + 2; x < cx + halfWidth; x += 3) {
        for (let y = top; y <= bottom; y += 1) this.set(x, y, M_DECK_EDGE);
      }
      // Rails along both banks.
      for (let x = cx - halfWidth; x <= cx + halfWidth; x += 1) {
        this.set(x, top, M_DECK_EDGE);
        this.set(x, bottom, M_DECK_EDGE);
      }
    }
  }

  /** A one-pixel bank wherever water meets anything else. */
  private markWaterEdges(): void {
    const source = this.materials.slice();
    for (let y = 1; y < ART_HEIGHT - 1; y += 1) {
      for (let x = 1; x < ART_WIDTH - 1; x += 1) {
        const index = y * ART_WIDTH + x;
        if (source[index] !== M_WATER) continue;
        if (
          source[index - 1] !== M_WATER ||
          source[index + 1] !== M_WATER ||
          source[index - ART_WIDTH] !== M_WATER ||
          source[index + ART_WIDTH] !== M_WATER
        ) {
          this.materials[index] = M_WATER_EDGE;
        } else if (artHash(x, y) > 0.985) {
          // Sparse shimmer seeds, collected for the animated overlay.
          this.ripples.push({ x: x * ART_SCALE, y: y * ART_SCALE, seed: (x * 31 + y) % 40 });
        }
      }
    }
  }

  /* --------------------------------------------------------- painting math */

  private set(x: number, y: number, material: number): void {
    if (x < 0 || y < 0 || x >= ART_WIDTH || y >= ART_HEIGHT) return;
    this.materials[y * ART_WIDTH + x] = material;
  }

  private fillBlob(
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    material: number,
    ragged: number,
    seed: number | string,
  ): void {
    const salt = typeof seed === 'string' ? seed.length * 17 + seed.charCodeAt(0) : seed;
    const left = Math.floor(cx - rx - 2);
    const right = Math.ceil(cx + rx + 2);
    const top = Math.floor(cy - ry - 2);
    const bottom = Math.ceil(cy + ry + 2);

    for (let y = top; y <= bottom; y += 1) {
      for (let x = left; x <= right; x += 1) {
        const dx = (x - cx) / Math.max(1, rx);
        const dy = (y - cy) / Math.max(1, ry);
        const distance = dx * dx + dy * dy;
        // The ragged term breaks the silhouette into pixel steps instead of a
        // clean ellipse, which is the difference between art and a debug shape.
        const noise = (artHash(x + salt, y - salt) - 0.5) * ragged;
        if (distance + noise < 1) this.set(x, y, material);
      }
    }
  }

  private outlineBlob(
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    material: number,
    seed: number | string,
  ): void {
    const salt = typeof seed === 'string' ? seed.length * 23 : seed;
    const steps = Math.max(24, Math.round((rx + ry) * 1.6));
    for (let step = 0; step < steps; step += 1) {
      const angle = (step / steps) * Math.PI * 2;
      const wobble = 1 + (artHash(step + salt, salt) - 0.5) * 0.06;
      this.set(Math.round(cx + Math.cos(angle) * rx * wobble), Math.round(cy + Math.sin(angle) * ry * wobble), material);
    }
  }

  /** Stamps a track between two world points, with a darker verge. */
  private stampLine(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    halfWidth: number,
    core: number,
    verge: number,
  ): void {
    const ax = fromX / ART_SCALE;
    const ay = fromY / ART_SCALE;
    const bx = toX / ART_SCALE;
    const by = toY / ART_SCALE;
    const length = Math.hypot(bx - ax, by - ay);
    const steps = Math.max(1, Math.ceil(length));

    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps;
      const x = ax + (bx - ax) * t;
      const y = ay + (by - ay) * t;
      // Enough wander to look walked rather than surveyed, and no more: at a
      // pixel and a half either way a track turns into a ribbon of noise.
      const wander = (artHash(step, 5) - 0.5) * 0.8;
      const radius = halfWidth + (artHash(step, 9) > 0.92 ? 1 : 0);
      for (let oy = -radius - 1; oy <= radius + 1; oy += 1) {
        for (let ox = -radius - 1; ox <= radius + 1; ox += 1) {
          const distance = Math.hypot(ox, oy);
          if (distance > radius + 1) continue;
          const px = Math.round(x + ox + wander);
          const py = Math.round(y + oy);
          const existing = this.materials[py * ART_WIDTH + px];
          // A track never paints over water or a bridge deck.
          if (existing === M_WATER || existing === M_DECK || existing === M_DECK_EDGE) continue;
          this.set(px, py, distance > radius ? verge : core);
        }
      }
    }
  }

  /** Index buffer to pixels, with the per-pixel dither that sells the style. */
  private resolveMaterials(colors: Record<string, string>): void {
    const context = this.bitmap.getContext('2d');
    if (context === null) return;
    const image = context.createImageData(ART_WIDTH, ART_HEIGHT);
    const data = image.data;

    // Two shades per material, chosen per pixel from a stable hash. Flat colour
    // at this resolution looks like a wireframe; a two-tone dither looks woven.
    const ramp: Array<[string, string]> = new Array(MATERIAL_COUNT).fill(['#000', '#000']);
    ramp[M_GRASS] = [colors.grass ?? PALETTE.grass, colors.grassAlt ?? PALETTE.grassAlt];
    ramp[M_FIELD] = [colors.openField ?? PALETTE.openField, colors.grassAlt ?? PALETTE.grassAlt];
    ramp[M_FOREST] = [PALETTE.forest, colors.forestCanopy ?? PALETTE.forestCanopy];
    ramp[M_HILL] = [colors.hill ?? PALETTE.hill, PALETTE.sandDark];
    ramp[M_CONTOUR] = [colors.hillContour ?? PALETTE.hillContour, colors.hillContour ?? PALETTE.hillContour];
    ramp[M_WATER] = [colors.river ?? PALETTE.river, PALETTE.riverEdge];
    ramp[M_WATER_EDGE] = [colors.riverEdge ?? PALETTE.riverEdge, PALETTE.foam];
    ramp[M_ROAD] = [colors.road ?? PALETTE.road, PALETTE.sandDark];
    ramp[M_ROAD_EDGE] = [PALETTE.earthDark, PALETTE.earth];
    ramp[M_DECK] = [colors.crossing ?? PALETTE.crossing, PALETTE.timber];
    ramp[M_DECK_EDGE] = [PALETTE.timberDark, PALETTE.timberDark];
    ramp[M_EARTH] = [PALETTE.earth, PALETTE.earthDark];
    ramp[M_ROCK] = [PALETTE.stoneDark, PALETTE.stone];
    ramp[M_SAND] = [PALETTE.sand, PALETTE.sandDark];

    const channels = ramp.map(([low, high]) => [hexToRgb(low), hexToRgb(high)] as const);

    for (let y = 0; y < ART_HEIGHT; y += 1) {
      for (let x = 0; x < ART_WIDTH; x += 1) {
        const index = y * ART_WIDTH + x;
        const material = this.materials[index] ?? M_GRASS;
        const pair = channels[material] ?? channels[M_GRASS];
        if (pair === undefined) continue;
        // Coarse 2×2 blocks, so the dither reads as texture and not as static.
        const bright = artHash(x >> 1, y >> 1) > 0.74;
        const rgb = bright ? pair[1] : pair[0];
        const offset = index * 4;
        data[offset] = rgb[0];
        data[offset + 1] = rgb[1];
        data[offset + 2] = rgb[2];
        data[offset + 3] = 255;
      }
    }

    context.putImageData(image, 0, 0);
  }

  /* --------------------------------------------------------------- scatter */

  private scatterProps(): void {
    const map = activeBattleMap();

    for (const zone of activeZones()) {
      const seed = zone.id.length * 131 + zone.id.charCodeAt(0) * 7;

      if (zone.terrain === 'forest') {
        const count = Math.round(zone.radius / 34);
        for (let n = 0; n < count; n += 1) {
          const angle = artHash(seed + n, 3) * Math.PI * 2;
          const distance = Math.sqrt(artHash(seed + n, 5)) * zone.radius * 0.94;
          const pick = artHash(seed + n, 7);
          const sprite = pick > 0.86 ? TREE_DEAD : pick > 0.45 ? TREE_PINE : TREE_OAK;
          this.props.push({
            x: zone.center.x + Math.cos(angle) * distance,
            y: zone.center.y + Math.sin(angle) * distance,
            sprite,
          });
        }
        // A fringe of scrub, so a wood does not end on a hard line.
        for (let n = 0; n < count; n += 1) {
          const angle = artHash(seed + n, 13) * Math.PI * 2;
          this.props.push({
            x: zone.center.x + Math.cos(angle) * zone.radius * 1.02,
            y: zone.center.y + Math.sin(angle) * zone.radius * 0.98,
            sprite: BUSH,
          });
        }
      }

      if (zone.terrain === 'village') {
        const count = 14;
        for (let n = 0; n < count; n += 1) {
          const angle = artHash(seed + n, 17) * Math.PI * 2;
          const distance = Math.sqrt(artHash(seed + n, 19)) * zone.radius * 0.72;
          const x = zone.center.x + Math.cos(angle) * distance;
          const y = zone.center.y + Math.sin(angle) * distance;
          const big = artHash(seed + n, 23) > 0.76;
          this.props.push({ x, y, sprite: big ? HALL : COTTAGE });
          if (artHash(seed + n, 29) > 0.55) {
            this.chimneys.push({ x: x + 12, y: y - 46, seed: (seed + n) % 40 });
          }
        }
        // Torches on the square, and a banner over them.
        for (let n = 0; n < 4; n += 1) {
          const angle = (n / 4) * Math.PI * 2 + 0.4;
          this.torches.push({
            x: zone.center.x + Math.cos(angle) * zone.radius * 0.34,
            y: zone.center.y + Math.sin(angle) * zone.radius * 0.34,
            seed: (seed + n * 9) % 40,
          });
        }
        this.banners.push({
          x: zone.center.x,
          y: zone.center.y - zone.radius * 0.1,
          height: 86,
          cloth: PALETTE.bannerRed,
          crest: PALETTE.bannerGold,
        });
      }

      if (zone.terrain === 'hill') {
        // A watchtower with a standard on it: high ground you can find by eye.
        this.props.push({ x: zone.center.x, y: zone.center.y - zone.radius * 0.12, sprite: WATCHTOWER });
        this.banners.push({
          x: zone.center.x,
          y: zone.center.y - zone.radius * 0.12 - 66,
          height: 62,
          cloth: PALETTE.bannerBlue,
          crest: PALETTE.bannerGold,
        });
      }

      if (zone.terrain === 'ridge') {
        // A mine head on the rock, and rubble along the spine.
        this.props.push({ x: zone.center.x, y: zone.center.y, sprite: MINE });
        const count = Math.round(zone.radius / 90);
        for (let n = 0; n < count; n += 1) {
          const angle = artHash(seed + n, 31) * Math.PI * 2;
          const distance = Math.sqrt(artHash(seed + n, 37)) * zone.radius;
          this.props.push({
            x: zone.center.x + Math.cos(angle) * distance,
            y: zone.center.y + Math.sin(angle) * distance,
            sprite: CRAG,
          });
        }
      }

      if (zone.crossing) {
        // A signpost each side of the bridge, and a banner over the near bank.
        this.props.push({ x: zone.center.x - zone.radius * 0.5, y: zone.center.y + 120, sprite: WAYPOST });
        this.banners.push({
          x: zone.center.x + zone.radius * 0.42,
          y: zone.center.y + 96,
          height: 74,
          cloth: PALETTE.bannerGold,
          crest: PALETTE.bannerRed,
        });
      }
    }

    // Rubble along an impassable rock spine, so it never reads as a dry river.
    if (map.barrier?.kind === 'ridge') {
      const half = barrierHalfWidth();
      for (let x = 120; x < MAP_WIDTH; x += 190) {
        for (let row = 0; row < 3; row += 1) {
          const offset = (row / 2 - 0.5) * 2 * half * 0.68;
          this.props.push({
            x: x + (artHash(x, row) - 0.5) * 120,
            y: barrierCenterAt(x) + offset + (artHash(x, row + 40) - 0.5) * 90,
            sprite: CRAG,
          });
        }
      }
    }
  }

  /** Props are baked into the same bitmap, so they cost nothing per frame. */
  private paintProps(): void {
    const context = this.bitmap.getContext('2d');
    if (context === null) return;
    context.imageSmoothingEnabled = false;
    // Painted back to front so a cottage lower on the map overlaps the one behind.
    const ordered = [...this.props].sort((a, b) => a.y - b.y);
    for (const prop of ordered) {
      paintSprite(context, prop.sprite, prop.x / ART_SCALE, prop.y / ART_SCALE, 1);
    }
  }

  /* ---------------------------------------------------------------- drawing */

  public draw(context: CanvasRenderingContext2D, camera: Camera, tick = 0): void {
    context.imageSmoothingEnabled = false;
    context.drawImage(this.bitmap, 0, 0, MAP_WIDTH, MAP_HEIGHT);
    this.drawWaterShimmer(context, camera, tick);
    this.drawTorches(context, camera, tick);
    this.drawSmoke(context, camera, tick);
    this.drawBanners(context, camera, tick);
  }

  /** Broken white crests moving along the water, on the tick clock. */
  private drawWaterShimmer(context: CanvasRenderingContext2D, camera: Camera, tick: number): void {
    if (this.ripples.length === 0) return;
    const bounds = camera.visibleBounds;
    const pixel = ART_SCALE;
    context.fillStyle = PALETTE.foam;

    for (const ripple of this.ripples) {
      if (
        ripple.x < bounds.left ||
        ripple.x > bounds.right ||
        ripple.y < bounds.top ||
        ripple.y > bounds.bottom
      ) {
        continue;
      }
      const phase = (tick + ripple.seed) % 40;
      if (phase > 16) continue;
      context.globalAlpha = phase < 8 ? 0.5 : 0.24;
      const drift = Math.floor(phase / 4) * pixel;
      context.fillRect(ripple.x + drift, ripple.y, pixel * 2, pixel);
    }
    context.globalAlpha = 1;
  }

  /** Torch flicker. Two pixels of flame and a warm pool on the ground. */
  private drawTorches(context: CanvasRenderingContext2D, camera: Camera, tick: number): void {
    const bounds = camera.visibleBounds;
    const pixel = ART_SCALE;
    for (const torch of this.torches) {
      if (torch.x < bounds.left || torch.x > bounds.right || torch.y < bounds.top || torch.y > bounds.bottom) {
        continue;
      }
      const phase = (tick + torch.seed) % 24;
      const tall = phase % 8 < 4;

      context.globalAlpha = 0.16 + (phase % 4) * 0.02;
      context.fillStyle = PALETTE.flame;
      context.fillRect(torch.x - pixel * 3, torch.y - pixel * 2, pixel * 6, pixel * 5);

      context.globalAlpha = 1;
      context.fillStyle = PALETTE.timberDark;
      context.fillRect(torch.x - pixel * 0.5, torch.y - pixel * 4, pixel, pixel * 4);
      context.fillStyle = PALETTE.flame;
      context.fillRect(torch.x - pixel, torch.y - pixel * 6, pixel * 2, pixel * 2);
      context.fillStyle = PALETTE.flameCore;
      context.fillRect(torch.x - pixel * 0.5, torch.y - pixel * (tall ? 7 : 6.5), pixel, pixel * 1.5);
    }
    context.globalAlpha = 1;
  }

  /** Chimney smoke: three pixels rising and fading on a long tick cycle. */
  private drawSmoke(context: CanvasRenderingContext2D, camera: Camera, tick: number): void {
    const bounds = camera.visibleBounds;
    const pixel = ART_SCALE;
    context.fillStyle = PALETTE.smoke;
    for (const chimney of this.chimneys) {
      if (
        chimney.x < bounds.left ||
        chimney.x > bounds.right ||
        chimney.y < bounds.top ||
        chimney.y > bounds.bottom
      ) {
        continue;
      }
      for (let puff = 0; puff < 3; puff += 1) {
        const phase = (tick + chimney.seed + puff * 20) % 60;
        const rise = phase * 1.4;
        context.globalAlpha = Math.max(0, 0.34 - phase * 0.005);
        const sway = ((phase >> 3) % 3) - 1;
        context.fillRect(chimney.x + sway * pixel, chimney.y - rise, pixel * 2, pixel * 2);
      }
    }
    context.globalAlpha = 1;
  }

  /**
   * Waving standards.
   *
   * A banner is the cheapest way to say "something is here" from across a map
   * this wide, and the wave is what stops the field looking like a still.
   */
  private drawBanners(context: CanvasRenderingContext2D, camera: Camera, tick: number): void {
    const bounds = camera.visibleBounds;
    const pixel = ART_SCALE;
    const margin = 200;

    for (const banner of this.banners) {
      if (
        banner.x < bounds.left - margin ||
        banner.x > bounds.right + margin ||
        banner.y < bounds.top - margin ||
        banner.y > bounds.bottom + margin
      ) {
        continue;
      }

      const topY = banner.y - banner.height;
      context.fillStyle = PALETTE.timberDark;
      context.fillRect(banner.x - pixel * 0.5, topY, pixel, banner.height);
      context.fillStyle = PALETTE.bannerGold;
      context.fillRect(banner.x - pixel * 0.5, topY - pixel, pixel, pixel);

      // Four cloth columns, each lagging the one before it by a tick step.
      const clothHeight = pixel * 5;
      for (let column = 0; column < 5; column += 1) {
        const phase = Math.floor((tick + column * 3) / 4) % 4;
        const lift = (phase === 1 ? -1 : phase === 3 ? 1 : 0) * (column / 5) * pixel;
        context.fillStyle = column === 2 ? banner.crest : banner.cloth;
        context.fillRect(banner.x + pixel * 0.5 + column * pixel, topY + lift, pixel, clothHeight);
      }
    }
  }

  /**
   * Cartographic names, drawn above terrain but below the armies.
   *
   * Each name sits on a hard-edged plate rather than floating on the ground:
   * over a dithered pixel field, unbacked text is the first thing to become
   * unreadable, and the map is worth nothing if its places cannot be named.
   */
  public drawLabels(
    context: CanvasRenderingContext2D,
    camera: Camera,
    hoveredZone: ZoneId | undefined,
  ): void {
    const bounds = camera.visibleBounds;
    const unit = 1 / camera.zoom;

    const hovered = hoveredZone === undefined ? undefined : ZONES[hoveredZone];
    if (hovered !== undefined) {
      // A stepped pixel ring rather than a dashed circle: same information,
      // and it belongs to the same drawing as everything else on the field.
      context.fillStyle = hovered.crossing ? PALETTE.crossingLabel : PALETTE.selection;
      const step = Math.PI / 26;
      const block = Math.max(4 * unit, 12);
      for (let angle = 0; angle < Math.PI * 2; angle += step) {
        if (Math.floor(angle / step) % 2 === 1) continue;
        context.fillRect(
          hovered.center.x + Math.cos(angle) * hovered.radius - block / 2,
          hovered.center.y + Math.sin(angle) * hovered.radius - block / 2,
          block,
          block,
        );
      }
    }

    const fontSize = 14 * unit;
    context.font = `700 ${fontSize}px ${LABEL_FONT}`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';

    for (const zone of activeZones()) {
      if (
        zone.center.x < bounds.left ||
        zone.center.x > bounds.right ||
        zone.center.y < bounds.top ||
        zone.center.y > bounds.bottom
      ) {
        continue;
      }
      const label = zone.name.toUpperCase();
      const labelY = zone.center.y - Math.min(zone.radius * 0.58, 230);
      const width = context.measureText(label).width + 16 * unit;
      const height = 20 * unit;
      const left = zone.center.x - width / 2;
      const top = labelY - height / 2;
      const hoveredHere = zone.id === hoveredZone;

      // Plate, then a one-pixel bevel, then the name.
      context.fillStyle = hoveredHere ? 'rgba(24, 20, 12, 0.94)' : 'rgba(10, 14, 9, 0.78)';
      context.fillRect(left, top, width, height);
      context.fillStyle = zone.crossing
        ? PALETTE.crossingLabel
        : hoveredHere
          ? PALETTE.selection
          : 'rgba(150, 132, 84, 0.5)';
      context.fillRect(left, top, width, unit);
      context.fillRect(left, top + height - unit, width, unit);
      context.fillRect(left, top, unit, height);
      context.fillRect(left + width - unit, top, unit, height);

      context.fillStyle = zone.crossing
        ? PALETTE.crossingLabel
        : hoveredHere
          ? PALETTE.selection
          : PALETTE.zoneLabel;
      context.fillText(label, zone.center.x, labelY);
    }
  }
}

function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace('#', '');
  const full =
    value.length === 3
      ? value
          .split('')
          .map((character) => character + character)
          .join('')
      : value;
  return [
    Number.parseInt(full.slice(0, 2), 16) || 0,
    Number.parseInt(full.slice(2, 4), 16) || 0,
    Number.parseInt(full.slice(4, 6), 16) || 0,
  ];
}
