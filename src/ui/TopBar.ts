import type { BattleOverview } from '../game/queries/GameQueries';

/** The status strip: force totals, the clock, speed, and WebMCP availability. */
export class TopBar {
  private readonly strength = document.getElementById('stat-strength');
  private readonly enemy = document.getElementById('stat-enemy');
  private readonly reinforcements = document.getElementById('stat-reinforcements');
  private readonly clock = document.getElementById('stat-clock');
  private readonly status = document.getElementById('webmcp-status');
  private readonly statusLabel = document.getElementById('webmcp-label');

  public constructor(onSpeed: (speed: number) => void) {
    const buttons = document.querySelectorAll<HTMLButtonElement>('.speed-control button');
    for (const button of buttons) {
      button.addEventListener('click', () => {
        const speed = Number(button.dataset.speed ?? '1');
        for (const other of buttons) {
          const selected = other === button;
          other.classList.toggle('active', selected);
          other.setAttribute('aria-pressed', String(selected));
        }
        onSpeed(speed);
      });
    }
  }

  /** Reflects speed changes that came from the keyboard rather than a click. */
  public syncSpeed(speed: number): void {
    for (const button of document.querySelectorAll<HTMLButtonElement>('.speed-control button')) {
      const selected = Number(button.dataset.speed ?? '1') === speed;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-pressed', String(selected));
    }
  }

  public setWebMcpStatus(status: 'connected' | 'unavailable' | 'failed', detail: string): void {
    if (this.status === null || this.statusLabel === null) return;
    this.status.dataset.status = status;
    this.status.title = detail;
    this.statusLabel.textContent =
      status === 'connected' ? 'WEBMCP READY' : status === 'failed' ? 'WEBMCP ERROR' : 'WEBMCP OFF';
  }

  public update(overview: BattleOverview): void {
    if (this.strength !== null) this.strength.textContent = overview.playerUnits.toLocaleString();
    if (this.enemy !== null) {
      this.enemy.textContent = overview.enemyVisibleStrength.toLocaleString();
    }
    if (this.reinforcements !== null) {
      this.reinforcements.textContent = String(overview.reinforcementsReady);
    }
    if (this.clock !== null) {
      const minutes = Math.floor(overview.elapsedSeconds / 60);
      const seconds = overview.elapsedSeconds % 60;
      this.clock.textContent = `${minutes}:${String(seconds).padStart(2, '0')}`;
    }
  }
}
