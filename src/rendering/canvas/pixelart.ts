import { PALETTE } from './palette';

/**
 * The pixel-art vocabulary.
 *
 * Every drawn thing in the game — the ground, the woods, the keeps, the troop
 * icons in the roster, the glyphs on the command buttons — comes out of this
 * one file, so the map and the interface cannot drift apart stylistically.
 *
 * Art is authored as rows of characters on a fixed grid. A character indexes
 * `INK`; a dot is transparent. That keeps sprites diffable, keeps them out of
 * the asset pipeline entirely, and lets the same source emit either canvas
 * pixels for the battlefield or SVG rectangles for the DOM.
 */

/**
 * The one font the drawn map uses.
 *
 * A true bitmap face would suit the art better, but the production headers
 * allow no third-party font source, and a hand-rolled one would cost more
 * legibility than it bought. A crisp monospace, set in caps on a plate, holds
 * up over a dithered field at every zoom the camera reaches.
 */
export const LABEL_FONT = 'ui-monospace, "Cascadia Mono", Consolas, Menlo, monospace';

export interface Sprite {
  readonly rows: readonly string[];
  /** Where the sprite's origin sits, in sprite pixels. Defaults to bottom centre. */
  readonly anchorX?: number;
  readonly anchorY?: number;
}

/** The full ink set. Two characters never share a colour, so art reads clearly. */
export const INK: Record<string, string> = {
  '#': PALETTE.shadow,
  k: PALETTE.stoneDark,
  s: PALETTE.stone,
  S: PALETTE.stoneLight,
  w: PALETTE.timberDark,
  W: PALETTE.timber,
  V: PALETTE.timberLight,
  e: PALETTE.earthDark,
  E: PALETTE.earth,
  n: PALETTE.sandDark,
  N: PALETTE.sand,
  g: PALETTE.forest,
  G: PALETTE.forestCanopy,
  l: PALETTE.grass,
  L: PALETTE.grassAlt,
  r: PALETTE.villageRoof,
  R: PALETTE.bannerRed,
  o: PALETTE.bannerGold,
  b: PALETTE.bannerBlue,
  y: PALETTE.kingGold,
  f: PALETTE.flame,
  F: PALETTE.flameCore,
  i: PALETTE.river,
  I: PALETTE.riverEdge,
  a: PALETTE.foam,
  m: PALETTE.smoke,
  /* Interface inks. Used by the roster and command glyphs, never by the map. */
  A: PALETTE.selection,
  B: PALETTE.selectionDark,
  C: PALETTE.player,
  D: PALETTE.enemy,
  P: '#e6e0cb',
  Q: '#9aa294',
};

export function spriteWidth(sprite: Sprite): number {
  return sprite.rows.reduce((widest, row) => Math.max(widest, row.length), 0);
}

export function spriteHeight(sprite: Sprite): number {
  return sprite.rows.length;
}

/**
 * Paints a sprite onto a canvas at one canvas pixel per art pixel.
 *
 * Runs of one colour are merged into a single fill, which matters because the
 * battlefield bake paints a few thousand sprites in one pass at load.
 */
export function paintSprite(
  context: CanvasRenderingContext2D,
  sprite: Sprite,
  originX: number,
  originY: number,
  scale = 1,
  inks: Record<string, string> = INK,
): void {
  const width = spriteWidth(sprite);
  const height = spriteHeight(sprite);
  const anchorX = sprite.anchorX ?? width / 2;
  const anchorY = sprite.anchorY ?? height;
  const left = Math.round(originX - anchorX * scale);
  const top = Math.round(originY - anchorY * scale);

  for (let row = 0; row < height; row += 1) {
    const line = sprite.rows[row] ?? '';
    let column = 0;
    while (column < line.length) {
      const character = line[column] ?? '.';
      if (character === '.') {
        column += 1;
        continue;
      }
      let run = 1;
      while (line[column + run] === character) run += 1;
      const fill = inks[character];
      if (fill !== undefined) {
        context.fillStyle = fill;
        context.fillRect(left + column * scale, top + row * scale, run * scale, scale);
      }
      column += run;
    }
  }
}

