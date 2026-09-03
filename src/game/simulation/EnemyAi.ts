import { TICKS_PER_SECOND } from '../config/battle';
import { DIFFICULTIES, type ScriptedAiOrder } from '../config/matches';
import type { GameCommandPayload, OrderGroupsPayload } from '../commands/types';
import type { ArmyGroup, ZoneId } from '../types/domain';
import { raiseAlert } from './Alerts';
import { activeGroups, findGroup, type GameState } from './GameState';
import { ZONES, activeZoneIds, homeZoneOf, zoneAt } from './Zones';

/**
 * The opposing commander.
 *
 * A scripted escalation gives the scenario its shape, and a light reactive
 * layer keeps it from feeling like a cutscene. Everything it does is submitted
 * as an ordinary command, so the enemy plays by exactly the same rules.
 */

/**
 * The guard is seated with its king on the opening tick and does not leave.
 *
 * Which regiment that is comes from the objective rather than a written id, so
 * an operation designed through the War Council tools seats its own guard.
 */
function guardOrder(state: GameState): ScriptedAiOrder {
  return {
    atSeconds: 1,
    groupId: state.objective.kings.enemy.guardGroupId,
    order: 'defend_zone',
    targetZone: homeZoneOf('enemy').id,
    formation: 'square',
    stance: 'hold_ground',
  };
}

function scriptedThisTick(state: GameState): GameCommandPayload[] {
  const commands: GameCommandPayload[] = [];
  const difficulty = DIFFICULTIES[state.difficultyId];
  const script = state.scenario.aiScript;
  for (const entry of [guardOrder(state), ...script]) {
    // Fires on exactly the tick it comes due, so the script never repeats.
    const dueTick = Math.round(entry.atSeconds * difficulty.timelineScale * TICKS_PER_SECOND);
    if (state.currentTick !== dueTick) continue;
    const group = findGroup(state, entry.groupId);
    if (group === undefined || group.members.length === 0) continue;

    const payload: OrderGroupsPayload = {
      type: 'order_groups',
      playerId: 'enemy',
      groupIds: [entry.groupId],
      order: entry.order,
    };
    if (entry.targetZone !== undefined) payload.targetZone = entry.targetZone;
    if (entry.formation !== undefined) payload.formation = entry.formation;
    if (entry.stance !== undefined) payload.stance = entry.stance;
    commands.push(payload);
  }
  return commands;
}

/**
 * Whether a regiment is free to be given something new to do.
 *
 * Being "idle" is not enough. A group that was sent to storm a bridge keeps
 * `attack_zone` as its order for the rest of the battle, so once its assault
 * ended it was never considered again — which is precisely why an untouched
 * battle used to grind to a halt at half strength and simply stay there. A
 * group that has arrived, has no waypoints left, and is not currently in
 * contact has finished its orders whatever they nominally still say.
 */
function hasFinishedItsOrders(state: GameState, group: ArmyGroup): boolean {
  if (group.order.kind === 'idle' || group.order.kind === 'hold') return true;
  if (group.path.length > 0) return false;
  // Still fighting where it was sent: leave it alone.
  if (
    group.lastCasualtyTick >= 0 &&
    state.currentTick - group.lastCasualtyTick < TICKS_PER_SECOND * 6
  ) {
    return false;
  }
  // And give every order a moment to take effect before reconsidering it.
  return state.currentTick - group.order.issuedAtTick > TICKS_PER_SECOND * 8;
}

/** Regiments the commander will not redirect, whatever the situation. */
function isCommitted(state: GameState, group: ArmyGroup): boolean {
  if (group.routing) return true;
  if (group.id === state.objective.kings.enemy.guardGroupId) return true;
  // The trains are committed by the script alone. None of them belongs in a
  // reactive assault: a gun sent to answer a contact arrives limbered and fires
  // at nothing, and a hospital sent anywhere near one is simply given away.
  return group.members.some((index) => {
    const category = state.units.categoryOf(index);
    return category === 'siege' || category === 'cannon' || category === 'surgeon';
  });
}

