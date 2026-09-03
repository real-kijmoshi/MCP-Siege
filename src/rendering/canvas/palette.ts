/**
 * The battlefield palette.
 *
 * A medieval pixel-art set: dark greens, earth browns, sand, stone grey, gold
 * and dark red. Every colour is a flat, saturated-but-earthy ramp with no
 * gradients, because the whole map is drawn as chunky pixels and a gradient
 * would smear the edges the art depends on.
 *
 * Readability at a glance is still the design goal. Terrain sits in the green
 * and brown half of the wheel; the armies own blue and crimson; and gold is
 * reserved for two things only — what the player has selected, and the kings.
 */

export const PALETTE = {
  /* ------------------------------------------------------------- ground */
  grass: '#3a5730',
  /*
   * Close to `grass` on purpose. The ground is dithered between the two at
   * every pixel, and a wide gap between them turned a quiet field into visual
   * static that fought the armies standing on it.
   */
  grassAlt: '#3f5d34',
  openField: '#4d7040',
  forest: '#22371f',
  forestCanopy: '#2f4d27',
  hill: '#6d6140',
  hillContour: '#8d7d51',
  /** Close to `hill`, for the same reason `grassAlt` is close to `grass`. */
  hillAlt: '#635840',
  river: '#27506e',
  riverEdge: '#4682a4',
  crossing: '#7b5a34',
  crossingEdge: '#ab8049',
  road: '#8d784f',
  village: '#6a4c32',
  villageRoof: '#8e3f34',

  /* ------------------------------------------------ pixel-art extensions */
  /** Deep shadow under canopy, walls and cliffs. One shade, used everywhere. */
  shadow: '#1a2618',
  /** Bare tilled earth, cart ruts, mine spoil. */
  earth: '#5a4530',
  earthDark: '#3f3021',
  /** Dressed stone for keeps, towers and bridges. */
  stone: '#7c7b70',
  stoneDark: '#4f4f47',
  stoneLight: '#a3a297',
  /** Sun-bleached sand and dry track. */
  sand: '#c2a774',
  sandDark: '#93794c',
  /** Sawn timber for palisades, bridge decks and roof beams. */
  timber: '#7a5433',
  timberDark: '#4d3520',
  timberLight: '#a3713f',
  /** Heraldic cloth. Banners are the loudest thing on the ground. */
  bannerGold: '#e8bd4e',
  bannerRed: '#9c2f2a',
  bannerBlue: '#3f6fae',
  /** Torch and hearth light, used for the flicker overlay. */
  flame: '#ffb547',
  flameCore: '#ffe08a',
  smoke: '#6a6e66',
  /** Foam and shallow water highlight. */
  foam: '#8fc6d8',

  /* --------------------------------------------------- ground detailing */
  /**
   * Moss, pebbles and scree. These never form a shape of their own; they are
   * scattered a pixel or two at a time over grass and rock so that a field
   * reads as ground that has been rained on rather than as a flat fill. `moss`
   * is only the fallback: a map that tints its ground grows its own.
   */
  moss: '#42603a',
  pebble: '#6d6a5e',
  scree: '#8b887c',
  /** Birch bark. Pale, but never the white that reads as litter on a map. */
  birchBark: '#8d8f80',
  /**
   * The crest that catches the light in shoaling water. The water tones
   * themselves are derived per map from its own river colour, so that an ash
   * country river is not shaded in the blues of a farmland one.
   */
  shallowLight: '#63a2b8',
  /** Roofing. Thatch is straw over rafters; tile is fired clay laid in courses. */
  thatch: '#9b8250',
  thatchDark: '#6c5934',
  roofTileDark: '#5d342a',
  /** Kitchen gardens and the beaten cobble of a market square. */
  garden: '#59692f',
  gardenDark: '#3f4c21',
  cobble: '#877f6f',
  cobbleDark: '#665f52',
  /** Camp canvas. The one pale colour on a battlefield of green and brown. */
  tentCloth: '#c4b89c',
  tentClothDark: '#948a72',

  /* ------------------------------------------------------------ overlays */
  zoneLabel: 'rgba(233, 227, 199, 0.72)',
  zoneRing: 'rgba(198, 176, 116, 0.22)',
  crossingLabel: 'rgba(240, 200, 108, 0.94)',

  fogUnexplored: '#0b0f0a',
  mapEdge: 'rgba(140, 122, 74, 0.30)',
  fogExplored: 'rgba(8, 11, 7, 0.55)',

  /* ------------------------------------------------------------- armies */
  player: '#5b8ed6',
  playerDark: '#36598f',
  playerLight: '#9cc0ef',
  enemy: '#b23a30',
  enemyDark: '#78241d',
  enemyLight: '#dd7a6f',

  /** Selection is gold, and gold is the loudest signal the interface has. */
  selection: '#f0c250',
  selectionFill: 'rgba(240, 194, 80, 0.13)',
  selectionDark: '#a8802a',

  plan: '#a98cd8',
  planFill: 'rgba(169, 140, 216, 0.15)',

  /** The objective. A warmer, brighter gold than selection, and crowned. */
  kingGold: '#ffd75e',
  kingDanger: '#ff7a3d',

  moraleGood: '#74be58',
  moraleWarn: '#d8a63c',
  moraleBad: '#c2483c',

  arrow: '#e6e0cb',
  melee: '#ffd27a',
  siegeBlast: '#ff9d4a',
} as const;

/** Morale colour used by both the army list and the on-map strength bars. */
export function moraleColor(morale: number): string {
  if (morale >= 55) return PALETTE.moraleGood;
  if (morale >= 25) return PALETTE.moraleWarn;
  return PALETTE.moraleBad;
}
