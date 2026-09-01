import { CATEGORY_TOKEN, UNIT_STATS } from '../game/config/battle';
import type { ArmySummary } from '../game/queries/GameQueries';
import { moraleColor } from '../rendering/canvas/palette';

/**
 * The roster.
 *
 * Rebuilt only when something a commander would notice has changed, because
 * replacing this DOM every frame would be both wasteful and visibly janky.
 *
 * Every row leads with the troop type. "Legion I" tells a commander nothing he
 * can act on; "HVY Legion I" tells him not to send it after cavalry.
 */
export class ArmyList {
  private readonly body = document.getElementById('army-list-body');
  private readonly count = document.getElementById('army-list-count');
  private signature = '';

  public constructor(
    private readonly onSelect: (groupId: string, additive: boolean) => void,
    private readonly onFocus: (groupId: string) => void = () => {},
  ) {}

  public render(armies: readonly ArmySummary[], selection: ReadonlySet<string>): void {
    if (this.body === null) return;

    const signature = armies
      .map(
        (army) =>
          `${army.id}:${army.strength}:${army.activity}:${Math.round(army.morale / 3)}:${
            army.engaged ? 'e' : '-'
          }:${army.surrounded ? 's' : '-'}:${army.pinned ? 'p' : '-'}:${
            army.crowded ? 'c' : '-'
          }:${Math.round(army.fatigue / 10)}:${selection.has(army.id) ? 1 : 0}`,
      )
      .join('|');
    if (signature === this.signature) return;
    this.signature = signature;

    this.body.replaceChildren(...armies.map((army) => this.row(army, selection.has(army.id))));

    // How much of the army is still standing, next to the heading, so the size of
    // the roster is not something the commander has to count.
    if (this.count !== null) {
      const men = armies.reduce((total, army) => total + army.strength, 0);
      this.count.textContent = `${armies.length} · ${men.toLocaleString()}`;
      this.count.title = `${armies.length} regiments, ${men.toLocaleString()} men`;
    }
  }

  private row(army: ArmySummary, selected: boolean): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `army-row${selected ? ' selected' : ''}${
      army.moraleState === 'routing' ? ' routing' : ''
    }${army.engaged ? ' engaged' : ''}`;
    button.dataset.role = army.primaryRole;
    button.title = `${UNIT_STATS[army.primaryRole].label} · ${army.zoneName}\nDouble-click to centre the camera.`;

    const head = document.createElement('div');
    head.className = 'row-head';

    const role = document.createElement('span');
    role.className = 'role';
    role.textContent = CATEGORY_TOKEN[army.primaryRole];

    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = army.name;

    const count = document.createElement('span');
    count.className = 'count';
    count.textContent = army.strength.toLocaleString();

    head.append(role, name, count);

    const activity = document.createElement('div');
    activity.className = 'activity';
    activity.textContent = `${army.activity} · ${army.formation.replace('_', ' ')}`;

    // What is happening to the formation right now, which the activity line —
    // it reports the order it was given — cannot say. Being surrounded kills a
    // regiment faster than anything else on the field, and a commander reading
    // a roster of a dozen names needs to find that one at a glance.
    if (army.surrounded || army.pinned) {
      const contact = document.createElement('span');
      contact.className = army.surrounded ? 'contact surrounded' : 'contact pinned';
      contact.textContent = army.surrounded ? 'SURROUNDED' : 'IN CONTACT';
      contact.title = army.surrounded
        ? 'Attacked from more quarters than the formation can face. It will come apart quickly.'
        : 'Held in melee. This formation cannot march away until the fight is settled.';
      activity.append(' ', contact);
    }

    // The two conditions a commander can actually fix, and which are invisible
    // on a strength bar: men with no room to swing, and men with nothing left.
    // Both are the price of pushing everything through one place at once.
    if (army.crowded) {
      const crush = document.createElement('span');
      crush.className = 'contact crushed';
      crush.textContent = 'CRUSHED';
      crush.title =
        'Packed too tightly to fight. Send fewer regiments through this ground at once, ' +
        'or spread into loose order.';
      activity.append(' ', crush);
    } else if (army.spent) {
      const spent = document.createElement('span');
      spent.className = 'contact spent';
      spent.textContent = 'SPENT';
      spent.title =
        'Exhausted. These men hit softer and give ground more easily; relieve them with a ' +
        'fresh regiment and let them rest out of contact.';
      activity.append(' ', spent);
    }

    const bars = document.createElement('div');
    bars.className = 'bars';
    bars.append(
      this.bar(army.strengthPercent, '#4d9dff', `Strength ${army.strengthPercent}%`),
      this.bar(army.morale, moraleColor(army.morale), `Morale ${army.morale}% (${army.moraleState})`),
      // Read as how much fight is left in the men rather than how tired they
      // are, so all three bars mean the same thing: full is good.
      this.bar(
        100 - army.fatigue,
        army.fatigue >= 55 ? '#c8783c' : '#7c8d6a',
        `Vigour ${100 - army.fatigue}% (fatigue ${army.fatigue}%)`,
      ),
    );

    button.append(head, activity, bars);
    button.addEventListener('click', (event) => this.onSelect(army.id, event.shiftKey));
    button.addEventListener('dblclick', () => this.onFocus(army.id));
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