/**
 * Sighted player strength by zone. Module-level scratch, fully rebuilt by
 * `refreshSighting` before every read, so reading the whole contact book costs
 * no allocation per evaluation and nothing carries between ticks.
 */
const sightedByZone = new Map<ZoneId, number>();
/** Everything in it, summed. Written by the same pass. */
let sightedTotal = 0;

/** Rebuilds the sighting scratch from the enemy's own contact book. */
function refreshSighting(state: GameState): void {
  sightedByZone.clear();
  sightedTotal = 0;
  for (const contact of state.contacts.enemy.values()) {
    if (!contact.visibleNow) continue;
    const zone = contact.lastSeenZone;
    sightedByZone.set(zone, (sightedByZone.get(zone) ?? 0) + contact.estimatedStrength);
    sightedTotal += contact.estimatedStrength;
  }
}

/**
 * Ground the commander will not march a regiment onto.
 *
 * An army that could be counted on to attack whatever was in front of it was an
 * army the player could farm: gather everything at one bridge, and the scripted
 * assault walked into it a regiment at a time and died. A commander who can see
 * several times his own numbers standing on the objective does not send his men
 * into them — he halts where he is and looks for somewhere else to be.
 *
 * How steep the odds must be before he says so is the clearest thing that
 * separates the three commanders. A levy turns back from a fight he could have
 * won, so a thin screen bluffs him; a warlord presses on until the odds are
 * genuinely hopeless, so a bridge cannot be held by one regiment and forgotten.
 * Both thresholds matter: the ratio alone would call off an attack on two men,
 * and the floor alone would send a scout into an army.
 */
function isHopeless(state: GameState, zone: ZoneId, ownStrength: number): boolean {
  const difficulty = DIFFICULTIES[state.difficultyId];
  const facing = sightedByZone.get(zone) ?? 0;
  return facing >= difficulty.declineMass && facing >= ownStrength * difficulty.declineRatio;
}

/**
 * Calling off an assault that has become hopeless.
 *
 * Only a march is ever called off, never a fight already joined: a regiment
 * that has arrived and is in contact has nothing to gain by turning its back.
 * It halts and holds the ground it is standing on rather than streaming home,
 * so refusing an attack does not hand the field away.
 */
function declineHopelessAssaults(state: GameState): GameCommandPayload[] {
  const commands: GameCommandPayload[] = [];
  for (const group of activeGroups(state, 'enemy')) {
    if (isCommitted(state, group)) continue;
    if (group.order.kind !== 'attack_zone' && group.order.kind !== 'move') continue;
    const target = group.order.targetZone;
    if (target === undefined) continue;
    // Still on the road. Once it has arrived, this is a battle, not a plan.
    if (group.path.length === 0 || group.engagement > 0) continue;
    if (!isHopeless(state, target, group.members.length)) continue;

    commands.push({
      type: 'order_groups',
      playerId: 'enemy',
      groupIds: [group.id],
      order: 'defend_zone',
      targetZone: zoneAt(group.anchor.x, group.anchor.y),
    });
  }
  return commands;
}

/**
 * Regiments the commander is free to give something new to do this cycle.
 *
 * Returned in `state.groups` order, which is the map's authored order and never
 * depends on what was seen first, so every assignment below it is deterministic.
 */
function freeRegiments(state: GameState): ArmyGroup[] {
  const guardId = state.objective.kings.enemy.guardGroupId;
  const free: ArmyGroup[] = [];
  for (const group of activeGroups(state, 'enemy')) {
    // The Royal Guard stands over its king whatever else is happening.
    if (group.id === guardId) continue;
    if (isCommitted(state, group)) continue;
    if (!hasFinishedItsOrders(state, group)) continue;
    free.push(group);
  }
  return free;
}

/** Squared distance from a regiment's anchor to a zone centre. */
function distanceToZone(group: ArmyGroup, zone: ZoneId): number {
  const center = ZONES[zone].center;
  const dx = center.x - group.anchor.x;
  const dy = center.y - group.anchor.y;
  return dx * dx + dy * dy;
}

