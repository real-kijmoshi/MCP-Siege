import '../styles/main.css';
import { GameQueries } from '../game/queries/GameQueries';
import { SimulationEngine } from '../game/simulation/Engine';
import { FixedStepRunner } from '../game/simulation/FixedStepRunner';
import { registerWebMcpTools } from '../integrations/webmcp/registry';
import { createWebMcpToolHandlers } from '../integrations/webmcp/tools';
import { createGame } from '../rendering/phaser/createGame';
import { HUD } from '../ui/HUD';
import { MarshalActivityStore } from '../ui/MarshalActivity';

function resourceIcon(resource: string): string {
  const paths: Record<string, string> = {
    food: '<path d="M7 15V5m0 5C4 9 3 7 3 5c3 0 4 2 4 5Zm0-2c3-1 4-3 4-5-3 0-4 2-4 5Zm3 7V7m0 5c3-1 4-3 4-5-3 0-4 2-4 5Z"/>',
    wood: '<path d="M8 14v-3M5 11h6L9.5 8h1L8 3 5.5 8h1L5 11Z"/><path d="M3 15h10"/>',
    stone: '<path d="m3 13 2-7 4-3 4 5-1 5H3Z"/><path d="m5 6 4 2 4 0M9 8l-1 5"/>',
    iron: '<path d="M3 12 6 5l6-2 2 6-5 5-6-2Z"/><path d="m6 5 3 4 5 0M9 9v5"/>',
  };
  return `<svg viewBox="0 0 16 16" aria-hidden="true">${paths[resource] ?? ''}</svg>`;
}

function renderApplicationShell(): void {
  const app = document.getElementById('app');
  if (app === null) throw new Error('Application root is missing.');
  app.innerHTML = `
    <section class="game-shell">
      <div id="game-canvas" aria-label="Iron and Oath medieval battlefield"></div>
      <div class="world-shade" aria-hidden="true"></div>
      <button class="realm-button" id="focus-town-hall" title="Select Town Hall [H]">
        <span class="realm-shield">IO</span><span>IRON &amp; OATH</span>
      </button>
      <header class="resource-strip" aria-label="Resource stockpiles">
        ${['food', 'wood', 'stone', 'iron'].map((resource) => `
          <div class="resource-item resource-${resource}">
            ${resourceIcon(resource)}<strong data-resource-value="${resource}">0</strong><small data-resource-rate="${resource}">+0.0/s</small>
          </div>`).join('')}
        <div class="resource-item population-item" id="population-item">
          <strong id="population-value">5 / 10</strong><small id="population-status">POPULATION</small>
        </div>
      </header>
      <button class="marshal-toggle" id="marshal-toggle" aria-controls="marshal-drawer" aria-expanded="false">
        <span class="marshal-orb"></span><strong>MARSHAL</strong><span id="marshal-chevron">+</span>
      </button>
      <div class="control-hint"><b>LMB</b> SELECT <i></i><b>RMB</b> MOVE / GATHER / ATTACK <i></i><b>WASD</b> PAN <i></i><b>WHEEL</b> ZOOM</div>
      <div class="command-toast" id="command-toast" role="status" aria-live="polite"></div>

      <section class="bottom-hud" aria-label="RTS command interface">
        <button class="minimap" id="minimap" aria-label="Battlefield minimap">
          <span class="mini-hall"></span><span id="minimap-entities"></span>
          <span class="minimap-viewport" id="minimap-viewport"></span><span class="minimap-compass">N</span>
        </button>
        <article class="selection-panel">
          <div class="selection-portrait" id="selection-portrait"><span>TH</span></div>
          <div class="selection-copy">
            <small id="selection-kicker">STRUCTURE</small><h1 id="selection-name">Town Hall</h1>
            <div class="health-row"><span class="health-track"><i id="selection-health-fill"></i></span><b id="selection-health">1200 / 1200</b></div>
            <div class="selection-stats">
              <span><small>ROLE</small><b id="selection-detail">ECONOMY</b></span>
              <span><small>STATE</small><b id="selection-state">READY</b></span>
              <span><small>QUEUE</small><b id="selection-queue">EMPTY</b></span>
            </div>
          </div>
          <button class="focus-selection" id="focus-selection" title="Center selection [F]">◎</button>
        </article>
        <section class="command-panel">
          <div class="command-panel-heading"><span id="command-context-label">TOWN HALL COMMANDS</span><small id="command-help">SELECT AND EXPAND</small></div>
          <div class="context-view command-grid" id="context-actions"></div>
        </section>
      </section>

      <aside class="marshal-drawer" id="marshal-drawer" aria-hidden="true">
        <header><div><small>WEBMCP CO-COMMANDER</small><h2>Marshal Activity</h2></div><button id="close-marshal">×</button></header>
        <p class="marshal-intro">Marshal orders enter the same deterministic command queue as player orders.</p>
        <div class="activity-list" id="activity-list"><p class="empty-activity">No Marshal activity yet.</p></div>
        <footer><button class="debug-toggle" id="debug-toggle">Show diagnostics</button>
          <div class="debug-details" id="debug-details" hidden><span>Simulation</span><b>20 Hz</b><span>Tick</span><b id="game-tick">0</b><span>WebMCP</span><b id="debug-webmcp">Detecting</b></div>
        </footer>
      </aside>
    </section>`;
}

async function bootstrap(): Promise<void> {
  renderApplicationShell();
  const engine = new SimulationEngine();
  const queries = new GameQueries(() => engine.getSnapshot());
  const activity = new MarshalActivityStore();
  const battlefield = createGame(engine);
  const hud = new HUD(engine, queries, activity, battlefield.scene);
  const runner = new FixedStepRunner(engine);
  runner.start();
  const updateHud = (): void => { hud.render(); requestAnimationFrame(updateHud); };
  requestAnimationFrame(updateHud);
  const connection = await registerWebMcpTools(createWebMcpToolHandlers(engine, queries, activity), activity);
  document.documentElement.dataset.webmcpStatus = connection.status;
  if (connection.status === 'connected') document.documentElement.dataset.webmcpTools = String(connection.toolCount);
  if (connection.status === 'failed') document.documentElement.dataset.webmcpError = connection.code;
}
void bootstrap();
