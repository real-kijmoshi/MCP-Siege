import type { GameState } from '../../game/simulation/GameState';
import { visibilityAt } from '../../game/simulation/Visibility';
import type { Camera } from './Camera';
import { PALETTE } from './palette';

/**
 * Combat effects.
 *
 * Deliberately minimal: a short line for a volley, a spark for a melee, a ring
 * for a siege impact. The simulation samples only a fraction of the blows
 * landed, which is plenty to read the shape of a fight without drawing
 * thousands of lines a frame.
 */
export class EffectsLayer {
  public draw(
    context: CanvasRenderingContext2D,
    camera: Camera,
    state: GameState,
    interpolation = 1,
  ): void {
    const events = state.combatEvents;
    if (events.length === 0) return;

    const bounds = camera.visibleBounds;
    context.save();
    context.lineCap = 'round';

    for (const event of events) {
      if (
        event.x < bounds.left ||
        event.x > bounds.right ||
        event.y < bounds.top ||
        event.y > bounds.bottom
      ) {
        continue;
      }
      if (visibilityAt(state, 'player', event.x, event.y) !== 2) continue;

      const age = Math.max(0, state.currentTick - event.tick - (1 - interpolation));
      const life = Math.max(0, 1 - age / 13);

      if (event.kind === 'arrow') {
        const progress = Math.min(1, (age + 2) / 8);
        const tail = Math.max(0, progress - 0.24);
        const dx = event.targetX - event.x;
        const dy = event.targetY - event.y;
        context.globalAlpha = life * 0.9;
        context.strokeStyle = PALETTE.arrow;
        context.lineWidth = 1.8 / camera.zoom;
        context.beginPath();
        context.moveTo(event.x + dx * tail, event.y + dy * tail);
        context.lineTo(event.x + dx * progress, event.y + dy * progress);
        context.stroke();
      } else if (event.kind === 'melee') {
        const cx = (event.x + event.targetX) / 2;
        const cy = (event.y + event.targetY) / 2;
        const spark = 8 + age * 2.4;
        context.globalAlpha = life;
        context.strokeStyle = PALETTE.melee;
        context.lineWidth = 2.2 / camera.zoom;
        context.beginPath();
        context.moveTo(cx - spark, cy);
        context.lineTo(cx + spark, cy);
        context.moveTo(cx, cy - spark);
        context.lineTo(cx, cy + spark);
        context.moveTo(cx - spark * 0.65, cy - spark * 0.65);
        context.lineTo(cx + spark * 0.65, cy + spark * 0.65);
        context.stroke();
      }
    }

    // Siege impacts get a hot core and smoke halo as well as the shock ring.
    for (const event of events) {
      if (event.kind !== 'siege') continue;
      if (visibilityAt(state, 'player', event.targetX, event.targetY) !== 2) continue;
      const age = Math.max(0, state.currentTick - event.tick - (1 - interpolation));
      const life = Math.max(0, 1 - age / 13);
      const radius = 18 + age * 11;
      context.globalAlpha = life * 0.85;
      context.fillStyle = PALETTE.siegeBlast;
      context.beginPath();
      context.arc(event.targetX, event.targetY, Math.max(3, 16 - age), 0, Math.PI * 2);
      context.fill();
      context.strokeStyle = PALETTE.siegeBlast;
      context.lineWidth = 3 / camera.zoom;
      context.beginPath();
      context.arc(event.targetX, event.targetY, radius, 0, Math.PI * 2);
      context.stroke();
      context.globalAlpha = life * 0.28;
      context.fillStyle = '#d8cec0';
      context.beginPath();
      context.arc(event.targetX - age * 2, event.targetY - radius * 0.22, radius * 0.48, 0, Math.PI * 2);
      context.fill();
    }

    context.restore();
  }
}