/** Bakes a sprite once into its own canvas, for anything drawn every frame. */
export function bakeSprite(sprite: Sprite, scale = 1): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, spriteWidth(sprite) * scale);
  canvas.height = Math.max(1, spriteHeight(sprite) * scale);
  const context = canvas.getContext('2d');
  if (context !== null) {
    context.imageSmoothingEnabled = false;
    paintSprite(
      context,
      { ...sprite, anchorX: 0, anchorY: 0 },
      0,
      0,
      scale,
    );
  }
  return canvas;
}

/**
 * A stable hash for cosmetic scatter.
 *
 * Deliberately not the simulation PRNG: art must never consume that stream, or
 * two players on the same seed would fight different battles because one of
 * them had a wider window.
 */
export function artHash(a: number, b: number): number {
  let value = (Math.imul(a | 0, 0x27d4_eb2d) ^ Math.imul(b | 0, 0x1656_67b1)) >>> 0;
  value ^= value >>> 15;
  value = Math.imul(value, 0x2c1b_3c6d) >>> 0;
  value ^= value >>> 12;
  return value / 0x1_0000_0000;
}

/* ------------------------------------------------------------------ terrain */

export const TREE_PINE: Sprite = {
  rows: [
    '...G...',
    '..GGG..',
    '..GgG..',
    '.GGGGG.',
    '.GGgGG.',
    'GGGGGGG',
    '.GggGG.',
    '...W...',
    '...w...',
    '..###..',
  ],
};

export const TREE_OAK: Sprite = {
  rows: [
    '..GGG..',
    '.GGGGG.',
    'GGGGgGG',
    'GGgGGGG',
    'GGGGGgG',
    '.GgGGG.',
    '..GWG..',
    '...w...',
    '..###..',
  ],
};

export const TREE_DEAD: Sprite = {
  rows: [
    '..w.w..',
    '..www..',
    '.w.W.w.',
    '...W...',
    '..wWw..',
    '...W...',
    '...W...',
    '...w...',
    '..###..',
  ],
};

export const BUSH: Sprite = {
  rows: ['.GG.', 'GGGG', '.gg.'],
};

/** A thatched cottage. The commonest thing on any of these maps. */
export const COTTAGE: Sprite = {
  rows: [
    '...rrr...',
    '..rrrrr..',
    '.rrrrrrr.',
    'rrrrrrrrr',
    '#WWWWWWW#',
    '.WeWWWeW.',
    '.WWWeWWW.',
    '.##ee##..',
  ],
};

/** A larger hall, so a village is not nine copies of one building. */
export const HALL: Sprite = {
  rows: [
    '..rrrrrrr..',
    '.rrrrrrrrr.',
    'rrrrrrrrrrr',
    '#WWWWWWWWW#',
    '.WeWWWWWeW.',
    '.WWWWeWWWW.',
    '.WeWWeWWeW.',
    '.###eeee##.',
  ],
};

/** A stone keep. Marks the ground a king actually stands on. */
export const KEEP: Sprite = {
  rows: [
    '.s.s.s.s.s.',
    '.sssssssss.',
    '.skssssssk.',
    '.sssssssss.',
    'sssssssssss',
    'sskssssskss',
    'sssssssssss',
    'sskssssskss',
    'ssssEEEssss',
    'ssssEEEssss',
    'kkkkEEEkkkk',
    '###########',
  ],
};

/** A watchtower, for high ground. */
export const WATCHTOWER: Sprite = {
  rows: [
    '.s.s.s.',
    '.sssss.',
    '.skkks.',
    'sssssss',
    '.sssss.',
    '.sksks.',
    '.sssss.',
    '.ssess.',
    '.ssess.',
    '.kkkkk.',
    '.#####.',
  ],
};

