import { TICKS_PER_SECOND } from '../config/battle';
import type { BattleAlert } from '../types/domain';
import type { ArmySummary, EnemyContactView, ObjectiveSummary, ZoneReport } from './GameQueries';

/**
 * What changed while the Marshal was thinking.
 *
 * Every read the game offers is a snapshot, and a commander who can only ever
 * ask "how is it now" has to hold the previous answer in his head and diff it
 * himself — over twenty regiments, four fronts and a dozen zones, across a
 * thirty-second gap in which a wing can be lost. This takes two projections
 * and reports the difference, so the answer to "what happened" is a short list
 * of what actually moved rather than a second full picture to re-read.
 *
 * It works entirely on projections that have already been through the fog, so
 * it can never report a change on something the commanding side cannot see.
 */

export interface BattleSnapshot {
  tick: number;
  armies: readonly ArmySummary[];
  zones: readonly ZoneReport[];
  contacts: readonly EnemyContactView[];
  alerts: readonly BattleAlert[];
  objective: ObjectiveSummary;
}

export interface GroupChange {
  groupId: string;
  name: string;
  /** Men lost, negative when a group was reinforced. */
  losses: number;
  moraleChange: number;
  zoneName: string;
  /** Conditions that came true while you were away, in plain words. */
  became: string[];
  /** Conditions that stopped being true. */
  recovered: string[];
}

export interface ChangeDigest {
  elapsedSeconds: number;
  groups: GroupChange[];
  destroyed: string[];
  raised: string[];
  zones: Array<{ zone: string; name: string; from: string; to: string }>;
  newContacts: Array<{ groupId: string; name: string; zoneName: string; estimatedStrength: number }>;
  lostSight: string[];
  alerts: string[];
  objectiveChanges: string[];
  /** True when nothing in the battle moved enough to be worth reporting. */
  quiet: boolean;
  summary: string;
}

/** Flags worth reporting the moment they flip, in the order a commander reads them. */
const FLAGS: Array<{ key: keyof ArmySummary; became: string; recovered: string }> = [
  { key: 'surrounded', became: 'surrounded', recovered: 'no longer surrounded' },
  { key: 'engaged', became: 'in contact', recovered: 'out of contact' },
  { key: 'pinned', became: 'pinned', recovered: 'free to march' },
  { key: 'crowded', became: 'crushed together', recovered: 'given room' },
  { key: 'spent', became: 'spent', recovered: 'rested' },
  { key: 'masked', became: 'masked, and no longer shooting', recovered: 'given a clear lane' },
  { key: 'limbered', became: 'limbered and unable to fire', recovered: 'unlimbered and firing' },
  { key: 'tended', became: 'under care', recovered: 'no longer being tended' },
];

/** Morale movement below this is noise from one exchange of blows. */
const MORALE_NOISE = 4;

