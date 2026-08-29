import { MAP_HEIGHT, MAP_WIDTH } from '../../game/config/battle';
import {
  CROSSINGS,
  ORDERED_ZONES,
  RIVER_HALF_WIDTH,
  ZONES,
  riverCenterY,
} from '../../game/simulation/Zones';
import type { Camera } from './Camera';
import { PALETTE } from './palette';

/**
 * Terrain.
 *
 * Built once as a list of simple shapes and drawn with viewport culling each
 * frame. Keeping it procedural rather than a pre-rendered bitmap means it stays
 * sharp at every zoom level and costs no memory, and the whole battlefield is
 * still only a few hundred shapes.
 */

interface Triangle {
  x: number;
  y: number;
  size: number;
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
}

interface Contour {
  x: number;
  y: number;
  radiusX: number;
  radiusY: number;
}

/** Deterministic scatter, so the map looks identical on every load. */
function makeRandom(seed: number): () => number {
  let value = seed >>> 0 || 1;
  return () => {
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    value >>>= 0;
    return value / 0x1_0000_0000;
  };
}

export class TerrainLayer {
  private readonly riverPath: Path2D;
  private readonly forest: Triangle[] = [];
  private readonly hills: Contour[] = [];
  private readonly buildings: Rect[] = [];
  private readonly fields: Contour[] = [];
  private readonly roads: Array<Array<[number, number]>> = [];

  public constructor() {
    this.riverPath = this.buildRiver();
    this.buildScatter();
    this.roads = this.buildRoads();
  }

  private buildRiver(): Path2D {
    const path = new Path2D();
    const step = 40;
    path.moveTo(0, riverCenterY(0) - RIVER_HALF_WIDTH);
    for (let x = step; x <= MAP_WIDTH; x += step) {
      path.lineTo(x, riverCenterY(x) - RIVER_HALF_WIDTH);
    }
    for (let x = MAP_WIDTH; x >= 0; x -= step) {
      path.lineTo(x, riverCenterY(x) + RIVER_HALF_WIDTH);
    }
    path.closePath();
    return path;
  }

  private buildScatter(): void {
    const random = makeRandom(0x5eed_1234);

    for (const zone of ORDERED_ZONES) {
      if (zone.terrain === 'forest') {
        const count = Math.round(zone.radius / 3.2);
        for (let n = 0; n < count; n += 1) {
          const angle = random() * Math.PI * 2;
          // Square root keeps the scatter even rather than clumped at the centre.
          const distance = Math.sqrt(random()) * zone.radius;
          this.forest.push({
            x: zone.center.x + Math.cos(angle) * distance,
            y: zone.center.y + Math.sin(angle) * distance,
            size: 26 + random() * 22,
          });
        }
      }

      if (zone.terrain === 'hill') {
        for (let ring = 0; ring < 4; ring += 1) {
          const scale = 1 - ring * 0.21;
          this.hills.push({
            x: zone.center.x,
            y: zone.center.y,
            radiusX: zone.radius * scale,
            radiusY: zone.radius * scale * 0.72,
          });
        }
      }

      if (zone.terrain === 'village') {
        for (let n = 0; n < 26; n += 1) {
          const angle = random() * Math.PI * 2;
          const distance = Math.sqrt(random()) * zone.radius * 0.85;
          this.buildings.push({
            x: zone.center.x + Math.cos(angle) * distance,
            y: zone.center.y + Math.sin(angle) * distance,
            width: 42 + random() * 40,
            height: 32 + random() * 28,
            angle: (random() - 0.5) * 0.5,
          });
        }
      }

      if (zone.terrain === 'open') {
        // Faint tonal variation so open ground is not a flat wash.
        for (let n = 0; n < 3; n += 1) {
          const angle = random() * Math.PI * 2;
          const distance = random() * zone.radius * 0.6;
          this.fields.push({
            x: zone.center.x + Math.cos(angle) * distance,
            y: zone.center.y + Math.sin(angle) * distance,
            radiusX: zone.radius * (0.45 + random() * 0.4),
            radiusY: zone.radius * (0.3 + random() * 0.3),
          });
        }
      }
    }
  }

  /** Roads trace the routes armies actually use, reinforcing the geography. */
  private buildRoads(): Array<Array<[number, number]>> {
    const route = (ids: Array<keyof typeof ZONES>): Array<[number, number]> =>
      ids.map((id) => [ZONES[id].center.x, ZONES[id].center.y]);

    return [
      route(['player_base', 'central_field', 'central_bridge', 'enemy_outer_defense', 'enemy_base']),
      route(['player_base', 'village', 'west_forest', 'west_crossing', 'northern_ridge']),
      route(['player_base', 'east_field', 'east_crossing', 'enemy_outer_defense']),
      route(['village', 'central_field', 'central_hill', 'east_field']),
    ];
  }

