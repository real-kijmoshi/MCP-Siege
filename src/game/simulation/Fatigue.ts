import { CONTACT, FATIGUE, FIELD_SUPPORT } from '../config/battle';
import { activeGroups, type GameState } from './GameState';

/**
 * Exhaustion.
 *
 * The cheapest system in the game and one of the most load-bearing: it is the
 * reason a reserve is worth holding. Without it a single mass of troops could
 * be committed on the first minute and grind the length of the battle at
 * undiminished strength, so there was never a moment where fresh men mattered
 * more than men already in the line.
 *
 * Like morale it works on the group records rather than on soldiers, so the
 * whole system is a pass over roughly twenty entries.
 */
export function advanceFatigue(state: GameState): void {
  for (const group of activeGroups(state)) {
    // Fighting is what tires men. Measured against the same threshold movement
    // uses for being pinned, so "in contact" means one thing across the engine.
    const pressed = Math.min(1, group.engagement / CONTACT.pinEngagement);
    let delta = pressed * FATIGUE.combatPerTick;

    // Marching costs less than fighting, but it is not free: a regiment
    // recalled the length of the field arrives having spent something.
    const marching = group.routing || group.path.length > 0;
    if (marching) delta += FATIGUE.marchPerTick;

    // Only troops that are both out of contact and standing still recover.
    // Men with surgeons among them recover faster: hot food, dressed wounds and
    // somewhere to lie down are the difference between a regiment that can be
    // sent back in and one that can only be sent home.
    if (pressed < 0.05 && !marching) {
      delta -= FATIGUE.restPerTick + FIELD_SUPPORT.restPerTick * group.succour;
    }

    group.fatigue = Math.max(0, Math.min(1, group.fatigue + delta));
  }
}
