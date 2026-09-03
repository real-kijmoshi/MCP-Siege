import { FIELD_SUPPORT, UNIT_STATS } from '../config/battle';
import type { ArmyGroup } from '../types/domain';
import { activeGroups, type GameState } from './GameState';

/**
 * Field hospitals.
 *
 * Runs immediately after `Combat`, so it reads the engagement this tick's
 * fighting actually produced, and before `Fatigue` and `Morale`, which both
 * read the care it writes.
 *
 * The pass is deliberately cheap. Care is decided per group against the handful
 * of hospitals on the field, which is a few hundred comparisons over roughly
 * twenty-six records; only the healing itself touches soldiers, and that is
 * strided and skipped entirely for a regiment nobody is tending.
 */

/** Surgeons a group has standing, ignoring one that has broken and run. */
function surgeonsIn(state: GameState, group: ArmyGroup): number {
  if (group.routing) return 0;
  let count = 0;
  for (const index of group.members) {
    if (state.units.categoryOf(index) === 'surgeon') count += 1;
  }
  return count;
}

export function advanceFieldSupport(state: GameState): void {
  const groups = activeGroups(state);

  // Who is carrying surgeons, found once rather than per regiment treated.
  const hospitals: Array<{ group: ArmyGroup; capacity: number }> = [];
  for (const group of groups) {
    const surgeons = surgeonsIn(state, group);
    if (surgeons > 0) {
      hospitals.push({ group, capacity: surgeons * FIELD_SUPPORT.tendedPerSurgeon });
    }
  }

  const reach = FIELD_SUPPORT.radius * FIELD_SUPPORT.radius;

  for (const group of groups) {
    // Nothing can be done for men who are still fighting, and nothing at all
    // for men who are running. Care is what a commander buys by pulling a
    // regiment *out*, so it must never be something he gets by leaving it in.
    if (group.engagement > FIELD_SUPPORT.maximumEngagement || group.routing) {
      group.succour = 0;
      continue;
    }

    let capacity = 0;
    for (const hospital of hospitals) {
      if (hospital.group.ownerId !== group.ownerId) continue;
      const dx = hospital.group.anchor.x - group.anchor.x;
      const dy = hospital.group.anchor.y - group.anchor.y;
      if (dx * dx + dy * dy > reach) continue;
      capacity += hospital.capacity;
    }

    if (capacity <= 0) {
      group.succour = 0;
      continue;
    }

    group.succour = Math.min(1, capacity / Math.max(1, group.members.length));
    tendWounded(state, group);
  }
}

/**
 * Puts the lightly wounded back on their feet.
 *
 * Strided, so the whole system costs a quarter of a pass over the men actually
 * being tended and nothing at all over the rest of the army. The stride is
 * multiplied back into the rate, so how fast a man recovers does not depend on
 * how the work happens to be spread across ticks.
 */
function tendWounded(state: GameState, group: ArmyGroup): void {
  const units = state.units;
  const members = group.members;
  const recovery = FIELD_SUPPORT.healPerTick * FIELD_SUPPORT.healStride * group.succour;

  for (
    let position = state.currentTick % FIELD_SUPPORT.healStride;
    position < members.length;
    position += FIELD_SUPPORT.healStride
  ) {
    const index = members[position];
    if (index === undefined) continue;
    const hp = units.hp[index] ?? 0;
    const ceiling = UNIT_STATS[units.categoryOf(index)].maxHitPoints;
    if (hp >= ceiling) continue;
    const missingShare = Math.max(0, (ceiling - hp) / ceiling);
    const diminishing = Math.max(FIELD_SUPPORT.diminishingRecoveryFloor, missingShare);
    units.hp[index] = Math.min(ceiling, hp + recovery * diminishing);
  }
}
