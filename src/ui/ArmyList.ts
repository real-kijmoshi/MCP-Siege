import type { ArmySummary } from '../game/queries/GameQueries';
import { moraleColor } from '../rendering/canvas/palette';

/**
 * The roster.
 *
 * Rebuilt only when something a commander would notice has changed, because
 * replacing this DOM every frame would be both wasteful and visibly janky.
 */
export class ArmyList {
  private readonly body = document.getElementById('army-list-body');
  private signature = '';

  public constructor(private readonly onSelect: (groupId: string, additive: boolean) => void) {}

  public render(armies: readonly ArmySummary[], selection: ReadonlySet<string>): void {
    if (this.body === null) return;

    const signature = armies
      .map(
        (army) =>
          `${army.id}:${army.strength}:${army.activity}:${Math.round(army.morale / 3)}:${
            selection.has(army.id) ? 1 : 0
          }`,
      )
      .join('|');
    if (signature === this.signature) return;
    this.signature = signature;

    this.body.replaceChildren(
      ...armies.map((army) => this.row(army, selection.has(army.id))),
    );
  }

  private row(army: ArmySummary, selected: boolean): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `army-row${selected ? ' selected' : ''}${
      army.moraleState === 'routing' ? ' routing' : ''
    }`;

    const head = document.createElement('div');
    head.className = 'row-head';

    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = army.name;

    const count = document.createElement('span');
    count.className = 'count';
    count.textContent = army.strength.toLocaleString();

    head.append(name, count);

    const activity = document.createElement('div');
    activity.className = 'activity';
    activity.textContent = `${army.activity} · ${army.formation}`;

    const bars = document.createElement('div');
    bars.className = 'bars';
    bars.append(
      this.bar(army.strengthPercent, '#4d9dff', `Strength ${army.strengthPercent}%`),
      this.bar(army.morale, moraleColor(army.morale), `Morale ${army.morale}% (${army.moraleState})`),
    );

    button.append(head, activity, bars);
    button.addEventListener('click', (event) => this.onSelect(army.id, event.shiftKey));
    return button;
  }

  private bar(percent: number, color: string, title: string): HTMLElement {
    const bar = document.createElement('span');
    bar.className = 'bar';
    bar.title = title;
    const fill = document.createElement('i');
    fill.style.width = `${Math.max(0, Math.min(100, percent))}%`;
    fill.style.background = color;
    bar.append(fill);
    return bar;
  }
}
