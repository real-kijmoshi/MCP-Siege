import { INK, UI_SPRITES, spriteHeight, spriteWidth, type Sprite } from '../rendering/canvas/pixelart';

/**
 * Pixel glyphs for the DOM.
 *
 * The interface draws from exactly the same sprite sheet as the battlefield, so
 * the shield on the Defend button and the shield over a heavy regiment on the
 * map are one drawing rather than two people's idea of a shield. Emitting SVG
 * rectangles rather than an image keeps every glyph crisp at any size and any
 * pixel ratio, and keeps the whole icon set inside the bundle — the production
 * headers allow no third-party image source.
 */

/** Rows of one colour are merged, which keeps a glyph down to a few rects. */
function spriteRects(sprite: Sprite): string {
  const parts: string[] = [];
  const height = spriteHeight(sprite);

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
      const fill = INK[character];
      if (fill !== undefined) {
        parts.push(`<rect x="${column}" y="${row}" width="${run}" height="1" fill="${fill}"/>`);
      }
      column += run;
    }
  }
  return parts.join('');
}

const cache = new Map<string, string>();

/**
 * The markup for one glyph, by name.
 *
 * Returns an empty string for a name that has no art rather than throwing: a
 * missing icon should cost a blank square, never a blank battlefield.
 */
export function iconMarkup(name: string): string {
  const cached = cache.get(name);
  if (cached !== undefined) return cached;

  const sprite = UI_SPRITES[name];
  if (sprite === undefined) return '';

  const markup =
    `<svg class="pixel-icon" viewBox="0 0 ${spriteWidth(sprite)} ${spriteHeight(sprite)}" ` +
    `shape-rendering="crispEdges" aria-hidden="true" focusable="false">${spriteRects(sprite)}</svg>`;
  cache.set(name, markup);
  return markup;
}

/** A glyph as a detached element, for code that builds its DOM by hand. */
export function iconElement(name: string): HTMLSpanElement {
  const holder = document.createElement('span');
  holder.className = 'icon';
  holder.innerHTML = iconMarkup(name);
  return holder;
}

/**
 * Fills every `[data-icon]` placeholder in the document.
 *
 * The markup declares which glyph it wants and this puts the art in, so the
 * page never ships a Unicode stand-in that a font might render as a box, a
 * colour emoji, or nothing at all.
 */
export function mountIcons(root: ParentNode = document): void {
  for (const holder of root.querySelectorAll<HTMLElement>('[data-icon]')) {
    const name = holder.dataset.icon;
    if (name === undefined || holder.dataset.iconMounted === name) continue;
    holder.innerHTML = iconMarkup(name);
    holder.dataset.iconMounted = name;
  }
}
