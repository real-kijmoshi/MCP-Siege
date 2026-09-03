import type { Formation, OrderKind, Stance, ZoneId } from '../types/domain';
import type { ScenarioDefinition } from './scenario';

/**
 * The authored operations.
 *
 * One for each battlefield, and each one a different problem: a trap that has to
 * be sprung at the right moment, an assault through one of two gaps with the
 * other one open behind you, a sovereign stranded on the wrong side of a tidal
 * channel, and a field with no feature on it at all, where both flanks are the
 * commander's own to hold. A fifth kind of battle exists — the one laid on the
 * War Council table, which a Marshal may rewrite through WebMCP — and that one
 * is `custom`.
 */
export const AUTHORED_SCENARIO_IDS = [
  'bridge_of_knives',
  'ember_gate',
  'salt_tide',
  'open_hand',
] as const;
export type AuthoredScenarioId = (typeof AUTHORED_SCENARIO_IDS)[number];

/** An operation is either one of the authored three, or a designed one. */
export type ScenarioId = AuthoredScenarioId | 'custom';

export const DIFFICULTY_IDS = ['levy', 'captain', 'warlord'] as const;
export type DifficultyId = (typeof DIFFICULTY_IDS)[number];

export interface ScriptedAiOrder {
  atSeconds: number;
  groupId: string;
  order: OrderKind;
  targetZone?: ZoneId;
  formation?: Formation;
  stance?: Stance;
}

/** Plain tier, so a player who does not know a levy from a warlord still can. */
export const DIFFICULTY_TIERS = ['Easy', 'Medium', 'Hard'] as const;
export type DifficultyTier = (typeof DIFFICULTY_TIERS)[number];

export interface DifficultyDefinition {
  id: DifficultyId;
  name: string;
  /**
   * Which of the three this is, in the words everyone already knows.
   *
   * The three commanders have always differed, but the lobby offered only their
   * titles, and nothing about "Levy", "Captain" and "Warlord" says which one a
   * first battle should be fought against.
   */
  tier: DifficultyTier;
  subtitle: string;
  description: string;
  timelineScale: number;
  reactionSeconds: number;
  reactionRadius: number;
  kingDefenseRadius: number;
  /**
   * When the enemy commander abandons the line and drives on the player's king.
   *
   * Scaled by `timelineScale` like the rest of the script. Without a last act
   * the two armies simply ground each other down and stopped, and an untouched
   * battle reached twenty minutes with no decision at all.
   */
  finalPushSeconds: number;
  /**
   * When the commander starts looking for an army that has committed itself.
   *
   * The single most effective thing a player could do was to put every regiment
   * he owned onto one crossing and walk through: the defenders there were
   * outnumbered five to one, and nothing on the far side of the field ever
   * noticed. Past this point an enemy that sees the player's weight gathered in
   * one place sends everything clear of the fighting the other way, at the
   * player's own sovereign. Scaled by `timelineScale` like the rest of the arc.
   */
  opportunismSeconds: number;
  /**
   * Share of the player's *sighted* strength that must be standing in one zone
   * before the commander calls it a commitment worth exploiting.
   */
  opportunismConcentration: number;
  /**
   * Odds at which the commander refuses to march onto an objective.
   *
   * Sighted strength on the ground, as a multiple of the regiment being sent at
   * it. A timid commander turns back from a fight he could have won and can be
   * bluffed by a screen; a hard one only declines what is genuinely hopeless,
   * so the player cannot hold a bridge with one regiment and be left alone.
   */
  declineRatio: number;
  /** And an absolute floor, so a weak detachment is still expected to attack. */
  declineMass: number;
  /**
   * How many regiments the commander will put onto one objective at once.
   *
   * This is the difference between an army and a queue. At one, free regiments
   * each answer whatever contact is nearest them, which is how a scripted
   * assault walked into a massed defence a regiment at a time and died in
   * detail — the single most exploitable thing the enemy did. Above one, the
   * commander picks a point and sends several together.
   */
  massedAssault: number;
  /**
   * Share of its original strength below which a regiment is worn out, and is
   * rotated to the rear rather than left standing in the line.
   *
   * Deliberately well above the point of collapse. A regiment that has actually
   * been broken is already routing, and a routing regiment takes no orders from
   * anybody — so a threshold set at the edge of destruction would describe a
   * behaviour that could never fire. This is the commander relieving a tired
   * regiment while it is still worth relieving. Zero for one who never does.
   */
  withdrawSpentBelow: number;
}

