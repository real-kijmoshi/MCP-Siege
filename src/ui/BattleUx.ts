export interface BattleUxActions {
  zoomIn: () => void;
  zoomOut: () => void;
  focusSelection: () => void;
  focusKing: () => void;
  selectAll: () => void;
  clearSelection: () => void;
  frameBattlefield: () => void;
}

/**
 * Small, persistent affordances around the battlefield.
 *
 * The simulation is intentionally dense; this layer makes the next useful
 * action obvious without covering the field or turning the game into a wizard.
 */
export class BattleUx {
  private readonly guide = document.getElementById('interaction-guide');
  private readonly guideTitle = document.getElementById('guide-title');
  private readonly guideDetail = document.getElementById('guide-detail');
  private readonly guideBadge = document.getElementById('guide-badge');
  private readonly help = document.getElementById('help-dialog');
  private readonly helpButton = document.getElementById('help-button');
  private previousFocus: HTMLElement | null = null;
  private lastSelectionCount = -1;
  private lastSpeed = -1;
  private feedbackTimer: number | undefined;

  public constructor(private readonly actions: BattleUxActions) {
    this.bind('view-zoom-in', actions.zoomIn);
    this.bind('view-zoom-out', actions.zoomOut);
    this.bind('view-focus-selection', actions.focusSelection);
    this.bind('view-focus-king', actions.focusKing);
    this.bind('view-fit-battlefield', actions.frameBattlefield);
    this.bind('selection-all', actions.selectAll);
    this.bind('selection-clear', actions.clearSelection);

    this.helpButton?.addEventListener('click', () => this.openHelp());
    document.getElementById('help-close')?.addEventListener('click', () => this.closeHelp());
    document.getElementById('help-done')?.addEventListener('click', () => this.closeHelp());
    this.help?.addEventListener('click', (event) => {
      if (event.target === this.help) this.closeHelp();
    });
    window.addEventListener('keydown', this.onKeyDown, true);
  }

  private bind(id: string, action: () => void): void {
    document.getElementById(id)?.addEventListener('click', () => {
      action();
      document.getElementById('battlefield')?.focus({ preventScroll: true });
    });
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    const target = event.target;
    const typing =
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement;

    if (this.help?.hidden === false) {
      if (event.key === 'Escape' || event.key === '?') {
        event.preventDefault();
        event.stopImmediatePropagation();
        this.closeHelp();
        return;
      }
      if (event.key === 'Tab') this.trapFocus(event);
      return;
    }

    if (!typing && event.key === '?') {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.openHelp();
    }
  };

  private trapFocus(event: KeyboardEvent): void {
    if (this.help === null) return;
    const focusable = [
      ...this.help.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ].filter((element) => !element.hidden);
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (first === undefined || last === undefined) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  public openHelp(): void {
    if (this.help === null || !this.help.hidden) return;
    this.previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.help.hidden = false;
    document.body.classList.add('modal-open');
    this.helpButton?.setAttribute('aria-expanded', 'true');
    this.help.querySelector<HTMLElement>('[tabindex="-1"]')?.focus({ preventScroll: true });
  }

  public closeHelp(): void {
    if (this.help === null || this.help.hidden) return;
    this.help.hidden = true;
    document.body.classList.remove('modal-open');
    this.helpButton?.setAttribute('aria-expanded', 'false');
    this.previousFocus?.focus({ preventScroll: true });
  }

  public update(selection: ReadonlySet<string>, speed: number): void {
    if (selection.size === this.lastSelectionCount && speed === this.lastSpeed) return;
    this.lastSelectionCount = selection.size;
    this.lastSpeed = speed;

    document.body.dataset.selectionCount = String(selection.size);
    if (this.guide === null || this.guideTitle === null || this.guideDetail === null) return;

    if (selection.size === 0) {
      if (this.guideBadge !== null) this.guideBadge.textContent = '1';
      this.guideTitle.textContent = 'Select a regiment';
      this.guideDetail.textContent = 'Left-click a unit or roster row. Drag a box for several.';
      this.guide.dataset.state = 'select';
    } else {
      if (this.guideBadge !== null) this.guideBadge.textContent = '2';
      this.guideTitle.textContent =
        selection.size === 1 ? 'Give this regiment an order' : `Command ${selection.size} regiments`;
      this.guideDetail.textContent =
        'Right-click to move or attack · Shift queues · Ctrl attacks through contact.';
      this.guide.dataset.state = 'order';
    }

    const paused = speed === 0;
    this.guide.classList.toggle('is-paused', paused);
  }

  public showCommand(message: string): void {
    if (this.guideTitle === null || this.guideDetail === null) return;
    if (this.feedbackTimer !== undefined) window.clearTimeout(this.feedbackTimer);
    if (this.guideBadge !== null) this.guideBadge.textContent = '✓';
    this.guide.dataset.state = 'confirmed';
    this.guideTitle.textContent = 'Order acknowledged';
    this.guideDetail.textContent = message;
    this.feedbackTimer = window.setTimeout(() => {
      this.lastSelectionCount = -1;
      this.update(new Set(Array.from({ length: Number(document.body.dataset.selectionCount ?? 0) }, (_, index) => String(index))), this.lastSpeed);
    }, 1800);
  }
}
