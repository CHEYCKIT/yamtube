import { t, useLocale } from '../i18n/LocaleContext'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { Check } from 'lucide-react'
import { PROFILE_DATA_CHANGED_EVENT } from '../profiles/events'
import { useProfiles } from '../profiles/ProfileContext'
import type { LibraryKind, SavedPlaylist, LibrarySaveOptions, SaveVideoRequest } from '../../../shared/ipc'

interface VideoSaveButtonProps {
  video: SaveVideoRequest
  className?: string
  buttonClassName?: string
  label?: string
  menuPosition?: 'above' | 'below'
  }

function CheckIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return <Check aria-hidden="true" className={className} strokeWidth={1.8} />
}

function optionClass(isActive: boolean): string {
  return [
    'flex h-8 w-full items-center justify-between gap-3 rounded px-2 text-left text-sm hover:bg-neutral-800',
    isActive ? 'text-white' : 'text-neutral-300'
  ].join(' ')
}

function UnifiedSaveButton({ video, className = '', buttonClassName }: VideoSaveButtonProps) {
  useLocale()
  const { activeProfileId, youtubeAccount } = useProfiles()
  const signedIn = youtubeAccount.signedIn
  const scopeKey = `${activeProfileId}:${signedIn}:${youtubeAccount.name}:${video.videoId}`
  const scopeRef = useRef(scopeKey)
  scopeRef.current = scopeKey
  const [open, setOpen] = useState(false)
  const [videoPlaylists, setVideoPlaylists] = useState<SavedPlaylist[]>([])
  const [musicPlaylists, setMusicPlaylists] = useState<SavedPlaylist[]>([])
  const [videoOptions, setVideoOptions] = useState<LibrarySaveOptions | null>(null)
  const [musicOptions, setMusicOptions] = useState<LibrarySaveOptions | null>(null)
  const [loading, setLoading] = useState(false)
  const [videoPlaylistName, setVideoPlaylistName] = useState('')
  const [musicPlaylistName, setMusicPlaylistName] = useState('')
  const [busy, setBusy] = useState(false)
  const loadRevision = useRef(0)
  const [status, setStatus] = useState<string | null>(null)

  async function load() {
    const owner = scopeKey
    const generation = ++loadRevision.current
    setLoading(true)
    // Each account service can fail independently. A Music error must not
    // prevent saving a normal video to Watch Later.
    const results = await Promise.allSettled([
      window.api.getLibrarySaveOptions(video.videoId, 'video'),
      window.api.getLibrarySaveOptions(video.videoId, 'music')
    ])
    if (scopeRef.current !== owner || generation !== loadRevision.current) return
    const [videos, music] = results
    setVideoOptions(videos.status === 'fulfilled' ? videos.value : null)
    setMusicOptions(music.status === 'fulfilled' ? music.value : null)
    setVideoPlaylists(videos.status === 'fulfilled' ? videos.value.playlists : [])
    setMusicPlaylists(music.status === 'fulfilled' ? music.value.playlists : [])
    const failed = results.find((result) => result.status === 'rejected')
    if (failed?.status === 'rejected') setStatus(failed.reason instanceof Error ? failed.reason.message : t('Could not load'))
    setLoading(false)
  }

  useEffect(() => {
    if (!open) return
    setVideoOptions(null)
    setMusicOptions(null)
    setStatus(null)
    void load()
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', closeOnEscape)
    return () => { loadRevision.current++; window.removeEventListener('keydown', closeOnEscape) }
  }, [open, scopeKey, video.videoId])

  const idsFor = (options: LibrarySaveOptions | null) => new Set<string | null>([...(options?.selectedPlaylistIds ?? []), ...(options?.looseSaved ? [null] : [])])
  const videoIds = idsFor(videoOptions)
  const musicIds = idsFor(musicOptions)

  async function toggle(library: LibraryKind, playlistId: string | null) {
    if (busy) return
    setBusy(true)
    setStatus(null)
    const owner = scopeKey
    const options = library === 'music' ? musicOptions : videoOptions
    const saved = idsFor(options).has(playlistId)
    try {
      if (saved) await window.api.removeSavedVideo(video.videoId, playlistId, library)
      else await window.api.saveVideo({ ...video, playlistId, library })
      if (scopeRef.current !== owner) return
      await load()
      window.dispatchEvent(new CustomEvent(PROFILE_DATA_CHANGED_EVENT))
    } catch (cause) {
      if (scopeRef.current === owner) setStatus(cause instanceof Error ? cause.message : saved ? t("Could not remove") : t("Could not save"))
    } finally { setBusy(false) }
  }

  async function createAndSave(event: FormEvent, library: LibraryKind) {
    event.preventDefault()
    const name = (library === 'music' ? musicPlaylistName : videoPlaylistName).trim()
    if (!name || busy) return
    setBusy(true)
    setStatus(null)
    const owner = scopeKey
    try {
      const playlist = await window.api.createSavedPlaylist({ name, library })
      if (scopeRef.current !== owner) return
      await window.api.saveVideo({ ...video, playlistId: playlist.id, library })
      if (scopeRef.current !== owner) return
      if (library === 'music') setMusicPlaylistName('')
      else setVideoPlaylistName('')
      await load()
      window.dispatchEvent(new CustomEvent(PROFILE_DATA_CHANGED_EVENT))
    } catch (cause) { if (scopeRef.current === owner) setStatus(cause instanceof Error ? cause.message : t("Could not create")) }
    finally { setBusy(false) }
  }

  const section = (library: LibraryKind, title: string, playlists: SavedPlaylist[], ids: Set<string | null>, name: string, setName: (value: string) => void) => <section className="min-w-0">
    <h3 className="mb-2 text-sm font-semibold">{title}</h3>
    <div className="grid max-h-52 gap-1 overflow-y-auto pr-1">
      <button type="button" disabled={busy || loading || !(library === 'music' ? musicOptions : videoOptions)?.canSaveLoose} onClick={() => void toggle(library, null)} className={`${optionClass(ids.has(null))} disabled:cursor-not-allowed disabled:opacity-50`}><span>{library === 'music' ? signedIn ? t("YouTube Music library") : t("Saved songs") : signedIn ? t("Watch Later") : t("Saved")}</span>{ids.has(null) && <CheckIcon className="wt-accent-text h-4 w-4" />}</button>
      {playlists.map((playlist) => <button key={playlist.id} type="button" disabled={busy || loading || !(library === 'music' ? musicOptions : videoOptions)} onClick={() => void toggle(library, playlist.id)} className={optionClass(ids.has(playlist.id))}><span className="truncate">{playlist.name}</span>{ids.has(playlist.id) && <CheckIcon className="wt-accent-text h-4 w-4" />}</button>)}
      {!playlists.length && <p className="px-2 py-1 text-xs text-neutral-500">{t("No playlists")}</p>}
    </div>
    {(library === 'music' ? musicOptions : videoOptions)?.looseError && <p className="mt-2 text-xs text-neutral-400">{(library === 'music' ? musicOptions : videoOptions)?.looseError}</p>}
    <form onSubmit={(event) => void createAndSave(event, library)} className="mt-3 flex gap-2 border-t border-neutral-800 pt-3">
      <input value={name} onChange={(event) => setName(event.target.value)} placeholder={t("New playlist")} className="min-w-0 flex-1 rounded border border-neutral-700 bg-neutral-900 px-2 py-2 text-sm" />
      <button disabled={busy || loading || !name.trim()} className="wt-action cursor-pointer rounded px-3 text-sm disabled:opacity-50">{t("Create")}</button>
    </form>
  </section>

  return <div className={className} onClick={(event) => event.stopPropagation()}>
    <button type="button" onClick={() => setOpen(true)} className={buttonClassName ?? 'grid h-8 w-8 place-items-center rounded bg-black/70 text-neutral-100 shadow-lg shadow-black/25 hover:bg-black/85'} aria-label={t("Save or add")} title={t("Save or add")}><span aria-hidden="true" className="text-xl leading-none">+</span></button>
    {open && createPortal(<div className="fixed inset-0 z-[100] grid place-items-center bg-black/65 p-4" onClick={() => setOpen(false)}>
      <div role="dialog" aria-modal="true" aria-label={t("Save or add")} onClick={(event) => event.stopPropagation()} className="w-full max-w-2xl rounded-xl border border-neutral-800 bg-neutral-950 shadow-2xl">
        <header className="flex items-center justify-between border-b border-neutral-800 px-5 py-4"><div className="min-w-0"><h2 className="text-lg font-semibold">{t("Save or add")}</h2><p className="mt-1 truncate text-xs text-neutral-400">{video.title}</p></div><button type="button" onClick={() => setOpen(false)} aria-label={t("Close")} className="grid h-9 w-9 cursor-pointer place-items-center rounded-full text-xl hover:bg-neutral-800">×</button></header>
        <div className="grid gap-6 p-5 sm:grid-cols-2">{section('video', signedIn ? t("YouTube playlists") : t("Videos"), videoPlaylists, videoIds, videoPlaylistName, setVideoPlaylistName)}{section('music', signedIn ? t('YouTube Music') : t('Music'), musicPlaylists, musicIds, musicPlaylistName, setMusicPlaylistName)}</div>
        {loading && <p role="status" className="px-5 pb-3 text-xs text-neutral-400">{t("Loading...")}</p>}
        {status && <p role="status" className="border-t border-neutral-800 px-5 py-3 text-xs text-red-400">{status}</p>}
      </div>
    </div>, document.body)}
  </div>
}

export function VideoSaveActions({ video, className = '', buttonClassName }: VideoSaveButtonProps) {
  return <UnifiedSaveButton video={video} className={className} buttonClassName={buttonClassName} />
}
