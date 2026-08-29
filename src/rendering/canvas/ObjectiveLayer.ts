import { OBJECTIVE } from '../../game/config/battle';
import type { GameState } from '../../game/simulation/GameState';
import { visibilityAt } from '../../game/simulation/Visibility';
import type { KingState, Vector2D } from '../../game/types/domain';
import type { Camera } from './Camera';
import { PALETTE } from './palette';

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
  public draw(context: CanvasRenderingContext2D, camera: Camera, state: GameState): void {
    const objective = state.objective;

    context.save();
    context.lineCap = 'round';
    context.lineJoin = 'round';

    this.drawKing(context, camera, objective.kings.player, objective.kings.player.position, false);

    const foe = objective.kings.enemy;
    const inSight = visibilityAt(state, 'player', foe.position.x, foe.position.y) === 2;
    if (inSight) {
      this.drawKing(context, camera, foe, foe.position, false);
    } else if (foe.lastSightingByOpponent !== undefined) {
      this.drawKing(context, camera, foe, foe.lastSightingByOpponent.position, true);
    }

    context.restore();
  }

  private drawKing(
    context: CanvasRenderingContext2D,
    camera: Camera,
    king: KingState,
    at: Vector2D,
    remembered: boolean,
  ): void {
    const scale = 1 / camera.zoom;
    const threatened = king.captureProgress > 0 || king.besieged;

    context.globalAlpha = remembered ? 0.4 : 1;

    // The ground that has to be held to take him. Only worth drawing once
    // somebody is actually trying: an idle ring is just clutter.
    if (threatened && !remembered) {
      this.drawCaptureRing(context, camera, at, king.captureProgress, king.besieged);
    }

    const colour = king.ownerId === 'player' ? PALETTE.player : PALETTE.enemy;
    const height = 46 * scale;
    const poleWidth = Math.max(2 * scale, 1.5 * scale);

    // Pole.
    context.strokeStyle = PALETTE.kingGold;
    context.lineWidth = poleWidth;
    context.beginPath();
    context.moveTo(at.x, at.y);
    context.lineTo(at.x, at.y - height);
    context.stroke();

    // Pennant, in the owner's colour so the two are never confused.
    const flag = 26 * scale;
    context.fillStyle = colour;
    context.beginPath();
    context.moveTo(at.x, at.y - height);
    context.lineTo(at.x + flag, at.y - height + flag * 0.34);
    context.lineTo(at.x, at.y - height + flag * 0.68);
    context.closePath();
    context.fill();

    // Crown, at the foot of the standard where the man himself stands.
    this.drawCrown(context, at.x, at.y, 13 * scale, threatened && !remembered);

    // Name, and the count that matters when it is moving.
    context.fillStyle = PALETTE.kingGold;
    context.font = `700 ${13 * scale}px ui-monospace, "SF Mono", Menlo, monospace`;
    context.textAlign = 'center';
    context.textBaseline = 'bottom';
    const label = remembered
      ? `${king.name} (last seen)`
      : threatened
        ? `${king.name} — ${Math.round(king.captureProgress)}%`
        : king.name;
    context.fillText(label, at.x, at.y - height - 8 * scale);

    context.globalAlpha = 1;
  }

  private drawCrown(
    context: CanvasRenderingContext2D,
    x: number,
    y: number,
    size: number,
    threatened: boolean,
  ): void {
    const half = size;
    const top = y - size * 1.35;

    context.beginPath();
    context.moveTo(x - half, y);
    context.lineTo(x - half, top);
    context.lineTo(x - half * 0.5, top + size * 0.55);
    context.lineTo(x, top);
    context.lineTo(x + half * 0.5, top + size * 0.55);
    context.lineTo(x + half, top);
    context.lineTo(x + half, y);
    context.closePath();

    context.fillStyle = threatened ? PALETTE.kingDanger : PALETTE.kingGold;
    context.fill();
    context.strokeStyle = '#1a1206';
    context.lineWidth = size * 0.16;
    context.stroke();
  }

  /** The capture ring, with the progress against it drawn as a filling arc. */
  private drawCaptureRing(
    context: CanvasRenderingContext2D,
    camera: Camera,
    at: Vector2D,
    progress: number,
    besieged: boolean,
  ): void {
    const scale = 1 / camera.zoom;
    const radius = OBJECTIVE.captureRadius;

    context.strokeStyle = besieged ? PALETTE.kingDanger : PALETTE.kingGold;
    context.lineWidth = 2.5 * scale;
    context.setLineDash([18 * scale, 12 * scale]);
    context.beginPath();
    context.arc(at.x, at.y, radius, 0, Math.PI * 2);
    context.stroke();
    context.setLineDash([]);

    if (progress <= 0) return;
    context.strokeStyle = PALETTE.kingDanger;
    context.lineWidth = 9 * scale;
    context.beginPath();
    context.arc(
      at.x,
      at.y,
      radius,
      -Math.PI / 2,
      -Math.PI / 2 + (Math.PI * 2 * Math.min(100, progress)) / 100,
    );
    context.stroke();
  }
}
