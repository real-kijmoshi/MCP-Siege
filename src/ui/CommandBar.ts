import {
  CATEGORY_TOKEN,
  FORMATION_PROFILES,
  STANCE_PROFILES,
  UNIT_STATS,
  describeMatchups,
} from '../game/config/battle';
import type { SimulationEngine } from '../game/simulation/Engine';
import { activeGroups, findGroup, type GameState } from '../game/simulation/GameState';
import { zoneAt } from '../game/simulation/Zones';
import {
  FORMATIONS,
  STANCES,
  UNIT_CATEGORIES,
  type ArmyGroup,
  type Formation,
  type Stance,
  type UnitCategory,
} from '../game/types/domain';

/**
 * The troop type most of a group's men carry.
 *
 * Read straight off the pool rather than through the query layer, because this
 * runs every animation frame and the projections allocate.
 */
const roleTally = new Int32Array(UNIT_CATEGORIES.length);

function primaryRoleOf(state: GameState, group: ArmyGroup): UnitCategory {
  roleTally.fill(0);
  for (const index of group.members) {
    const ordinal = state.units.category[index] ?? 0;
    roleTally[ordinal] = (roleTally[ordinal] ?? 0) + 1;
  }
  let best = 0;
  for (let ordinal = 1; ordinal < roleTally.length; ordinal += 1) {
    if ((roleTally[ordinal] ?? 0) > (roleTally[best] ?? 0)) best = ordinal;
  }
  return UNIT_CATEGORIES[best] as UnitCategory;
}

/**
 * The command row.
 *
 * Every button dispatches the same command the Marshal would send over WebMCP.
 * There is no separate "player-only" path into the simulation.
 */
export class CommandBar {
  private readonly readout = document.getElementById('selection-readout');
  private readonly matchup = document.getElementById('selection-matchup');
  private readonly menu = document.getElementById('formation-menu');
  private readonly stanceMenu = document.getElementById('stance-menu');
  private readonly buttons = new Map<string, HTMLButtonElement>();

  public constructor(
    private readonly engine: SimulationEngine,
    private readonly selection: Set<string>,
    private readonly onResult: (message: string) => void,
  ) {
    for (const button of document.querySelectorAll<HTMLButtonElement>('.commands button')) {
      const command = button.dataset.command;
      if (command === undefined) continue;
      this.buttons.set(command, button);
      button.addEventListener('click', () => this.run(command));
    }

    this.buildFormationMenu();
    this.buildStanceMenu();

    // Any click outside a menu dismisses it.
    document.addEventListener('click', (event) => {
      const target = event.target;
      this.dismissUnlessInside(this.menu, 'formation', target);
      this.dismissUnlessInside(this.stanceMenu, 'stance', target);
    });
  }

  private dismissUnlessInside(
    menu: HTMLElement | null,
    command: string,
    target: EventTarget | null,
  ): void {
    if (menu === null || menu.hidden) return;
    if (
      target instanceof Node &&
      (menu.contains(target) ||
        (target instanceof HTMLElement && target.closest(`[data-command="${command}"]`) !== null))
    ) {
      return;
    }
    menu.hidden = true;
  }

  private buildFormationMenu(): void {
    if (this.menu === null) return;
    this.menu.replaceChildren(
      ...FORMATIONS.map((formation) => {
        const profile = FORMATION_PROFILES[formation];
        const button = document.createElement('button');
        button.type = 'button';
        const label = document.createElement('strong');
        label.textContent = profile.label;
        const description = document.createElement('small');
        description.textContent = profile.description;
        button.append(label, description);
        button.addEventListener('click', () => {
          this.applyFormation(formation);
          this.menu!.hidden = true;
        });
        return button;
      }),
    );
  }

  /**
   * Stance is the third pillar of the tactical model — how far a regiment will
   * leave its ground to chase a fight — and it had no control at all until now,
   * so the only way to change it was through WebMCP.
   */
  private buildStanceMenu(): void {
    if (this.stanceMenu === null) return;
    this.stanceMenu.replaceChildren(
      ...STANCES.map((stance) => {
        const profile = STANCE_PROFILES[stance];
        const button = document.createElement('button');
        button.type = 'button';
        const label = document.createElement('strong');
        label.textContent = profile.label;
        const description = document.createElement('small');
        description.textContent = profile.description;
        button.append(label, description);
        button.addEventListener('click', () => {
          this.applyStance(stance);
          this.stanceMenu!.hidden = true;
        });
        return button;
      }),
    );
  }

  private applyStance(stance: Stance): void {
    const groupIds = this.selected();
    if (groupIds.length === 0) return;
    this.dispatch({ type: 'change_formation', playerId: 'player', groupIds, stance });
  }

  private selected(): string[] {
    return [...this.selection];
  }

  private applyFormation(formation: Formation): void {
    const groupIds = this.selected();
    if (groupIds.length === 0) return;
    this.dispatch({
      type: 'change_formation',
      playerId: 'player',
      groupIds,
      formation,
    });
  }

