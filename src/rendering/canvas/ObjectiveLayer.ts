import { OBJECTIVE } from '../../game/config/battle';
import type { GameState } from '../../game/simulation/GameState';
import { visibilityAt } from '../../game/simulation/Visibility';
import type { KingState, Vector2D } from '../../game/types/domain';
import type { Camera } from './Camera';
import { PALETTE } from './palette';
import { ICON_CROWN, KEEP, LABEL_FONT, bakeSprite } from './pixelart';

/**
 * The kings.
 *
 * The one thing on the battlefield that is worth more than the men around it,
 * so it is drawn as the only gold on a screen of blue and red. Markers hold a
 * constant size on screen regardless of zoom: at the range where regiments
 * collapse into blobs, the two objectives must still be findable at a glance.
 *
 * Fog binds this layer like every other. Your own sovereign is always drawn.
 * The enemy's is drawn where he stands only while he is actually in sight, and
 * otherwise as a faded standard at the last place he was seen — nothing at all
 * until he has been sighted once.
 */
export class ObjectiveLayer {
  /** Baked once. Two blits a frame, whatever the camera is doing. */
  private readonly keep = bakeSprite(KEEP, 1);
  private readonly crown = bakeSprite(ICON_CROWN, 1);

  public draw(context: CanvasRenderingContext2D, camera: Camera, state: GameState): void {
    const objective = state.objective;
    const tick = state.currentTick;

    context.save();
    context.imageSmoothingEnabled = false;

    this.drawKing(context, camera, objective.kings.player, objective.kings.player.position, false, tick);

    const foe = objective.kings.enemy;
    const inSight = visibilityAt(state, 'player', foe.position.x, foe.position.y) === 2;
    if (inSight) {
      this.drawKing(context, camera, foe, foe.position, false, tick);
    } else if (foe.lastSightingByOpponent !== undefined) {
      this.drawKing(context, camera, foe, foe.lastSightingByOpponent.position, true, tick);
    }

    context.restore();
  }

  /**
   * A keep with a standard over it.
   *
   * The objective is the one thing on the field that must be findable from any
   * zoom, so the marker holds a constant size on screen and is the only place
   * the brightest gold in the palette is spent.
   */
  private drawKing(
    context: CanvasRenderingContext2D,
    camera: Camera,
    king: KingState,
    at: Vector2D,
    remembered: boolean,
    tick: number,
  ): void {
    const scale = 1 / camera.zoom;
    const threatened = king.captureProgress > 0 || king.besieged;
    const pixel = Math.max(2, 3 * scale);

    context.globalAlpha = remembered ? 0.42 : 1;

    // The ground that has to be held to take him. Only worth drawing once
    // somebody is actually trying: an idle ring is just clutter.
    if (threatened && !remembered) {
      this.drawCaptureRing(context, camera, at, king.captureProgress, king.besieged, tick);
    }

    const colour = king.ownerId === 'player' ? PALETTE.player : PALETTE.enemy;
    const keepWidth = this.keep.width * pixel;
    const keepHeight = this.keep.height * pixel;
    const keepLeft = at.x - keepWidth / 2;
    const keepTop = at.y - keepHeight;

    // A shadow plate under the keep, so it never sinks into a dark wood.
    context.fillStyle = 'rgba(8, 10, 6, 0.5)';
    context.fillRect(keepLeft - pixel, keepTop - pixel, keepWidth + pixel * 2, keepHeight + pixel * 2);
    context.drawImage(this.keep, keepLeft, keepTop, keepWidth, keepHeight);

    // The owner's colours run down the keep wall, so the two are never confused.
    context.fillStyle = colour;
    context.fillRect(at.x - pixel * 1.5, keepTop + pixel * 4, pixel * 3, pixel * 5);

    // The standard, waving on the tick clock like every other banner.
    const poleHeight = 26 * pixel;
    const poleTop = keepTop - poleHeight;
    context.fillStyle = PALETTE.timberDark;
    context.fillRect(at.x - pixel / 2, poleTop, pixel, poleHeight);
    for (let column = 0; column < 5; column += 1) {
      const phase = Math.floor((tick + column * 3) / 4) % 4;
      const lift = (phase === 1 ? -1 : phase === 3 ? 1 : 0) * (column / 5) * pixel;
      context.fillStyle = column === 2 ? PALETTE.kingGold : colour;
      context.fillRect(at.x + pixel / 2 + column * pixel, poleTop + lift, pixel, pixel * 5);
    }

    // The crown, over the gate, on a plate of its own.
    const crownWidth = this.crown.width * pixel;
    const crownHeight = this.crown.height * pixel;
    context.globalAlpha = remembered ? 0.42 : threatened && tick % 20 < 10 ? 0.55 : 1;
    context.drawImage(
      threatened ? this.dangerCrown() : this.crown,
      at.x - crownWidth / 2,
      keepTop - crownHeight - pixel,
      crownWidth,
      crownHeight,
    );
    context.globalAlpha = remembered ? 0.42 : 1;

    // Name, and the count that matters when it is moving.
    const label = remembered
      ? `${king.name} (last seen)`
      : threatened
        ? `${king.name} — ${Math.round(king.captureProgress)}%`
        : king.name;
    const fontSize = 13 * scale;
    context.font = `700 ${fontSize}px ${LABEL_FONT}`;
    context.textAlign = 'center';
    context.textBaseline = 'bottom';
    const width = context.measureText(label).width + 14 * scale;
    const plateTop = poleTop - 22 * scale;
    context.fillStyle = 'rgba(9, 12, 7, 0.86)';
    context.fillRect(at.x - width / 2, plateTop, width, 18 * scale);
    context.fillStyle = threatened ? PALETTE.kingDanger : PALETTE.kingGold;
    context.fillRect(at.x - width / 2, plateTop, width, scale);
    context.fillRect(at.x - width / 2, plateTop + 17 * scale, width, scale);
    context.fillText(label, at.x, plateTop + 15 * scale);

    context.globalAlpha = 1;
  }

