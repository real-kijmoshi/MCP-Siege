import {
  DIFFICULTIES,
  DIFFICULTY_IDS,
  SCENARIO_IDS,
  type DifficultyId,
  type ScenarioId,
} from '../game/config/matches';
import { BATTLE_MAPS } from '../game/config/maps';
import { SCENARIOS } from '../game/config/scenario';

export interface MatchSelection {
  scenarioId: ScenarioId;
  difficultyId: DifficultyId;
}

function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`Missing lobby element #${id}.`);
  return element as T;
}

/** Owns the inert pre-battle selection screen. No simulation exists until deployment. */
export function showLobby(): Promise<MatchSelection> {
  const root = requireElement<HTMLElement>('lobby');
  const scenarioList = requireElement<HTMLElement>('lobby-scenarios');
  const difficultyList = requireElement<HTMLElement>('lobby-difficulties');
  const difficultyDescription = requireElement<HTMLElement>('difficulty-description');
  const briefingName = requireElement<HTMLElement>('briefing-name');
  const briefingDescription = requireElement<HTMLElement>('briefing-description');
  const briefingGround = requireElement<HTMLElement>('briefing-ground');
  const briefingOrders = requireElement<HTMLElement>('briefing-orders');
  const briefingFacts = requireElement<HTMLElement>('briefing-facts');
  const mapCaption = requireElement<HTMLElement>('briefing-map-caption');
  const deploy = requireElement<HTMLButtonElement>('lobby-deploy');

  let scenarioId: ScenarioId = 'riverwatch';
  let difficultyId: DifficultyId = 'captain';

  const updateScenarioSelection = (): void => {
    for (const other of scenarioList.querySelectorAll<HTMLButtonElement>('.mission-entry')) {
      const selected = other.dataset.scenario === scenarioId;
      other.classList.toggle('selected', selected);
      other.setAttribute('aria-pressed', String(selected));
    }
  };

  const updateDifficultySelection = (): void => {
    for (const other of difficultyList.querySelectorAll<HTMLButtonElement>('.difficulty-option')) {
      const selected = other.dataset.difficulty === difficultyId;
      other.classList.toggle('selected', selected);
      other.setAttribute('aria-pressed', String(selected));
    }
  };

  const renderBriefing = (): void => {
    const scenario = SCENARIOS[scenarioId];
    const map = BATTLE_MAPS[scenario.mapId];
    briefingName.textContent = scenario.name;
    briefingDescription.textContent = scenario.briefingLine;
    // The ground is half the operation, so it is named before the orders are.
    briefingGround.textContent = `${map.name} — ${map.terrainNote}`;
    mapCaption.textContent = map.caption;
    briefingOrders.replaceChildren(
      ...scenario.battleOrders.map((order) => {
        const line = document.createElement('strong');
        line.textContent = order;
        return line;
      }),
    );
    briefingFacts.replaceChildren(
      ...scenario.battleFacts.map((fact) => {
        const item = document.createElement('span');
        item.textContent = fact;
        return item;
      }),
    );
    root.dataset.scenario = scenarioId;
    root.dataset.map = scenario.mapId;
  };

  const renderDifficulty = (): void => {
    difficultyDescription.textContent = DIFFICULTIES[difficultyId].description;
  };

  for (const id of SCENARIO_IDS) {
    const scenario = SCENARIOS[id];
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'mission-entry';
    button.dataset.scenario = id;
    button.innerHTML =
      `<span class="mission-number">${scenario.eyebrow.split(' · ')[0]}</span>` +
      `<span class="mission-name"><strong>${scenario.name}</strong><small>${scenario.location}</small></span>` +
      `<b class="mission-pressure">${scenario.pressure}</b>` +
      '<i class="mission-seal" aria-hidden="true">♜</i>';
    button.addEventListener('click', () => {
      scenarioId = id;
      updateScenarioSelection();
      renderBriefing();
    });
    button.setAttribute('aria-pressed', String(id === scenarioId));
    button.classList.toggle('selected', id === scenarioId);
    scenarioList.append(button);
  }

  for (const id of DIFFICULTY_IDS) {
    const difficulty = DIFFICULTIES[id];
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'difficulty-option';
    button.dataset.difficulty = id;
    // The commander's title, and under it which of the three this actually is.
    // The titles alone told a first-time player nothing about which to pick.
    const title = document.createElement('strong');
    title.textContent = difficulty.name;
    const tier = document.createElement('small');
    tier.textContent = difficulty.tier;
    button.append(title, tier);
    button.setAttribute('aria-label', `${difficulty.name} — ${difficulty.tier}`);
    button.addEventListener('click', () => {
      difficultyId = id;
      updateDifficultySelection();
      renderDifficulty();
    });
    button.setAttribute('aria-pressed', String(id === difficultyId));
    button.classList.toggle('selected', id === difficultyId);
    difficultyList.append(button);
  }

  renderBriefing();
  renderDifficulty();

  return new Promise((resolve) => {
    deploy.addEventListener(
      'click',
      () => {
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
          resolve({ scenarioId, difficultyId });
        }, 320);
      },
      { once: true },
    );
  });
}
