import { randomUUID } from 'node:crypto'
import { accountRevision, getAccountClient, hasYoutubeAccount } from './youtubeAccount'
import { getSessionState, removeProfileHistoryEntry } from './localDb'
import { playbackHistory } from './youtube'
import { parseYoutubeHistoryFeed } from './youtubeHistoryFeed'
import type { YoutubeHistoryPage } from '../shared/ipc'

type Owner = { revision: number; profileId: string }
type Removal = Owner & { videoId: string; feedbackToken: string | null; createdAt: number }
const pages = new Map<string, Owner & { continuation: string }>()
const removals = new Map<string, Removal>()
const pending = new Map<string, Promise<void>>()
let cacheRevision = -1

async function owner(): Promise<Owner> {
  if (!hasYoutubeAccount()) throw new Error('Sign in to YouTube to view account history')
  const revision = accountRevision()
  const profileId = (await getSessionState()).activeProfileId
  if (!profileId || revision !== accountRevision()) throw new Error('Your YouTube account changed. Reload history.')
  if (cacheRevision !== revision) { pages.clear(); removals.clear(); cacheRevision = revision }
  return { revision, profileId }
}
function sameOwner(a: Owner, b: Owner): boolean { return a.revision === b.revision && a.profileId === b.profileId }

export async function getYoutubeHistory(continuation?: string): Promise<YoutubeHistoryPage> {
  const scope = await owner()
  const previous = continuation ? pages.get(continuation) : null
  if (continuation && (!previous || !sameOwner(scope, previous))) throw new Error('History page expired. Reload history.')
  const client = await getAccountClient()
  if (!sameOwner(scope, await owner())) throw new Error('Your YouTube account changed. Reload history.')
  const response = await client.actions.execute('/browse', previous ? { continuation: previous.continuation } : { browseId: 'FEhistory' })
  if (!sameOwner(scope, await owner())) throw new Error('Your YouTube account changed. Reload history.')
  const feed = parseYoutubeHistoryFeed(response.data)
  if (continuation) pages.delete(continuation)
  let next: string | null = null
  if (feed.continuation) {
    next = randomUUID()
    pages.set(next, { ...scope, continuation: feed.continuation })
    while (pages.size > 20) pages.delete(pages.keys().next().value!)
  }
  const videos = feed.items.map(({ video, feedbackToken }) => {
    const historyId = randomUUID()
    removals.set(historyId, { ...scope, videoId: video.videoId, feedbackToken, createdAt: Date.now() })
    return { ...video, historyId, canRemove: !!feedbackToken }
  })
  while (removals.size > 4000) removals.delete(removals.keys().next().value!)
  return { videos, continuation: next, paused: feed.paused }
}

export async function removeYoutubeHistoryVideo(historyId: string): Promise<void> {
  if (typeof historyId !== 'string' || historyId.length > 100) throw new Error('Invalid history entry')
  const scope = await owner()
  const entry = removals.get(historyId)
  if (!entry || !sameOwner(scope, entry) || Date.now() - entry.createdAt > 30 * 60_000) throw new Error('This history entry expired. Refresh history and try again.')
  if (!entry.feedbackToken) throw new Error('YouTube did not provide a removal action for this entry. Refresh history or remove it on YouTube.')
  const key = `${entry.revision}:${entry.profileId}:${entry.videoId}`
  const existing = pending.get(key)
  if (existing) return existing
  const operation = (async () => {
    const tracking = await playbackHistory.suspendForHistoryRemoval(entry.videoId, entry.profileId)
    try {
      const client = await getAccountClient()
      if (!sameOwner(scope, await owner())) throw new Error('Your YouTube account changed. Reload history.')
      const response = await client.actions.execute('/feedback', { feedbackTokens: [entry.feedbackToken] })
      if (!Array.isArray(response.data?.feedbackResponses) || !response.data.feedbackResponses.some((result: unknown) => result && typeof result === 'object' && (result as { isProcessed?: boolean }).isProcessed === true)) {
        throw new Error('YouTube did not confirm removal. The video is still shown; try again.')
      }
      tracking.commit()
      for (const [id, candidate] of removals) if (sameOwner(candidate, entry) && candidate.videoId === entry.videoId) removals.delete(id)
      // YouTube has already removed this watch. A local disk error must not
      // resume progress reporting and recreate it in the account history.
      await removeProfileHistoryEntry(entry.profileId, entry.videoId).catch(() => console.warn('[history] YouTube removal succeeded; local history could not be updated'))
    } catch (error) { tracking.rollback(); throw error }
  })().finally(() => { pending.delete(key) })
  pending.set(key, operation)
  return operation
}

export async function removeLocalHistoryVideo(videoId: string, profileId: string): Promise<void> {
  if (typeof videoId !== 'string' || !videoId || videoId.length > 128 || typeof profileId !== 'string') throw new Error('Invalid history entry')
  if ((await getSessionState()).activeProfileId !== profileId) throw new Error('Your profile changed. Reload history.')
  const tracking = await playbackHistory.suspendForHistoryRemoval(videoId, profileId)
  try { await removeProfileHistoryEntry(profileId, videoId); tracking.commit() }
  catch (error) { tracking.rollback(); throw error }
}