/** A mine head: cut timber frame, spoil heap, dark adit. */
export const MINE: Sprite = {
  rows: [
    '..WWWWW..',
    '.WwwwwwW.',
    '.W##..#W.',
    '.W#####W.',
    'nW#####Wn',
    'nn#####nn',
    'nnnnnnnnn',
    '.nn###nn.',
  ],
};

/** A signpost with a hanging shield. Marks a road junction. */
export const WAYPOST: Sprite = {
  rows: ['.ooo.', 'oRoRo', '.ooo.', '..W..', '..W..', '..w..', '.###.'],
};

/** Broken rock along an impassable spine. */
export const CRAG: Sprite = {
  rows: ['..SS...', '.SsssS.', 'Sssksss', 'ssksskk', '#kk##k#'],
};

/* ---------------------------------------------------------------- unit roles */

/**
 * Troop icons.
 *
 * Eight by eight, one silhouette each, and readable at that size — which is the
 * whole point, since the roster shows them at 16 CSS pixels and the map draws
 * them over a moving battle.
 */
export const ROLE_SPRITES: Record<string, Sprite> = {
  infantry: {
    rows: [
      '....PP..',
      '...PPP..',
      '..PPP...',
      '.PPP.Q..',
      'PPP..Q..',
      '.B..QQQ.',
      '.B......',
      '........',
    ],
  },
  spearman: {
    rows: [
      '.....P..',
      '....PP..',
      '...PPP..',
      '..P.P...',
      '.QQQ....',
      'QQQQQ...',
      '.QQQ....',
      '..W.....',
    ],
  },
  heavy_infantry: {
    rows: [
      '.QQQQQQ.',
      'QPPPPPPQ',
      'QPBBBBPQ',
      'QPBPPBPQ',
      'QPBBBBPQ',
      '.QPPPPQ.',
      '..QPPQ..',
      '...QQ...',
    ],
  },
  archer: {
    rows: [
      '..Q.....',
      '.Q.Q....',
      'Q...Q...',
      'Q...PPPP',
      'Q...Q...',
      '.Q.Q....',
      '..Q.....',
      '........',
    ],
  },
  scout: {
    rows: [
      '........',
      '..QQQQ..',
      '.QPPPPQ.',
      'QPPAAPPQ',
      '.QPPPPQ.',
      '..QQQQ..',
      '........',
      '........',
    ],
  },
  cavalry: {
    rows: [
      '..QQ....',
      '.QQQQ...',
      'QQQQQQ..',
      '.QQQQQQ.',
      '..QQQQQQ',
      '..QQ.QQ.',
      '..Q...Q.',
      '..Q...Q.',
    ],
  },
  siege: {
    rows: [
      '.....W..',
      '....WW..',
      '...WW...',
      'WWWW....',
      '.W..W...',
      '.W...W..',
      'kWWWWWk.',
      '.k...k..',
    ],
  },
};

/* -------------------------------------------------------------- the ranks */

/**
 * The men on the field, as figures rather than counters.
 *
 * A soldier drawn on the battlefield cannot be a `Sprite`: eight thousand of
 * them are painted every frame, and reading a character grid per man would
 * cost sixty-four cells each. So a figure is instead a handful of rectangles
 * grouped by ink, which lets the whole army be drawn ink by ink — every
 * shadow in one fill, every shaft in the next — no matter how many different
 * kinds of troops are standing on the field.
 *
 * Coordinates are grid cells with the origin between the man's feet and `y`
 * rising, so a figure is authored the way it is seen. Five cells across is one
 * unit block, which is what ties a drawn man to the ground he occupies.
 *
 * Only five inks are used, and all five are already in the palette: the same
 * shadow the canopy casts, the same timber the palisades are cut from, the
 * same dressed stone as the keeps for anything steel, sand for skin and linen,
 * and the regiment's own colour for cloth. A soldier is therefore made of the
 * country he is standing in.
 */

