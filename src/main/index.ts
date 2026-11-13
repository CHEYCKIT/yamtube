import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { initializeDiagnostics, getDiagnostics } from './diagnosticLog'
import { join } from 'node:path'
import { IPC_CHANNELS } from '../shared/ipc'
import { translateFor } from '../shared/locale'
import { registerUpdates, checkForUpdatesOnStartup } from './updates'
import type {
  ChannelResponse,
  CollectionRequest,
  CollectionResponse,
  CreateLocalUserRequest,
  DeleteLocalUserRequest,
  CreateProfileRequest,
  CreateSavedPlaylistRequest,
  LocalSessionState,
  LibraryKind,
  LoginLocalUserRequest,
  ProfilesState,
  SaveVideoRequest,
  SearchRequest,
  SearchResponse,
  SearchSuggestionsResponse,
  Subscription,
  UpdateProfileRequest,
  VideoInfoRequest,
  VideoInfoResponse,
  VideoCommentsResponse
} from '../shared/ipc'
import { fetchVideoInfo, fetchVideoComments, getChannelInfo, getCollectionVideos, getHomeDiscovery, getSearchSuggestions, getSubscriptionsFeed, getVideoPreview, searchVideos, playbackHistory, getYoutubeSubscriptionsFeed } from './youtube'
import { initializeProtection, protectionState, updateProtection } from './adBlock'
import { initializeYoutubeAccount, youtubeAccountState, connectYoutubeAccount, disconnectYoutubeAccount, hasYoutubeAccount, activateCurrentLibrary } from './youtubeAccount'
import { signInWithBrowser, cancelBrowserLogin, removeAbandonedLoginProfiles, getSignInBrowsers, selectSignInBrowser, addSignInBrowser } from './browserLogin'
import { parseYoutubeCookies } from './youtubeCookies'
import { getChannelPage } from './channelBrowse'
import type { ChannelPageRequest, ChannelPageResponse } from '../shared/ipc'
import { clearHistory, getHistory } from './historyStore'
import { getYoutubeHistory, removeYoutubeHistoryVideo, removeLocalHistoryVideo } from './youtubeHistory'
import {
  createLocalUser,
  getAppPreferences,
  setAppPreferences,
  deleteLocalUser,
  createUserProfile,
  exportLocalData,
  getProfilesState,
  getSessionState,
  getPlayerAudioPreferences,
  setPlayerAudioPreferences,
  importLocalData,
  listActiveSearchHistory,
  loginLocalUser,
  logoutLocalUser,
  recordActiveSearchQuery,
  removeUserProfile,
  setActiveUserProfile,
  updateUserProfile
} from './localDb'
import { createSavedPlaylist, listSavedPlaylists, listSavedVideos, saveVideo, removeSavedVideo, getLibraryVideos, getLibrarySaveOptions } from './accountLibrary'
import { addSubscription, listSubscriptions, removeSubscription } from './subscriptionsStore'

// AppImage launches do not always keep stdout/stderr attached. Node emits an
// EPIPE error when a later console call writes to a closed launcher pipe; if
// nobody handles it, the Electron main process exits. Logging must never make
// the application crash.
for (const stream of [process.stdout, process.stderr]) {
  stream.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code !== 'EPIPE') throw error
  })
}

// Keep the data directory identical in development and packaged installations.
// Keep the encryption/keyring identity and storage location compatible with beta 1.
// The window, installer, executable and desktop entry use the LokTube product name.
app.setName('worldtube')
app.setPath('userData', join(app.getPath('appData'), 'worldtube'))
const primaryInstance = app.requestSingleInstanceLock()
if (!primaryInstance) app.quit()
app.on('second-instance', () => {
  const window = BrowserWindow.getAllWindows().find((candidate) => candidate.isVisible())
  if (window) { if (window.isMinimized()) window.restore(); window.focus() }
})
if (process.platform === 'linux') {
  app.setDesktopName(app.isPackaged ? 'com.riberojuanca.worldtube.desktop' : 'com.riberojuanca.worldtube.dev.desktop')
}

