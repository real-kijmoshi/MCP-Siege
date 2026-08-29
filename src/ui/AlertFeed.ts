import type { BattleAlert } from '../game/types/domain';

/**
 * Transient strategic alerts.
 *
 * Deliberately ephemeral: alerts surface a situation and then get out of the
 * way. The durable copy lives in `get_alerts`, which is where the Marshal reads
 * them anyway.
 */
export class AlertFeed {
  private readonly container = document.getElementById('alert-feed');
  private readonly shown = new Set<string>();

  public push(alerts: readonly BattleAlert[]): void {
    if (this.container === null) return;

    // Alerts arrive newest-first; show them oldest-first so the feed reads down.
    for (const alert of [...alerts].reverse()) {
      if (this.shown.has(alert.id)) continue;
      this.shown.add(alert.id);

      const element = document.createElement('div');
      element.className = `alert ${alert.severity}`;
      element.textContent = alert.message;
      this.container.append(element);

      window.setTimeout(() => {
        element.style.transition = 'opacity 0.4s';
        element.style.opacity = '0';
        window.setTimeout(() => element.remove(), 400);
      }, alert.severity === 'critical' ? 9000 : 6000);

      // Never let a burst of events cover the battlefield.
      while (this.container.childElementCount > 6) this.container.firstElementChild?.remove();
    }

    if (this.shown.size > 200) this.shown.clear();
  }
}

/** One-line confirmation of an order, including orders the Marshal issued. */
export class Toast {
  private readonly element = document.getElementById('toast');
  private timer: number | undefined;

  public show(message: string, fromMarshal = false): void {
    if (this.element === null) return;
    this.element.textContent = fromMarshal ? `MARSHAL · ${message}` : message;
    this.element.classList.toggle('marshal', fromMarshal);
    this.element.classList.add('visible');

    if (this.timer !== undefined) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.element?.classList.remove('visible');
    }, fromMarshal ? 5200 : 3200);
  }
}