export const FIGURE_SHADOW = 0;
export const FIGURE_WOOD = 1;
export const FIGURE_BODY = 2;
export const FIGURE_SKIN = 3;
export const FIGURE_METAL = 4;
export const FIGURE_LAYERS = 5;

export interface FigureCell {
  readonly layer: number;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /**
   * Drawn at command zoom as well as close to.
   *
   * The core cells are the ones that carry the silhouette — the shaft of a
   * spear, the barrel of a horse, the bed of an engine. A commander looking at
   * the whole valley still has to be able to tell one arm from another, and
   * these are the cells that tell him.
   */
  readonly core?: boolean;
}

const shadow = (x: number, y: number, w: number, h: number, core = false): FigureCell =>
  ({ layer: FIGURE_SHADOW, x, y, w, h, core });
const wood = (x: number, y: number, w: number, h: number, core = false): FigureCell =>
  ({ layer: FIGURE_WOOD, x, y, w, h, core });
const cloth = (x: number, y: number, w: number, h: number, core = false): FigureCell =>
  ({ layer: FIGURE_BODY, x, y, w, h, core });
const skin = (x: number, y: number, w: number, h: number, core = false): FigureCell =>
  ({ layer: FIGURE_SKIN, x, y, w, h, core });
const steel = (x: number, y: number, w: number, h: number, core = false): FigureCell =>
  ({ layer: FIGURE_METAL, x, y, w, h, core });

/**
 * Every troop type, drawn facing right. Facing left is the same art mirrored.
 *
 * Legs are cut in shadow rather than cloth, which is what makes a man read as
 * a man at this size: the ground shows between them, so a rank is a row of
 * figures rather than a row of dominoes.
 */
