import { ZONE_IDS, type ZoneId } from '../../game/types/domain';
import { EMPTY_INPUT_SCHEMA, createToolSchemas } from './schemas';
import type { WebMcpToolHandlers } from './tools';

/**
 * Native WebMCP registration.
 *
 * The page publishes tools through `document.modelContext` and nothing more.
 * There is no embedded chat, no tool inspector, and no backend: discovery and
 * conversation belong entirely to the host browser or agent. The game is fully
 * playable when none of this is available.
 */

export type WebMcpConnectionResult =
  | { status: 'connected'; toolCount: number }
  | { status: 'unavailable'; code: 'API_UNAVAILABLE' }
  | { status: 'failed'; code: 'REGISTRATION_FAILED'; message: string };

let registrationController: AbortController | undefined;

export async function registerWebMcpTools(
  handlers: WebMcpToolHandlers,
  modelContext: WebMCP.ModelContext | undefined = typeof document === 'undefined'
    ? undefined
    : document.modelContext,
  /** The zones of the map this battle is on. The schemas offer nothing else. */
  zoneIds: readonly ZoneId[] = ZONE_IDS,
): Promise<WebMcpConnectionResult> {
  if (typeof modelContext?.registerTool !== 'function') {
    return { status: 'unavailable', code: 'API_UNAVAILABLE' };
  }

  const schemas = createToolSchemas(zoneIds);

  // Abort any previous registration so a reload cannot leave a partial tool set.
  registrationController?.abort();
  const controller = new AbortController();
  registrationController = controller;

  const tools: WebMCP.ModelContextTool[] = [
    {
      name: 'get_battle_overview',
      title: 'Get battle overview',
      description:
        'Concise strategic picture of the battle: the objective and how it stands, your strength, ' +
        'enemy strength you can see, the state of each front, and current alerts. Start here. ' +
        'Read-only.',
      inputSchema: EMPTY_INPUT_SCHEMA,
      annotations: { readOnlyHint: true },
      execute: () => handlers.getBattleOverview(),
    },
    {
      name: 'get_objective',
      title: 'Get the objective',
      description:
        'How the battle is won and how it currently stands: your own king, his Royal Guard and ' +
        'any capture against him, and what is known of the enemy king. Fog of war applies to ' +
        'the enemy sovereign — you get his last sighting, not his position. Read-only.',
      inputSchema: EMPTY_INPUT_SCHEMA,
      annotations: { readOnlyHint: true },
      execute: () => handlers.getObjective(),
    },
    {
      name: 'get_armies',
      title: 'Get armies',
      description:
        'Order of battle for every group under your command: strength, formation, stance, ' +
        'morale, what it is doing and where it stands. Each group also reports whether it is ' +
        'pinned — held in melee, and unable to march away until the fight is settled — and ' +
        'whether it is surrounded, meaning the attack is coming from more quarters than the ' +
        'formation can face. A surrounded group takes far heavier casualties and breaks fast, ' +
        'so it is the first thing worth answering. Each group also reports whether it is ' +
        'crowded — packed so tightly against friendly regiments that it cannot fight, which ' +
        'is what happens when several formations are pushed through one crossing at once — ' +
        'and how spent it is, from 0 fresh to 100 exhausted. Crowded troops lose half their ' +
        'damage and are far easier to shoot; spent troops hit softer and give ground. Both ' +
        'are answered by manoeuvre: give a crushed regiment room, and relieve a spent one ' +
        'with a fresh formation. Read-only.',
      inputSchema: EMPTY_INPUT_SCHEMA,
      annotations: { readOnlyHint: true },
      execute: () => handlers.getArmies(),
    },
    {
      name: 'get_army_details',
      title: 'Get army details',
      description:
        'Detailed report on one group: composition, casualties, active order, the effect of its ' +
        'current formation, nearby friendly groups and known threats. Read-only.',
      inputSchema: schemas.ARMY_DETAILS_SCHEMA,
      annotations: { readOnlyHint: true },
      execute: (input) => handlers.getArmyDetails(input),
    },
    {
      name: 'get_visible_enemies',
      title: 'Get visible enemies',
      description:
        'Enemy forces currently in sight, with estimated strength and composition. Fog of war ' +
        'applies: forces you cannot see are absent. Read-only.',
      inputSchema: EMPTY_INPUT_SCHEMA,
      annotations: { readOnlyHint: true },
      execute: () => handlers.getVisibleEnemies(),
    },
    {
      name: 'get_intelligence',
      title: 'Get intelligence',
      description:
        'Everything known about the enemy, including last-known positions of forces no longer ' +
        'in sight. Strength figures are estimates, not exact counts. Read-only.',
      inputSchema: EMPTY_INPUT_SCHEMA,
      annotations: { readOnlyHint: true },
      execute: () => handlers.getIntelligence(),
    },
    {
      name: 'get_front_status',
      title: 'Get front status',
      description:
        'Assessment of the west, centre, east and rear: relative strength, which groups are ' +
        'committed there, and who holds each zone. Read-only.',
      inputSchema: EMPTY_INPUT_SCHEMA,
      annotations: { readOnlyHint: true },
      execute: () => handlers.getFrontStatus(),
    },
    {
      name: 'get_alerts',
      title: 'Get alerts',
      description:
        'Recent strategic events: morale collapses, ground lost, enemy sightings, groups spent ' +
        'or idle. The fastest way to notice what changed. Read-only.',
      inputSchema: EMPTY_INPUT_SCHEMA,
      annotations: { readOnlyHint: true },
      execute: () => handlers.getAlerts(),
    },
    {
      name: 'get_strategic_zones',
      title: 'Get strategic zones',
      description:
        'The named locations on the battlefield, their terrain, which front they belong to, and ' +
        'who controls them. Use these names when giving orders. Read-only.',
      inputSchema: EMPTY_INPUT_SCHEMA,
      annotations: { readOnlyHint: true },
      execute: () => handlers.getStrategicZones(),
    },
    {
      name: 'get_active_orders',
      title: 'Get active orders',
      description:
        'What every group is currently doing, plus any standing conditional orders that are ' +
        'armed and waiting for their trigger. Reports how many named-route waypoints remain ' +
        'without exposing their raw coordinates. Read-only.',
      inputSchema: EMPTY_INPUT_SCHEMA,
      annotations: { readOnlyHint: true },
      execute: () => handlers.getActiveOrders(),
    },
    {
      name: 'get_plan',
      title: 'Get current plan',
      description:
        'The battle plan currently drafted or executing, with every step, its trigger and its ' +
        'target. Read-only.',
      inputSchema: EMPTY_INPUT_SCHEMA,
      annotations: { readOnlyHint: true },
      execute: () => handlers.getPlan(),
    },

    {
      name: 'order_group',
      title: 'Order groups',
      description:
        'Give one or more groups a real order: move, attack_zone, attack_group, defend_zone, ' +
        'hold, retreat, scout or support, with an optional formation and stance. Takes effect ' +
        'immediately through the same command queue the human commander uses.',
      inputSchema: schemas.ORDER_GROUP_SCHEMA,
      annotations: { readOnlyHint: false },
      execute: (input) => handlers.orderGroup(input),
    },
    {
      name: 'deploy_custom_formation',
      title: 'Deploy a custom formation',
      description:
        'Atomically arrange up to fourteen regiments around one named strategic zone. Assign ' +
        'each regiment a unique front, line, wing, rear, or reserve slot plus its own formation, ' +
        'stance, and move/attack/defend order. The game derives passable positions from those ' +
        'semantic slots; raw coordinates and individual soldiers are never exposed.',
      inputSchema: schemas.DEPLOY_FORMATION_SCHEMA,
      annotations: { readOnlyHint: false },
      execute: (input) => handlers.deployFormation(input),
    },
    {
      name: 'reorganize_armies',
      title: 'Reorganise armies',
      description:
        'Split a group into a mixed detachment, detach one troop category into its own regiment, ' +
        'merge several groups, or rename a group. Category detachments give fine control of ' +
        'archers, guns, cavalry, surgeons, and other arms without exposing soldier ids.',
      inputSchema: schemas.REORGANIZE_SCHEMA,
      annotations: { readOnlyHint: false },
      execute: (input) => handlers.reorganizeArmies(input),
    },
    {
      name: 'set_conditional_order',
      title: 'Set a standing order',
      description:
        'Arm an order that fires later when a condition is met, for example retreating a group ' +
        'if its morale falls below a threshold, or committing a reserve if a zone is lost. ' +
        'Fires once. List armed orders with get_active_orders.',
      inputSchema: schemas.SET_CONDITIONAL_SCHEMA,
      annotations: { readOnlyHint: false },
      execute: (input) => handlers.setConditionalOrder(input),
    },
    {
      name: 'cancel_conditional_order',
      title: 'Cancel a standing order',
      description: 'Disarm a standing conditional order before it fires.',
      inputSchema: schemas.CANCEL_CONDITIONAL_SCHEMA,
      annotations: { readOnlyHint: false },
      execute: (input) => handlers.cancelConditionalOrder(input),
    },
    {
      name: 'focus_siege',
      title: 'Focus siege',
      description:
        'Commit a siege or artillery group to bombard a zone. Both outrange everything else ' +
        'but are slow and helpless in close combat, so they are deployed loose and holding ' +
        'ground. Guns must also stand still to fire at all: a battery still on the march ' +
        'shoots at nothing, so order it onto its ground well before you need it firing.',
      inputSchema: schemas.FOCUS_SIEGE_SCHEMA,
      annotations: { readOnlyHint: false },
      execute: (input) => handlers.focusSiege(input),
    },
    {
      name: 'direct_reinforcements',
      title: 'Direct reinforcements',
      description:
        'Commit a banked reinforcement wave as a new group and send it to a zone or to support ' +
        'an existing group. Check availability with get_battle_overview.',
      inputSchema: schemas.DIRECT_REINFORCEMENTS_SCHEMA,
      annotations: { readOnlyHint: false },
      execute: (input) => handlers.directReinforcements(input),
    },

    {
      name: 'create_plan',
      title: 'Create a battle plan',
      description:
        'Draft a multi-step operation WITHOUT executing it. Nothing moves. The plan is drawn ' +
        'over the battlefield as numbered arrows so the commander can review it, and steps may ' +
        'be gated on conditions. Call execute_plan only once the commander approves.',
      inputSchema: schemas.CREATE_PLAN_SCHEMA,
      annotations: { readOnlyHint: false },
      execute: (input) => handlers.createPlan(input),
    },
    {
      name: 'modify_plan',
      title: 'Modify the battle plan',
      description:
        'Revise a drafted plan: add, remove, replace or reorder steps, or rename the operation. ' +
        'The battlefield preview updates. Still nothing moves.',
      inputSchema: schemas.MODIFY_PLAN_SCHEMA,
      annotations: { readOnlyHint: false },
      execute: (input) => handlers.modifyPlan(input),
    },
    {
      name: 'execute_plan',
      title: 'Execute the battle plan',
      description:
        'Commit a drafted plan. Steps with an immediate condition become orders at once; the ' +
        'rest are armed and fire when their trigger is met.',
      inputSchema: schemas.PLAN_ID_SCHEMA,
      annotations: { readOnlyHint: false },
      execute: (input) => handlers.executePlan(input),
    },
    {
      name: 'cancel_plan',
      title: 'Cancel the battle plan',
      description:
        'Cancel a plan and disarm any steps still waiting. Orders already issued still stand; ' +
        'this is not a recall of troops already marching.',
      inputSchema: schemas.PLAN_ID_SCHEMA,
      annotations: { readOnlyHint: false },
      execute: (input) => handlers.cancelPlan(input),
    },
  ];

  try {
    for (const tool of tools) {
      await modelContext.registerTool(tool, { signal: controller.signal });
    }
    return { status: 'connected', toolCount: tools.length };
  } catch (error) {
    controller.abort();
    if (registrationController === controller) registrationController = undefined;
    return {
      status: 'failed',
      code: 'REGISTRATION_FAILED',
      message: error instanceof Error ? error.message : 'Unknown registration error.',
    };
  }
}

/** Explains, in the page, why tools are not available in this browser. */
export function getWebMcpCapabilityMessage(): string {
  if (typeof window === 'undefined') return 'WebMCP requires a browser.';
  if (!window.isSecureContext) {
    return 'WebMCP requires HTTPS or localhost. Open this page in a secure context.';
  }
  if (!window.originAgentCluster) {
    return 'WebMCP requires origin isolation. Restart the dev server and reload this tab.';
  }
  return (
    'Native WebMCP is not enabled in this browser. In Chrome, enable ' +
    'chrome://flags/#enable-webmcp-testing, relaunch, then reload this page.'
  );
}
