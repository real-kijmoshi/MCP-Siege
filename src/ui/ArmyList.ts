import { CATEGORY_TOKEN, UNIT_STATS } from '../game/config/battle';
import type { ArmySummary } from '../game/queries/GameQueries';
import { moraleColor } from '../rendering/canvas/palette';
import { iconMarkup } from './icons';

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
  private filter: 'all' | 'attention' = 'all';
  private query = '';

  public constructor(
    private readonly onSelect: (groupId: string, additive: boolean) => void,
    private readonly onFocus: (groupId: string) => void = () => {},
  ) {
    const search = document.getElementById('army-search');
    if (search instanceof HTMLInputElement) {
      search.addEventListener('input', () => {
        this.query = search.value.trim().toLocaleLowerCase();
        this.signature = '';
      });
    }

    document.getElementById('army-search-clear')?.addEventListener('click', () => {
      if (!(search instanceof HTMLInputElement)) return;
      search.value = '';
      this.query = '';
      this.signature = '';
      search.focus();
    });

    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-army-filter]')) {
      button.addEventListener('click', () => {
        this.filter = button.dataset.armyFilter === 'attention' ? 'attention' : 'all';
        for (const other of document.querySelectorAll<HTMLButtonElement>('[data-army-filter]')) {
          const selected = other === button;
          other.classList.toggle('active', selected);
          other.setAttribute('aria-pressed', String(selected));
        }
        this.signature = '';
      });
    }
  }

  public render(armies: readonly ArmySummary[], selection: ReadonlySet<string>): void {
    if (this.body === null) return;

    const signature = `${this.filter}:${this.query}|` + armies
      .map(
        (army) =>
          `${army.id}:${army.strength}:${army.activity}:${Math.round(army.morale / 3)}:${
            army.engaged ? 'e' : '-'
          }:${army.surrounded ? 's' : '-'}:${army.pinned ? 'p' : '-'}:${
            army.crowded ? 'c' : '-'
          }:${army.limbered ? 'l' : '-'}:${army.tended ? 't' : '-'}:${
            Math.round(army.fatigue / 10)
          }:${selection.has(army.id) ? 1 : 0}`,
      )
      .join('|');
    if (signature === this.signature) return;
    this.signature = signature;

    const focusedGroupId =
      document.activeElement instanceof HTMLElement
        ? document.activeElement.closest<HTMLButtonElement>('.army-row')?.dataset.groupId
        : undefined;
    const visible = armies.filter((army) => this.isVisible(army));
    const rows = visible.map((army) => this.row(army, selection.has(army.id)));
    this.body.replaceChildren(...(rows.length > 0 ? rows : [this.emptyState()]));
    if (focusedGroupId !== undefined) {
      for (const row of this.body.querySelectorAll<HTMLButtonElement>('.army-row')) {
        if (row.dataset.groupId === focusedGroupId) row.focus({ preventScroll: true });
      }
    }

    // How much of the army is still standing, next to the heading, so the size of
    // the roster is not something the commander has to count.
    if (this.count !== null) {
      const men = armies.reduce((total, army) => total + army.strength, 0);
      this.count.textContent =
        visible.length === armies.length
          ? `${armies.length} · ${men.toLocaleString()}`
          : `${visible.length}/${armies.length} · ${men.toLocaleString()}`;
      this.count.title = `${visible.length} shown of ${armies.length} regiments, ${men.toLocaleString()} men total`;
    }
  }

  private isVisible(army: ArmySummary): boolean {
    const matchesQuery =
      this.query.length === 0 ||
      army.name.toLocaleLowerCase().includes(this.query) ||
      army.zoneName.toLocaleLowerCase().includes(this.query) ||
      UNIT_STATS[army.primaryRole].label.toLocaleLowerCase().includes(this.query) ||
      CATEGORY_TOKEN[army.primaryRole].toLocaleLowerCase().includes(this.query);
    if (!matchesQuery) return false;
    if (this.filter === 'all') return true;
    return (
      army.engaged ||
      army.surrounded ||
      army.pinned ||
      army.crowded ||
      army.spent ||
      army.moraleState === 'routing'
    );
  }

  private emptyState(): HTMLElement {
    const empty = document.createElement('div');
    empty.className = 'army-empty';
    empty.innerHTML = '<b>No regiments match</b><span>Clear the search or show all groups.</span>';
    return empty;
  }

  private row(army: ArmySummary, selected: boolean): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `army-row${selected ? ' selected' : ''}${
      army.moraleState === 'routing' ? ' routing' : ''
    }${army.engaged ? ' engaged' : ''}`;
    button.dataset.groupId = army.id;
    button.dataset.role = army.primaryRole;
    button.setAttribute('aria-pressed', String(selected));
    button.title = `${UNIT_STATS[army.primaryRole].label} · ${army.zoneName}\nDouble-click to centre the camera.`;

    const head = document.createElement('div');
    head.className = 'row-head';

    // The troop type as a silhouette first and three letters second. A player
    // who has not yet learned the abbreviations can still read the roster.
    const role = document.createElement('span');
    role.className = 'role';
    role.innerHTML = iconMarkup(army.primaryRole);
    const token = document.createElement('i');
    token.textContent = CATEGORY_TOKEN[army.primaryRole];
    role.append(token);

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

    // Guns on the road are not guns. This is the single easiest thing to get
    // wrong with a battery and the only thing on the roster that says so.
    if (army.limbered) {
      const limbered = document.createElement('span');
      limbered.className = 'contact limbered';
      limbered.textContent = 'LIMBERED';
      limbered.title =
        'The guns are on their teams and cannot fire. They need a few seconds standing ' +
        'still before they will shoot at anything.';
      activity.append(' ', limbered);
    } else if (army.tended) {
      const tended = document.createElement('span');
      tended.className = 'contact tended';
      tended.textContent = 'TENDED';
      tended.title =
        'A field hospital is within reach. Left out of contact these men recover their ' +
        'wounded, their wind and their nerve far faster than they would alone.';
      activity.append(' ', tended);
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

