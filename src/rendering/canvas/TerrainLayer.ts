import { MAP_HEIGHT, MAP_WIDTH } from '../../game/config/battle';
import type { BattleMapId, MereDefinition } from '../../game/config/maps';
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

/**
 * Terrain.
 *
 * Built once per map as a list of simple shapes and drawn with viewport culling
 * each frame. Keeping it procedural rather than a pre-rendered bitmap means it
 * stays sharp at every zoom level and costs no memory, and a whole battlefield
 * is still only a few hundred shapes.
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
  angle: number;
  outer: boolean;
}

/** Rock along an impassable spine, so a ridge does not read as a dry river. */
interface Crag {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Deterministic scatter, so a map looks identical on every load. */
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

function seedForMap(id: BattleMapId): number {
  let seed = 0x5eed_1234;
  for (let index = 0; index < id.length; index += 1) {
    seed = Math.imul(seed ^ id.charCodeAt(index), 0x45d9_f3b) >>> 0;
  }
  return seed;
}

export class TerrainLayer {
  private builtFor: BattleMapId | undefined;
  private barrierPath = new Path2D();
  private hasBarrier = false;
  private forest: Triangle[] = [];
  private hills: Contour[] = [];
  private buildings: Rect[] = [];
  private fields: Contour[] = [];
  private crags: Crag[] = [];
  private meres: readonly MereDefinition[] = [];
  private roads: Array<Array<[number, number]>> = [];
  private colors: Record<keyof typeof PALETTE, string> = PALETTE;

  public constructor(mapId?: BattleMapId) {
    if (mapId !== undefined) useBattleMap(mapId);
    this.rebuild();
  }

  /** Rebuilds only when the battle is being fought somewhere else. */
  public syncTo(mapId: BattleMapId): void {
    if (this.builtFor === mapId) return;
    useBattleMap(mapId);
    this.rebuild();
  }

  private rebuild(): void {
    const map = activeBattleMap();
    this.builtFor = activeBattleMapId();
    // Authored ground colouring over the shared palette: ash country is not the
    // colour of harvest country, and the map should say so before anything moves.
    this.colors = { ...PALETTE, ...map.ground };
    this.meres = map.meres;
    this.forest = [];
    this.hills = [];
    this.buildings = [];
    this.fields = [];
    this.crags = [];
    this.hasBarrier = map.barrier !== undefined;
    this.barrierPath = this.buildBarrier();
    this.buildScatter();
    this.roads = this.buildRoads();
  }

  private buildBarrier(): Path2D {
    const path = new Path2D();
    if (!this.hasBarrier) return path;
    const half = barrierHalfWidth();
    const step = 40;
    path.moveTo(0, barrierCenterAt(0) - half);
    for (let x = step; x <= MAP_WIDTH; x += step) {
      path.lineTo(x, barrierCenterAt(x) - half);
    }
    for (let x = MAP_WIDTH; x >= 0; x -= step) {
      path.lineTo(x, barrierCenterAt(x) + half);
    }
    path.closePath();
    return path;
  }

