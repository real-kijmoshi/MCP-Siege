import type { ObjectiveReport } from '../game/queries/GameQueries';

/**
 * The objective, as two chips and one ending.
 *
 * Deliberately the smallest thing that can carry a win condition: the map is
 * still what the player looks at, and the chips only raise their voice when a
 * king is actually being taken. There is no scoreboard and no panel.
 */
export class ObjectiveBanner {
  private readonly own = document.getElementById('objective-own');
  private readonly ownName = document.getElementById('objective-own-name');
  private readonly ownState = document.getElementById('objective-own-state');
  private readonly ownBar = document.getElementById('objective-own-bar');

  private readonly foe = document.getElementById('objective-foe');
  private readonly foeName = document.getElementById('objective-foe-name');
  private readonly foeState = document.getElementById('objective-foe-state');
  private readonly foeBar = document.getElementById('objective-foe-bar');

  private readonly outcome = document.getElementById('outcome');
  private readonly outcomeCard = document.querySelector<HTMLElement>('.outcome-card');
  private readonly outcomeTitle = document.getElementById('outcome-title');
  private readonly outcomeReason = document.getElementById('outcome-reason');
  private readonly outcomeElapsed = document.getElementById('outcome-elapsed');
  private readonly outcomeSurvivors = document.getElementById('outcome-survivors');
  private readonly outcomeLosses = document.getElementById('outcome-losses');
  private readonly outcomeRegiments = document.getElementById('outcome-regiments');

  private decided = false;

  public constructor() {
    document
      .getElementById('outcome-restart')
      ?.addEventListener('click', () => window.location.reload());
    this.outcome?.addEventListener('keydown', (event) => {
      if (event.key !== 'Tab') return;
      // The result dialog has one action. Keep keyboard focus on it instead of
      // letting Tab wander into controls dimmed behind the modal battlefield.
      event.preventDefault();
      document.getElementById('outcome-restart')?.focus({ preventScroll: true });
    });
  }

  public update(report: ObjectiveReport): void {
    this.renderOwn(report);
    this.renderEnemy(report);

    if (report.outcome === 'ongoing' || this.decided) return;
    this.decided = true;
    this.renderOutcome(report);
  }

  private renderOwn(report: ObjectiveReport): void {
    const king = report.yourKing;
    if (this.ownName !== null) this.ownName.textContent = king.name.toUpperCase();
    if (this.own !== null) this.own.dataset.status = king.status;
    if (this.ownBar !== null) this.ownBar.style.width = `${king.capturePercent}%`;
    if (this.ownState === null) return;

    this.ownState.textContent =
      king.status === 'safe'
        ? `Safe · guard ${king.guardStrength}`
        : king.status === 'captured'
          ? 'Taken'
          : `${king.capturePercent}% taken · ${king.attackers} against ${king.defenders}`;
  }

  private renderEnemy(report: ObjectiveReport): void {
    const king = report.enemyKing;
    if (this.foeName !== null) this.foeName.textContent = king.name.toUpperCase();
    if (this.foeBar !== null) this.foeBar.style.width = `${king.capturePercent}%`;

    // Fog is the reason for the third state: he is not "safe", he is unseen.
    if (this.foe !== null) {
      this.foe.dataset.status =
        king.lastSeenZone === undefined ? 'unseen' : king.capturePercent > 0 ? 'threatened' : 'safe';
    }
    if (this.foeState === null) return;

    this.foeState.textContent =
      king.lastSeenZone === undefined
        ? 'Never sighted'
        : king.visibleNow
          ? king.capturePercent > 0
            ? `${king.capturePercent}% taken · ${king.lastSeenZoneName}`
            : `In sight · ${king.lastSeenZoneName}`
          : `Last seen ${king.lastSeenZoneName} · ${king.lastSeenSecondsAgo}s ago`;
  }

  private renderOutcome(report: ObjectiveReport): void {
    const won = report.outcome === 'player_victory';
    const minutes = Math.floor(report.result.elapsedSeconds / 60);
    const seconds = report.result.elapsedSeconds % 60;
    if (this.outcomeTitle !== null) this.outcomeTitle.textContent = won ? 'VICTORY' : 'DEFEAT';
    if (this.outcomeReason !== null) this.outcomeReason.textContent = report.outcomeReason;
    if (this.outcomeElapsed !== null) {
      this.outcomeElapsed.textContent = `${minutes}:${String(seconds).padStart(2, '0')}`;
    }
    if (this.outcomeSurvivors !== null) {
      this.outcomeSurvivors.textContent = report.result.survivingUnits.toLocaleString();
    }
    if (this.outcomeLosses !== null) {
      this.outcomeLosses.textContent = report.result.losses.toLocaleString();
    }
    if (this.outcomeRegiments !== null) {
      this.outcomeRegiments.textContent =
        `${report.result.survivingRegiments} regiments remain from ` +
        `${report.result.initialUnits.toLocaleString()} men deployed.`;
    }
    this.outcomeCard?.classList.toggle('defeat', !won);
    this.outcome?.removeAttribute('hidden');
    this.outcomeCard?.focus({ preventScroll: true });
  }
}