/**
 * The regiments nearest a zone that could be sent to it this cycle.
 *
 * Ranked by distance and then by id, so which regiments go is fixed by the
 * state of the battle and never by iteration order. Only what is within the
 * commander's response radius is considered: an assault assembled from the far
 * side of the map is a plan on paper and a straggle in practice.
 */
function nearestAvailable(
  state: GameState,
  free: readonly ArmyGroup[],
  zone: ZoneId,
  limit: number,
): ArmyGroup[] {
  const difficulty = DIFFICULTIES[state.difficultyId];
  const reach = difficulty.reactionRadius * difficulty.reactionRadius;
  return free
    .filter((group) => distanceToZone(group, zone) <= reach)
    .sort((a, b) => {
      const gap = distanceToZone(a, zone) - distanceToZone(b, zone);
      if (Math.abs(gap) > 0.001) return gap;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    })
    .slice(0, limit);
}

/** A zone worth massing on, with the regiments the commander would send. */
interface Assault {
  zone: ZoneId;
  groups: ArmyGroup[];
}

/**
 * The point the commander will mass on this cycle.
 *
 * Massing is for exactly the ground a single regiment would refuse and a
 * handful together would not. Below that, one regiment is enough and gathering
 * an assault only strips the rest of the line; above it, the assault would walk
 * into the same slaughter as the lone regiment would have, which is the mistake
 * this whole layer exists to stop. Both bounds are read through `isHopeless`, so
 * a warlord masses on odds a levy would not go near.
 *
 * Zones are iterated in the map's authored order, so a tie never depends on the
 * contact book's own ordering.
 */
function chooseAssault(state: GameState, free: readonly ArmyGroup[]): Assault | undefined {
  const difficulty = DIFFICULTIES[state.difficultyId];

  let best: Assault | undefined;
  let heaviest = 0;
  for (const zone of activeZoneIds()) {
    const weight = sightedByZone.get(zone) ?? 0;
    if (weight <= heaviest) continue;

    const groups = nearestAvailable(state, free, zone, difficulty.massedAssault);
    if (groups.length < 2) continue;

    // Worth massing on: the regiment that would otherwise have gone alone
    // would have turned back from it.
    const single = groups[0]?.members.length ?? 0;
    if (!isHopeless(state, zone, single)) continue;

    // And worth attacking at all once they are together.
    const combined = groups.reduce((sum, group) => sum + group.members.length, 0);
    if (isHopeless(state, zone, combined)) continue;

    heaviest = weight;
    best = { zone, groups };
  }
  return best;
}

/**
 * What idle formations do about what they can see.
 *
 * Every free regiment used to answer whatever contact was nearest it, which
 * meant the enemy never attacked anything — it queued. A player who massed at
 * one crossing was met by one regiment, then another, then another, and beat
 * each of them in turn with the whole army. So the commander now picks a point
 * first and sends several regiments at it together, and only what is left over
 * falls back to answering the nearest threat. How many go together is the
 * difficulty: at one, this degrades exactly to the old behaviour.
 */
