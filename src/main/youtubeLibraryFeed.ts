// Keep the original account feed order, including modern lockup cards. The
// renderer receives plain metadata; service tokens never cross the IPC bridge.
export type Data = Record<string, any>
export const record = (value: unknown): Data => value && typeof value === 'object' && !Array.isArray(value) ? value as Data : {}
export function label(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  const data = record(value)
  return String(data.simpleText ?? data.content ?? (Array.isArray(data.runs) ? data.runs.map((run: Data) => run.text ?? '').join('') : '')).trim()
}
export function find(value: unknown, key: string, depth = 0): any {
  if (depth > 35 || !value || typeof value !== 'object') return undefined
  if (!Array.isArray(value) && key in value) return (value as Data)[key]
  for (const child of Object.values(value)) { const result = find(child, key, depth + 1); if (result !== undefined) return result }
}
export function nodes(value: unknown, key: string, depth = 0): Data[] {
  if (depth > 40 || !value || typeof value !== 'object') return []
  if (!Array.isArray(value) && key in value) return [record((value as Data)[key])]
  return Object.values(value).flatMap((child) => nodes(child, key, depth + 1))
}
export function musicLibraryAction(value: unknown): { saved: boolean; token: string } | null {
  for (const toggle of nodes(value, 'toggleMenuServiceItemRenderer')) {
    const icon = toggle.defaultIcon?.iconType
    if (!['LIBRARY_ADD', 'LIBRARY_REMOVE', 'LIBRARY_SAVED'].includes(icon)) continue
    const token = find(toggle.defaultServiceEndpoint, 'feedbackToken')
    if (typeof token === 'string' && token) return { saved: icon !== 'LIBRARY_ADD', token }
  }
  return null
}
export interface LibraryFeed {
  collections: { id: string; name: string; thumbnailUrl: string | null; itemCount: string | null; kind: 'playlist' | 'album' }[]
  videos: { videoId: string; title: string; channelId: string | null; channelName: string; thumbnailUrl: string | null; setVideoId?: string; libraryAction: ReturnType<typeof musicLibraryAction> }[]
  continuation: string | null
  editable?: boolean
}
export function parseLibraryFeed(response: unknown): LibraryFeed {
  const feed: LibraryFeed = { collections: [], videos: [], continuation: null }
  const image = (value: unknown): string | null => { const url = find(value, 'url'); return typeof url === 'string' && url.startsWith('https://') ? url : null }
  const musicColumns = (data: Data): Data[] => (data.flexColumns ?? []).map((column: Data) => record(column.musicResponsiveListItemFlexColumnRenderer).text)
  const walk = (value: unknown, depth = 0): void => {
    if (depth > 40 || !value || typeof value !== 'object') return
    if (Array.isArray(value)) { value.forEach((child) => walk(child, depth + 1)); return }
    for (const [key, raw] of Object.entries(value)) {
      const data = record(raw)
      if (['playlistRenderer', 'gridPlaylistRenderer', 'lockupViewModel', 'musicTwoRowItemRenderer', 'musicResponsiveListItemRenderer', 'playlistVideoRenderer', 'videoRenderer'].includes(key)) {
        const columns = musicColumns(data)
        const metadata = data.metadata?.lockupMetadataViewModel
        const endpoint = data.navigationEndpoint ?? find(columns[0], 'navigationEndpoint') ?? find(data.rendererContext, 'browseEndpoint')
        const browseId = find(endpoint, 'browseId')
        const type = find(endpoint, 'pageType')
        const id = data.playlistId ?? (data.contentType === 'LOCKUP_CONTENT_TYPE_PLAYLIST' ? data.contentId : undefined) ??
          (typeof browseId === 'string' && browseId.startsWith('VL') ? browseId.slice(2) : undefined) ??
          (type === 'MUSIC_PAGE_TYPE_ALBUM' ? browseId : undefined)
        const title = label(data.title ?? metadata?.title ?? columns[0])
        if (typeof id === 'string' && title) {
          feed.collections.push({ id, name: title, kind: type === 'MUSIC_PAGE_TYPE_ALBUM' ? 'album' : 'playlist',
            thumbnailUrl: image(data.thumbnail ?? data.thumbnails ?? data.contentImage),
            itemCount: label(data.videoCountText ?? data.videoCountShortText) || null })
        } else {
          const videoId = data.videoId ?? (['LOCKUP_CONTENT_TYPE_VIDEO', 'LOCKUP_CONTENT_TYPE_SHORT'].includes(data.contentType) ? data.contentId : undefined) ?? find(data.playlistItemData, 'videoId') ?? find(data.navigationEndpoint, 'videoId') ?? find(columns[0], 'videoId')
          if (typeof videoId === 'string' && /^[\w-]{11}$/.test(videoId) && title) {
            const author = data.shortBylineText ?? data.longBylineText ?? columns[1]
            const channelId = find(author, 'browseId')
            feed.videos.push({ videoId, title, channelId: typeof channelId === 'string' && channelId.startsWith('UC') ? channelId : null,
              channelName: label(author), thumbnailUrl: image(data.thumbnail ?? data.thumbnails ?? data.contentImage),
              setVideoId: data.setVideoId ?? data.playlistSetVideoId ?? data.playlistItemData?.playlistSetVideoId,
              libraryAction: musicLibraryAction(data.menu) })
          }
        }
        // Menus, recommendations and preview tracks aren't additional feed items.
      } else if (key === 'continuationItemRenderer') {
        const token = find(data, 'token'); if (typeof token === 'string') feed.continuation = token
      } else if (key === 'continuations') {
        const token = find(raw, 'continuation'); if (typeof token === 'string') feed.continuation = token
      } else if (key === 'tabRenderer') {
        if (data.selected !== false) walk(data.content, depth + 1)
      } else if (!['header', 'sidebar', 'secondaryContents', 'menu', 'trackingParams'].includes(key)) walk(raw, depth + 1)
    }
  }
  const data = record(response)
  for (const key of ['contents', 'continuationContents', 'onResponseReceivedActions', 'onResponseReceivedCommands', 'onResponseReceivedEndpoints']) walk(data[key])
  if (find(data, 'musicEditablePlaylistDetailHeaderRenderer')) feed.editable = true
  const editable = find(data, 'isEditable')
  if (typeof editable === 'boolean') feed.editable = editable
  return feed
}
