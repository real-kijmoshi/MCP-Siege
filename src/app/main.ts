import '../styles/main.css';
import '../styles/lobby.css';

import { MAP_HEIGHT, MAP_WIDTH, TICKS_PER_SECOND } from '../game/config/battle';
import { DIFFICULTIES } from '../game/config/matches';
import { SCENARIOS } from '../game/config/scenario';
import { GameQueries } from '../game/queries/GameQueries';
import { SimulationEngine } from '../game/simulation/Engine';
import { activeGroups } from '../game/simulation/GameState';
import { activeZoneIds } from '../game/simulation/Zones';
import { Input } from '../rendering/canvas/Input';
import { Minimap } from '../rendering/canvas/Minimap';
import { Renderer } from '../rendering/canvas/Renderer';
import { RenderSnapshot } from '../rendering/canvas/RenderSnapshot';
import { AlertFeed, Toast } from '../ui/AlertFeed';
import { FieldJournal } from '../ui/FieldJournal';
import { ArmyList } from '../ui/ArmyList';
import { BattleUx } from '../ui/BattleUx';
import { CommandBar } from '../ui/CommandBar';
import { FirstOrders } from '../ui/FirstOrders';
import { ObjectiveBanner } from '../ui/ObjectiveBanner';
import { TopBar } from '../ui/TopBar';
import { showLobby } from '../ui/Lobby';
import { mountIcons } from '../ui/icons';
import {
  getWebMcpCapabilityMessage,
  registerWebMcpTools,
} from '../integrations/webmcp/registry';
import { createWebMcpToolHandlers } from '../integrations/webmcp/tools';
import { isApplicationRuntimeError } from './runtimeErrors';

/**
 * Application wiring.
 *
 * One engine, one renderer, one thin DOM layer, and a WebMCP registration. The
 * page contains no Marshal interface of its own: the agent lives in the host
 * browser, and the only trace of it here is the status dot and a toast when an
 * order arrives from outside.
 */

let fatalShown = false;

function showFatalError(error: unknown): void {
  if (fatalShown) return;
  fatalShown = true;
  // Keep technical detail in developer tools; the player gets a stable,
  // actionable recovery screen rather than a stack trace or a frozen field.
  // eslint-disable-next-line no-console
  console.error('[siege] unrecoverable runtime error', error);
  const screen = document.getElementById('fatal-screen');
  const message = document.getElementById('fatal-message');
  if (message !== null) {
    message.textContent =
      'The battle encountered an unexpected error. Reload to restore a clean deterministic state.';
  }
  screen?.removeAttribute('hidden');
  screen?.querySelector<HTMLElement>('[tabindex="-1"]')?.focus({ preventScroll: true });
}

function requireCanvas(id: string): HTMLCanvasElement {
  const element = document.getElementById(id);
  if (!(element instanceof HTMLCanvasElement)) throw new Error(`Missing canvas #${id}.`);
  return element;
}

/**
 * Opens on the whole of the player's own army.
 *
 * A fixed centre and zoom happened to cut two regiments off the edge in
 * Riverwatch and framed the other two scenarios worse still, since each one
 * deploys somewhere different.
 */
function frameBattlefield(renderer: Renderer): void {
  // Start at command zoom. The previous opening framed only the player's
  // deployment and often put the river, gaps, causeway and objective offscreen
  // â€” precisely the ground a first order has to reason about.
  renderer.camera.fitBounds(0, 0, MAP_WIDTH, MAP_HEIGHT, 160);
}