export const FIGURES: Record<string, readonly FigureCell[]> = {
  /** Sword and shield. The plainest figure, and the one all the others answer to. */
  infantry: [
    shadow(-2.1, 0, 4.2, 0.8, true),
    shadow(-1.3, 0.5, 1.1, 2.1),
    shadow(0.2, 0.5, 1.1, 2.1),
    cloth(-1.6, 2.2, 3.2, 2.6, true),
    skin(-0.8, 4.7, 1.6, 1),
    steel(-1.3, 5.5, 2.6, 1.2, true),
    steel(2.1, 2.6, 0.8, 4),
    steel(-3, 2.3, 1.3, 2.2),
  ],

  /** The shaft is the whole point: a spear block should read as a hedge. */
  spearman: [
    shadow(-2.1, 0, 4.2, 0.8, true),
    shadow(-1.3, 0.5, 1.1, 2.1),
    shadow(0.2, 0.5, 1.1, 2.1),
    cloth(-1.6, 2.2, 3.2, 2.6, true),
    skin(-0.9, 4.7, 1.8, 1.1),
    steel(-1.3, 5.6, 2.6, 1.2),
    wood(1.9, 1.4, 0.8, 8, true),
    steel(1.7, 9.2, 1.2, 1.8, true),
  ],

  /** Broader, helmed to the eyes, and carrying more iron than anyone else. */
  heavy_infantry: [
    shadow(-2.4, 0, 4.8, 0.8, true),
    shadow(-1.5, 0.5, 1.2, 2.1),
    shadow(0.3, 0.5, 1.2, 2.1),
    cloth(-1.9, 2.1, 3.8, 2.8, true),
    steel(-2.1, 4.2, 4.2, 0.8),
    skin(-0.7, 4.9, 1.4, 0.7),
    steel(-1.6, 5.4, 3.2, 1.6, true),
    steel(2.5, 2.2, 1.1, 3.6),
    steel(-3.4, 2.1, 1.4, 2.6),
  ],

  /** The bow is drawn as three cells of a curve, which is enough to read as one. */
  archer: [
    shadow(-2, 0, 4, 0.8, true),
    shadow(-1.2, 0.5, 1, 2.1),
    shadow(0.2, 0.5, 1, 2.1),
    cloth(-1.5, 2.2, 3, 2.5, true),
    skin(-0.9, 4.6, 1.8, 1.1),
    cloth(-1.3, 5.5, 2.6, 1),
    wood(2.2, 2.2, 0.8, 0.9),
    wood(2.8, 3, 0.8, 2.6, true),
    wood(2.2, 5.5, 0.8, 0.9),
  ],

  /** A long barrel held level: unmistakable beside a bow at any distance. */
  handgunner: [
    shadow(-2, 0, 4, 0.8, true),
    shadow(-1.2, 0.5, 1, 2.1),
    shadow(0.2, 0.5, 1, 2.1),
    cloth(-1.5, 2.2, 3, 2.5, true),
    skin(-0.9, 4.6, 1.8, 1.1),
    steel(-1.3, 5.5, 2.6, 1.1),
    wood(0.4, 3.2, 1.8, 0.9),
    steel(2, 3.7, 3.4, 0.8, true),
  ],

  /** Hooded, unarmoured and small. He is not meant to look like a line of battle. */
  scout: [
    shadow(-1.7, 0, 3.4, 0.7, true),
    shadow(-1.1, 0.4, 0.9, 1.9),
    shadow(0.2, 0.4, 0.9, 1.9),
    cloth(-1.3, 2, 2.6, 2.2, true),
    skin(-0.8, 4.1, 1.6, 1),
    cloth(-1.2, 4.9, 2.4, 1.1, true),
    steel(1.7, 2.4, 0.7, 2.2),
  ],

  /** Linen, a cross on the chest, and a satchel. No weapon at all. */
  surgeon: [
    shadow(-1.8, 0, 3.6, 0.7, true),
    shadow(-1.1, 0.4, 0.9, 1.9),
    shadow(0.2, 0.4, 0.9, 1.9),
    cloth(-1.4, 2, 2.8, 2.5, true),
    skin(-0.5, 2.6, 1, 1.6),
    skin(-1.1, 3.1, 2.2, 0.6),
    skin(-0.9, 4.4, 1.8, 1.1),
    skin(-1.3, 5.3, 2.6, 1, true),
    wood(-2.8, 2.2, 1.2, 1.6),
  ],

  /** Horse first, man second. The barrel and the lance are what carry at distance. */
  cavalry: [
    shadow(-3.3, 0, 6.6, 0.8, true),
    shadow(-2.4, 0.4, 0.9, 1.6),
    shadow(-0.5, 0.4, 0.9, 1.6),
    shadow(1.4, 0.4, 0.9, 1.6),
    wood(-3, 1.7, 5.6, 2, true),
    wood(2.2, 2.5, 1.4, 1.8),
    wood(3.1, 3.9, 1.7, 1),
    wood(-3.7, 2.3, 0.9, 1.6),
    cloth(-1.1, 3.5, 2.2, 2.2, true),
    skin(-0.6, 5.6, 1.4, 0.9),
    steel(-1, 6.4, 2.2, 1.1, true),
    wood(-0.2, 4.8, 5.2, 0.6, true),
    steel(4.8, 4.7, 1.4, 0.8),
  ],

  /** A trebuchet: bed, frame, and an arm thrown up into the air. */
  siege: [
    shadow(-4.2, 0, 8.4, 0.8, true),
    shadow(-3, 0.2, 2, 1.5),
    shadow(1.2, 0.2, 2, 1.5),
    wood(-3.6, 1.4, 7.2, 1.4, true),
    wood(-2.3, 2.6, 1, 2.7),
    wood(1.4, 2.6, 1, 2.7),
    wood(-0.4, 2.8, 1, 2.2, true),
    wood(0.4, 4.8, 1, 2.2, true),
    wood(1.2, 6.8, 1, 2, true),
    steel(1.4, 8.6, 1.8, 1.2),
    steel(-3.8, 2.7, 1.1, 1.2),
  ],

  /** The longest thing on the field, and the one a commander must be able to find. */
  cannon: [
    shadow(-4.6, 0, 9.2, 0.8, true),
    shadow(-3.2, 0.2, 2.1, 1.6),
    shadow(0.9, 0.2, 2.1, 1.6),
    wood(-4, 1.4, 6.6, 1.4, true),
    steel(-2.4, 2.6, 6.6, 1.4, true),
    steel(4.1, 2.3, 1.2, 2),
    steel(-3.1, 2.7, 0.9, 1.2),
  ],
};