function reactions(state: GameState): GameCommandPayload[] {
  const difficulty = DIFFICULTIES[state.difficultyId];
  const interval = Math.round(TICKS_PER_SECOND * difficulty.reactionSeconds);
  if (state.currentTick % interval !== 0) return [];

  const commands: GameCommandPayload[] = [];
  const contacts = [...state.contacts.enemy.values()].filter((contact) => contact.visibleNow);
  if (contacts.length === 0) return commands;

  const free = freeRegiments(state);
  if (free.length === 0) return commands;

  const committed = new Set<string>();

  if (difficulty.massedAssault > 1) {
    const assault = chooseAssault(state, free);
    if (assault !== undefined) {
      // Everyone chosen is marked as spoken for even when he is already going,
      // so the piecemeal pass below cannot pull a regiment back out of the
      // assault to answer something closer to it.
      const marching: string[] = [];
      for (const group of assault.groups) {
        committed.add(group.id);
        if (zoneAt(group.anchor.x, group.anchor.y) === assault.zone) continue;
        if (group.order.kind === 'attack_zone' && group.order.targetZone === assault.zone) continue;
        marching.push(group.id);
      }

      if (marching.length > 0) {
        commands.push({
          type: 'order_groups',
          playerId: 'enemy',
          groupIds: marching,
          order: 'attack_zone',
          targetZone: assault.zone,
        });
      }
    }
  }

  for (const group of free) {
    if (committed.has(group.id)) continue;

    let nearest = contacts[0];
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const contact of contacts) {
      const dx = contact.lastPosition.x - group.anchor.x;
      const dy = contact.lastPosition.y - group.anchor.y;
      const distance = dx * dx + dy * dy;
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = contact;
      }
    }

    if (nearest === undefined) continue;
    // And never answer a contact by walking into a mass that has already been
    // judged hopeless, or the commander would undo his own prudence every few
    // seconds.
    if (isHopeless(state, nearest.lastSeenZone, group.members.length)) continue;
    // Only respond to a genuinely close threat; otherwise hold the line.
    if (nearestDistance > difficulty.reactionRadius * difficulty.reactionRadius) continue;
    // Already standing on the ground it would be sent to: re-issuing would
    // only reset the order clock every few seconds for no movement at all.
    if (zoneAt(group.anchor.x, group.anchor.y) === nearest.lastSeenZone) continue;

    commands.push({
      type: 'order_groups',
      playerId: 'enemy',
      groupIds: [group.id],
      order: 'attack_zone',
      targetZone: nearest.lastSeenZone,
    });
  }

  return commands;
}

/**
 * Relieving a worn regiment.
 *
 * A regiment that has lost a good part of its men is worth little where it
 * stands and a great deal behind the line, where it stops being free casualties
 * and can come forward again once it has rallied. Nothing did this: worn
 * regiments simply stood where they were until they were finished, which handed
 * the player a steady supply of cheap kills and left the enemy's real strength
 * spread across regiments too weak to hold anything.
 *
 * It relieves the tired, not the doomed. A regiment that has actually broken is
 * routing, and a routing regiment accepts no orders at all, so waiting for that
 * point would be waiting for a moment this can never act on.
 *
 * Only troops already clear of the fighting go. Turning your back on an enemy
 * you are in contact with is not a withdrawal, it is a rout, and the morale
 * system is what decides that.
 */
function rotateSpentRegiments(state: GameState): GameCommandPayload[] {
  const difficulty = DIFFICULTIES[state.difficultyId];
  if (difficulty.withdrawSpentBelow <= 0) return [];

  const interval = Math.round(TICKS_PER_SECOND * difficulty.reactionSeconds);
  if (state.currentTick % interval !== 0) return [];

  const homeZone = homeZoneOf('enemy').id;
  const commands: GameCommandPayload[] = [];
  // Relief is a mid-battle economy: a regiment is spared now so it is worth
  // something later. Once the final push is due there is no later, and the two
  // decisions actively fought each other -- the push sent a spent regiment at
  // the player king, relief ordered it home five seconds afterward, it walked
  // back, the push sent it out again, and the pair cycled for the remaining
  // twenty minutes while the battle itself stopped happening entirely.
  if (state.currentTick >= finalPushDueTick(state)) return [];

  for (const group of activeGroups(state, 'enemy')) {
    if (isCommitted(state, group)) continue;
    if (group.order.kind === 'retreat') continue;
    if (group.engagement > 0) continue;
    if (group.initialStrength <= 0) continue;
    if (group.members.length > group.initialStrength * difficulty.withdrawSpentBelow) continue;
    // Already home: there is nowhere useful to send it.
    if (zoneAt(group.anchor.x, group.anchor.y) === homeZone) continue;

    commands.push({
      type: 'order_groups',
      playerId: 'enemy',
      groupIds: [group.id],
      order: 'retreat',
    });
  }
  return commands;
}

/**
 * Relief for the enemy king.
 *
 * Without this, a player who slips a column past the line simply walks up and
 * takes the sovereign unopposed, and the objective stops being a fight. The
 * order is only issued when the group is not already answering the call, so
 * re-evaluating every few seconds does not keep resetting its march.
 */