  public draw(context: CanvasRenderingContext2D, camera: Camera): void {
    const bounds = camera.visibleBounds;
    const margin = 200;

    context.fillStyle = PALETTE.grass;
    context.fillRect(0, 0, MAP_WIDTH, MAP_HEIGHT);

    // Open-ground tonal variation.
    context.fillStyle = PALETTE.openField;
    for (const field of this.fields) {
      context.beginPath();
      context.ellipse(field.x, field.y, field.radiusX, field.radiusY, 0, 0, Math.PI * 2);
      context.fill();
    }

    // Hills as stacked contours.
    context.strokeStyle = PALETTE.hillContour;
    context.lineWidth = 3 / camera.zoom;
    for (const contour of this.hills) {
      context.fillStyle = PALETTE.hill;
      context.beginPath();
      context.ellipse(contour.x, contour.y, contour.radiusX, contour.radiusY, 0, 0, Math.PI * 2);
      context.fill();
      context.stroke();
    }

    // Roads.
    context.strokeStyle = PALETTE.road;
    context.lineWidth = 22;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    for (const road of this.roads) {
      context.beginPath();
      road.forEach(([x, y], index) => {
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });
      context.stroke();
    }

    // River, then the crossings drawn over it.
    context.fillStyle = PALETTE.river;
    context.fill(this.riverPath);
    context.strokeStyle = PALETTE.riverEdge;
    context.lineWidth = 5 / camera.zoom;
    context.stroke(this.riverPath);

    for (const crossing of CROSSINGS) {
      const width = crossing.radius * 1.24;
      const centerY = riverCenterY(crossing.center.x);
      context.fillStyle = PALETTE.crossing;
      context.fillRect(
        crossing.center.x - width / 2,
        centerY - RIVER_HALF_WIDTH - 16,
        width,
        RIVER_HALF_WIDTH * 2 + 32,
      );
      context.strokeStyle = PALETTE.crossingEdge;
      context.lineWidth = 4 / camera.zoom;
      context.strokeRect(
        crossing.center.x - width / 2,
        centerY - RIVER_HALF_WIDTH - 16,
        width,
        RIVER_HALF_WIDTH * 2 + 32,
      );
    }

    // Forest as clustered triangles, culled to the viewport.
    context.fillStyle = PALETTE.forestCanopy;
    context.beginPath();
    for (const tree of this.forest) {
      if (
        tree.x < bounds.left - margin ||
        tree.x > bounds.right + margin ||
        tree.y < bounds.top - margin ||
        tree.y > bounds.bottom + margin
      ) {
        continue;
      }
      const half = tree.size / 2;
      context.moveTo(tree.x, tree.y - half);
      context.lineTo(tree.x + half, tree.y + half);
      context.lineTo(tree.x - half, tree.y + half);
      context.closePath();
    }
    context.fill();

    // Village buildings.
    for (const building of this.buildings) {
      if (
        building.x < bounds.left - margin ||
        building.x > bounds.right + margin ||
        building.y < bounds.top - margin ||
        building.y > bounds.bottom + margin
      ) {
        continue;
      }
      context.save();
      context.translate(building.x, building.y);
      context.rotate(building.angle);
      context.fillStyle = PALETTE.village;
      context.fillRect(-building.width / 2, -building.height / 2, building.width, building.height);
      context.fillStyle = PALETTE.villageRoof;
      context.fillRect(-building.width / 2, -building.height / 2, building.width, building.height * 0.4);
      context.restore();
    }
  }

  /** Zone rings and names, drawn above terrain but below the armies. */
  public drawLabels(context: CanvasRenderingContext2D, camera: Camera): void {
    const bounds = camera.visibleBounds;

    context.strokeStyle = PALETTE.zoneRing;
    context.lineWidth = 2 / camera.zoom;
    for (const zone of ORDERED_ZONES) {
      if (
        zone.center.x < bounds.left - zone.radius ||
        zone.center.x > bounds.right + zone.radius ||
        zone.center.y < bounds.top - zone.radius ||
        zone.center.y > bounds.bottom + zone.radius
      ) {
        continue;
      }
      context.beginPath();
      context.arc(zone.center.x, zone.center.y, zone.radius, 0, Math.PI * 2);
      context.stroke();
    }

    // Labels are drawn at a constant screen size so they stay readable.
    const fontSize = 15 / camera.zoom;
    context.font = `600 ${fontSize}px ui-monospace, "SF Mono", Menlo, monospace`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';

    for (const zone of ORDERED_ZONES) {
      if (
        zone.center.x < bounds.left ||
        zone.center.x > bounds.right ||
        zone.center.y < bounds.top ||
        zone.center.y > bounds.bottom
      ) {
        continue;
      }
      context.fillStyle = zone.crossing ? PALETTE.crossingLabel : PALETTE.zoneLabel;
      context.fillText(
        zone.name.toUpperCase(),
        zone.center.x,
        zone.center.y - zone.radius + fontSize * 1.2,
      );
    }
  }
}