/* ------------------------------------------------------------ command glyphs */

/** Crossed swords: two full blades, two guards, two grips. */
export const ICON_ATTACK: Sprite = {
  rows: [
    '.P....P.',
    '.PP..PP.',
    '..PPPP..',
    '...PP...',
    '..QPPQ..',
    '.Q.PP.Q.',
    'B..PP..B',
    'BB.QQ.BB',
  ],
};

/** A planted standard: stand and do not move. */
export const ICON_HOLD: Sprite = {
  rows: [
    '..oooo..',
    '..oRRo..',
    '..oooo..',
    '..W.....',
    '..W.....',
    '..W.....',
    '.QQQQQ..',
    'QQQQQQQ.',
  ],
};

/** A kite shield. */
export const ICON_DEFEND: Sprite = {
  rows: [
    'QQQQQQQQ',
    'QPPPPPPQ',
    'QPAAAAPQ',
    'QPAPPAPQ',
    'QPAAAAPQ',
    '.QPPPPQ.',
    '..QPPQ..',
    '...QQ...',
  ],
};

/** A column turning about. */
export const ICON_RETREAT: Sprite = {
  rows: [
    '........',
    '..P.....',
    '.PP.....',
    'PPPPPPP.',
    '.PP...P.',
    '..P...P.',
    '......P.',
    '....QQQ.',
  ],
};

/** Ranks and files. */
export const ICON_FORMATION: Sprite = {
  rows: [
    'PP.PP.PP',
    'PP.PP.PP',
    '........',
    'PP.PP.PP',
    'PP.PP.PP',
    '........',
    'QQ.QQ.QQ',
    'QQ.QQ.QQ',
  ],
};

/** An eye over the line these men hold: how far they will leave it. */
export const ICON_STANCE: Sprite = {
  rows: [
    '..QQQQ..',
    '.Q....Q.',
    'Q..PP..Q',
    'Q.PAAP.Q',
    'Q..PP..Q',
    '.Q....Q.',
    '..QQQQ..',
    'QQQQQQQQ',
  ],
};

/** One body becoming two. */
export const ICON_SPLIT: Sprite = {
  rows: [
    'PPP.....',
    'PPP.PP..',
    '..P.PP..',
    '..PP....',
    '..PP....',
    '..P.PP..',
    'PPP.PP..',
    'PPP.....',
  ],
};

/** Two bodies becoming one. */
export const ICON_MERGE: Sprite = {
  rows: [
    'PP.....P',
    'PP...PPP',
    '..PPP..P',
    '....PPPP',
    '....PPPP',
    '..PPP..P',
    'PP...PPP',
    'PP.....P',
  ],
};

/* ------------------------------------------------------------- status glyphs */

export const ICON_CROWN: Sprite = {
  rows: [
    'y.....y',
    'y.y.y.y',
    'y.y.y.y',
    'yyyyyyy',
    'yoRoRoy',
    'yyyyyyy',
    '.#####.',
  ],
};

export const ICON_STRENGTH: Sprite = {
  rows: [
    '..CC..',
    '.CCCC.',
    'CC..CC',
    'CC..CC',
    '.CCCC.',
    '..CC..',
  ],
};

export const ICON_ENEMY: Sprite = {
  rows: [
    'D....D',
    '.D..D.',
    '..DD..',
    '..DD..',
    '.D..D.',
    'D....D',
  ],
};

export const ICON_REINFORCE: Sprite = {
  rows: [
    '..PP..',
    '.PPPP.',
    'PPPPPP',
    '..PP..',
    '..PP..',
    '..PP..',
  ],
};