  /** The crown again, in the alarm colour. Baked on first threat, then kept. */
  private dangerCrown(): HTMLCanvasElement {
    if (this.dangerCrownCache === undefined) {
      this.dangerCrownCache = bakeSprite(ICON_CROWN, 1);
      const context = this.dangerCrownCache.getContext('2d');
      if (context !== null) {
        context.globalCompositeOperation = 'source-in';
        context.fillStyle = PALETTE.kingDanger;
        context.fillRect(0, 0, this.dangerCrownCache.width, this.dangerCrownCache.height);
      }
    }
    return this.dangerCrownCache;
  }

  private dangerCrownCache: HTMLCanvasElement | undefined;

  /** The capture ring, with the progress against it drawn as a filling arc. */
  private drawCaptureRing(
    context: CanvasRenderingContext2D,
    camera: Camera,
    at: Vector2D,
    progress: number,
    besieged: boolean,
    tick: number,
  ): void {
    const scale = 1 / camera.zoom;
    const radius = OBJECTIVE.captureRadius;
    const block = Math.max(6, 6 * scale);
    const steps = 72;
    // The ring turns slowly while the ground is contested, which is the one
    // piece of motion that says "this is happening now" from across the map.
    const spin = besieged ? Math.floor(tick / 3) % steps : 0;

    context.fillStyle = besieged ? PALETTE.kingDanger : PALETTE.kingGold;
    for (let step = 0; step < steps; step += 1) {
      if ((step + spin) % 3 === 0) continue;
      const angle = (step / steps) * Math.PI * 2;
      context.fillRect(
        at.x + Math.cos(angle) * radius - block / 2,
        at.y + Math.sin(angle) * radius - block / 2,
        block,
        block,
      );
    }

    if (progress <= 0) return;
    // Progress fills the same ring clockwise from the top, in heavier blocks.
    const taken = Math.round((steps * Math.min(100, progress)) / 100);
    context.fillStyle = PALETTE.kingDanger;
    for (let step = 0; step < taken; step += 1) {
      const angle = -Math.PI / 2 + (step / steps) * Math.PI * 2;
      context.fillRect(
        at.x + Math.cos(angle) * radius - block,
        at.y + Math.sin(angle) * radius - block,
        block * 2,
        block * 2,
      );
    }
  }
}
