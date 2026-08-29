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
  public draw(context: CanvasRenderingContext2D, camera: Camera, state: GameState): void {
    const events = state.combatEvents;
    if (events.length === 0) return;

    const bounds = camera.visibleBounds;
    context.save();
    context.lineCap = 'round';

    context.strokeStyle = PALETTE.melee;
    context.lineWidth = 1.6 / camera.zoom;
    context.beginPath();

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

      if (event.kind === 'arrow') {
        context.moveTo(event.x, event.y);
        context.lineTo(event.targetX, event.targetY);
      } else if (event.kind === 'melee') {
        // A short spark at the point of contact rather than a full line.
        const dx = event.targetX - event.x;
        const dy = event.targetY - event.y;
        const length = Math.hypot(dx, dy) || 1;
        context.moveTo(event.x + (dx / length) * 4, event.y + (dy / length) * 4);
        context.lineTo(event.targetX, event.targetY);
      }
    }
    context.stroke();

    // Siege impacts read as expanding rings, which makes bombardment obvious.
    context.strokeStyle = PALETTE.siegeBlast;
    context.lineWidth = 3 / camera.zoom;
    for (const event of events) {
      if (event.kind !== 'siege') continue;
      if (visibilityAt(state, 'player', event.targetX, event.targetY) !== 2) continue;
      const age = Math.max(0, state.currentTick - event.tick);
      const radius = 20 + age * 9;
      context.globalAlpha = Math.max(0, 1 - age / 6);
      context.beginPath();
      context.arc(event.targetX, event.targetY, radius, 0, Math.PI * 2);
      context.stroke();
    }

    context.restore();
  }
}
