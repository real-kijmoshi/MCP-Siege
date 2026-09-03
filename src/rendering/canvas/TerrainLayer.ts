import { MAP_HEIGHT, MAP_WIDTH } from '../../game/config/battle';
import type { BattleMapId, ZoneDefinition } from '../../game/config/maps';
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
  BARRELS,
  BIRDS,
  BUSH,
  CAMPFIRE,
  COTTAGE_THATCH,
  COTTAGE_TILE,
  CRAG,
  DEER,
  GARDEN_PLOT,
  HALL,
  LOG_PILE,
  MARKET_STALL,
  MINE,
  PALISADE,
  RUIN_ARCH,
  RUIN_WALL,
  SHED,
  SIEGE_ENGINE,
  SIEGE_TOWER,
  STAKES,
  STUMP,
  SUPPLY_CART,
  TENT,
  TENT_BIG,
  TREE_BIRCH,
  TREE_DEAD,
  TREE_OAK,
  TREE_PINE,
  TREE_SAPLING,
  WATCHTOWER,
  WAYPOST,
  WELL,
  LABEL_FONT,
  artHash,
  paintSprite,
  spriteWidth,
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
/* Detailing materials. None of these ever forms a shape on its own. */
const M_MOSS = 14;
const M_PEBBLE = 15;
const M_SHALLOW = 16;
const M_REFLECT = 17;
const M_GARDEN = 18;
const M_COBBLE = 19;
const M_TRACK = 20;
const M_SCREE = 21;
const MATERIAL_COUNT = 22;

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
  /** A torch burns on a pole; a camp fire burns on the ground and casts wider. */
  kind: 'torch' | 'fire';
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
  private ripples: Array<{ x: number; y: number; seed: number; length: number; shallow: boolean }> = [];

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
    this.paintLoggingPaths();
    this.paintVillageGround();
    this.paintCampGround();
    this.paintCrossings();
    // Speckle last of the ground passes, so moss and pebbles land on roads and
    // village earth too rather than only on whatever was painted first.
    this.speckleGround();
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
          // Five contours rather than three, each drawn from its own seed so the
          // rings sit off-centre from one another. Even spacing round a shared
          // centre reads as a target; uneven spacing reads as a slope.
          for (let ring = 0; ring < 5; ring += 1) {
            const scale = 1 - ring * 0.16;
            const driftX = (artHash(ring, zone.id.length) - 0.5) * radius * 0.12;
            const driftY = (artHash(ring + 9, zone.id.length) - 0.5) * radius * 0.09;
            this.fillBlob(
              cx + driftX,
              cy + driftY,
              radius * scale,
              radius * scale * 0.64,
              M_HILL,
              0.22,
              zone.id + ring,
            );
            // Two rings a pixel apart. One is swallowed by the dither; two read
            // as a contour line, which is the whole point of drawing them.
            for (let pass = 0; pass < 2; pass += 1) {
              this.outlineBlob(
                cx + driftX,
                cy + driftY,
                radius * scale - pass,
                radius * scale * 0.64 - pass,
                M_CONTOUR,
                zone.id + ring,
              );
            }
          }
          // Rock breaking through the turf where the slope is steepest.
          for (let outcrop = 0; outcrop < 4; outcrop += 1) {
            const angle = artHash(outcrop, zone.id.length * 3) * Math.PI * 2;
            const reach = radius * (0.3 + artHash(outcrop, 57) * 0.4);
            this.fillBlob(
              cx + Math.cos(angle) * reach,
              cy + Math.sin(angle) * reach * 0.66,
              radius * 0.1,
              radius * 0.05,
              M_ROCK,
              0.6,
              zone.id + outcrop * 3,
            );
          }
          // Bare rock breaking the turf at the crown, with scree spilling below.
          this.fillBlob(cx, cy - radius * 0.06, radius * 0.22, radius * 0.13, M_ROCK, 0.5, zone.id + 71);
          this.scatterInBlob(cx, cy, radius * 0.9, radius * 0.6, M_SCREE, 0.07, zone.id + 83, [M_HILL, M_CONTOUR, M_ROCK]);
          break;
        case 'village':
          this.fillBlob(cx, cy, radius * 0.82, radius * 0.7, M_EARTH, 0.36, zone.id);
          break;
        case 'ridge':
          // Rock is built up in bands: a dark body, a lighter shoulder offset
          // uphill, and a scatter of scree, which is what gives a ridge its age.
          this.fillBlob(cx, cy, radius * 0.9, radius * 0.6, M_ROCK, 0.3, zone.id);
          for (let band = 0; band < 4; band += 1) {
            const scale = 0.82 - band * 0.17;
            const lift = (band + 1) * radius * 0.06;
            this.outlineBlob(cx, cy - lift, radius * scale, radius * scale * 0.55, M_SCREE, zone.id + band * 13);
          }
          this.scatterInBlob(cx, cy, radius * 0.95, radius * 0.66, M_PEBBLE, 0.07, zone.id + 41, [M_ROCK, M_SCREE]);
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

  /**
   * Logging paths.
   *
   * A wood that nobody has ever worked is a texture; a wood with a cart track
   * cut into it, a clearing at the end and the stumps still standing is a
   * place. Each track runs from the side of the wood facing the nearest open
   * ground, so it always points somewhere a cart could plausibly have come from.
   */
  private paintLoggingPaths(): void {
    for (const zone of activeZones()) {
      if (zone.terrain !== 'forest') continue;
      const seed = zone.id.length * 97 + zone.id.charCodeAt(0);

      // The nearest zone that is not itself woodland: where the timber goes.
      let toward = { x: zone.center.x, y: zone.center.y + zone.radius };
      let best = Number.POSITIVE_INFINITY;
      for (const other of activeZones()) {
        if (other.id === zone.id || other.terrain === 'forest') continue;
        const distance = Math.hypot(other.center.x - zone.center.x, other.center.y - zone.center.y);
        if (distance < best) {
          best = distance;
          toward = other.center;
        }
      }
      const heading = Math.atan2(toward.y - zone.center.y, toward.x - zone.center.x);

      for (let track = 0; track < 2; track += 1) {
        const spread = (track === 0 ? -1 : 1) * 0.5;
        const angle = heading + spread;
        const mouthX = zone.center.x + Math.cos(angle) * zone.radius * 1.02;
        const mouthY = zone.center.y + Math.sin(angle) * zone.radius * 1.02;
        // The clearing end sits short of the middle, so the wood still hides
        // whatever is standing in the heart of it.
        const headX = zone.center.x + Math.cos(angle + 0.35) * zone.radius * 0.3;
        const headY = zone.center.y + Math.sin(angle + 0.35) * zone.radius * 0.3;
        this.stampLine(mouthX, mouthY, headX, headY, 1, M_TRACK, M_EARTH);

        // A felled clearing at the head, with the stumps and the stacked timber.
        this.fillBlob(
          headX / ART_SCALE,
          headY / ART_SCALE,
          (zone.radius * 0.16) / ART_SCALE,
          (zone.radius * 0.12) / ART_SCALE,
          M_EARTH,
          0.5,
          seed + track,
        );
        for (let n = 0; n < 4; n += 1) {
          const spin = artHash(seed + track * 7 + n, 3) * Math.PI * 2;
          const reach = Math.sqrt(artHash(seed + track * 7 + n, 5)) * zone.radius * 0.15;
          this.props.push({
            x: headX + Math.cos(spin) * reach,
            y: headY + Math.sin(spin) * reach,
            sprite: n === 0 ? LOG_PILE : STUMP,
          });
        }
      }
    }
  }

  /**
   * The village floor: a cobbled square, the lanes off it, and kitchen gardens
   * behind the houses. Painted after the roads so a highway does not run
   * through the middle of the market.
   */
  private paintVillageGround(): void {
    for (const zone of activeZones()) {
      if (zone.terrain !== 'village') continue;
      const cx = zone.center.x / ART_SCALE;
      const cy = zone.center.y / ART_SCALE;
      const radius = zone.radius / ART_SCALE;
      const seed = zone.id.length * 53 + zone.id.charCodeAt(0);

      // Lanes first, so the square is laid over where they meet.
      for (let lane = 0; lane < 5; lane += 1) {
        const angle = (lane / 5) * Math.PI * 2 + artHash(seed, lane) * 0.6;
        this.stampLine(
          zone.center.x,
          zone.center.y,
          zone.center.x + Math.cos(angle) * zone.radius * 0.88,
          zone.center.y + Math.sin(angle) * zone.radius * 0.88,
          0,
          M_TRACK,
          M_EARTH,
        );
      }

      this.fillBlob(cx, cy, radius * 0.16, radius * 0.13, M_COBBLE, 0.16, seed + 11);

      // Garden strips behind the houses, out toward the edge of the village.
      for (let plot = 0; plot < 7; plot += 1) {
        const angle = artHash(seed + plot, 61) * Math.PI * 2;
        const reach = (0.46 + artHash(seed + plot, 67) * 0.28) * radius;
        this.fillBlob(
          cx + Math.cos(angle) * reach,
          cy + Math.sin(angle) * reach,
          radius * 0.11,
          radius * 0.07,
          M_GARDEN,
          0.18,
          seed + plot * 5,
        );
      }
    }
  }

  /**
   * The ground a camp stands on.
   *
   * Grass does not survive an army sleeping on it. The camps get trodden earth
   * with lanes worn between the tent rows, and the field works in front of them
   * get a churned strip where the spoil from digging them went.
   */
  private paintCampGround(): void {
    for (const camp of this.campSites()) {
      const zone = camp.zone;
      const cx = zone.center.x / ART_SCALE;
      const cy = zone.center.y / ART_SCALE;
      const radius = zone.radius / ART_SCALE;
      const forwardX = Math.cos(camp.facing);
      const forwardY = Math.sin(camp.facing);
      const acrossX = Math.cos(camp.facing + Math.PI / 2);
      const acrossY = Math.sin(camp.facing + Math.PI / 2);
      const seed = zone.id.length * 149 + zone.id.charCodeAt(0);

      if (camp.home) {
        this.fillBlob(
          cx + forwardX * radius * 0.12,
          cy + forwardY * radius * 0.12,
          radius * 0.66,
          radius * 0.54,
          M_EARTH,
          0.44,
          seed,
        );
        // A lane between each pair of tent rows.
        for (let lane = 0; lane < 4; lane += 1) {
          const depth = zone.radius * (0.47 - lane * 0.13);
          const reach = zone.radius * 0.5;
          this.stampLine(
            zone.center.x + forwardX * depth - acrossX * reach,
            zone.center.y + forwardY * depth - acrossY * reach,
            zone.center.x + forwardX * depth + acrossX * reach,
            zone.center.y + forwardY * depth + acrossY * reach,
            0,
            M_TRACK,
            M_EARTH,
          );
        }
        continue;
      }

      // A field work: spoil thrown up behind the stake line.
      const lineRadius = zone.radius * 0.72;
      const span = 0.5;
      const steps = 14;
      for (let step = 0; step <= steps; step += 1) {
        const angle = camp.facing + (step / steps - 0.5) * 2 * span;
        this.fillBlob(
          (zone.center.x + Math.cos(angle) * lineRadius) / ART_SCALE,
          (zone.center.y + Math.sin(angle) * lineRadius) / ART_SCALE,
          radius * 0.09,
          radius * 0.05,
          M_EARTH,
          0.6,
          seed + step,
        );
      }
    }
  }

  /**
   * Where the camps and the field works are, and which way each one faces.
   *
   * Shared by the ground pass and the prop pass so the trodden earth cannot
   * drift away from the tents standing on it.
   */
  private campSites(): Array<{ zone: ZoneDefinition; facing: number; home: boolean }> {
    const map = activeBattleMap();
    const homes = [map.playerHomeZone, map.enemyHomeZone];
    const sites: Array<{ zone: ZoneDefinition; facing: number; home: boolean }> = [];

    for (const homeId of homes) {
      const home = ZONES[homeId];
      if (home === undefined) continue;
      // A camp faces the middle of the map, which is the only direction an
      // attack can come from on any of these battlefields.
      sites.push({
        zone: home,
        facing: Math.atan2(MAP_HEIGHT / 2 - home.center.y, MAP_WIDTH / 2 - home.center.x),
        home: true,
      });
    }

    // Outer defences: everything a home zone shares an edge with, short of the
    // crossings themselves, which belong to neither side.
    const seen = new Set<string>();
    for (const [a, b] of map.edges) {
      const homeSide = homes.includes(a) ? a : homes.includes(b) ? b : undefined;
      if (homeSide === undefined) continue;
      const outerId = homeSide === a ? b : a;
      if (homes.includes(outerId) || seen.has(outerId)) continue;
      const outer = ZONES[outerId];
      const home = ZONES[homeSide];
      if (outer === undefined || home === undefined) continue;
      if (outer.crossing || outer.terrain === 'forest' || outer.terrain === 'village') continue;
      seen.add(outerId);
      sites.push({
        zone: outer,
        facing: Math.atan2(outer.center.y - home.center.y, outer.center.x - home.center.x),
        home: false,
      });
    }

    return sites;
  }

  /**
   * Moss and loose stone, over everything already painted.
   *
   * Two frequencies of the same hash: a coarse one that decides where a patch
   * of moss sits at all, and a fine one that eats its edge away. That is what
   * separates weathered ground from a field of even noise, and it costs one
   * pass over a bitmap that is only baked when the map changes.
   */
  private speckleGround(): void {
    // Bare earth is left out: moss grows where nothing walks, and a camp
    // floor or a village square is the ground most walked on there is.
    const soft = [M_GRASS, M_FIELD, M_FOREST, M_HILL];
    const hard = [M_GRASS, M_FIELD, M_ROAD, M_ROAD_EDGE, M_EARTH, M_HILL, M_TRACK];

    for (let y = 0; y < ART_HEIGHT; y += 1) {
      for (let x = 0; x < ART_WIDTH; x += 1) {
        const index = y * ART_WIDTH + x;
        const existing = this.materials[index] ?? M_GRASS;
        // Three octaves: a rare coarse one that decides where a patch sits at
        // all, a middle one that gives it a shape, and a fine one that eats its
        // edge. Two octaves alone spread moss over the whole field as static.
        if (
          soft.includes(existing) &&
          artHash(x >> 4, y >> 4) > 0.93 &&
          artHash(x >> 1, y >> 1) > 0.38 &&
          artHash(x, y * 5) > 0.3
        ) {
          this.materials[index] = M_MOSS;
          continue;
        }
        if (hard.includes(existing) && artHash(x * 7, y * 13) > 0.994) {
          this.materials[index] = M_PEBBLE;
        }
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

      // The bridge's reflection, thrown downstream onto open water. Broken into
      // dashes by the same hash that ripples the surface, because a solid bar
      // of dark water would read as a second, sunken bridge.
      for (let x = cx + halfWidth + 1; x <= cx + halfWidth + 8; x += 1) {
        for (let y = top + 2; y <= bottom - 2; y += 1) {
          if (this.materials[y * ART_WIDTH + x] !== M_WATER) continue;
          if (artHash(x * 3, y) < 0.36) continue;
          this.set(x, y, M_REFLECT);
        }
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
        } else if (nearBank(source, x, y)) {
          // Water shoals toward a bank. Two pixels of pale shallows is the
          // difference between a river and a blue stripe with a line round it.
          this.materials[index] = M_SHALLOW;
          // The shallows catch the light more often than open water does, but
          // in shorter flecks, because there is less water under them to move.
          if (artHash(x * 5, y * 3) > 0.972) {
            this.ripples.push({
              x: x * ART_SCALE,
              y: y * ART_SCALE,
              seed: (x * 17 + y * 3) % 40,
              length: 1,
              shallow: true,
            });
          }
        } else if (artHash(x, y) > 0.978) {
          // Sparse shimmer seeds, collected for the animated overlay.
          this.ripples.push({
            x: x * ART_SCALE,
            y: y * ART_SCALE,
            seed: (x * 31 + y) % 40,
            length: artHash(x, y * 7) > 0.6 ? 3 : 2,
            shallow: false,
          });
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

  /**
   * Sprinkles single pixels of one material inside an ellipse, and only over
   * materials that were already there. Used for scree, moss and pebbles: the
   * detail that makes ground look weathered without changing its shape.
   */
  private scatterInBlob(
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    material: number,
    density: number,
    seed: number | string,
    over: readonly number[],
  ): void {
    const salt = typeof seed === 'string' ? seed.length * 19 + seed.charCodeAt(0) : seed;
    const left = Math.max(0, Math.floor(cx - rx));
    const right = Math.min(ART_WIDTH - 1, Math.ceil(cx + rx));
    const top = Math.max(0, Math.floor(cy - ry));
    const bottom = Math.min(ART_HEIGHT - 1, Math.ceil(cy + ry));

    for (let y = top; y <= bottom; y += 1) {
      for (let x = left; x <= right; x += 1) {
        const dx = (x - cx) / Math.max(1, rx);
        const dy = (y - cy) / Math.max(1, ry);
        if (dx * dx + dy * dy > 1) continue;
        const index = y * ART_WIDTH + x;
        const existing = this.materials[index] ?? M_GRASS;
        if (!over.includes(existing)) continue;
        if (artHash(x + salt, y * 3 - salt) > density) continue;
        this.materials[index] = material;
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
    // Both ground shades are derived from the map's own colour rather than
    // paired with the palette's default green. A map that tints its earth ash
    // brown was otherwise dithered against spring grass, which put a green
    // static over the whole of ash country.
    const turf = colors.grass ?? PALETTE.grass;
    const tilled = colors.openField ?? PALETTE.openField;
    ramp[M_GRASS] = [turf, shade(turf, 0.07)];
    ramp[M_FIELD] = [tilled, shade(tilled, 0.07)];
    // The woodland floor is deliberately darker than the tree ink. Dithering it
    // between the same two greens the canopy is drawn in made a wood a flat
    // patch of green with its trees invisible inside it.
    ramp[M_FOREST] = [PALETTE.shadow, PALETTE.forest];
    ramp[M_HILL] = [colors.hill ?? PALETTE.hill, PALETTE.hillAlt];
    ramp[M_CONTOUR] = [colors.hillContour ?? PALETTE.hillContour, colors.hillContour ?? PALETTE.hillContour];
    // Deep water is the darkest thing on the map and the shallows the palest,
    // so a river reads as water with a bottom rather than as a flat blue band.
    // Every tone is derived from the map's own river colour: a blue shallow in
    // an ash-country river would be the one thing on the field out of key.
    const water = colors.river ?? PALETTE.river;
    const bank = colors.riverEdge ?? PALETTE.riverEdge;
    ramp[M_WATER] = [shade(water, -0.3), water];
    ramp[M_WATER_EDGE] = [colors.riverEdge ?? PALETTE.riverEdge, PALETTE.foam];
    ramp[M_ROAD] = [colors.road ?? PALETTE.road, PALETTE.sandDark];
    ramp[M_ROAD_EDGE] = [PALETTE.earthDark, PALETTE.earth];
    ramp[M_DECK] = [colors.crossing ?? PALETTE.crossing, PALETTE.timber];
    ramp[M_DECK_EDGE] = [PALETTE.timberDark, PALETTE.timberDark];
    ramp[M_EARTH] = [PALETTE.earth, PALETTE.earthDark];
    ramp[M_ROCK] = [PALETTE.stoneDark, PALETTE.stone];
    ramp[M_SAND] = [PALETTE.sand, PALETTE.sandDark];
    // Moss takes the map's own woodland green, not one fixed green: on ash
    // country a spring-green patch would read as a bug rather than as moss.
    const moss = colors.forestCanopy ?? PALETTE.moss;
    ramp[M_MOSS] = [shade(moss, -0.24), moss];
    ramp[M_PEBBLE] = [PALETTE.pebble, PALETTE.scree];
    ramp[M_SHALLOW] = [bank, shade(bank, 0.22)];
    ramp[M_REFLECT] = [shade(water, -0.55), shade(water, -0.3)];
    ramp[M_GARDEN] = [PALETTE.gardenDark, PALETTE.garden];
    ramp[M_COBBLE] = [PALETTE.cobbleDark, PALETTE.cobble];
    ramp[M_TRACK] = [colors.road ?? PALETTE.road, PALETTE.sandDark];
    ramp[M_SCREE] = [PALETTE.stone, PALETTE.scree];

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
        // Woods grow in stands, not in an even sprinkle. Each stand takes one
        // species and packs tightly around its own centre, which is what makes
        // a wood read as pine here and oak there rather than as green confetti.
        const stands = Math.max(4, Math.round(zone.radius / 90));
        const species = [TREE_PINE, TREE_OAK, TREE_BIRCH, TREE_DEAD] as const;
        for (let stand = 0; stand < stands; stand += 1) {
          const standAngle = artHash(seed + stand, 101) * Math.PI * 2;
          const standReach = Math.sqrt(artHash(seed + stand, 103)) * zone.radius * 0.74;
          const standX = zone.center.x + Math.cos(standAngle) * standReach;
          const standY = zone.center.y + Math.sin(standAngle) * standReach;
          const dominant = species[Math.floor(artHash(seed + stand, 107) * 3)] ?? TREE_PINE;
          const spread = zone.radius * (0.16 + artHash(seed + stand, 109) * 0.12);
          // Sized from the stand's own area rather than from a flat count, so a
          // wood is a canopy you cannot see the floor through at any map size.
          const trees = Math.round((spread * spread) / 260) + 8;

          for (let n = 0; n < trees; n += 1) {
            const angle = artHash(seed + stand * 31 + n, 3) * Math.PI * 2;
            const distance = Math.sqrt(artHash(seed + stand * 31 + n, 5)) * spread;
            const odd = artHash(seed + stand * 31 + n, 7);
            // One tree in six is off-species, and one in twenty is dead timber.
            const sprite =
              odd > 0.95 ? TREE_DEAD : odd > 0.84 ? TREE_SAPLING : odd > 0.68 ? TREE_BIRCH : dominant;
            this.props.push({
              x: standX + Math.cos(angle) * distance,
              y: standY + Math.sin(angle) * distance * 0.9,
              sprite,
            });
          }
        }

        // Loose growth between the stands, so the wood has no visible seams.
        const strays = Math.round((zone.radius * zone.radius) / 5200);
        for (let n = 0; n < strays; n += 1) {
          const angle = artHash(seed + n, 127) * Math.PI * 2;
          const distance = Math.sqrt(artHash(seed + n, 131)) * zone.radius * 0.96;
          this.props.push({
            x: zone.center.x + Math.cos(angle) * distance,
            y: zone.center.y + Math.sin(angle) * distance,
            sprite: artHash(seed + n, 137) > 0.5 ? TREE_OAK : TREE_SAPLING,
          });
        }

        // A fringe of scrub, so a wood does not end on a hard line.
        const fringe = Math.round(zone.radius / 34);
        for (let n = 0; n < fringe; n += 1) {
          const angle = artHash(seed + n, 13) * Math.PI * 2;
          this.props.push({
            x: zone.center.x + Math.cos(angle) * zone.radius * 1.02,
            y: zone.center.y + Math.sin(angle) * zone.radius * 0.98,
            sprite: BUSH,
          });
        }

        // Whatever lived here before the armies came. Deep in the wood only,
        // where a player who bothers to look will find it.
        for (let n = 0; n < 2; n += 1) {
          const angle = artHash(seed + n, 149) * Math.PI * 2;
          const distance = zone.radius * (0.24 + artHash(seed + n, 151) * 0.3);
          this.props.push({
            x: zone.center.x + Math.cos(angle) * distance,
            y: zone.center.y + Math.sin(angle) * distance,
            sprite: DEER,
          });
        }
        this.props.push({
          x: zone.center.x + (artHash(seed, 157) - 0.5) * zone.radius,
          y: zone.center.y - zone.radius * (0.4 + artHash(seed, 163) * 0.3),
          sprite: BIRDS,
        });
      }

      if (zone.terrain === 'village') {
        // Houses stand along the lanes rather than anywhere inside the ring, and
        // there are enough of them that the place reads as a settlement people
        // left rather than as a dozen sheds in a field.
        const lanes = 5;
        for (let lane = 0; lane < lanes; lane += 1) {
          const angle = (lane / lanes) * Math.PI * 2 + artHash(seed, lane) * 0.6;
          const along = Math.cos(angle);
          const across = -Math.sin(angle);
          const houses = 4 + Math.floor(artHash(seed + lane, 19) * 3);

          for (let n = 0; n < houses; n += 1) {
            const reach = zone.radius * (0.26 + (n / houses) * 0.58);
            // Set back from the lane, alternating sides, so a street forms.
            const offset = (n % 2 === 0 ? 1 : -1) * zone.radius * (0.09 + artHash(seed + lane * 9 + n, 23) * 0.05);
            const x = zone.center.x + along * reach + across * offset;
            const y = zone.center.y + Math.sin(angle) * reach + Math.cos(angle) * offset;
            const pick = artHash(seed + lane * 9 + n, 29);
            const sprite =
              pick > 0.9 ? HALL : pick > 0.72 ? SHED : pick > 0.42 ? COTTAGE_THATCH : COTTAGE_TILE;
            this.props.push({ x, y, sprite });
            if (sprite !== SHED && artHash(seed + lane * 9 + n, 31) > 0.4) {
              this.chimneys.push({ x: x + 12, y: y - 46, seed: (seed + lane * 5 + n) % 40 });
            }
          }
        }

        // The square: a well at the middle of it and three stalls round the edge.
        this.props.push({ x: zone.center.x, y: zone.center.y + 10, sprite: WELL });
        for (let stall = 0; stall < 3; stall += 1) {
          const angle = (stall / 3) * Math.PI * 2 + 0.9;
          this.props.push({
            x: zone.center.x + Math.cos(angle) * zone.radius * 0.17,
            y: zone.center.y + Math.sin(angle) * zone.radius * 0.14,
            sprite: MARKET_STALL,
          });
        }

        // Kitchen gardens, on the plots the ground pass already tilled.
        for (let plot = 0; plot < 7; plot += 1) {
          const angle = artHash(seed + plot, 61) * Math.PI * 2;
          const reach = (0.46 + artHash(seed + plot, 67) * 0.28) * zone.radius;
          this.props.push({
            x: zone.center.x + Math.cos(angle) * reach,
            y: zone.center.y + Math.sin(angle) * reach,
            sprite: GARDEN_PLOT,
          });
        }
        this.props.push({
          x: zone.center.x - zone.radius * 0.24,
          y: zone.center.y + zone.radius * 0.2,
          sprite: BARRELS,
        });

        // Torches on the square, and a banner over them.
        for (let n = 0; n < 4; n += 1) {
          const angle = (n / 4) * Math.PI * 2 + 0.4;
          this.torches.push({
            x: zone.center.x + Math.cos(angle) * zone.radius * 0.34,
            y: zone.center.y + Math.sin(angle) * zone.radius * 0.34,
            seed: (seed + n * 9) % 40,
            kind: 'torch',
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
        // Older work than the tower: whoever held this ground first left walls
        // on it, and the rock has been taking them back ever since.
        for (let n = 0; n < 3; n += 1) {
          const angle = artHash(seed + n, 173) * Math.PI * 2;
          const distance = zone.radius * (0.34 + artHash(seed + n, 179) * 0.36);
          this.props.push({
            x: zone.center.x + Math.cos(angle) * distance,
            y: zone.center.y + Math.sin(angle) * distance * 0.7,
            sprite: n === 0 ? RUIN_ARCH : RUIN_WALL,
          });
        }
        const boulders = Math.round(zone.radius / 130);
        for (let n = 0; n < boulders; n += 1) {
          const angle = artHash(seed + n, 181) * Math.PI * 2;
          const distance = Math.sqrt(artHash(seed + n, 191)) * zone.radius * 0.85;
          this.props.push({
            x: zone.center.x + Math.cos(angle) * distance,
            y: zone.center.y + Math.sin(angle) * distance * 0.66,
            sprite: CRAG,
          });
        }
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
        // Ancient work blended into the rock face, half crag and half masonry.
        for (let n = 0; n < 4; n += 1) {
          const angle = artHash(seed + n, 193) * Math.PI * 2;
          const distance = zone.radius * (0.3 + artHash(seed + n, 197) * 0.5);
          this.props.push({
            x: zone.center.x + Math.cos(angle) * distance,
            y: zone.center.y + Math.sin(angle) * distance * 0.6,
            sprite: n % 3 === 0 ? RUIN_ARCH : RUIN_WALL,
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

    this.scatterCamps();

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

  /**
   * The two camps, and the field works in front of them.
   *
   * A home zone is where an army sleeps, so it gets what an army sleeping looks
   * like from above: a palisade on the side facing the enemy, the pavilion
   * behind it, tent lines, fires, the baggage and the engines. Every zone that
   * touches a home zone gets stakes instead — a prepared position rather than a
   * camp, which is exactly what an outer defence is.
   */
  private scatterCamps(): void {
    const map = activeBattleMap();

    for (const site of this.campSites()) {
      if (!site.home) continue;
      const home = site.zone;
      const facing = site.facing;
      const seed = home.id.length * 211 + home.id.charCodeAt(0);
      const cloth = home.id === map.enemyHomeZone ? PALETTE.enemy : PALETTE.player;

      // The palisade: a continuous arc across the threatened face. The step is
      // derived from the sprite's own width, so the wall abuts on a small map
      // and on a large one instead of breaking into a dotted line.
      const wallRadius = home.radius * 0.82;
      const wallStep = (spriteWidth(PALISADE) * ART_SCALE * 0.92) / wallRadius;
      const wallPosts = Math.ceil(0.85 / wallStep);
      for (let post = -wallPosts; post <= wallPosts; post += 1) {
        const angle = facing + post * wallStep;
        this.props.push({
          x: home.center.x + Math.cos(angle) * wallRadius,
          y: home.center.y + Math.sin(angle) * wallRadius,
          sprite: PALISADE,
        });
      }

      // Everything else is placed as a distance forward of the zone centre along
      // the same heading, so the whole camp stays inside the ring however the
      // map has cut the zone against the edge of the world.
      const forwardX = Math.cos(facing);
      const forwardY = Math.sin(facing);
      const acrossX = Math.cos(facing + Math.PI / 2);
      const acrossY = Math.sin(facing + Math.PI / 2);

      // The pavilion, set back from the wall, with its colour over it.
      const pavilionX = home.center.x - forwardX * home.radius * 0.18;
      const pavilionY = home.center.y - forwardY * home.radius * 0.18;
      this.props.push({ x: pavilionX, y: pavilionY, sprite: TENT_BIG });
      this.banners.push({
        x: pavilionX,
        y: pavilionY - 54,
        height: 82,
        cloth,
        crest: PALETTE.bannerGold,
      });

      // Tent lines: rows, because soldiers do not pitch camp at random.
      const place = (forward: number, along: number, sprite: Sprite): { x: number; y: number } => {
        const x = home.center.x + forwardX * home.radius * forward + acrossX * along;
        const y = home.center.y + forwardY * home.radius * forward + acrossY * along;
        this.props.push({ x, y, sprite });
        return { x, y };
      };

      for (let row = 0; row < 4; row += 1) {
        for (let tent = -5; tent <= 5; tent += 1) {
          // A hand's breadth of jitter. Tent lines are dressed, not surveyed.
          const jitterAlong = (artHash(seed + row * 17 + tent, 211) - 0.5) * 26;
          const jitterDepth = (artHash(seed + row * 17 + tent, 223) - 0.5) * 0.03;
          place(0.4 - row * 0.13 + jitterDepth, tent * 74 + jitterAlong, TENT);
        }
      }

      // Fires between the lines. The flame itself rides the torch overlay, so
      // the whole camp flickers on the simulation tick and freezes when paused.
      for (let fire = 0; fire < 4; fire += 1) {
        const at = place(0.06, (fire - 1.5) * 220, CAMPFIRE);
        this.torches.push({ x: at.x, y: at.y - 6, seed: (seed + fire * 11) % 40, kind: 'fire' });
      }

      // Engines forward of the tents, baggage behind them.
      place(0.6, -300, SIEGE_ENGINE);
      place(0.6, 300, SIEGE_ENGINE);
      place(0.55, 470, SIEGE_TOWER);
      place(-0.4, -180, SUPPLY_CART);
      place(-0.4, 180, BARRELS);
    }

    for (const site of this.campSites()) {
      if (site.home) continue;
      const outer = site.zone;
      const facing = site.facing;
      const seed = outer.id.length * 173 + outer.id.charCodeAt(0);
      const lineRadius = outer.radius * 0.72;
      const stakeStep = (spriteWidth(STAKES) * ART_SCALE * 0.95) / lineRadius;
      const stakeCount = Math.ceil(0.9 / stakeStep);
      for (let stake = -stakeCount; stake <= stakeCount; stake += 1) {
        const angle = facing + stake * stakeStep;
        this.props.push({
          x: outer.center.x + Math.cos(angle) * lineRadius,
          y: outer.center.y + Math.sin(angle) * lineRadius,
          sprite: STAKES,
        });
      }
      const restX = outer.center.x - Math.cos(facing) * outer.radius * 0.34;
      const restY = outer.center.y - Math.sin(facing) * outer.radius * 0.34;
      this.props.push({ x: restX, y: restY, sprite: TENT });
      this.props.push({ x: restX + 120, y: restY + 40, sprite: TENT });
      this.props.push({ x: restX - 110, y: restY + 30, sprite: CAMPFIRE });
      this.torches.push({ x: restX - 110, y: restY + 24, seed: seed % 40, kind: 'fire' });
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
      if (phase > 18) continue;
      // A crest brightens, drifts downstream, and dies away behind itself. The
      // trailing pixel is what turns a blinking dot into moving water.
      const drift = Math.floor(phase / 3) * pixel;
      const fade = phase < 6 ? 1 : phase < 12 ? 0.55 : 0.24;

      context.globalAlpha = (ripple.shallow ? 0.7 : 0.5) * fade;
      context.fillStyle = ripple.shallow ? PALETTE.shallowLight : PALETTE.foam;
      context.fillRect(ripple.x + drift, ripple.y, pixel * ripple.length, pixel);

      if (!ripple.shallow && phase > 3) {
        context.globalAlpha = 0.2 * fade;
        context.fillRect(ripple.x + drift - pixel, ripple.y + pixel, pixel * 2, pixel);
      }
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

      if (torch.kind === 'fire') {
        // A fire on the ground: a wide warm pool, a low body of flame, and no
        // pole. The stones and the laid logs are already baked underneath it.
        context.globalAlpha = 0.2 + (phase % 4) * 0.025;
        context.fillStyle = PALETTE.flame;
        context.fillRect(torch.x - pixel * 5, torch.y - pixel * 3, pixel * 10, pixel * 6);
        context.globalAlpha = 1;
        context.fillStyle = PALETTE.flame;
        context.fillRect(torch.x - pixel * 1.5, torch.y - pixel * 2, pixel * 3, pixel * 2);
        context.fillStyle = PALETTE.flameCore;
        context.fillRect(torch.x - pixel * 0.5, torch.y - pixel * (tall ? 3.5 : 3), pixel, pixel * 1.5);
        continue;
      }

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

/** True where deep water is within three pixels of anything that is not water. */
function nearBank(source: Uint8Array, x: number, y: number): boolean {
  for (let reach = 2; reach <= 5; reach += 1) {
    if (
      source[y * ART_WIDTH + x - reach] !== M_WATER ||
      source[y * ART_WIDTH + x + reach] !== M_WATER ||
      source[(y - reach) * ART_WIDTH + x] !== M_WATER ||
      source[(y + reach) * ART_WIDTH + x] !== M_WATER
    ) {
      return true;
    }
  }
  return false;
}

/** Lightens or darkens a hex colour. `amount` runs from -1 (black) to 1 (white). */
function shade(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  const mix = (channel: number): string => {
    const target = amount < 0 ? 0 : 255;
    const value = Math.round(channel + (target - channel) * Math.abs(amount));
    return Math.max(0, Math.min(255, value)).toString(16).padStart(2, '0');
  };
  return `#${mix(r)}${mix(g)}${mix(b)}`;
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