let accountOperation: Promise<unknown> | null = null
function changeAccount<T>(operation: () => Promise<T>): Promise<T> {
  if (accountOperation) return Promise.reject(new Error('Another account operation is in progress'))
  const pending = operation().finally(() => { if (accountOperation === pending) accountOperation = null })
  accountOperation = pending
  return pending
}

ipcMain.handle(IPC_CHANNELS.YOUTUBE_ACCOUNT_STATE, () => youtubeAccountState())
function senderWindow(event: Electron.IpcMainInvokeEvent): BrowserWindow {
  const window = BrowserWindow.fromWebContents(event.sender)
  if (!window || window.isDestroyed()) throw new Error('No app window')
  return window
}
ipcMain.handle(IPC_CHANNELS.WINDOW_STATE, (event) => ({ maximized: senderWindow(event).isMaximized() }))
ipcMain.handle(IPC_CHANNELS.WINDOW_MINIMIZE, (event) => senderWindow(event).minimize())
ipcMain.handle(IPC_CHANNELS.WINDOW_MAXIMIZE, (event) => {
  const window = senderWindow(event)
  if (window.isMaximized()) window.unmaximize()
  else window.maximize()
})
ipcMain.handle(IPC_CHANNELS.WINDOW_CLOSE, (event) => senderWindow(event).close())
ipcMain.handle(IPC_CHANNELS.YOUTUBE_SIGN_IN, (_event, browserId?: string) => changeAccount(async () => {
  return connectYoutubeAccount(await signInWithBrowser(browserId))
}))
ipcMain.handle(IPC_CHANNELS.YOUTUBE_BROWSERS_GET, (_event, refresh?: boolean) => getSignInBrowsers(refresh === true))
ipcMain.handle(IPC_CHANNELS.YOUTUBE_BROWSER_SELECT, (_event, id: string) => selectSignInBrowser(id))
ipcMain.handle(IPC_CHANNELS.YOUTUBE_BROWSER_ADD, async (event) => {
  const owner = BrowserWindow.fromWebContents(event.sender)
  if (!owner) throw new Error('No app window')
  return addSignInBrowser(owner)
})
ipcMain.handle(IPC_CHANNELS.YOUTUBE_SIGN_IN_CANCEL, () => cancelBrowserLogin())
ipcMain.handle(IPC_CHANNELS.YOUTUBE_SIGN_OUT, () => changeAccount(disconnectYoutubeAccount))
ipcMain.handle(IPC_CHANNELS.YOUTUBE_IMPORT_COOKIES, (event) => changeAccount(async () => {
  const owner = BrowserWindow.fromWebContents(event.sender)
  if (!owner) throw new Error('No app window')
  const selected = await dialog.showOpenDialog(owner, {
    title: 'Import YouTube cookies', properties: ['openFile'],
    filters: [{ name: 'YouTube cookies (Netscape or Cookie-Editor)', extensions: ['txt', 'json'] }]
  })
  if (selected.canceled || !selected.filePaths[0]) return null
  return connectYoutubeAccount(parseYoutubeCookies(await readFile(selected.filePaths[0], 'utf8')))
}))
ipcMain.handle(IPC_CHANNELS.PLAYBACK_PROGRESS, (_event, progress: import('../shared/ipc').PlaybackProgress) => playbackHistory.progress(progress))
ipcMain.handle(IPC_CHANNELS.YOUTUBE_HISTORY, () => getYoutubeHistory())
ipcMain.handle(IPC_CHANNELS.YOUTUBE_HISTORY_MORE, (_event, continuation: string) => getYoutubeHistory(continuation))
ipcMain.handle(IPC_CHANNELS.YOUTUBE_HISTORY_REMOVE, (_event, id: string) => removeYoutubeHistoryVideo(id))
ipcMain.handle(IPC_CHANNELS.HISTORY_REMOVE, (_event, videoId: string, profileId: string) => removeLocalHistoryVideo(videoId, profileId))
ipcMain.handle(IPC_CHANNELS.PROTECTION_STATE, () => protectionState())
ipcMain.handle(IPC_CHANNELS.PROTECTION_UPDATE, () => updateProtection())
ipcMain.handle(IPC_CHANNELS.DIAGNOSTICS_GET, () => getDiagnostics())
ipcMain.handle(IPC_CHANNELS.DIAGNOSTICS_EXPORT, async (event) => {
  const owner = BrowserWindow.fromWebContents(event.sender)
  if (!owner) throw new Error('No app window')
  const result = await dialog.showSaveDialog(owner, { title: 'Export LokTube logs', defaultPath: 'LokTube-diagnostics.txt', filters: [{ name: 'Diagnostic log', extensions: ['txt'] }] })
  if (result.canceled || !result.filePath) return null
  const { contents } = await getDiagnostics(true)
  await writeFile(result.filePath, `LokTube ${app.getVersion()} · ${process.platform} ${process.arch}\n${contents}`, { mode: 0o600 })
  return result.filePath
})

