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
 * has done its job.
 */
/** How long the brief stays up if the player gives no order at all. */
const LINGER_MS = 14_000;

export class FirstOrders {
  private readonly element = document.getElementById('first-orders');
  private dismissed = false;

  public constructor(scenarioId: ScenarioId) {
    const scenario = SCENARIOS[scenarioId];

    const title = document.getElementById('first-orders-title');
    if (title !== null) title.textContent = scenario.battleOrders[0];

    const body = document.getElementById('first-orders-body');
    if (body !== null) body.textContent = scenario.briefingLine;

    document
      .getElementById('first-orders-dismiss')
      ?.addEventListener('click', () => this.dismiss());

    // A player who only watches never issues an order, and the card would sit
    // over his battlefield for the rest of the battle.
    window.setTimeout(() => this.dismiss(), LINGER_MS);
  }

  /** Called when the player issues their first order of any kind. */
  public dismiss(): void {
    if (this.dismissed || this.element === null) return;
    this.dismissed = true;
    this.element.classList.add('leaving');
    window.setTimeout(() => this.element?.remove(), 400);
  }
}