function defendTheKing(state: GameState): GameCommandPayload[] {
  const difficulty = DIFFICULTIES[state.difficultyId];
  const interval = Math.round(TICKS_PER_SECOND * difficulty.reactionSeconds);
  if (state.currentTick % interval !== 0) return [];

  const king = state.objective.kings.enemy;
  if (!king.besieged && king.captureProgress <= 0) return [];

  const homeZone = homeZoneOf('enemy').id;
  const commands: GameCommandPayload[] = [];
  for (const group of activeGroups(state, 'enemy')) {
    if (isCommitted(state, group)) continue;
    if (group.order.kind === 'defend_zone' && group.order.targetZone === homeZone) continue;

    // Only what is close enough to matter: recalling the whole army would hand
    // the player the entire field for the price of one raid.
    const dx = king.position.x - group.anchor.x;
    const dy = king.position.y - group.anchor.y;
    if (dx * dx + dy * dy > difficulty.kingDefenseRadius * difficulty.kingDefenseRadius) continue;

    commands.push({
      type: 'order_groups',
      playerId: 'enemy',
      groupIds: [group.id],
      order: 'defend_zone',
      targetZone: homeZone,
    });
  }
  return commands;
}

/** Sighted strength below which the commander has read nothing worth acting on. */
const MINIMUM_SIGHTED_STRENGTH = 400;

/**
 * Punishing an army that has committed itself.
 *
 * The strongest move available to a player was to put every regiment he owned
 * onto one crossing and walk through it. The defenders there were outnumbered
 * five to one, and nothing anywhere else on the field ever noticed: the enemy
 * only reacted to what stood close to it, and its own drive on the player's
 * king was on a fixed clock the rush finished well before.
 *
 * So the commander watches where the player's weight actually is. Once it is
 * gathered in one place, everything he has that is clear of the fighting goes
 * the other way, at the sovereign the player has just left unguarded. That
 * turns a rush from a free win into a race, which is the decision the crossing
 * was always supposed to pose.
 *
 * It reads intelligence, never the truth, so it can be fooled: a feint that
 * shows the enemy a mass at one bridge draws his loose regiments away from the
 * other one, exactly as it should.
 */
function exploitTheOpening(state: GameState): GameCommandPayload[] {
  const difficulty = DIFFICULTIES[state.difficultyId];
  const interval = Math.round(TICKS_PER_SECOND * difficulty.reactionSeconds);
  if (state.currentTick % interval !== 0) return [];

  const dueTick = Math.round(
    difficulty.opportunismSeconds * difficulty.timelineScale * TICKS_PER_SECOND,
  );
  const finalPushTick = Math.round(
    difficulty.finalPushSeconds * difficulty.timelineScale * TICKS_PER_SECOND,
  );
  // Before he has any read on the battle, and after he has committed to the
  // last act, this is not the commander's problem.
  if (state.currentTick < dueTick || state.currentTick >= finalPushTick) return [];

  // A commander whose own sovereign is being taken has a nearer problem.
  const ownKing = state.objective.kings.enemy;
  if (ownKing.besieged || ownKing.captureProgress > 0) return [];

  if (sightedTotal < MINIMUM_SIGHTED_STRENGTH) return [];

  // Iterated in the map's authored zone order, never the contact book's own,
  // so which zone wins a tie never depends on what was seen first.
  let heaviestZone: ZoneId | undefined;
  let heaviest = 0;
  for (const id of activeZoneIds()) {
    const weight = sightedByZone.get(id) ?? 0;
    if (weight > heaviest) {
      heaviest = weight;
      heaviestZone = id;
    }
  }
  if (heaviestZone === undefined) return [];
  if (heaviest / sightedTotal < difficulty.opportunismConcentration) return [];

  const mass = ZONES[heaviestZone].center;
  const sighting = state.objective.kings.player.lastSightingByOpponent;
  // His last sighting if there is one; otherwise the base every commander knows
  // is there. Neither is a peek at the truth.
  const targetZone = sighting?.zoneId ?? homeZoneOf('player').id;

  const commands: GameCommandPayload[] = [];
  for (const group of activeGroups(state, 'enemy')) {
    if (isCommitted(state, group)) continue;
    if (!hasFinishedItsOrders(state, group)) continue;
    // Pulling a regiment out of a melee to march round the flank only loses the
    // melee. Only troops already clear of the fighting go.
    if (group.engagement > 0) continue;
    // And only troops far enough from the mass to get away with it.
    const dx = group.anchor.x - mass.x;
    const dy = group.anchor.y - mass.y;
    if (dx * dx + dy * dy < difficulty.reactionRadius * difficulty.reactionRadius) continue;
    if (group.order.kind === 'attack_zone' && group.order.targetZone === targetZone) continue;

    commands.push({
      type: 'order_groups',
      playerId: 'enemy',
      groupIds: [group.id],
      order: 'attack_zone',
      targetZone,
    });
  }

  if (commands.length > 0) {
    raiseAlert(
      state,
      'enemy_exploits_opening',
      'attack',
      'warning',
      `The enemy has seen your army gathered at ${ZONES[heaviestZone].name} and is marching ` +
        'around it.',
      { zoneId: targetZone },
    );
  }
  return commands;
}

