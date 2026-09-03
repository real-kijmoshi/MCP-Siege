import { BATTLE_MAPS, BATTLE_MAP_IDS, type BattleMapId } from '../game/config/maps';
import { DEFAULT_TABLE_MAP, createSkirmishOperation } from '../game/config/customBattle';
import {
  DIFFICULTIES,
  DIFFICULTY_IDS,
  type DifficultyId,
  type ScenarioId,
} from '../game/config/matches';
import { AUTHORED_SCENARIOS, SCENARIOS, type ScenarioDefinition } from '../game/config/scenario';
import { createWarCouncilToolHandlers, type WarCouncilPort } from '../integrations/webmcp/council';
import { registerWarCouncilTools } from '../integrations/webmcp/councilRegistry';
import { getWebMcpCapabilityMessage } from '../integrations/webmcp/registry';
import { LobbyMap } from './LobbyMap';
import { iconMarkup, mountIcons } from './icons';

/**
 * The War Council.
 *
 * The home screen is a game screen: the same oak, iron, stone and parchment the
 * battlefield is built from, the same pixel sprite sheet, and a portrait of the
 * ground drawn from the map data rather than from a picture of it.
 *
 * It is also the one place an external Marshal can write a battle instead of
 * fighting one. While this screen is up the page publishes the War Council
 * tools, so an agent can read every battlefield, design an operation on one and
 * either propose it — it appears here, under the commander's hand — or deploy
 * it outright. The tools come down the moment the army marches.
 *
 * No simulation exists until then.
 */

export interface MatchSelection {
  scenario: ScenarioDefinition;
  difficultyId: DifficultyId;
}

function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`Missing War Council element #${id}.`);
  return element as T;
}

function requireCanvas(id: string): HTMLCanvasElement {
  const element = document.getElementById(id);
  if (!(element instanceof HTMLCanvasElement)) throw new Error(`Missing canvas #${id}.`);
  return element;
}

function armyStrength(operation: ScenarioDefinition, side: 'player' | 'enemy'): number {
  const groups = side === 'player' ? operation.playerGroups : operation.enemyGroups;
  let total = 0;
  for (const group of groups) {
    for (const [, count] of group.composition) total += count;
  }
  return total;
}

/** One row of the order of battle: a label, a figure, and whose figure it is. */
function orderRow(label: string, value: string, side?: 'player' | 'enemy'): [HTMLElement, HTMLElement] {
  const term = document.createElement('dt');
  term.textContent = label;
  const detail = document.createElement('dd');
  detail.textContent = value;
  if (side !== undefined) detail.dataset.side = side;
  return [term, detail];
}

const DIFFICULTY_GLYPH: Record<DifficultyId, string> = {
  levy: 'hold',
  captain: 'defend',
  warlord: 'attack',
};