export const ICON_CLOCK: Sprite = {
  rows: [
    '.QQQQ.',
    'QPPPPQ',
    'QPAPPQ',
    'QPAAPQ',
    'QPPPPQ',
    '.QQQQ.',
  ],
};

export const ICON_MORALE: Sprite = {
  rows: [
    '.A..A.',
    'AAAAAA',
    'AAAAAA',
    '.AAAA.',
    '..AA..',
    '...A..',
  ],
};

export const ICON_BANNER: Sprite = {
  rows: [
    'oooooo',
    'oRRRRo',
    'oRooRo',
    'oooooo',
    '..W...',
    '..W...',
  ],
};

export const ICON_TERRAIN: Sprite = {
  rows: [
    '...G..',
    '..GGG.',
    '.GGGGG',
    '..lLl.',
    '.lLlLl',
    'llllll',
  ],
};

/* ------------------------------------------------------------------- brand */

/**
 * The wordmark.
 *
 * Hand-set on a five-by-seven grid and outlined in the same shadow ink the
 * terrain uses, so the title of the game is drawn out of the game's own
 * material rather than set in a typeface the battlefield has never seen. It is
 * the one sprite in the file authored at more than icon size, and it is the
 * only place the interface says the game's name.
 */
export const LOGO_SIEGE: Sprite = {
  rows: [
    '.##############################',
    '##ooo##ooooo#ooooo##ooo##ooooo#',
    '#oo##o###o###oo####oo##o#oo####',
    '#oo####.#o#.#oo####oo####oo###.',
    '##ooo##.#o#.#oooo##oo#oo#oooo#.',
    '####oo#.#o#.#oo####oo##o#oo###.',
    '#o##oo###o###oo####oo##o#oo####',
    '##ooo##ooooo#ooooo##ooo##ooooo#',
    '.##############################',
  ],
};

/**
 * The Crown crest: a three-pointed crown over a shield.
 *
 * It stands where a favicon, a header mark or a seal is needed. Gold for the
 * crown because gold is the sovereign's colour everywhere else in the game,
 * and crimson for the field because the Crown's own heraldry has to be
 * distinguishable from the blue its soldiers are drawn in.
 */
export const ICON_CREST: Sprite = {
  rows: [
    '.y...y...y.',
    '.yy.yyy.yy.',
    '.yyyyyyyyy.',
    '.yoyoyoyoy.',
    '.yyyyyyyyy.',
    'ooooooooooo',
    'oRRRRoRRRRo',
    'oRRRRoRRRRo',
    'oRoooooooRo',
    '.oRRRoRRRo.',
    '.oRRRoRRRo.',
    '..oRRoRRo..',
    '...oRoRo...',
    '....ooo....',
  ],
};

/** A folded map. Marks the battlefield portrait and anything about ground. */
export const ICON_MAP: Sprite = {
  rows: [
    'PPPPPPPP',
    'PllLlLlP',
    'PlGGlLlP',
    'PlGlliiP',
    'PllliilP',
    'PlNllllP',
    'PlllNllP',
    'PPPPPPPP',
  ],
};

/** Every glyph the interface can ask for, by name. */
export const UI_SPRITES: Record<string, Sprite> = {
  attack: ICON_ATTACK,
  hold: ICON_HOLD,
  defend: ICON_DEFEND,
  retreat: ICON_RETREAT,
  formation: ICON_FORMATION,
  stance: ICON_STANCE,
  split: ICON_SPLIT,
  merge: ICON_MERGE,
  crown: ICON_CROWN,
  strength: ICON_STRENGTH,
  enemy: ICON_ENEMY,
  reinforce: ICON_REINFORCE,
  clock: ICON_CLOCK,
  morale: ICON_MORALE,
  banner: ICON_BANNER,
  terrain: ICON_TERRAIN,
  crest: ICON_CREST,
  logo: LOGO_SIEGE,
  map: ICON_MAP,
  ...ROLE_SPRITES,
};