// This dev machine doesn't have the setuid chrome-sandbox helper configured
// (needs root-owned 4755, which we won't set from here), so Chromium's native
// startup aborts before any of this file's JS runs — app.commandLine.appendSwitch()
// here is too late to matter. `pnpm dev` passes electron-vite's own `--noSandbox`
// flag instead. A packaged build hitting the same host will need `--no-sandbox`
// passed to the electron binary itself (see freetube-audio-lab's dev notes).

function createWindow(): void {
  const icon = app.isPackaged ? join(process.resourcesPath, 'icon.png') : join(app.getAppPath(), 'resources/icon.png')
  const mainWindow = new BrowserWindow({
    title: 'LokTube',
    frame: false,
    icon,
    width: 1280,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })
  const windowState = () => mainWindow.webContents.send(IPC_CHANNELS.WINDOW_STATE, { maximized: mainWindow.isMaximized() })
  mainWindow.on('maximize', windowState)
  mainWindow.on('unmaximize', windowState)
  mainWindow.on('app-command', (_event, command) => {
    if (command === 'browser-backward' || command === 'browser-back') mainWindow.webContents.send(IPC_CHANNELS.NAVIGATE_HISTORY, 'back')
    else if (command === 'browser-forward') mainWindow.webContents.send(IPC_CHANNELS.NAVIGATE_HISTORY, 'forward')
  })

  // The renderer's `fetch()` calls to YouTube's SABR/ABR endpoint
  // (googlevideo.com), and the native <track> loads for captions
  // (www.youtube.com/api/timedtext, see GlobalPlayerHost.tsx) are otherwise
  // blocked by CORS — those servers don't send Access-Control-Allow-Origin
  // for an app origin like this one. Same approach as poToken.ts's hidden
  // BotGuard session: inject the headers a real page load would send, and
  // allow the response back in. Scoped to just these two paths so nothing
  // else loaded in this window is affected.
  const CORS_WORKAROUND_URLS = ['https://*.googlevideo.com/*', 'https://www.youtube.com/api/timedtext*']

  mainWindow.webContents.session.webRequest.onBeforeSendHeaders({ urls: CORS_WORKAROUND_URLS }, ({ requestHeaders }, callback) => {
    requestHeaders.Referer = 'https://www.youtube.com/'
    requestHeaders.Origin = 'https://www.youtube.com'
    callback({ requestHeaders })
  })

  mainWindow.webContents.session.webRequest.onHeadersReceived({ urls: CORS_WORKAROUND_URLS }, ({ responseHeaders }, callback) => {
    const headers: Record<string, string[]> = { ...responseHeaders }
    // googlevideo.com already echoes back an ACAO header for the Origin we
    // send (see onBeforeSendHeaders above) — appending another one instead of
    // replacing it produces an invalid multi-value header the browser rejects.
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === 'access-control-allow-origin') delete headers[key]
    }
    headers['Access-Control-Allow-Origin'] = ['*']
    callback({ responseHeaders: headers })
  })

  // Renderer console output normally only goes to Chrome DevTools, invisible
  // from the terminal running `pnpm dev` — mirror it into our own stdout so
  // React/shaka-player errors show up in the same place as main-process logs.
  mainWindow.webContents.on('console-message', (details) => {
    console.log(`[renderer:${details.level}] ${details.message} (${details.sourceId}:${details.lineNumber})`)
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    // Internal/blank windows (including Document PiP) must never be forwarded
    // to the user's browser. Only real web links are external navigation.
    if (/^https?:\/\//i.test(details.url)) void shell.openExternal(details.url)
    return { action: 'deny' }
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    // Reloading the trusted app document is required after account changes.
    if (url.split('#')[0] === mainWindow.webContents.getURL().split('#')[0]) return
    event.preventDefault()
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
  })
  // Fullscreen is part of our trusted player UI. Scope its permission requests
  // to the main app frame; the attestation renderer keeps its own deny policy.
  mainWindow.webContents.session.setPermissionRequestHandler((contents, permission, respond, details) => {
    respond(contents === mainWindow.webContents && permission === 'fullscreen' && details.isMainFrame)
  })
  mainWindow.webContents.session.setPermissionCheckHandler((contents, permission, _origin, details) => {
    return contents === mainWindow.webContents && permission === 'fullscreen' && details.isMainFrame
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

ipcMain.handle(
  IPC_CHANNELS.GET_VIDEO_INFO,
  async (_event, { videoId }: VideoInfoRequest): Promise<VideoInfoResponse> => {
    try {
      const data = await fetchVideoInfo(videoId)
      return { ok: true, data }
    } catch (error) {
      console.error('[playback] Failed to load video', error)
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }
)

ipcMain.handle(IPC_CHANNELS.GET_VIDEO_COMMENTS, async (_event, videoId: string, cursor?: string): Promise<VideoCommentsResponse> => {
  if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId) || (cursor && (typeof cursor !== 'string' || cursor.length > 100))) {
    return { ok: false, error: 'Invalid comments request' }
  }
  try {
    return { ok: true, data: await fetchVideoComments(videoId, cursor) }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
})

ipcMain.handle(IPC_CHANNELS.GET_VIDEO_PREVIEW, (_event, videoId: string) => getVideoPreview(videoId))

ipcMain.handle(IPC_CHANNELS.SEARCH, async (_event, { query, filters }: SearchRequest): Promise<SearchResponse> => {
  try {
    await recordActiveSearchQuery(query).catch((error) => {
      console.warn('[search-history] failed to record query', error)
    })
    const data = await searchVideos(query, filters)
    return { ok: true, data: data.videos, channels: data.channels, collections: data.collections }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
})

ipcMain.handle(IPC_CHANNELS.GET_COLLECTION, async (_event, request: CollectionRequest): Promise<CollectionResponse> => {
  try {
    return { ok: true, data: await getCollectionVideos(request.collectionId, request.kind) }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
})

ipcMain.handle(IPC_CHANNELS.SEARCH_SUGGESTIONS, async (_event, { query }: SearchRequest): Promise<SearchSuggestionsResponse> => {
  try {
    const data = await getSearchSuggestions(query)
    return { ok: true, data }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
})

ipcMain.handle(IPC_CHANNELS.GET_HOME_FEED, async (): Promise<SearchResponse> => {
  try {
    const data = await getHomeDiscovery()
    return { ok: true, data: data.videos, home: data.home }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
})

ipcMain.handle(IPC_CHANNELS.GET_CHANNEL, async (_event, { channelId }: { channelId: string }): Promise<ChannelResponse> => {
  try {
    const data = await getChannelInfo(channelId, false)
    return { ok: true, data }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
})

ipcMain.handle(IPC_CHANNELS.CHANNEL_PAGE, async (_event, request: ChannelPageRequest): Promise<ChannelPageResponse> => {
  try {
    return { ok: true, data: await getChannelPage(request) }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
})

registerUpdates()
ipcMain.handle(IPC_CHANNELS.APP_PREFERENCES_GET, () => getAppPreferences())
ipcMain.handle(IPC_CHANNELS.APP_PREFERENCES_SET, (_event, preferences: import('../shared/locale').AppPreferences) => setAppPreferences(preferences))
ipcMain.handle(IPC_CHANNELS.SESSION_GET_STATE, (): Promise<LocalSessionState> => getSessionState())
ipcMain.handle(IPC_CHANNELS.PLAYER_AUDIO_GET, () => getPlayerAudioPreferences())
ipcMain.handle(IPC_CHANNELS.PLAYER_AUDIO_SET, (_event, audio: import('../shared/ipc').PlayerAudioPreferences) => setPlayerAudioPreferences(audio))
ipcMain.handle(IPC_CHANNELS.SESSION_CREATE_USER, (_event, request: CreateLocalUserRequest): Promise<LocalSessionState> => createLocalUser(request))
ipcMain.handle(IPC_CHANNELS.SESSION_LOGIN, (_event, request: LoginLocalUserRequest): Promise<LocalSessionState> => loginLocalUser(request))
ipcMain.handle(IPC_CHANNELS.SESSION_LOGOUT, (): Promise<LocalSessionState> => logoutLocalUser())
ipcMain.handle(IPC_CHANNELS.SESSION_DELETE_USER, (_event, request: DeleteLocalUserRequest): Promise<LocalSessionState> => deleteLocalUser(request))

ipcMain.handle(IPC_CHANNELS.DATA_EXPORT, async (event): Promise<string | null> => {
  const ownerWindow = BrowserWindow.fromWebContents(event.sender)
  if (!ownerWindow) throw new Error('No app window')
  const result = await dialog.showSaveDialog(ownerWindow, {
    title: translateFor((await getAppPreferences()).language, "Export LokTube data"),
    defaultPath: 'loktube-data.json',
    filters: [{ name: 'LokTube data', extensions: ['json'] }]
  })
  if (result.canceled || !result.filePath) return null
  await exportLocalData(result.filePath)
  return result.filePath
})

ipcMain.handle(IPC_CHANNELS.DATA_IMPORT, async (event): Promise<LocalSessionState | null> => {
  const ownerWindow = BrowserWindow.fromWebContents(event.sender)
  if (!ownerWindow) throw new Error('No app window')
  const result = await dialog.showOpenDialog(ownerWindow, {
    title: translateFor((await getAppPreferences()).language, "Import LokTube data"),
    properties: ['openFile'],
    filters: [{ name: 'LokTube data', extensions: ['json'] }]
  })
  const [filePath] = result.filePaths
  if (result.canceled || !filePath) return null
  await importLocalData(filePath)
  await activateCurrentLibrary()
  return getSessionState()
})

ipcMain.handle(IPC_CHANNELS.PROFILES_GET_STATE, (): Promise<ProfilesState> => getProfilesState())
ipcMain.handle(IPC_CHANNELS.PROFILES_CREATE, (_event, request: CreateProfileRequest): Promise<ProfilesState> => createUserProfile(request))
ipcMain.handle(IPC_CHANNELS.PROFILES_UPDATE, (_event, request: UpdateProfileRequest): Promise<ProfilesState> => updateUserProfile(request))
ipcMain.handle(IPC_CHANNELS.PROFILES_SET_ACTIVE, (_event, profileId: string): Promise<ProfilesState> => setActiveUserProfile(profileId))
ipcMain.handle(IPC_CHANNELS.PROFILES_REMOVE, (_event, profileId: string): Promise<ProfilesState> => removeUserProfile(profileId))

ipcMain.handle(IPC_CHANNELS.HISTORY_LIST, () => getHistory())
ipcMain.handle(IPC_CHANNELS.HISTORY_CLEAR, () => clearHistory())

ipcMain.handle(IPC_CHANNELS.LIBRARY_VIDEOS_PAGE, (_event, playlistId: string | null, library?: LibraryKind, continuation?: string) => getLibraryVideos(playlistId, library, continuation))
ipcMain.handle(IPC_CHANNELS.LIBRARY_SAVE_OPTIONS, (_event, videoId: string, library?: LibraryKind) => getLibrarySaveOptions(videoId, library))
ipcMain.handle(IPC_CHANNELS.SAVED_PLAYLISTS_LIST, (_event, library?: LibraryKind) => listSavedPlaylists(library))
ipcMain.handle(IPC_CHANNELS.SAVED_PLAYLISTS_CREATE, (_event, request: CreateSavedPlaylistRequest) => createSavedPlaylist(request))
ipcMain.handle(IPC_CHANNELS.SAVED_VIDEOS_LIST, (_event, playlistId?: string | null, library?: LibraryKind) => listSavedVideos(playlistId, library))
ipcMain.handle(IPC_CHANNELS.SAVED_VIDEOS_SAVE, (_event, request: SaveVideoRequest) => saveVideo(request))
ipcMain.handle(IPC_CHANNELS.SAVED_VIDEOS_REMOVE, (_event, videoId: string, playlistId?: string | null, library?: LibraryKind) =>
  removeSavedVideo(videoId, playlistId, library)
)
ipcMain.handle(IPC_CHANNELS.SEARCH_HISTORY_LIST, () => listActiveSearchHistory())
ipcMain.handle(IPC_CHANNELS.SEARCH_HISTORY_RECORD, (_event, query: string) => recordActiveSearchQuery(query))

ipcMain.handle(IPC_CHANNELS.SUBSCRIPTIONS_LIST, () => listSubscriptions())
ipcMain.handle(IPC_CHANNELS.SUBSCRIPTIONS_FEED, async (): Promise<SearchResponse> => {
  try {
    const data = hasYoutubeAccount() ? await getYoutubeSubscriptionsFeed()
      : await getSubscriptionsFeed((await listSubscriptions()).map((sub) => sub.channelId))
    return { ok: true, data }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
})
ipcMain.handle(IPC_CHANNELS.SUBSCRIPTIONS_ADD, (_event, sub: Omit<Subscription, 'subscribedAt'>) => addSubscription(sub))
ipcMain.handle(IPC_CHANNELS.SUBSCRIPTIONS_REMOVE, (_event, channelId: string) => removeSubscription(channelId))

app.whenReady().then(async () => {
  if (!primaryInstance) return
  await initializeDiagnostics(join(app.getPath('userData'), 'logs'))
  console.info(`LokTube ${app.getVersion()} starting on ${process.platform} ${process.arch}`)
  await initializeProtection()
  await removeAbandonedLoginProfiles()
  await initializeYoutubeAccount()
  if (process.platform === 'darwin') {
    app.dock?.setIcon(app.isPackaged ? join(process.resourcesPath, 'icon.png') : join(app.getAppPath(), 'resources/icon.png'))
  }
  createWindow()
  void checkForUpdatesOnStartup()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })

  // Dev-only: exercise the real fetchVideoInfo pipeline on boot without
  // needing anyone to click through the UI. Set WORLDTUBE_AUTOTEST_VIDEO_ID
  // when launching `pnpm dev` — logs go through the same console.log calls
  // as a real request, so they show up wherever those are being watched.
  const autotestVideoId = process.env.WORLDTUBE_AUTOTEST_VIDEO_ID
  if (autotestVideoId) {
    fetchVideoInfo(autotestVideoId)
      .then((data) => console.log('[autotest] RESULT_OK', JSON.stringify({ ...data, dashManifest: data.dashManifest ? `<${data.dashManifest.length} chars>` : null })))
      .catch((error) => console.error('[autotest] RESULT_ERROR', error))
  }
})

app.on('before-quit', cancelBrowserLogin)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