export function showWarCouncil(): Promise<MatchSelection> {
  const root = requireElement<HTMLElement>('lobby');
  const operationList = requireElement<HTMLElement>('lobby-operations');
  const difficultyList = requireElement<HTMLElement>('lobby-difficulties');
  const difficultyDescription = requireElement<HTMLElement>('difficulty-description');
  const numeral = requireElement<HTMLElement>('brief-numeral');
  const location = requireElement<HTMLElement>('brief-location');
  const name = requireElement<HTMLElement>('brief-name');
  const summary = requireElement<HTMLElement>('brief-summary');
  const twist = requireElement<HTMLElement>('brief-twist');
  const orders = requireElement<HTMLElement>('brief-orders');
  const facts = requireElement<HTMLElement>('brief-facts');
  const battlefield = requireElement<HTMLElement>('brief-battlefield');
  const terrain = requireElement<HTMLElement>('brief-terrain');
  const deploy = requireElement<HTMLButtonElement>('lobby-deploy');
  const deployStrength = requireElement<HTMLElement>('deploy-strength');
  const armies = requireElement<HTMLElement>('brief-armies');
  const marshal = requireElement<HTMLElement>('council-marshal');
  const marshalLabel = requireElement<HTMLElement>('council-marshal-label');
  const tableGround = requireElement<HTMLElement>('table-ground');
  const tableGroundNote = requireElement<HTMLElement>('table-ground-note');
  const tableGroundChoices = requireElement<HTMLElement>('table-ground-choices');
  const portrait = new LobbyMap(requireCanvas('lobby-map'));

  mountIcons(root);

  let draft = createSkirmishOperation(DEFAULT_TABLE_MAP);
  /** True once a Marshal has written the operation on the table itself. */
  let marshalDesign = false;
  let savedOperation: string | null = null;
  let savedDifficulty: string | null = null;
  try {
    savedOperation = window.localStorage.getItem('siege:last-scenario');
    savedDifficulty = window.localStorage.getItem('siege:last-difficulty');
  } catch {
    // Storage is optional in sandboxed and privacy-hardened browsers.
  }
  const knownOperationIds: ScenarioId[] = [
    ...AUTHORED_SCENARIOS.map((operation) => operation.id),
    'custom',
  ];
  let selectedId: ScenarioId =
    knownOperationIds.find((id) => id === savedOperation) ?? 'bridge_of_knives';
  let difficultyId: DifficultyId =
    DIFFICULTY_IDS.find((id) => id === savedDifficulty) ?? 'captain';
  let deployed = false;

  const rememberSelection = (): void => {
    try {
      window.localStorage.setItem('siege:last-scenario', selectedId);
      window.localStorage.setItem('siege:last-difficulty', difficultyId);
    } catch {
      // Persistence is a convenience, never a deployment requirement.
    }
  };

  /** Lays a fresh blank skirmish on a battlefield, discarding what was there. */
  const layTable = (mapId: BattleMapId): void => {
    draft = createSkirmishOperation(mapId);
    marshalDesign = false;
  };

  const operations = (): ScenarioDefinition[] => [...AUTHORED_SCENARIOS, draft];
  const selected = (): ScenarioDefinition =>
    operations().find((operation) => operation.id === selectedId) ?? SCENARIOS.bridge_of_knives;

  /* ------------------------------------------------------------- rendering */

  const renderOperations = (): void => {
    operationList.replaceChildren(
      ...operations().map((operation) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'operation-entry';
        button.dataset.operation = operation.id;
        button.dataset.origin = operation.origin;
        const chosen = operation.id === selectedId;
        button.classList.toggle('selected', chosen);
        button.setAttribute('aria-pressed', String(chosen));
        button.innerHTML =
          `<span class="entry-seal">${operation.numeral}</span>` +
          '<span class="entry-name">' +
          `<strong>${operation.name}</strong>` +
          `<small>${operation.location}</small>` +
          '</span>' +
          `<span class="entry-pressure">${operation.pressure}</span>` +
          `<span class="entry-mark">${iconMarkup(operation.origin === 'designed' ? 'map' : 'crest')}</span>`;
        button.addEventListener('click', () => {
          selectedId = operation.id;
          rememberSelection();
          renderOperations();
          renderBriefing();
        });
        return button;
      }),
    );
  };

  const renderBriefing = (): void => {
    const operation = selected();
    const map = BATTLE_MAPS[operation.mapId];

    numeral.textContent = operation.numeral;
    location.textContent = operation.location;
    name.textContent = operation.name;
    summary.textContent = operation.summary;
    twist.textContent = operation.twist;
    battlefield.textContent = map.name.toUpperCase();
    terrain.textContent = map.terrainNote;

    orders.replaceChildren(
      ...operation.battleOrders.map((order) => {
        const item = document.createElement('li');
        item.textContent = order;
        return item;
      }),
    );
    facts.replaceChildren(
      ...operation.battleFacts.map((fact) => {
        const item = document.createElement('span');
        item.textContent = fact;
        return item;
      }),
    );

    const mine = armyStrength(operation, 'player');
    const theirs = armyStrength(operation, 'enemy');
    deployStrength.textContent = `${mine.toLocaleString('en-GB')} men under your hand`;

    // The figures a commander weighs before he presses the seal, beside it.
    armies.replaceChildren(
      ...orderRow(operation.playerArmyName, `${operation.playerGroups.length} · ${mine.toLocaleString('en-GB')}`, 'player'),
      ...orderRow(operation.enemyArmyName, `${operation.enemyGroups.length} · ${theirs.toLocaleString('en-GB')}`, 'enemy'),
      ...orderRow('Ground', map.name),
      // An authored operation is timed; the table is measured by its script.
      ...orderRow(operation.origin === 'designed' ? 'Enemy plan' : 'Expected', operation.duration),
    );

    root.dataset.map = operation.mapId;
    root.dataset.operation = operation.id;
    deploy.title = `${operation.name} against ${DIFFICULTIES[difficultyId].name} (${DIFFICULTIES[difficultyId].tier})`;
    portrait.draw(operation);
    renderTableGround();
  };

  const renderTableGround = (): void => {
    const operation = selected();
    const isTable = operation.origin === 'designed';
    tableGround.hidden = !isTable;
    if (!isTable) return;

    tableGroundNote.textContent = marshalDesign
      ? 'Written by your Marshal — choosing ground lays a fresh blank battle over it.'
      : 'Choose the ground this battle is fought on.';
    for (const button of tableGroundChoices.querySelectorAll<HTMLButtonElement>('.ground-choice')) {
      const chosen = button.dataset.map === operation.mapId;
      button.classList.toggle('selected', chosen);
      button.setAttribute('aria-pressed', String(chosen));
    }
  };

  const renderDifficulty = (): void => {
    for (const button of difficultyList.querySelectorAll<HTMLButtonElement>('.commander-choice')) {
      const chosen = button.dataset.difficulty === difficultyId;
      button.classList.toggle('selected', chosen);
      button.setAttribute('aria-pressed', String(chosen));
    }
    difficultyDescription.textContent = DIFFICULTIES[difficultyId].description;
  };

  tableGroundChoices.replaceChildren(
    ...BATTLE_MAP_IDS.map((mapId) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ground-choice';
      button.dataset.map = mapId;
      button.innerHTML =
        `<strong>${BATTLE_MAPS[mapId].name}</strong>` +
        `<small>${BATTLE_MAPS[mapId].terrainNote}</small>`;
      button.addEventListener('click', () => {
        layTable(mapId);
        selectedId = 'custom';
        rememberSelection();
        renderOperations();
        renderBriefing();
      });
      return button;
    }),
  );

  difficultyList.replaceChildren(
    ...DIFFICULTY_IDS.map((id) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'commander-choice';
      button.dataset.difficulty = id;
      button.innerHTML =
        `<span class="icon">${iconMarkup(DIFFICULTY_GLYPH[id])}</span>` +
        `<strong>${DIFFICULTIES[id].name}</strong>` +
        `<small>${DIFFICULTIES[id].subtitle}${id === 'captain' ? ' · Recommended' : ''}</small>`;
      if (id === 'captain') button.dataset.recommended = 'true';
      button.addEventListener('click', () => {
        difficultyId = id;
        rememberSelection();
        renderDifficulty();
      });
      return button;
    }),
  );

  const bindArrowNavigation = (container: HTMLElement): void => {
    container.addEventListener('keydown', (event) => {
      if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      const buttons = [...container.querySelectorAll<HTMLButtonElement>('button')];
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (index < 0 || buttons.length === 0) return;
      const backwards = event.key === 'ArrowUp' || event.key === 'ArrowLeft';
      const next = buttons[(index + (backwards ? -1 : 1) + buttons.length) % buttons.length];
      if (next === undefined) return;
      event.preventDefault();
      next.focus();
      next.click();
    });
  };

  bindArrowNavigation(operationList);
  bindArrowNavigation(difficultyList);

  renderOperations();
  renderBriefing();
  renderDifficulty();

  /* --------------------------------------------------------------- deploy */

  return new Promise<MatchSelection>((resolve) => {
    let close: () => void = () => {};

    const march = (): boolean => {
      if (deployed) return false;
      deployed = true;
      const operation = selected();
      // The council closes before the battle exists, so a Marshal can never be
      // holding a design tool while an army is already on the field.
      close();
      deploy.disabled = true;
      root.setAttribute('aria-busy', 'true');
      root.classList.add('departing');
      window.setTimeout(() => {
        root.hidden = true;
        document.body.classList.add('battle-started');
        const app = document.getElementById('app');
        if (app !== null) {
          app.inert = false;
          app.setAttribute('aria-hidden', 'false');
        }
        document.getElementById('battlefield')?.focus({ preventScroll: true });
        resolve({ scenario: operation, difficultyId });
      }, 320);
      return true;
    };

    deploy.addEventListener('click', () => void march());

    const port: WarCouncilPort = {
      authored: AUTHORED_SCENARIOS,
      getDraft: () => draft,
      setDraft: (operation) => {
        draft = operation;
        marshalDesign = true;
        renderOperations();
        renderBriefing();
      },
      setTableMap: (mapId) => {
        layTable(mapId);
        renderOperations();
        renderBriefing();
      },
      isMarshalDesign: () => marshalDesign,
      getSelection: () => ({ operationId: selectedId, difficultyId }),
      select: (operationId, nextDifficulty) => {
        selectedId = operationId;
        if (nextDifficulty !== undefined) difficultyId = nextDifficulty;
        rememberSelection();
        renderOperations();
        renderBriefing();
        renderDifficulty();
      },
      deploy: (operationId, nextDifficulty) => {
        selectedId = operationId;
        if (nextDifficulty !== undefined) difficultyId = nextDifficulty;
        rememberSelection();
        renderOperations();
        renderBriefing();
        renderDifficulty();
        return march();
      },
      hasDeployed: () => deployed,
    };

    void registerWarCouncilTools(createWarCouncilToolHandlers(port)).then((connection) => {
      close = connection.close;
      // Registration is asynchronous, and a commander who deployed while it was
      // in flight must not end up with design tools published over his battle.
      if (deployed) {
        connection.close();
        return;
      }
      if (connection.status === 'connected') {
        marshal.dataset.state = 'connected';
        marshalLabel.textContent = `MARSHAL READY · ${connection.toolCount} TOOLS`;
        marshal.title =
          'Your Marshal can read every battlefield, design an operation and deploy it.';
      } else if (connection.status === 'failed') {
        marshal.dataset.state = 'failed';
        marshalLabel.textContent = 'MARSHAL REFUSED';
        marshal.title = connection.message;
      } else {
        marshal.dataset.state = 'unavailable';
        marshalLabel.textContent = 'NO MARSHAL';
        marshal.title = getWebMcpCapabilityMessage();
      }
    });
  });
}
