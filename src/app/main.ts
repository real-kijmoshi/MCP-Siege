import '../styles/main.css';

import { TICKS_PER_SECOND } from '../game/config/battle';
import { GameQueries } from '../game/queries/GameQueries';
import { SimulationEngine } from '../game/simulation/Engine';
import { Input } from '../rendering/canvas/Input';
import { Minimap } from '../rendering/canvas/Minimap';
import { Renderer } from '../rendering/canvas/Renderer';
import { AlertFeed, Toast } from '../ui/AlertFeed';
import { ArmyList } from '../ui/ArmyList';
import { CommandBar } from '../ui/CommandBar';
import { TopBar } from '../ui/TopBar';
import {
  getWebMcpCapabilityMessage,
  registerWebMcpTools,
} from '../integrations/webmcp/registry';
import { createWebMcpToolHandlers } from '../integrations/webmcp/tools';

/**
 * Application wiring.
 *
 * One engine, one renderer, one thin DOM layer, and a WebMCP registration. The
 * page contains no Marshal interface of its own: the agent lives in the host
 * browser, and the only trace of it here is the status dot and a toast when an
 * order arrives from outside.
 */

function requireCanvas(id: string): HTMLCanvasElement {
  const element = document.getElementById(id);
  if (!(element instanceof HTMLCanvasElement)) throw new Error(`Missing canvas #${id}.`);
  return element;
}

async function bootstrap(): Promise<void> {
  const engine = new SimulationEngine();
  const queries = new GameQueries(() => engine.getState());

  const battlefieldCanvas = requireCanvas('battlefield');
  const renderer = new Renderer(battlefieldCanvas);
  const minimapCanvas = requireCanvas('minimap');
  const minimap = new Minimap(minimapCanvas);

  const alertFeed = new AlertFeed();
  const toast = new Toast();

  let speed = 1;
  const topBar = new TopBar((next) => {
    speed = next;
  });

  const armyList = new ArmyList((groupId, additive) => {
    if (!additive) renderer.selection.clear();
    if (additive && renderer.selection.has(groupId)) renderer.selection.delete(groupId);
    else renderer.selection.add(groupId);
    commandBar.update();
  });

  const commandBar = new CommandBar(engine, renderer.selection, (message) => toast.show(message));

  const input = new Input(battlefieldCanvas, minimapCanvas, minimap, renderer, engine, {
    onSelectionChange: () => commandBar.update(),
    onTogglePause: () => {
      speed = speed === 0 ? 1 : 0;
      topBar.syncSpeed(speed);
    },
    onSpeedChange: (delta) => {
      const steps = [0, 1, 2, 4];
      const current = steps.indexOf(speed);
      speed = steps[Math.max(0, Math.min(steps.length - 1, current + delta))] ?? 1;
      topBar.syncSpeed(speed);
    },
    onOrderIssued: (message) => toast.show(message),
  });

  // Focus the player's centre so the opening frame shows the main line.
  renderer.camera.centerOn(4000, 3300);

  window.addEventListener('resize', () => {
    renderer.resize();
    minimap.resize();
  });

  /* ------------------------------------------------------- simulation loop */

  let accumulator = 0;
  let previous = performance.now();
  const stepMs = 1000 / TICKS_PER_SECOND;

  const frame = (now: number): void => {
    const elapsed = Math.min(now - previous, 250);
    previous = now;

    if (speed > 0) {
      accumulator += elapsed * speed;
      // Bound the catch-up so a background tab cannot stall the page on return.
      let steps = 0;
      while (accumulator >= stepMs && steps < 12) {
        engine.step();
        accumulator -= stepMs;
        steps += 1;
      }
      if (accumulator > stepMs * 12) accumulator = 0;
    }

    input.update();

    const state = engine.getState();
    renderer.render(state, queries.getPlanForOverlay('player'));
    minimap.draw(state, renderer.camera);

    topBar.update(queries.getBattleOverview('player'));
    armyList.render(queries.getArmies('player'), renderer.selection);
    alertFeed.push(queries.getAlerts('player', 6));
    commandBar.update();

    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  /* ------------------------------------------------------------- WebMCP */

  const handlers = createWebMcpToolHandlers({
    engine,
    queries,
    onMarshalAction: (summary) => toast.show(summary, true),
  });

  const connection = await registerWebMcpTools(handlers);
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
      value: { engine, queries, tools: handlers },
      writable: false,
    });
    // eslint-disable-next-line no-console
    console.info('[siege] window.__battle.tools is available for manual tool calls.');
  }
}

void bootstrap();
