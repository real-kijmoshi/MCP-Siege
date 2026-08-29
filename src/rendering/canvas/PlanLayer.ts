import { describeCondition } from '../../game/simulation/Conditions';
import { findGroup, type GameState } from '../../game/simulation/GameState';
import { ZONES } from '../../game/simulation/Zones';
import type { BattlePlan, Vector2D } from '../../game/types/domain';
import type { Camera } from './Camera';
import { PALETTE } from './palette';

/**
 * The plan overlay.
 *
 * This is Plan Mode made visible: a proposed operation drawn over the live
 * battlefield as numbered, translucent arrows while nothing has actually moved.
 * The commander reads the plan on the map, revises it in conversation, and only
 * then commits.
 */
export class PlanLayer {
  public draw(
    context: CanvasRenderingContext2D,
    camera: Camera,
    state: GameState,
    plan: BattlePlan | undefined,
  ): void {
    if (plan === undefined || plan.status === 'cancelled' || plan.status === 'complete') return;

    const draft = plan.status === 'draft';
    // An executing plan fades back; a draft is the thing being discussed.
    const alpha = draft ? 1 : 0.45;

    context.save();
    context.globalAlpha = alpha;
    context.lineCap = 'round';
    context.lineJoin = 'round';

    for (const step of plan.steps) {
      const group = findGroup(state, step.groupId);
      if (group === undefined || group.members.length === 0) continue;

      const target = this.targetOf(state, step.targetZone, step.targetGroupId);
      const from = group.anchor;

      if (target !== undefined) {
        this.drawZoneHighlight(context, camera, target, step.targetZone !== undefined);
        this.drawArrow(context, camera, from, target);
        this.drawBadge(context, camera, from, target, step.index);
      } else {
        // A formation change has no destination; mark it on the group itself.
        this.drawBadge(context, camera, from, from, step.index);
      }
    }

    context.restore();
  }

  private targetOf(
    state: GameState,
    targetZone: string | undefined,
    targetGroupId: string | undefined,
  ): Vector2D | undefined {
    if (targetZone !== undefined) {
      const zone = ZONES[targetZone as keyof typeof ZONES];
      if (zone !== undefined) return zone.center;
    }
    if (targetGroupId !== undefined) {
      const target = findGroup(state, targetGroupId);
      if (target !== undefined) return target.anchor;
      // An enemy target may only be known from intelligence.
      const contact = state.contacts.player.get(targetGroupId);
      if (contact !== undefined) return contact.lastPosition;
    }
    return undefined;
  }

  private drawZoneHighlight(
    context: CanvasRenderingContext2D,
    camera: Camera,
    center: Vector2D,
    isZone: boolean,
  ): void {
    const radius = isZone ? 260 : 140;
    context.fillStyle = PALETTE.planFill;
    context.strokeStyle = PALETTE.plan;
    context.lineWidth = 2.5 / camera.zoom;
    context.setLineDash([14 / camera.zoom, 10 / camera.zoom]);
    context.beginPath();
    context.arc(center.x, center.y, radius, 0, Math.PI * 2);
    context.fill();
    context.stroke();
    context.setLineDash([]);
  }

  /** A gently curved arrow, so overlapping steps stay distinguishable. */
  private drawArrow(
    context: CanvasRenderingContext2D,
    camera: Camera,
    from: Vector2D,
    to: Vector2D,
  ): void {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy);
    if (length < 40) return;

    const midX = (from.x + to.x) / 2;
    const midY = (from.y + to.y) / 2;
    // Bow the arc perpendicular to the line of march.
    const bow = Math.min(length * 0.18, 420);
    const controlX = midX - (dy / length) * bow;
    const controlY = midY + (dx / length) * bow;

    context.strokeStyle = PALETTE.plan;
    context.lineWidth = 7 / camera.zoom;
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.quadraticCurveTo(controlX, controlY, to.x, to.y);
    context.stroke();

    // Head, aligned with the curve's final tangent.
    const tangentX = to.x - controlX;
    const tangentY = to.y - controlY;
    const angle = Math.atan2(tangentY, tangentX);
    const head = 46;
    context.fillStyle = PALETTE.plan;
    context.beginPath();
    context.moveTo(to.x, to.y);
    context.lineTo(
      to.x - Math.cos(angle - 0.42) * head,
      to.y - Math.sin(angle - 0.42) * head,
    );
    context.lineTo(
      to.x - Math.cos(angle + 0.42) * head,
      to.y - Math.sin(angle + 0.42) * head,
    );
    context.closePath();
    context.fill();
  }

  private drawBadge(
    context: CanvasRenderingContext2D,
    camera: Camera,
    from: Vector2D,
    to: Vector2D,
    index: number,
  ): void {
    // Sit the number near the start of the arrow, where the group actually is.
    const x = from.x + (to.x - from.x) * 0.18;
    const y = from.y + (to.y - from.y) * 0.18;
    const radius = 22 / camera.zoom;

    context.fillStyle = '#160d24';
    context.strokeStyle = PALETTE.plan;
    context.lineWidth = 3 / camera.zoom;
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
    context.stroke();

    context.fillStyle = PALETTE.plan;
    context.font = `700 ${26 / camera.zoom}px ui-monospace, "SF Mono", Menlo, monospace`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(String(index), x, y + 1 / camera.zoom);
  }

  /**
   * The operation's name and steps, pinned to the corner.
   *
   * Called by the renderer during its screen-space pass, which already has the
   * device pixel ratio applied; resetting the transform here would draw the
   * legend at half size and in the wrong place on a high-DPI display.
   */
  public drawLegend(
    context: CanvasRenderingContext2D,
    camera: Camera,
    state: GameState,
    plan: BattlePlan | undefined,
  ): void {
    if (plan === undefined || plan.status === 'cancelled' || plan.status === 'complete') return;

    context.save();

    const padding = 18;
    const lineHeight = 19;
    const width = 340;
    const height = padding * 2 + 30 + plan.steps.length * lineHeight;
    const x = padding;
    const y = camera.viewportHeight - height - padding;

    context.fillStyle = 'rgba(12, 8, 20, 0.86)';
    context.strokeStyle = PALETTE.plan;
    context.lineWidth = 1.5;
    context.beginPath();
    context.roundRect(x, y, width, height, 8);
    context.fill();
    context.stroke();

    context.textAlign = 'left';
    context.textBaseline = 'top';

    context.fillStyle = PALETTE.plan;
    context.font = '700 13px ui-monospace, "SF Mono", Menlo, monospace';
    context.fillText(
      `${plan.name.toUpperCase()}  ·  ${plan.status.toUpperCase()}`,
      x + padding,
      y + padding,
    );

    context.font = '11px ui-monospace, "SF Mono", Menlo, monospace';
    plan.steps.forEach((step, position) => {
      const group = findGroup(state, step.groupId);
      const target =
        step.targetZone !== undefined
          ? ZONES[step.targetZone].name
          : (step.targetGroupId ?? step.formation ?? '');
      const trigger =
        step.startCondition.kind === 'immediate' ? '' : ` · ${describeCondition(step.startCondition)}`;

      context.fillStyle = 'rgba(226, 220, 240, 0.9)';
      const label = `${step.index}. ${group?.name ?? step.groupId} — ${step.action.replace('_', ' ')} ${target}${trigger}`;
      context.fillText(
        label.length > 52 ? `${label.slice(0, 51)}…` : label,
        x + padding,
        y + padding + 30 + position * lineHeight,
      );
    });

    context.restore();
  }
}
