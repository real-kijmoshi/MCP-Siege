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

  private decided = false;

  public constructor() {
    document
      .getElementById('outcome-restart')
      ?.addEventListener('click', () => window.location.reload());
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
    if (this.outcomeTitle !== null) this.outcomeTitle.textContent = won ? 'VICTORY' : 'DEFEAT';
    if (this.outcomeReason !== null) this.outcomeReason.textContent = report.outcomeReason;
    this.outcomeCard?.classList.toggle('defeat', !won);
    this.outcome?.removeAttribute('hidden');
  }
}
