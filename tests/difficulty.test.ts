import { describe, expect, it } from 'vitest';
import { TICKS_PER_SECOND } from '../src/game/config/battle';
import { DIFFICULTIES, DIFFICULTY_IDS, type DifficultyId } from '../src/game/config/matches';
import {
  ASHEN_ARMY,
  CROWN_ARMY,
  SCENARIOS,
  type ScenarioDefinition,
} from '../src/game/config/scenario';
import { SimulationEngine } from '../src/game/simulation/Engine';
import { activeGroups, findGroup } from '../src/game/simulation/GameState';

/**
 * The three commanders, as three different opponents rather than three clocks.
 *
 * Difficulty used to be timing alone: the same commander, arriving sooner. What
 * is asserted here is that he also *decides* differently — how many regiments he
 * puts on one objective at once, what odds he will accept, and whether he takes
 * a worn regiment out of the line before it is destroyed.
 *
 * The battle is played from a defensive posture rather than a rush. A player who
 * throws everything at the enemy base fights the whole battle on the enemy's own
 * ground, where his commander has no rear to relieve anybody to and nothing to
 * mass against; holding a line is what actually gives him decisions to make.
 */

/** A line in the centre, bows on the hill, and horse held back for the king. */
function deployDefensively(engine: SimulationEngine): void {
  const hold = (groupIds: string[], targetZone: 'central_field' | 'central_hill' | 'player_base'): void => {
    engine.dispatch('human', {
      type: 'order_groups',
      playerId: 'player',
      groupIds,
      order: 'defend_zone',
      targetZone,
    });
  };
  hold(['vanguard', 'ironbacks', 'hedge'], 'central_field');
  hold(['longbows', 'hammers'], 'central_hill');
  hold(['fenmen', 'greyriders', 'lancers'], 'player_base');
}

const FULL_VALE: ScenarioDefinition = {
  ...SCENARIOS.bridge_of_knives,
  id: 'custom',
  origin: 'designed',
  playerGroups: CROWN_ARMY,
  enemyGroups: ASHEN_ARMY,
  aiScript: SCENARIOS.bridge_of_knives.aiScript.filter(
    (order) => order.groupId !== 'cinder_bowmen',
  ),
};

interface Observed {
  /**
   * How often two or more enemy regiments were put onto one objective by a
   * single decision.
   *
   * Counted rather than merely detected, because the scenario's own script also
   * lands several regiments on the same ground at the same second. The script is
   * the same shape for all three commanders, so what separates them is how much
   * more of this there is on top of it.
   */
  massedOrders: number;
  /** Whether any enemy regiment was taken out of the line to rally. */
  relievedWorn: boolean;
}

async function observe(difficultyId: DifficultyId, seed: number, seconds = 420): Promise<Observed> {
  const engine = new SimulationEngine({
    scenarioId: 'custom',
    scenario: FULL_VALE,
    seed,
    difficultyId,
  });
  const state = engine.getState();
  const together = new Map<string, number>();
  let massedOrders = 0;
  let relievedWorn = false;

  deployDefensively(engine);

  for (let tick = 0; tick < TICKS_PER_SECOND * seconds; tick += 1) {
    // Long deterministic battles must occasionally release the worker event
    // loop, otherwise Vitest can mistake healthy CPU work for a dead worker.
    if (tick > 0 && tick % 2_000 === 0) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    engine.step();

    together.clear();
    for (const group of activeGroups(state, 'enemy')) {
      // Orders issued on the tick just simulated, so a standing order is not
      // counted again on every tick it remains in force.
      if (group.order.issuedAtTick !== state.currentTick - 1) continue;
      // A routing regiment is streaming away under its own morale, which is not
      // a decision the commander made.
      if (group.order.kind === 'retreat' && !group.routing) relievedWorn = true;
      if (group.order.kind !== 'attack_zone') continue;
      const zone = group.order.targetZone;
      if (zone === undefined) continue;
      const count = (together.get(zone) ?? 0) + 1;
      together.set(zone, count);
      // Counted on the step from one to two, so a body of four is one decision.
      if (count === 2) massedOrders += 1;
    }

    if (state.objective.outcome !== 'ongoing') break;
  }
  return { massedOrders, relievedWorn };
}

