import { randomUUID } from 'node:crypto'
import type { Innertube } from 'youtubei.js'
import { accountRevision, getAccountClient, hasYoutubeAccount } from './youtubeAccount'
import * as local from './localDb'
import { find, label, musicLibraryAction, nodes, parseLibraryFeed, type Data } from './youtubeLibraryFeed'
import type { CreateSavedPlaylistRequest, LibraryKind, LibrarySaveOptions, LibraryVideosPage, SavedPlaylist, SavedVideo, SaveVideoRequest } from '../shared/ipc'

type Scope = { revision: number; profileId: string; client: Innertube }
type Page = { revision: number; profileId: string; playlistId: string | null; library: LibraryKind; token: string; editable?: boolean }
const continuations = new Map<string, Page>()
const validLibrary = (library: LibraryKind): LibraryKind => {
  if (library !== 'video' && library !== 'music') throw new Error('Invalid library')
  return library
}
function validId(id: string, video = false): void {
  if (typeof id !== 'string' || !(video ? /^[\w-]{11}$/ : /^[\w-]{1,160}$/).test(id)) throw new Error('Invalid YouTube item')
}
async function scope(): Promise<Scope> {
  const revision = accountRevision()
  if (!hasYoutubeAccount()) throw new Error('Sign in to YouTube to open your account library.')
  const profileId = (await local.getSessionState()).activeProfileId
  const client = await getAccountClient()
  if (!profileId || !hasYoutubeAccount() || revision !== accountRevision()) throw new Error('Your YouTube account changed. Reload the library.')
  const owner = { revision, profileId, client }
  await check(owner)
  return owner
}
async function check(owner: Scope): Promise<void> {
  if (!hasYoutubeAccount() || owner.revision !== accountRevision() || owner.profileId !== (await local.getSessionState()).activeProfileId)
    throw new Error('Your YouTube account changed. Reload the library.')
}
async function request(owner: Scope, endpoint: string, args: Data): Promise<Data> {
  await check(owner)
  const response = await owner.client.actions.execute(endpoint, args)
  await check(owner)
  const data = response.data
  if (!response.success || data?.error || data?.responseContext?.mainAppWebResponseContext?.loggedOut === true)
    throw new Error('YouTube could not access your account library. Sign in again and retry.')
  const errors = nodes(data, 'alertRenderer').filter((alert) => alert.type === 'ERROR')
  if (errors.length) throw new Error(label(errors[0].text) || 'YouTube could not complete this library action.')
  return data
}
const clientArgs = (library: LibraryKind): Data => library === 'music' ? { client: 'YTMUSIC' } : { client: 'WEB' }
function playlist(owner: Scope, id: string, name: string, library: LibraryKind, extra: Partial<SavedPlaylist> = {}): SavedPlaylist {
  return { id, profileId: owner.profileId, name, description: null, library, createdAt: 0, updatedAt: 0, source: 'youtube', ...extra }
}
function video(owner: Scope, value: SaveVideoRequest, library: LibraryKind): SavedVideo {
  return { videoId: value.videoId, title: value.title, channelId: value.channelId, channelName: value.channelName, thumbnailUrl: value.thumbnailUrl, playlistId: value.playlistId, id: `${library}:${value.playlistId ?? 'library'}:${value.videoId}`, profileId: owner.profileId, library, savedAt: 0 }
}
async function accountPage(owner: Scope, playlistId: string | null, library: LibraryKind, previous?: Page): Promise<LibraryVideosPage> {
  if (playlistId !== null) validId(playlistId)
  const browseId = playlistId ? (playlistId.startsWith('MPR') || playlistId.startsWith('FEmusic_') ? playlistId : `VL${playlistId}`)
    : library === 'music' ? 'FEmusic_liked_videos' : 'VLWL'
  const data = await request(owner, '/browse', { ...clientArgs(library), ...(previous ? { continuation: previous.token } : { browseId }) })
  const feed = parseLibraryFeed(data)
  const editable = feed.editable ?? previous?.editable
  const videos = feed.videos.map((item) => ({ ...video(owner, { ...item, playlistId }, library),
    canRemove: library === 'music' && !playlistId ? !!item.libraryAction?.saved : editable !== false && !playlistId?.startsWith('MPR') && !['LL', 'LM'].includes(playlistId ?? '') }))
  let continuation: string | null = null
  if (feed.continuation) {
    continuation = randomUUID()
    continuations.set(continuation, { revision: owner.revision, profileId: owner.profileId, playlistId, library, token: feed.continuation, editable })
    while (continuations.size > 500) continuations.delete(continuations.keys().next().value!)
  }
  return { videos, continuation }
}
export async function getLibraryVideos(playlistId: string | null, library: LibraryKind = 'video', continuation?: string): Promise<LibraryVideosPage> {
  validLibrary(library)
  if (!hasYoutubeAccount()) {
    if (continuation) throw new Error('Your library changed. Reload it.')
    return { videos: await local.listActiveSavedVideos(library === 'music' && playlistId === null ? undefined : playlistId, library), continuation: null }
  }
  const owner = await scope()
  const previous = continuation ? continuations.get(continuation) : undefined
  if (continuation && (!previous || previous.revision !== owner.revision || previous.profileId !== owner.profileId || previous.playlistId !== playlistId || previous.library !== library))
    throw new Error('This library page expired. Reload it.')
  return accountPage(owner, playlistId, library, previous)
}
export async function listSavedVideos(playlistId?: string | null, library: LibraryKind = 'video'): Promise<SavedVideo[]> {
  validLibrary(library)
  if (!hasYoutubeAccount()) return local.listActiveSavedVideos(playlistId, library)
  // Used for playback queues. Browsing and save dialogs use paged/per-video
  // requests instead of fetching every video in every account playlist.
  const owner = await scope()
  const result: SavedVideo[] = []
  const seen = new Set<string>()
  let previous: Page | undefined
  do {
    const page = await accountPage(owner, playlistId ?? null, library, previous)
    result.push(...page.videos)
    previous = page.continuation ? continuations.get(page.continuation) : undefined
    if (page.continuation) continuations.delete(page.continuation)
    if (previous && seen.has(previous.token)) throw new Error('YouTube repeated a library page. Reload and try again.')
    if (previous) seen.add(previous.token)
  } while (previous)
  return result
}
export async function listSavedPlaylists(library: LibraryKind = 'video'): Promise<SavedPlaylist[]> {
  validLibrary(library)
  if (!hasYoutubeAccount()) {
    const [playlists, videos] = await Promise.all([local.listActiveSavedPlaylists(library), local.listActiveSavedVideos(undefined, library)])
    return playlists.map((item) => {
      const entries = videos.filter((entry) => entry.playlistId === item.id)
      return { ...item, thumbnailUrl: entries[0]?.thumbnailUrl ?? null, itemCount: String(entries.length) }
    })
  }
  const owner = await scope()
  const result = new Map<string, SavedPlaylist>()
  if (library === 'music') result.set('LM', playlist(owner, 'LM', 'Liked songs', library, { canEdit: false }))
  const seen = new Set<string>()
  let continuation: string | null = null
  do {
    const data = await request(owner, '/browse', { ...clientArgs(library), ...(continuation ? { continuation } : { browseId: library === 'music' ? 'FEmusic_library_landing' : 'FEplaylist_aggregation' }) })
    const feed = parseLibraryFeed(data)
    for (const item of feed.collections) {
      if (['WL', 'LL', 'LM'].includes(item.id)) continue
      result.set(item.id, playlist(owner, item.id, item.name, library, { ...item, canEdit: item.kind !== 'album' ? undefined : false }))
    }
    continuation = feed.continuation
    if (continuation && seen.has(continuation)) throw new Error('YouTube repeated a library page. Reload and try again.')
    if (continuation) seen.add(continuation)
  } while (continuation)
  return [...result.values()]
}
async function playlistOptions(owner: Scope, videoId: string, library: LibraryKind, response?: Data): Promise<LibrarySaveOptions> {
  const data = response ?? await request(owner, '/playlist/get_add_to_playlist', { ...clientArgs(library), videoIds: [videoId], excludeWatchLater: false })
  const options = nodes(data, 'playlistAddToOptionRenderer')
  if (!options.length && !find(data, 'addToPlaylistRenderer')) throw new Error('YouTube did not return your playlist choices. Retry or sign in again.')
  const selectedPlaylistIds: string[] = []
  const playlists: SavedPlaylist[] = []
  let looseSaved = false
  let canSaveLoose = false
  for (const option of options) {
    const id = option.playlistId
    if (typeof id !== 'string') continue
    const selected = option.containsSelectedVideos === 'ALL'
    if (id === 'WL') { if (library === 'video') { looseSaved = selected; canSaveLoose = true }; continue }
    if (id === 'LL' || id === 'LM') continue
    playlists.push(playlist(owner, id, label(option.title), library, { canEdit: true }))
    if (selected) selectedPlaylistIds.push(id)
  }
  return { playlists, selectedPlaylistIds, looseSaved, canSaveLoose }
}
async function musicAction(owner: Scope, videoId: string): Promise<ReturnType<typeof musicLibraryAction>> {
  const data = await request(owner, '/music/get_queue', { client: 'YTMUSIC', videoIds: [videoId] })
  return musicLibraryAction(data)
}
export async function getLibrarySaveOptions(videoId: string, library: LibraryKind = 'video'): Promise<LibrarySaveOptions> {
  validId(videoId, true); validLibrary(library)
  if (!hasYoutubeAccount()) {
    const [playlists, entries] = await Promise.all([local.listActiveSavedPlaylists(library), local.listActiveSavedVideos(undefined, library)])
    const matches = entries.filter((item) => item.videoId === videoId)
    return { playlists, selectedPlaylistIds: matches.flatMap((item) => item.playlistId ? [item.playlistId] : []), looseSaved: matches.some((item) => !item.playlistId), canSaveLoose: true }
  }
  const owner = await scope()
  const options = await playlistOptions(owner, videoId, library)
  if (library === 'music') {
    try {
      const action = await musicAction(owner, videoId)
      options.looseSaved = action?.saved ?? false
      options.canSaveLoose = !!action
      if (!action) options.looseError = 'YouTube Music does not offer a library action for this video. You can still add it to a playlist.'
    } catch (cause) {
      await check(owner)
      options.canSaveLoose = false
      options.looseError = cause instanceof Error ? cause.message : 'Could not load YouTube Music library status.'
    }
  }
  return options
}
export async function createSavedPlaylist(input: CreateSavedPlaylistRequest): Promise<SavedPlaylist> {
  const library = validLibrary(input.library ?? 'video')
  if (!input.name?.trim() || input.name.trim().length > 150 || (input.description?.length ?? 0) > 5000) throw new Error('Enter a playlist name of up to 150 characters.')
  if (!hasYoutubeAccount()) return local.createActiveSavedPlaylist(input)
  const owner = await scope()
  const data = await request(owner, '/playlist/create', { ...clientArgs(library), title: input.name.trim(), description: input.description ?? '', privacyStatus: 'PRIVATE', videoIds: [] })
  if (typeof data.playlistId !== 'string') throw new Error('YouTube did not confirm playlist creation. Refresh before trying again.')
  return playlist(owner, data.playlistId, input.name.trim(), library, { description: input.description ?? null, canEdit: true })
}
async function changeSaved(owner: Scope, videoId: string, playlistId: string | null, library: LibraryKind, add: boolean): Promise<void> {
  if (library === 'music' && !playlistId) {
    const action = await musicAction(owner, videoId)
    if (!action) throw new Error('YouTube Music does not offer a library action for this video. Add it to a playlist instead.')
    if (action.saved === add) return
    const data = await request(owner, '/feedback', { client: 'YTMUSIC', feedbackTokens: [action.token] })
    if (!data.feedbackResponses?.some((entry: Data) => entry.isProcessed === true)) throw new Error('YouTube Music did not confirm the library change. Refresh and retry.')
    return
  }
  const menu = await request(owner, '/playlist/get_add_to_playlist', { ...clientArgs(library), videoIds: [videoId], excludeWatchLater: false })
  const options = await playlistOptions(owner, videoId, library, menu)
  if (playlistId ? !options.playlists.some((item) => item.id === playlistId) : !options.canSaveLoose)
    throw new Error('YouTube did not offer an editable playlist for this action. Refresh and retry.')
  const selected = playlistId ? options.selectedPlaylistIds.includes(playlistId) : options.looseSaved
  if (selected === add) return
  const target = playlistId ?? 'WL'
  const choice = nodes(menu, 'playlistAddToOptionRenderer').find((item) => item.playlistId === target)
  const endpoint = find(choice?.[add ? 'addToPlaylistServiceEndpoint' : 'removeFromPlaylistServiceEndpoint'], 'playlistEditEndpoint')
  if (endpoint?.playlistId !== target || !Array.isArray(endpoint.actions) || !endpoint.actions.length)
    throw new Error('YouTube did not provide this playlist action. Refresh and retry.')
  // Use the server's own add/remove command, including any required entry IDs.
  const data = await request(owner, '/browse/edit_playlist', { ...clientArgs(library), ...endpoint })
  if (data.status !== 'STATUS_SUCCEEDED') throw new Error('YouTube did not confirm the playlist change. Refresh before trying again.')
}
export async function saveVideo(input: SaveVideoRequest): Promise<SavedVideo> {
  validId(input.videoId, true)
  const library = validLibrary(input.library ?? 'video')
  const playlistId = input.playlistId ?? null
  if (playlistId) validId(playlistId)
  if (!hasYoutubeAccount()) return local.saveActiveVideo(input)
  const owner = await scope()
  await changeSaved(owner, input.videoId, playlistId, library, true)
  return video(owner, { ...input, playlistId }, library)
}
export async function removeSavedVideo(videoId: string, playlistId: string | null = null, library: LibraryKind = 'video'): Promise<void> {
  validId(videoId, true); validLibrary(library)
  if (playlistId) validId(playlistId)
  if (!hasYoutubeAccount()) return local.removeActiveSavedVideo(videoId, playlistId, library)
  const owner = await scope()
  await changeSaved(owner, videoId, playlistId, library, false)
}
