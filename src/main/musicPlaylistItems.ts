/** Normalize YouTube Music's parsed playlist rows. Avoid generic browse-feed
 * parsing: tracks are represented by MusicResponsiveListItem nodes, not
 * regular YouTube playlistVideoRenderer entries. */
interface MusicItem {
  id?: string
  item_type?: string
  title?: string
  authors?: { name: string; channel_id?: string }[]
  artists?: { name: string; channel_id?: string }[]
  thumbnails?: { url?: string }[]
  endpoint?: { payload?: { videoId?: string } }
}
export interface MusicPlaylistTrack {
  videoId: string
  title: string
  channelId: string | null
  channelName: string
  thumbnailUrl: string | null
}
export function mapMusicPlaylistTracks(items: readonly unknown[]): MusicPlaylistTrack[] {
  const tracks: MusicPlaylistTrack[] = []
  const seen = new Set<string>()
  for (const value of items) {
    if (!value || typeof value !== 'object') continue
    const item = value as MusicItem
    if (item.item_type && ['playlist','album','artist','library_artist','podcast_show'].includes(item.item_type)) continue
    const videoId = item.id ?? item.endpoint?.payload?.videoId
    if (typeof videoId !== 'string' || !/^[A-Za-z0-9_-]{11}$/.test(videoId) || !item.title?.trim() || seen.has(videoId)) continue
    seen.add(videoId)
    const creator = item.artists?.[0] ?? item.authors?.[0]
    tracks.push({
      videoId, title: item.title, channelId: creator?.channel_id ?? null,
      channelName: creator?.name ?? '', thumbnailUrl: item.thumbnails?.[0]?.url ?? null
    })
  }
  return tracks
}