export const DIFFICULTIES: Record<DifficultyId, DifficultyDefinition> = {
  levy: {
    id: 'levy',
    name: 'Levy',
    tier: 'Easy',
    subtitle: 'Forgiving',
    description:
      'Commits slowly, answers only what is close, and feeds his regiments in one at a time. ' +
      'He calls off an attack at odds he could have beaten and leaves the broken ones standing. ' +
      'Best for learning command.',
    timelineScale: 1,
    reactionSeconds: 8,
    reactionRadius: 1200,
    kingDefenseRadius: 2100,
    finalPushSeconds: 660,
    opportunismSeconds: 300,
    opportunismConcentration: 0.7,
    declineRatio: 1.8,
    declineMass: 700,
    massedAssault: 1,
    withdrawSpentBelow: 0,
  },
  captain: {
    id: 'captain',
    name: 'Captain',
    tier: 'Medium',
    subtitle: 'Intended',
    description:
      'The authored battle tempo. Alert reactions, firm flanks and timely relief, assaults ' +
      'delivered by a pair of regiments rather than one, and spent troops rotated to the rear.',
    timelineScale: 0.74,
    reactionSeconds: 5,
    reactionRadius: 1500,
    kingDefenseRadius: 2600,
    finalPushSeconds: 540,
    opportunismSeconds: 150,
    opportunismConcentration: 0.58,
    declineRatio: 3.5,
    declineMass: 1400,
    massedAssault: 2,
    withdrawSpentBelow: 0.4,
  },
  warlord: {
    id: 'warlord',
    name: 'Warlord',
    tier: 'Hard',
    subtitle: 'Relentless',
    description:
      'Earlier assaults, rapid reactions and defenders who coordinate across the rear. He ' +
      'masses three regiments on a point before he attacks it, presses odds a lesser commander ' +
      'would refuse, and pulls his broken regiments back to rally and come again.',
    timelineScale: 0.55,
    reactionSeconds: 3,
    reactionRadius: 2050,
    kingDefenseRadius: 3400,
    finalPushSeconds: 420,
    opportunismSeconds: 90,
    opportunismConcentration: 0.5,
    declineRatio: 5,
    declineMass: 2200,
    massedAssault: 3,
    withdrawSpentBelow: 0.55,
  },
};

export interface SimulationOptions {
  seed: number;
  scenarioId: ScenarioId;
  difficultyId: DifficultyId;
  /**
   * The operation to fight, in full.
   *
   * Authored operations are looked up from `scenarioId`; a designed one has no
   * entry to look up, so it is carried here. Either way the engine copies it
   * into its own state, which is what keeps two battles in one process — one
   * authored, one designed by a Marshal — from reading each other's script.
   */
  scenario?: ScenarioDefinition;
}

export const DEFAULT_SIMULATION_OPTIONS: SimulationOptions = {
  seed: 20_260_829,
  scenarioId: 'bridge_of_knives',
  difficultyId: 'captain',
};

export function resolveSimulationOptions(
  options: number | Partial<SimulationOptions> | undefined,
): SimulationOptions {
  if (typeof options === 'number') return { ...DEFAULT_SIMULATION_OPTIONS, seed: options };
  return { ...DEFAULT_SIMULATION_OPTIONS, ...options };
}