describe('the three commanders', () => {
  it('gives every difficulty a plain tier a first-time player can read', () => {
    const tiers = DIFFICULTY_IDS.map((id) => DIFFICULTIES[id].tier);
    expect(tiers).toEqual(['Easy', 'Medium', 'Hard']);
  });

  it('escalates how many regiments go in together, and how few odds are refused', () => {
    // Ordered rather than fixed, because the absolute figures are balance
    // numbers that get retuned. What must hold is the direction.
    const { levy, captain, warlord } = DIFFICULTIES;

    expect(levy.massedAssault).toBeLessThan(captain.massedAssault);
    expect(captain.massedAssault).toBeLessThan(warlord.massedAssault);

    // A higher ratio is a commander who presses on where a lesser one turns back.
    expect(levy.declineRatio).toBeLessThan(captain.declineRatio);
    expect(captain.declineRatio).toBeLessThan(warlord.declineRatio);
  });

  it('sends a levy in one regiment at a time and a warlord in a body', async () => {
    // The levy answers whatever is nearest each of his regiments, which is how
    // an assault used to walk into a massed defence and die in detail. The
    // warlord picks a point first and puts several regiments on it together.
    const warlord = await observe('warlord', 22);
    const levy = await observe('levy', 22);
    expect(warlord.massedOrders).toBeGreaterThan(levy.massedOrders);
  }, 600_000);

  it('stops calling regiments back once the final push is on', () => {
    // The deadlock this guards against, which froze an untouched Last Light for
    // twenty minutes: the final push sent a spent regiment at the player king,
    // relief ordered it home five seconds later, it walked back, the push sent
    // it out again, and the two orders cycled for the rest of the battle while
    // nothing on the field changed at all. Relief is a mid-battle economy --
    // spare a regiment now, use it later. Once the push is on there is no
    // later, and holding anything back is simply refusing to fight.
    const engine = new SimulationEngine({ difficultyId: 'warlord', seed: 3 });
    const state = engine.getState();
    const difficulty = DIFFICULTIES.warlord;
    const dueTick = Math.round(
      difficulty.finalPushSeconds * difficulty.timelineScale * TICKS_PER_SECOND,
    );

    for (let tick = 0; tick < dueTick; tick += 1) engine.step();

    const group = findGroup(state, 'cinder_host');
    if (group === undefined) throw new Error('missing regiment');

    // Worn past the warlord threshold, out on the western flank where nothing
    // is in contact with it, and nowhere near the muster it would be relieved
    // to: every condition relief looks for. Cut to just under the threshold
    // rather than to nothing, so the regiment is a candidate for relief without
    // being so far gone that it simply breaks and runs on its own.
    const spent = Math.floor(group.initialStrength * 0.2);
    for (const index of group.members.slice(spent)) state.units.kill(index);
    group.members.length = Math.min(group.members.length, spent);
    group.morale = 70;
    group.routing = false;
    group.anchor.x = 1600;
    group.anchor.y = 1400;
    group.path = [];

    engine.dispatch('enemy_ai', {
      type: 'order_groups',
      playerId: 'enemy',
      groupIds: ['cinder_host'],
      order: 'attack_zone',
      targetZone: 'player_base',
    });
    engine.step();
    expect(group.order.kind).toBe('attack_zone');

    // Several reaction intervals, so relief has been evaluated repeatedly. The
    // escalation may well redirect the regiment to different ground in that
    // time; what it must never do is call it off.
    const reaction = Math.round(TICKS_PER_SECOND * difficulty.reactionSeconds);
    for (let tick = 0; tick < reaction * 5; tick += 1) {
      engine.step();
      expect(group.order.kind, `called off on tick ${state.currentTick}`).not.toBe('retreat');
    }
  }, 600_000);

  it('never relieves a regiment until fewer than ten percent remain', async () => {
    expect(DIFFICULTIES.levy.withdrawSpentBelow).toBe(0);
    expect((await observe('levy', 22)).relievedWorn).toBe(false);
    expect(DIFFICULTIES.captain.withdrawSpentBelow).toBe(0.1);
    expect(DIFFICULTIES.warlord.withdrawSpentBelow).toBe(0.1);
  }, 600_000);
});