/**
 * The final drive on the player's sovereign.
 *
 * Both armies used to fight themselves to a standstill around the crossings
 * and then simply stop: twenty minutes of untouched battle ended with no
 * decision at all, because nothing ever forced the last act. Past the scripted
 * escalation the enemy commander stops trading and goes for the throat, which
 * is what turns a grind into a crisis the player has to answer.
 *
 * It never overrides the defence of his own king — a commander whose sovereign
 * is being taken has a more urgent problem than taking yours.
 */
/**
 * When the commander stops trading blows along the line and drives everything
 * he has left at the player's sovereign.
 *
 * Read by the relief pass as well as by the push itself, because relief has to
 * know when there is no longer any point holding a regiment back.
 */
function finalPushDueTick(state: GameState): number {
  const difficulty = DIFFICULTIES[state.difficultyId];
  return Math.round(difficulty.finalPushSeconds * difficulty.timelineScale * TICKS_PER_SECOND);
}

function finalPush(state: GameState): GameCommandPayload[] {
  const difficulty = DIFFICULTIES[state.difficultyId];
  if (state.currentTick < finalPushDueTick(state)) return [];

  const interval = Math.round(TICKS_PER_SECOND * difficulty.reactionSeconds);
  if (state.currentTick % interval !== 0) return [];

  const ownKing = state.objective.kings.enemy;
  if (ownKing.besieged || ownKing.captureProgress > 0) return [];

  const target = state.objective.kings.player;
  const targetZone = zoneAt(target.position.x, target.position.y);

  const commands: GameCommandPayload[] = [];
  for (const group of activeGroups(state, 'enemy')) {
    if (isCommitted(state, group)) continue;
    if (!hasFinishedItsOrders(state, group)) continue;
    // Already marching on him: do not reset the march every few seconds.
    if (group.order.kind === 'attack_zone' && group.order.targetZone === targetZone) continue;

    commands.push({
      type: 'order_groups',
      playerId: 'enemy',
      groupIds: [group.id],
      order: 'attack_zone',
      targetZone,
    });
  }

  // Announced once, on the tick the commitment is made. The alert family's
  // cooldown would otherwise re-raise it every twenty seconds until the end.
  if (commands.length > 0 && !state.alertCooldowns.has('enemy_final_push')) {
    raiseAlert(
      state,
      'enemy_final_push',
      'attack',
      'critical',
      'The enemy is committing everything against your King.',
      { zoneId: targetZone },
    );
  }
  return commands;
}

export function enemyAiCommands(state: GameState): GameCommandPayload[] {
  // One read of the contact book per tick, shared by everything below it that
  // needs to know where the player's weight is.
  refreshSighting(state);

  return [
    ...scriptedThisTick(state),
    ...defendTheKing(state),
    ...declineHopelessAssaults(state),
    ...rotateSpentRegiments(state),
    ...exploitTheOpening(state),
    ...finalPush(state),
    ...reactions(state),
  ];
}

