import { CATEGORY_TOKEN, FORMATION_PROFILES, STANCE_PROFILES, UNIT_STATS } from '../game/config/battle';
import type { ArmyDetails, ArmySummary, ObjectiveReport } from '../game/queries/GameQueries';
import { ZONES } from '../game/simulation/Zones';
import type { TerrainKind } from '../game/config/maps';
import type { ZoneId } from '../game/types/domain';
import { moraleColor } from '../rendering/canvas/palette';
import { iconMarkup } from './icons';

/**
 * The war journal.
 *
 * The right-hand column of the command screen: what the ground under the
 * cursor is worth, what the selected regiment actually is, and what winning
 * looks like. All three used to live either nowhere or as a card drawn onto the
 * battlefield itself, over the ground it was describing.
 *
 * It reads projections and never touches state, and it rebuilds only when
 * something a commander would notice has changed — this runs every frame.
 */

const TERRAIN_NOTES: Record<TerrainKind, string> = {
  open: 'Full march speed. Exposed to missiles and to a cavalry charge.',
  forest: 'Cover. Missiles lose 30%, cavalry loses 28% and moves slowly.',
  hill: 'High ground. Defenders take 18% less, and missiles reach 12% further.',
  village: 'Hard cover. Walls absorb 22%, and cavalry is halved among the houses.',
  crossing: 'A choke point. Columns pass through it fastest, and everything else jams.',
  river: 'Impassable water. Only a marked crossing gets an army over.',
  ridge: 'Impassable rock. Only a marked gap gets an army through.',
};

const TERRAIN_LABEL: Record<TerrainKind, string> = {
  open: 'Open field',
  forest: 'Woodland',
  hill: 'High ground',
  village: 'Village',
  crossing: 'Crossing',
  river: 'River',
  ridge: 'Ridge',
};

export interface JournalView {
  armies: readonly ArmySummary[];
  selection: ReadonlySet<string>;
  hoveredZone: ZoneId | undefined;
  objective: ObjectiveReport;
  /** Resolved lazily, and only for a single selected regiment. */
  detailsFor: (groupId: string) => ArmyDetails | undefined;
}

export class FieldJournal {
  private readonly root = document.getElementById('field-journal');
  private signature = '';

  public update(view: JournalView): void {
    if (this.root === null) return;

    const selected = [...view.selection];
    const single = selected.length === 1 ? selected[0] : undefined;
    const details = single === undefined ? undefined : view.detailsFor(single);

    const signature = [
      selected.length,
      single ?? '',
      details === undefined ? '' : `${details.strength}:${Math.round(details.morale / 2)}:${details.activity}:${details.zone}:${Math.round(details.fatigue / 5)}:${details.formation}:${details.stance}`,
      view.hoveredZone ?? '',
    ].join('|');
    if (signature === this.signature) return;
    this.signature = signature;

    this.root.innerHTML = [
      this.regimentSection(details, selected.length),
      this.groundSection(view.hoveredZone, details),
    ].join('');
  }

  /* ------------------------------------------------------------- regiment */

