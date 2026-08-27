export type ActivityKind = 'QUERY' | 'COMMAND' | 'SUCCESS' | 'WARNING' | 'ERROR';

export interface ActivityEntry {
  id: number;
  kind: ActivityKind;
  message: string;
  time: string;
}

export type ActivityListener = (entries: readonly ActivityEntry[]) => void;

export class MarshalActivityStore {
  private readonly entries: ActivityEntry[] = [];
  private readonly listeners = new Set<ActivityListener>();
  private nextId = 1;

  public record(kind: ActivityKind, message: string): void {
    const time = new Intl.DateTimeFormat(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(new Date());
    this.entries.unshift({ id: this.nextId, kind, message, time });
    this.nextId += 1;
    if (this.entries.length > 30) this.entries.pop();
    this.emit();
  }

  public subscribe(listener: ActivityListener): () => void {
    this.listeners.add(listener);
    listener(this.getEntries());
    return () => this.listeners.delete(listener);
  }

  public getEntries(): readonly ActivityEntry[] {
    return this.entries.map((entry) => ({ ...entry }));
  }

  private emit(): void {
    const entries = this.getEntries();
    for (const listener of this.listeners) listener(entries);
  }
}
