/**
 * The battlefield palette.
 *
 * Muted, desaturated terrain so that the only saturated things on screen are
 * the armies. Readability at a glance is the whole design goal: a commander
 * should be able to tell what is happening zoomed all the way out.
 */

export const PALETTE = {
  grass: '#263a29',
  grassAlt: '#2d4330',
  openField: '#304833',
  forest: '#1b2d21',
  forestCanopy: '#285033',
  hill: '#394b2d',
  hillContour: '#536843',
  river: '#17415a',
  riverEdge: '#2d6884',
  crossing: '#6b5942',
  crossingEdge: '#9a8058',
  road: '#505141',
  village: '#574b35',
  villageRoof: '#716044',

  zoneLabel: 'rgba(222, 235, 215, 0.62)',
  zoneRing: 'rgba(175, 208, 170, 0.20)',
  crossingLabel: 'rgba(255, 222, 158, 0.92)',

  fogUnexplored: '#080b09',
  mapEdge: 'rgba(120, 152, 118, 0.22)',
  fogExplored: 'rgba(6, 10, 8, 0.55)',

  player: '#4d9dff',
  playerDark: '#2f6dbb',
  playerLight: '#8cc4ff',
  enemy: '#ff5347',
  enemyDark: '#bb3229',
  enemyLight: '#ff8b83',

  selection: '#7dffb0',
  selectionFill: 'rgba(125, 255, 176, 0.10)',

  plan: '#c08bff',
  planFill: 'rgba(192, 139, 255, 0.14)',

  /** The only gold on the map: the objective, and nothing else. */
  kingGold: '#f5c451',
  kingDanger: '#ff7a3d',

  moraleGood: '#5fd08a',
  moraleWarn: '#e8c15a',
  moraleBad: '#ff6b5b',

  arrow: '#e8eee6',
  melee: '#ffd47a',
  siegeBlast: '#ff9d4a',
} as const;

/** Morale colour used by both the army list and the on-map strength bars. */
export function moraleColor(morale: number): string {
  if (morale >= 55) return PALETTE.moraleGood;
  if (morale >= 25) return PALETTE.moraleWarn;
  return PALETTE.moraleBad;
}