  private buildScatter(): void {
    // Each country gets its own stable grain. Previously every map used the
    // same seed, which made four battlefields look like one reskinned layout.
    const random = makeRandom(seedForMap(activeBattleMapId()));

    for (const zone of activeZones()) {
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
            x: zone.center.x + (random() - 0.5) * zone.radius * 0.12,
            y: zone.center.y + (random() - 0.5) * zone.radius * 0.1,
            radiusX: zone.radius * scale,
            radiusY: zone.radius * scale * (0.48 + random() * 0.22),
            angle: (random() - 0.5) * 0.6,
            outer: ring === 0,
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
            angle: random() * Math.PI,
            outer: true,
          });
        }
      }
    }

    const barrier = activeBattleMap().barrier;
    if (barrier?.kind === 'ridge') {
      const half = barrier.halfWidth;
      for (let x = 60; x < MAP_WIDTH; x += 90) {
        const rows = 3;
        for (let row = 0; row < rows; row += 1) {
          const offset = (row / (rows - 1) - 0.5) * 2 * half * 0.72;
          const width = 60 + random() * 70;
          this.crags.push({
            x: x + (random() - 0.5) * 60,
            y: barrierCenterAt(x) + offset + (random() - 0.5) * 60,
            width,
            height: width * (0.55 + random() * 0.4),
          });
        }
      }
    }
  }

  /** Roads trace the routes armies actually use, reinforcing the geography. */
  private buildRoads(): Array<Array<[number, number]>> {
    return activeBattleMap().roads.map((route) =>
      route.map((id) => [ZONES[id].center.x, ZONES[id].center.y] as [number, number]),
    );
  }

  public draw(context: CanvasRenderingContext2D, camera: Camera): void {
    const bounds = camera.visibleBounds;
    const margin = 200;
    const colors = this.colors;

    context.fillStyle = colors.grass;
    context.fillRect(0, 0, MAP_WIDTH, MAP_HEIGHT);

    // Open-ground tonal variation. Goldmere is cut into visible harvest strips;
    // the coast is washed with salt pans; the Vale stays soft and pastoral.
    context.fillStyle = colors.openField;
    for (const field of this.fields) {
      context.beginPath();
      context.ellipse(
        field.x,
        field.y,
        field.radiusX,
        field.radiusY,
        field.angle,
        0,
        Math.PI * 2,
      );
      context.fill();
      if (this.builtFor === 'goldmere') {
        context.save();
        context.clip();
        context.translate(field.x, field.y);
        context.rotate(field.angle);
        context.strokeStyle = 'rgba(220, 191, 92, 0.11)';
        context.lineWidth = 9;
        for (let y = -field.radiusY; y <= field.radiusY; y += 48) {
          context.beginPath();
          context.moveTo(-field.radiusX, y);
          context.lineTo(field.radiusX, y);
          context.stroke();
        }
        context.restore();
      }
    }

    // Hills are irregular landforms, not perfect target rings.
    context.strokeStyle = colors.hillContour;
    context.lineWidth = 2 / camera.zoom;
    for (const contour of this.hills) {
      context.beginPath();
      context.ellipse(
        contour.x,
        contour.y,
        contour.radiusX,
        contour.radiusY,
        contour.angle,
        0,
        Math.PI * 2,
      );
      if (contour.outer) {
        context.fillStyle = colors.hill;
        context.fill();
      }
      context.stroke();
    }

    // Roads are worn routes with curved joins and a narrow crown. The dark
    // verge keeps them legible without the old ruler-straight debug lines.
    context.lineCap = 'round';
    context.lineJoin = 'round';
    for (const road of this.roads) {
      this.traceRoad(context, road);
      context.strokeStyle = 'rgba(10, 13, 10, 0.34)';
      context.lineWidth = 34;
      context.stroke();
      this.traceRoad(context, road);
      context.strokeStyle = colors.road;
      context.lineWidth = 17;
      context.stroke();
      this.traceRoad(context, road);
      context.strokeStyle = 'rgba(222, 205, 156, 0.12)';
      context.lineWidth = 2 / camera.zoom;
      context.setLineDash([26, 34]);
      context.stroke();
      context.setLineDash([]);
    }

    // Standing water away from the barrier, drawn over the roads it interrupts.
    for (const mere of this.meres) {
      context.fillStyle = colors.river;
      context.beginPath();
      context.ellipse(mere.center.x, mere.center.y, mere.radius, mere.radius * 0.78, 0, 0, Math.PI * 2);
      context.fill();
      context.strokeStyle = colors.riverEdge;
      context.lineWidth = 5 / camera.zoom;
      context.stroke();
      context.strokeStyle = 'rgba(132, 200, 213, 0.14)';
      context.lineWidth = 2 / camera.zoom;
      context.beginPath();
      context.ellipse(
        mere.center.x - mere.radius * 0.08,
        mere.center.y,
        mere.radius * 0.72,
        mere.radius * 0.42,
        -0.12,
        0.2,
        Math.PI * 1.25,
      );
      context.stroke();
    }

    if (this.hasBarrier) this.drawBarrier(context, camera, bounds, margin);

    // Forest as clustered triangles, culled to the viewport.
    context.fillStyle = colors.forestCanopy;
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
      context.fillStyle = colors.village;
      context.fillRect(-building.width / 2, -building.height / 2, building.width, building.height);
      context.fillStyle = colors.villageRoof;
      context.fillRect(-building.width / 2, -building.height / 2, building.width, building.height * 0.4);
      context.restore();
    }
  }

  private traceRoad(context: CanvasRenderingContext2D, road: Array<[number, number]>): void {
    const first = road[0];
    if (first === undefined) return;
    context.beginPath();
    context.moveTo(first[0], first[1]);
    for (let index = 1; index < road.length - 1; index += 1) {
      const point = road[index];
      const next = road[index + 1];
      if (point === undefined || next === undefined) continue;
      context.quadraticCurveTo(point[0], point[1], (point[0] + next[0]) / 2, (point[1] + next[1]) / 2);
    }
    const last = road[road.length - 1];
    if (last !== undefined && road.length > 1) context.lineTo(last[0], last[1]);
  }

  /** The barrier, then the crossings drawn over it. */
  private drawBarrier(
    context: CanvasRenderingContext2D,
    camera: Camera,
    bounds: { left: number; right: number; top: number; bottom: number },
    margin: number,
  ): void {
    const colors = this.colors;
    const half = barrierHalfWidth();

    context.fillStyle = colors.river;
    context.fill(this.barrierPath);
    context.strokeStyle = colors.riverEdge;
    context.lineWidth = 5 / camera.zoom;
    context.stroke(this.barrierPath);

    if (activeBattleMap().barrier?.kind === 'river') {
      context.strokeStyle = 'rgba(113, 190, 211, 0.16)';
      context.lineWidth = 3 / camera.zoom;
      context.setLineDash([90, 130]);
      for (let offset = -half * 0.45; offset <= half * 0.45; offset += half * 0.45) {
        context.beginPath();
        context.moveTo(0, barrierCenterAt(0) + offset);
        for (let x = 80; x <= MAP_WIDTH; x += 80) {
          context.lineTo(x, barrierCenterAt(x) + offset);
        }
        context.stroke();
      }
      context.setLineDash([]);
    }

    // A ridge is rock: broken slabs along the spine tell it apart from water at
    // a glance, which matters because the two read identically as a dark band.
    context.fillStyle = colors.hill;
    for (const crag of this.crags) {
      if (
        crag.x < bounds.left - margin ||
        crag.x > bounds.right + margin ||
        crag.y < bounds.top - margin ||
        crag.y > bounds.bottom + margin
      ) {
        continue;
      }
      context.beginPath();
      context.moveTo(crag.x - crag.width / 2, crag.y + crag.height / 2);
      context.lineTo(crag.x - crag.width * 0.16, crag.y - crag.height / 2);
      context.lineTo(crag.x + crag.width / 2, crag.y + crag.height / 2);
      context.closePath();
      context.fill();
    }

    for (const crossing of activeCrossings()) {
      const width = Math.min(crossing.radius * 1.12, 540);
      const centerY = barrierCenterAt(crossing.center.x);
      const tangent = Math.atan2(
        barrierCenterAt(crossing.center.x + 20) - barrierCenterAt(crossing.center.x - 20),
        40,
      );
      const crossingLength = half * 2 + 46;
      context.save();
      context.translate(crossing.center.x, centerY);
      context.rotate(tangent);
      context.fillStyle = colors.crossing;
      context.fillRect(-width / 2, -crossingLength / 2, width, crossingLength);
      context.strokeStyle = colors.crossingEdge;
      context.lineWidth = 4 / camera.zoom;
      context.strokeRect(-width / 2, -crossingLength / 2, width, crossingLength);
      context.strokeStyle = 'rgba(31, 24, 15, 0.34)';
      context.lineWidth = 2 / camera.zoom;
      const plankStep = activeBattleMap().barrier?.kind === 'ridge' ? 74 : 42;
      for (let x = -width / 2 + plankStep; x < width / 2; x += plankStep) {
        context.beginPath();
        context.moveTo(x, -crossingLength / 2);
        context.lineTo(x, crossingLength / 2);
        context.stroke();
      }
      context.restore();
    }
  }

  /** Cartographic names, drawn above terrain but below the armies. */
  public drawLabels(
    context: CanvasRenderingContext2D,
    camera: Camera,
    hoveredZone: ZoneId | undefined,
  ): void {
    const bounds = camera.visibleBounds;

    const hovered = hoveredZone === undefined ? undefined : ZONES[hoveredZone];
    if (hovered !== undefined) {
      context.strokeStyle = hovered.crossing ? PALETTE.crossingLabel : PALETTE.selection;
      context.lineWidth = 2 / camera.zoom;
      context.setLineDash([18 / camera.zoom, 12 / camera.zoom]);
      context.beginPath();
      context.arc(hovered.center.x, hovered.center.y, hovered.radius, 0, Math.PI * 2);
      context.stroke();
      context.setLineDash([]);
    }

    // Labels are drawn at a constant screen size so they stay readable.
    const fontSize = 15 / camera.zoom;
    context.font = `600 ${fontSize}px ui-monospace, "SF Mono", Menlo, monospace`;
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
      const labelWidth = context.measureText(label).width + 18 / camera.zoom;
      const labelHeight = 22 / camera.zoom;
      if (zone.id === hoveredZone) {
        context.fillStyle = 'rgba(8, 18, 12, 0.9)';
        context.fillRect(zone.center.x - labelWidth / 2, labelY - labelHeight / 2, labelWidth, labelHeight);
      }
      context.strokeStyle = 'rgba(5, 10, 7, 0.86)';
      context.lineWidth = 4 / camera.zoom;
      context.strokeText(label, zone.center.x, labelY);
      context.fillStyle = zone.crossing ? PALETTE.crossingLabel : PALETTE.zoneLabel;
      context.fillText(label, zone.center.x, labelY);
    }
  }
}