  private run(command: string): void {
    const groupIds = this.selected();
    if (groupIds.length === 0 && command !== 'formation' && command !== 'stance') return;

    switch (command) {
      case 'formation':
        if (this.stanceMenu !== null) this.stanceMenu.hidden = true;
        if (this.menu !== null && groupIds.length > 0) this.menu.hidden = !this.menu.hidden;
        return;

      case 'stance':
        if (this.menu !== null) this.menu.hidden = true;
        if (this.stanceMenu !== null && groupIds.length > 0) {
          this.stanceMenu.hidden = !this.stanceMenu.hidden;
        }
        return;

      case 'hold':
        this.dispatch({ type: 'order_groups', playerId: 'player', groupIds, order: 'hold' });
        return;

      case 'retreat':
        this.dispatch({ type: 'order_groups', playerId: 'player', groupIds, order: 'retreat' });
        return;

      case 'defend': {
        // Defend the ground the group is standing on.
        const first = findGroup(this.engine.getState(), groupIds[0] ?? '');
        if (first === undefined) return;
        this.dispatch({
          type: 'order_groups',
          playerId: 'player',
          groupIds,
          order: 'defend_zone',
          targetZone: zoneAt(first.anchor.x, first.anchor.y),
        });
        return;
      }

      case 'attack': {
        const target = this.nearestKnownEnemy(groupIds[0] ?? '');
        if (target === undefined) {
          this.onResult('No enemy force is currently known. Scout first.');
          return;
        }
        this.dispatch({
          type: 'order_groups',
          playerId: 'player',
          groupIds,
          order: 'attack_group',
          targetGroupId: target,
        });
        return;
      }

      case 'split': {
        const groupId = groupIds[0];
        if (groupId === undefined) return;
        const source = findGroup(this.engine.getState(), groupId);
        if (source === undefined) return;
        this.dispatch({
          type: 'split_group',
          playerId: 'player',
          groupId,
          percent: 50,
          newGroupName: `${source.name} B`,
        });
        return;
      }

      case 'merge': {
        if (groupIds.length < 2) {
          this.onResult('Select at least two groups to merge.');
          return;
        }
        this.dispatch({ type: 'merge_groups', playerId: 'player', groupIds });
        return;
      }
    }
  }

  /** Nearest enemy the player actually has intelligence on. */
  private nearestKnownEnemy(groupId: string): string | undefined {
    const state = this.engine.getState();
    const group = findGroup(state, groupId);
    if (group === undefined) return undefined;

    let best: string | undefined;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const contact of state.contacts.player.values()) {
      const dx = contact.lastPosition.x - group.anchor.x;
      const dy = contact.lastPosition.y - group.anchor.y;
      const distance = dx * dx + dy * dy;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = contact.groupId;
      }
    }
    return best;
  }

  private dispatch(payload: Parameters<SimulationEngine['dispatch']>[1]): void {
    const command = this.engine.dispatch('human', payload);
    const unsubscribe = this.engine.onCommandResult((issued, result) => {
      if (issued.id !== command.id) return;
      unsubscribe();
      this.onResult(result.ok ? result.summary : result.message);
    });
  }

  /** Enables only the commands that make sense for the current selection. */
  public update(): void {
    const groupIds = this.selected();
    const state = this.engine.getState();

    for (const [command, button] of this.buttons) {
      if (command === 'merge') button.disabled = groupIds.length < 2;
      else if (command === 'split') button.disabled = groupIds.length !== 1;
      else button.disabled = groupIds.length === 0;
    }

    if (this.readout === null) return;
    const label = this.readout.querySelector('small');
    const detail = this.readout.querySelector('b');
    if (label === null || detail === null) return;

    if (groupIds.length === 0) {
      label.textContent = 'NO SELECTION';
      detail.textContent = 'Select a group on the map or in the list';
      this.setMatchup('');
      if (this.menu !== null) this.menu.hidden = true;
      if (this.stanceMenu !== null) this.stanceMenu.hidden = true;
      return;
    }

    const groups = activeGroups(state, 'player').filter((group) => this.selection.has(group.id));
    const men = groups.reduce((sum, group) => sum + group.members.length, 0);

    if (groups.length === 1 && groups[0] !== undefined) {
      const group = groups[0];
      const role = primaryRoleOf(state, group);

      label.textContent = `${group.formation.toUpperCase().replace('_', ' ')} · ${group.stance
        .toUpperCase()
        .replace('_', ' ')}`;
      detail.textContent = `${CATEGORY_TOKEN[role]} ${group.name} — ${men.toLocaleString()} men, ${Math.round(
        group.morale,
      )}% morale`;

      // The one place the counter matrix is spelled out in words. Without it a
      // player can lose a cavalry wing to a spear wall and never learn why.
      this.setMatchup(`${UNIT_STATS[role].label}: ${describeMatchups(role)}`);
    } else {
      label.textContent = `${groups.length} GROUPS SELECTED`;
      detail.textContent = `${men.toLocaleString()} men under orders`;
      this.setMatchup('');
    }
  }

  private setMatchup(text: string): void {
    if (this.matchup === null || this.matchup.textContent === text) return;
    this.matchup.textContent = text;
  }
}