export function describeChanges(before: BattleSnapshot, after: BattleSnapshot): ChangeDigest {
  const previous = new Map(before.armies.map((army) => [army.id, army]));
  const current = new Map(after.armies.map((army) => [army.id, army]));

  const groups: GroupChange[] = [];
  for (const army of after.armies) {
    const was = previous.get(army.id);
    if (was === undefined) continue;

    const losses = was.strength - army.strength;
    const moraleChange = army.morale - was.morale;
    const became: string[] = [];
    const recovered: string[] = [];

    for (const flag of FLAGS) {
      const before_ = was[flag.key] === true;
      const now = army[flag.key] === true;
      if (now && !before_) became.push(flag.became);
      else if (before_ && !now) recovered.push(flag.recovered);
    }
    if (army.moraleState === 'routing' && was.moraleState !== 'routing') became.push('broken and routing');
    if (was.moraleState === 'routing' && army.moraleState !== 'routing') recovered.push('rallied');
    if (army.zone !== was.zone) became.push(`arrived at ${army.zoneName}`);

    const worthReporting =
      losses !== 0 ||
      Math.abs(moraleChange) >= MORALE_NOISE ||
      became.length > 0 ||
      recovered.length > 0;
    if (!worthReporting) continue;

    groups.push({
      groupId: army.id,
      name: army.name,
      losses,
      moraleChange,
      zoneName: army.zoneName,
      became,
      recovered,
    });
  }

  // Heaviest losses first: a commander reads a change report to find the wound.
  groups.sort((a, b) => b.losses - a.losses || a.groupId.localeCompare(b.groupId));

  const destroyed = before.armies
    .filter((army) => !current.has(army.id))
    .map((army) => `${army.name} has been destroyed.`);
  const raised = after.armies
    .filter((army) => !previous.has(army.id))
    .map((army) => `${army.name} has taken the field.`);

  const previousZones = new Map(before.zones.map((zone) => [zone.id, zone.control]));
  const zones = after.zones
    .filter((zone) => previousZones.get(zone.id) !== undefined && previousZones.get(zone.id) !== zone.control)
    .map((zone) => ({
      zone: zone.id,
      name: zone.name,
      from: previousZones.get(zone.id) ?? 'unknown',
      to: zone.control,
    }));

  const knownBefore = new Set(before.contacts.map((contact) => contact.groupId));
  const visibleBefore = new Set(
    before.contacts.filter((contact) => contact.visibleNow).map((contact) => contact.groupId),
  );
  const newContacts = after.contacts
    .filter((contact) => !knownBefore.has(contact.groupId))
    .map((contact) => ({
      groupId: contact.groupId,
      name: contact.name,
      zoneName: contact.zoneName,
      estimatedStrength: contact.estimatedStrength,
    }));
  const lostSight = after.contacts
    .filter((contact) => !contact.visibleNow && visibleBefore.has(contact.groupId))
    .map((contact) => `${contact.name} is no longer in sight; last seen at ${contact.zoneName}.`);

  const seen = new Set(before.alerts.map((alert) => alert.id));
  const alerts = after.alerts
    .filter((alert) => !seen.has(alert.id))
    .map((alert) => alert.message);

  const objectiveChanges: string[] = [];
  if (after.objective.yourKing !== before.objective.yourKing) {
    objectiveChanges.push(after.objective.yourKing);
  }
  if (after.objective.enemyKing !== before.objective.enemyKing) {
    objectiveChanges.push(after.objective.enemyKing);
  }
  if (after.objective.outcome !== before.objective.outcome) {
    objectiveChanges.push(`The battle is decided: ${after.objective.outcome}.`);
  }

  const digest: ChangeDigest = {
    elapsedSeconds: Math.round((after.tick - before.tick) / TICKS_PER_SECOND),
    groups,
    destroyed,
    raised,
    zones,
    newContacts,
    lostSight,
    alerts,
    objectiveChanges,
    quiet: false,
    summary: '',
  };

  digest.quiet =
    groups.length === 0 &&
    destroyed.length === 0 &&
    raised.length === 0 &&
    zones.length === 0 &&
    newContacts.length === 0 &&
    lostSight.length === 0 &&
    alerts.length === 0 &&
    objectiveChanges.length === 0;

  const parts: string[] = [];
  const bled = groups.reduce((sum, group) => sum + Math.max(0, group.losses), 0);
  if (bled > 0) parts.push(`${bled} men lost`);
  if (destroyed.length > 0) parts.push(`${destroyed.length} regiment(s) destroyed`);
  if (zones.length > 0) parts.push(`${zones.length} zone(s) changed hands`);
  if (newContacts.length > 0) parts.push(`${newContacts.length} new contact(s)`);
  const broke = groups.filter((group) => group.became.includes('broken and routing')).length;
  if (broke > 0) parts.push(`${broke} regiment(s) broke`);

  digest.summary =
    parts.length === 0
      ? `${digest.elapsedSeconds}s passed and nothing changed worth reporting.`
      : `In ${digest.elapsedSeconds}s: ${parts.join(', ')}.`;

  return digest;
}
