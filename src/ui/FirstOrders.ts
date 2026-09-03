import { SCENARIOS } from '../game/config/scenario';
import type { ScenarioId } from '../game/config/matches';

/**
 * The opening brief, on the battlefield itself.
 *
 * The War Council explains the operation, and then the player is dropped onto
 * eight thousand men with no reminder of what winning looks like or which
 * button does anything. This card carries that across the cut: the objective,
 * the two controls that matter, and the one rule that makes the counter matrix
 * learnable. It leaves as soon as the player gives an order, because by then it
 * has done its job. The clock waits here as well: reading the briefing should
 * never spend the few quiet seconds before the opening assault.
 */
export class FirstOrders {
  private readonly element = document.getElementById('first-orders');
  private dismissed = false;

  public constructor(scenarioId: ScenarioId, onBegin: () => void) {
    const scenario = SCENARIOS[scenarioId];

    const title = document.getElementById('first-orders-title');
    if (title !== null) title.textContent = scenario.battleOrders[0];

    const body = document.getElementById('first-orders-body');
    if (body !== null) body.textContent = scenario.briefingLine;

    // Closing the briefing is not consent to start the clock. The dedicated
    // Begin button starts play; dismiss simply reveals the field while paused.
    document
      .getElementById('first-orders-dismiss')
      ?.addEventListener('click', () => this.dismiss());
    document
      .getElementById('first-orders-begin')
      ?.addEventListener('click', onBegin);
  }

  /** Called when the player begins the battle or issues their first order. */
  public dismiss(): void {
    if (this.dismissed || this.element === null) return;
    this.dismissed = true;
    this.element.classList.add('leaving');
    window.setTimeout(() => this.element?.remove(), 400);
  }
}
