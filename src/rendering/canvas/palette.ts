/**
 * The battlefield palette.
 *
 * Muted, desaturated terrain so that the only saturated things on screen are
 * the armies. Readability at a glance is the whole design goal: a commander
 * should be able to tell what is happening zoomed all the way out.
 */

export const PALETTE = {
  grass: '#1a2a1d',
  grassAlt: '#1f3021',
  openField: '#213424',
  forest: '#132018',
  forestCanopy: '#1d3a24',
  hill: '#26361f',
  hillContour: '#31462a',
  river: '#132c3c',
  riverEdge: '#1b4258',
  crossing: '#4b4133',
  crossingEdge: '#65573f',
  road: '#33352b',
  village: '#3a3427',
  villageRoof: '#4a4130',

  zoneLabel: 'rgba(196, 214, 190, 0.42)',
  zoneRing: 'rgba(150, 180, 150, 0.10)',
  crossingLabel: 'rgba(232, 206, 150, 0.72)',

  fogUnexplored: '#080b09',
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