  private regimentSection(details: ArmyDetails | undefined, selectedCount: number): string {
    if (selectedCount > 1) {
      return section(
        'crown',
        'SELECTED FORCE',
        `<p class="journal-empty">${selectedCount} regiments are under one order. Select a single
         regiment to read its state.</p>`,
      );
    }

    if (details === undefined) {
      return section(
        'crown',
        'REGIMENT',
        `<p class="journal-empty">No regiment selected. Click one on the field, or pick it from
         the roster on the left.</p>`,
      );
    }

    const stats = UNIT_STATS[details.primaryRole];
    const formation = FORMATION_PROFILES[details.formation as keyof typeof FORMATION_PROFILES];
    const stance = STANCE_PROFILES[details.stance as keyof typeof STANCE_PROFILES];
    const flags = [
      details.routing ? ['ROUTING', 'bad'] : undefined,
      details.surrounded ? ['SURROUNDED', 'bad'] : undefined,
      details.crowded ? ['CRUSHED', 'bad'] : undefined,
      details.pinned ? ['IN CONTACT', 'warn'] : undefined,
      details.spent ? ['SPENT', 'warn'] : undefined,
      details.engaged && !details.pinned ? ['ENGAGED', 'warn'] : undefined,
    ].filter((entry): entry is [string, string] => entry !== undefined);

    const body = `
      <div class="unit-head">
        <span class="unit-portrait">${iconMarkup(details.primaryRole)}</span>
        <span class="unit-name">
          <b>${escape(details.name)}</b>
          <small>${escape(stats.label)} · ${CATEGORY_TOKEN[details.primaryRole]}</small>
        </span>
      </div>
      ${flags.length === 0 ? '' : `<div class="unit-flags">${flags
        .map(([label, tone]) => `<span class="flag" data-tone="${tone}">${label}</span>`)
        .join('')}</div>`}
      ${meter('Strength', `${details.strength} / ${details.initialStrength}`, details.strengthPercent, '#5b8ed6')}
      ${meter('Morale', `${Math.round(details.morale)}% · ${escape(details.moraleState)}`, details.morale, moraleColor(details.morale))}
      ${meter('Vigour', `${100 - Math.round(details.fatigue)}%`, 100 - details.fatigue, details.fatigue >= 55 ? '#c8783c' : '#5d7a3a')}
      <dl class="journal-facts">
        <dt>Orders</dt><dd>${escape(details.activity)}</dd>
        <dt>Formation</dt><dd>${escape(formation?.label ?? details.formation)}<small>${escape(formation?.description ?? '')}</small></dd>
        <dt>Stance</dt><dd>${escape(stance?.label ?? details.stance)}<small>${escape(stance?.description ?? '')}</small></dd>
        <dt>Losses</dt><dd>${details.casualties} men</dd>
        <dt>Standing in</dt><dd>${escape(details.zoneName)}</dd>
        ${details.knownThreats.length === 0
          ? ''
          : `<dt>Facing</dt><dd>${escape(details.knownThreats.slice(0, 3).join(', '))}</dd>`}
      </dl>`;

    return section('crown', 'REGIMENT', body);
  }

  /* --------------------------------------------------------------- ground */

  private groundSection(hovered: ZoneId | undefined, details: ArmyDetails | undefined): string {
    const id = hovered ?? details?.zone;
    if (id === undefined) {
      return section(
        'terrain',
        'GROUND',
        '<p class="journal-empty">Move the cursor over the field to read the ground.</p>',
      );
    }

    const zone = ZONES[id];
    const terrain = zone.terrain;
    const body = `
      <div class="ground-head">
        <b>${escape(zone.name)}</b>
        <span class="ground-kind" data-terrain="${terrain}">${TERRAIN_LABEL[terrain].toUpperCase()}</span>
      </div>
      <p class="ground-effect">${escape(TERRAIN_NOTES[terrain])}</p>
      <p class="ground-lore">${escape(zone.description)}</p>
      ${hovered === undefined ? '<p class="journal-hint">Ground your selected regiment is standing on.</p>' : ''}`;

    return section('terrain', 'GROUND', body);
  }

}

/* ------------------------------------------------------------------ markup */

function section(icon: string, title: string, body: string): string {
  return `<section class="journal-block">
    <h2><span class="icon">${iconMarkup(icon)}</span>${title}</h2>
    ${body}
  </section>`;
}

/** A labelled bar. Full is always good, on all three of them. */
function meter(label: string, value: string, percent: number, color: string): string {
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  return `<div class="journal-meter">
    <span class="meter-label">${label}<b>${escape(value)}</b></span>
    <span class="meter-track"><i style="width:${clamped}%;background:${color}"></i></span>
  </div>`;
}

/**
 * Every value on this panel comes from the simulation rather than from a
 * player, but it is written into innerHTML, so it is escaped on the way in.
 */
function escape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
