import { randomUUID } from 'node:crypto'
import type { HistoryEntry, PlaybackProgress } from '../shared/ipc'

export interface RemoteWatchInfo {
  addToWatchHistory(): Promise<unknown>
  updateWatchTime(position: number): Promise<unknown>
}

interface RecordSource {
  entry: Omit<HistoryEntry, 'watchedAt'>
  revision: number
  profileId: string
  remote: (() => Promise<RemoteWatchInfo>) | null
}

interface PlaybackRecord extends RecordSource {
  createdAt: number
  localRecorded: boolean
  remoteRecorded: boolean
  remoteInfo: Promise<RemoteWatchInfo> | null
  lastUpdate: number
  queue: Promise<void>
  suppressed: boolean
}

export class PlaybackHistory {
  private records = new Map<string, PlaybackRecord>()
  constructor(private dependencies: {
    currentRevision(): number
    currentProfile(): Promise<string | null>
    recordLocal(entry: Omit<HistoryEntry, 'watchedAt'>, profileId: string): Promise<void>
    syncFailed(failed: boolean, revision: number): void
    now?: () => number
  }) {}

  register(source: RecordSource): string {
    const token = randomUUID()
    this.records.set(token, { ...source, createdAt: this.now(), localRecorded: false, remoteRecorded: false,
      remoteInfo: null, lastUpdate: 0, queue: Promise.resolve(), suppressed: false })
    while (this.records.size > 300) this.records.delete(this.records.keys().next().value!)
    return token
  }

  private now(): number { return this.dependencies.now?.() ?? Date.now() }

  async suspendForHistoryRemoval(videoId: string, profileId: string): Promise<{ commit(): void; rollback(): void }> {
    const affected = [...this.records].filter(([, record]) => record.entry.videoId === videoId && record.profileId === profileId)
    for (const [, record] of affected) record.suppressed = true
    // Finish in-flight writes before deletion, so a late progress report cannot
    // recreate the watch immediately after YouTube acknowledges its removal.
    await Promise.all(affected.map(([, record]) => record.queue))
    return {
      commit: () => { for (const [token, record] of affected) if (this.records.get(token) === record) this.records.delete(token) },
      rollback: () => { for (const [, record] of affected) record.suppressed = false }
    }
  }

  async progress(progress: PlaybackProgress): Promise<void> {
    if (!progress || typeof progress.token !== 'string' || !Number.isFinite(progress.position) || progress.position < 0 ||
      typeof progress.ended !== 'boolean') throw new Error('Invalid playback progress')
    const record = this.records.get(progress.token)
    if (!record) return
    const operation = record.queue.then(async () => {
      if (record.suppressed || this.records.get(progress.token) !== record) return
      if (this.now() - record.createdAt > 24 * 60 * 60_000 ||
        record.revision !== this.dependencies.currentRevision() || record.profileId !== await this.dependencies.currentProfile()) {
        this.records.delete(progress.token)
        return
      }
      if (!record.localRecorded) {
        await this.dependencies.recordLocal(record.entry, record.profileId)
        record.localRecorded = true
      }
      if (!record.remote || (!progress.ended && record.lastUpdate > 0 && this.now() - record.lastUpdate < 25_000)) return
      // Recheck after an async local write/account switch before remote sync.
      if (record.suppressed || record.revision !== this.dependencies.currentRevision()) return
      record.lastUpdate = this.now()
      try {
        record.remoteInfo ??= record.remote()
        const info = await record.remoteInfo
        if (record.suppressed || record.revision !== this.dependencies.currentRevision()) return
        if (!record.remoteRecorded) {
          await info.addToWatchHistory()
          record.remoteRecorded = true
        }
        if (record.suppressed || record.revision !== this.dependencies.currentRevision()) return
        await info.updateWatchTime(progress.position)
        this.dependencies.syncFailed(false, record.revision)
      } catch {
        record.remoteInfo = null
        this.dependencies.syncFailed(true, record.revision)
      }
    })
    record.queue = operation.catch(() => undefined)
    return operation
  }
}