async function bootstrap(): Promise<void> {
  const selection = await showLobby();
  const engine = new SimulationEngine(selection);
  const matchLabel = document.getElementById('match-label');
  if (matchLabel !== null) {
    matchLabel.textContent =
      `${SCENARIOS[selection.scenarioId].name} · ${DIFFICULTIES[selection.difficultyId].name}`;
  }
  const queries = new GameQueries(() => engine.getState());

  const battlefieldCanvas = requireCanvas('battlefield');
  const renderer = new Renderer(battlefieldCanvas);
  const minimapCanvas = requireCanvas('minimap');
  const minimap = new Minimap(minimapCanvas);

  const alertFeed = new AlertFeed((x, y) => renderer.camera.centerOn(x, y));
  const toast = new Toast();
  // Pixel glyphs replace every placeholder in the shell before it is shown,
  // so no Unicode stand-in is ever on screen even for a frame.
  mountIcons();
  const objectiveBanner = new ObjectiveBanner();
  const fieldJournal = new FieldJournal();

  // Give a first-time commander time to read the field. The opening assault is
  // only seconds away on Captain, so starting the clock under the briefing
  // punished the player for reading the instructions we put in front of them.
  let speed = 0;
  let openingHold = true;
  let firstOrders: FirstOrders | undefined;
  let battleUx: BattleUx | undefined;
  let topBar: TopBar;
  const setSpeed = (next: number): void => {
    speed = next;
    topBar.syncSpeed(speed);
    battleUx?.update(renderer.selection, speed);
    if (next > 0 && openingHold) {
      openingHold = false;
      firstOrders?.dismiss();
    }
  };
  const beginFromOpening = (): void => {
    if (!openingHold) return;
    setSpeed(1);
  };
  topBar = new TopBar(setSpeed);
  topBar.syncSpeed(0);
  firstOrders = new FirstOrders(selection.scenarioId, beginFromOpening);

  const armyList = new ArmyList(
    (groupId, additive) => {
      if (!additive) renderer.selection.clear();
      if (additive && renderer.selection.has(groupId)) renderer.selection.delete(groupId);
      else renderer.selection.add(groupId);
      commandBar.update();
    },
    (groupId) => input.focusGroup(groupId),
  );

  const commandBar = new CommandBar(engine, renderer.selection, (message) => {
    beginFromOpening();
    toast.show(message);
    battleUx?.showCommand(message);
    firstOrders?.dismiss();
  });

  const input = new Input(battlefieldCanvas, minimapCanvas, minimap, renderer, engine, {
    onSelectionChange: () => {
      commandBar.update();
      battleUx?.update(renderer.selection, speed);
    },
    onTogglePause: () => {
      setSpeed(speed === 0 ? 1 : 0);
    },
    onSpeedChange: (delta) => {
      const steps = [0, 1, 2, 4];
      const current = steps.indexOf(speed);
      setSpeed(steps[Math.max(0, Math.min(steps.length - 1, current + delta))] ?? 1);
    },
    onNotice: (message) => {
      toast.show(message);
    },
    onOrderIssued: (message) => {
      beginFromOpening();
      toast.show(message);
      battleUx?.showCommand(message);
      firstOrders?.dismiss();
    },
  });

  battleUx = new BattleUx({
    zoomIn: () => input.zoomIn(),
    zoomOut: () => input.zoomOut(),
    focusSelection: () => input.focusSelection(),
    focusKing: () => input.focusKing(),
    selectAll: () => input.selectAll(),
    clearSelection: () => input.clearSelection(),
    frameBattlefield: () => frameBattlefield(renderer),
  });
  battleUx.update(renderer.selection, speed);

  frameBattlefield(renderer);

  window.addEventListener('resize', () => {
    // Only the viewport changes here. Re-framing would snatch the camera away
    // from wherever the commander was actually looking.
    renderer.resize();
    minimap.resize();
  });

  /* ------------------------------------------------------- simulation loop */

  let accumulator = 0;
  let previous = performance.now();
  const stepMs = 1000 / TICKS_PER_SECOND;
  const renderSnapshot = new RenderSnapshot(engine.getState().units.capacity);
  renderSnapshot.capture(engine.getState());

  const frame = (now: number): void => {
    const elapsed = Math.min(now - previous, 250);
    previous = now;

    if (speed > 0) {
      accumulator += elapsed * speed;
      // Bound the catch-up so a background tab cannot stall the page on return.
      let steps = 0;
      while (accumulator >= stepMs && steps < 12) {
        renderSnapshot.capture(engine.getState());
        engine.step();
        accumulator -= stepMs;
        steps += 1;
      }
      if (accumulator > stepMs * 12) accumulator = 0;
    } else if (engine.pendingCommandCount > 0) {
      // Pause freezes the battle, not command acknowledgement. Orders are
      // validated and queued now, then begin moving on the first resumed tick.
      engine.flushQueuedCommands();
    }

    input.update();

    const state = engine.getState();
    const interpolation = speed === 0 ? 1 : Math.max(0, Math.min(1, accumulator / stepMs));
    renderer.render(state, queries.getPlanForOverlay('player'), renderSnapshot, interpolation);
    minimap.draw(state, renderer.camera, renderer.terrainArtwork);

    const armies = queries.getArmies('player');
    const objective = queries.getObjective('player');
    topBar.update(queries.getBattleOverview('player'), armies);
    objectiveBanner.update(objective);
    armyList.render(armies, renderer.selection);
    fieldJournal.update({
      armies,
      selection: renderer.selection,
      hoveredZone: renderer.hoveredZone,
      objective,
      // A regiment can be destroyed between selection and the next frame, and
      // the panel must not take the battle down with it.
      detailsFor: (groupId) => {
        try {
          return queries.getArmyDetails('player', groupId);
        } catch {
          return undefined;
        }
      },
    });
    alertFeed.push(queries.getAlerts('player', 6));
    commandBar.update();
    battleUx.update(renderer.selection, speed);

    if (state.objective.outcome !== 'ongoing' && speed !== 0) {
      speed = 0;
      topBar.syncSpeed(0);
    }

    if (!fatalShown) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  /* ------------------------------------------------------------- WebMCP */

  const handlers = createWebMcpToolHandlers({
    engine,
    queries,
    onMarshalAction: (summary, commandType) => {
      // Drafting is genuinely inert: a Marshal can discuss, create and revise
      // a plan while the opening field remains frozen for the commander.
      if (!['create_plan', 'modify_plan', 'cancel_plan'].includes(commandType)) {
        beginFromOpening();
      }
      toast.show(summary, true);
    },
  });

  // The tool schemas offer only the ground this battle is fought on.
  const connection = await registerWebMcpTools(
    handlers,
    typeof document === 'undefined' ? undefined : document.modelContext,
    activeZoneIds(),
  );
  document.documentElement.dataset.webmcpStatus = connection.status;

  if (connection.status === 'connected') {
    document.documentElement.dataset.webmcpTools = String(connection.toolCount);
    topBar.setWebMcpStatus('connected', `${connection.toolCount} tools registered.`);
  } else if (connection.status === 'failed') {
    topBar.setWebMcpStatus('failed', connection.message);
  } else {
    topBar.setWebMcpStatus('unavailable', getWebMcpCapabilityMessage());
  }

  // Console access for verifying tools without a WebMCP client. Not a UI.
  if (new URLSearchParams(window.location.search).has('mcpdebug')) {
    Object.defineProperty(window, '__battle', {
      value: { engine, queries, tools: handlers, renderer, input },
      writable: false,
    });
    // eslint-disable-next-line no-console
    console.info('[siege] window.__battle.tools is available for manual tool calls.');
  }
}

document.getElementById('fatal-reload')?.addEventListener('click', () => window.location.reload());
window.addEventListener('error', (event) => {
  if (isApplicationRuntimeError(event.error ?? event.message, event.filename, window.location.origin)) {
    showFatalError(event.error ?? event.message);
  }
});
window.addEventListener('unhandledrejection', (event) => {
  if (isApplicationRuntimeError(event.reason, undefined, window.location.origin)) {
    showFatalError(event.reason);
  }
});

void bootstrap().catch(showFatalError);

