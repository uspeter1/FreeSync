// Holds local "delete" events for a short window so cloud-sync transients
// (OneDrive/Dropbox/iCloud blipping a file out and re-creating it within ~1s)
// don't propagate as real deletions to remote peers.
//
// Lifecycle per path:
//   schedule(path)  → start a timer
//   cancel(path)    → kill the timer (called when the file reappears on disk)
//   timer fires     → re-checks fileExists(path) one more time; only calls
//                     propagate(path) if the file is still genuinely gone
//
// The fire-time re-check is a defensive backstop. It catches any path through
// which the file could reappear that doesn't call cancel() — e.g. a remote
// peer restoring the file, a race between the create-watcher and the delete-
// watcher, or a future code change that forgets to call cancel.

export interface DeleteDebouncerOptions {
  delayMs: number;
  fileExists: (path: string) => boolean;
  propagate: (path: string) => void;
}

export class DeleteDebouncer {
  private timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private opts: DeleteDebouncerOptions) {}

  schedule(path: string): void {
    const existing = this.timers.get(path);
    if (existing) clearTimeout(existing);

    const handle = setTimeout(() => {
      this.timers.delete(path);
      // Re-check: if anything has put the file back on disk between schedule
      // and fire (cancel() wasn't called for any reason), abort the delete.
      if (this.opts.fileExists(path)) return;
      this.opts.propagate(path);
    }, this.opts.delayMs);

    this.timers.set(path, handle);
  }

  cancel(path: string): boolean {
    const handle = this.timers.get(path);
    if (!handle) return false;
    clearTimeout(handle);
    this.timers.delete(path);
    return true;
  }

  hasPending(path: string): boolean {
    return this.timers.has(path);
  }

  pendingCount(): number {
    return this.timers.size;
  }

  cancelAll(): void {
    for (const handle of this.timers.values()) clearTimeout(handle);
    this.timers.clear();
  }
}
