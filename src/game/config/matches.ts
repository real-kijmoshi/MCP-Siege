import type { Formation, OrderKind, Stance, ZoneId } from '../types/domain';

export const SCENARIO_IDS = [
  'riverwatch',
  'broken_bridgehead',
  'last_light',
  'cinder_road',
  'ashen_gate',
  'goldmere_fields',
  'the_long_causeway',
] as const;
export type ScenarioId = (typeof SCENARIO_IDS)[number];

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

export interface DifficultyDefinition {
  id: DifficultyId;
  name: string;
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
}

export const DIFFICULTIES: Record<DifficultyId, DifficultyDefinition> = {
  levy: {
    id: 'levy',
    name: 'Levy',
    subtitle: 'Forgiving',
    description:
      'Slower commitments, a narrower response radius, and a commander slow to punish an army ' +
      'that has committed itself. Best for learning command.',
    timelineScale: 1,
    reactionSeconds: 8,
    reactionRadius: 1200,
    kingDefenseRadius: 2100,
    finalPushSeconds: 660,
    opportunismSeconds: 300,
    opportunismConcentration: 0.7,
  },
  captain: {
    id: 'captain',
    name: 'Captain',
    subtitle: 'Intended',
    description: 'The authored battle tempo: alert reactions, firm flanks, and timely relief.',
    timelineScale: 0.74,
    reactionSeconds: 5,
    reactionRadius: 1500,
    kingDefenseRadius: 2600,
    finalPushSeconds: 540,
    opportunismSeconds: 150,
    opportunismConcentration: 0.58,
  },
  warlord: {
    id: 'warlord',
    name: 'Warlord',
    subtitle: 'Relentless',
    description: 'Earlier assaults, rapid reactions, and defenders who coordinate across the rear.',
    timelineScale: 0.55,
    reactionSeconds: 3,
    reactionRadius: 2050,
    kingDefenseRadius: 3400,
    finalPushSeconds: 420,
    opportunismSeconds: 90,
    opportunismConcentration: 0.5,
  },
};

export interface SimulationOptions {
  seed: number;
  scenarioId: ScenarioId;
  difficultyId: DifficultyId;
}

export const DEFAULT_SIMULATION_OPTIONS: SimulationOptions = {
  seed: 20_260_829,
  scenarioId: 'riverwatch',
  difficultyId: 'captain',
};

export function resolveSimulationOptions(
  options: number | Partial<SimulationOptions> | undefined,
): SimulationOptions {
  if (typeof options === 'number') return { ...DEFAULT_SIMULATION_OPTIONS, seed: options };
  return { ...DEFAULT_SIMULATION_OPTIONS, ...options };
}
