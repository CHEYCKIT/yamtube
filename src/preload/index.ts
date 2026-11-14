import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '../shared/ipc'
import type { AppPreferences } from '../shared/locale'
import type { UpdateState } from '../shared/ipc'
import type {
  ChannelResponse,
  CollectionRequest,
  CollectionResponse,
  PlayerAudioPreferences,
  ChannelPageRequest,
  ChannelPageResponse,
  CreateLocalUserRequest,
  DeleteLocalUserRequest,
  CreateProfileRequest,
  CreateSavedPlaylistRequest,
  HistoryEntry,
  LocalSessionState,
  LibraryKind,
  LoginLocalUserRequest,
  ProfilesState,
  SaveVideoRequest,
  SearchHistoryEntry,
  SearchRequest,
  SearchFilters,
  SearchResponse,
  SearchSuggestionsResponse,
  LibraryVideosPage,
  LibrarySaveOptions,
  SavedPlaylist,
  SavedVideo,
  Subscription,
  UpdateProfileRequest,
  VideoInfoRequest,
  VideoInfoResponse
} from '../shared/ipc'

const api = {
  getWindowState: (): Promise<{ maximized: boolean }> => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_STATE),
  minimizeWindow: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_MINIMIZE),
  toggleMaximizeWindow: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_MAXIMIZE),
  closeWindow: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_CLOSE),
  onWindowState: (listener: (state: { maximized: boolean }) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: { maximized: boolean }) => listener(state)
    ipcRenderer.on(IPC_CHANNELS.WINDOW_STATE, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.WINDOW_STATE, handler)
  },
  getDiagnostics: (): Promise<{ path: string; contents: string }> => ipcRenderer.invoke(IPC_CHANNELS.DIAGNOSTICS_GET),
  exportDiagnostics: (): Promise<string | null> => ipcRenderer.invoke(IPC_CHANNELS.DIAGNOSTICS_EXPORT),
  onHistoryNavigation: (listener: (direction: 'back' | 'forward') => void): (() => void) => {
    const receive = (_event: Electron.IpcRendererEvent, direction: 'back' | 'forward') => listener(direction)
    ipcRenderer.on(IPC_CHANNELS.NAVIGATE_HISTORY, receive)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.NAVIGATE_HISTORY, receive)
  },
  getYoutubeAccount: (): Promise<import('../shared/ipc').YoutubeAccountState> => ipcRenderer.invoke(IPC_CHANNELS.YOUTUBE_ACCOUNT_STATE),
  signInYoutube: (): Promise<import('../shared/ipc').YoutubeAccountState> => ipcRenderer.invoke(IPC_CHANNELS.YOUTUBE_SIGN_IN),
  signInYoutubeWithBrowser: (browserId?: string): Promise<import('../shared/ipc').YoutubeAccountState> => ipcRenderer.invoke(IPC_CHANNELS.YOUTUBE_SIGN_IN_BROWSER, browserId),
  getSignInBrowsers: (refresh = false): Promise<import('../shared/ipc').SignInBrowserState> => ipcRenderer.invoke(IPC_CHANNELS.YOUTUBE_BROWSERS_GET, refresh),
  selectSignInBrowser: (id: string): Promise<import('../shared/ipc').SignInBrowserState> => ipcRenderer.invoke(IPC_CHANNELS.YOUTUBE_BROWSER_SELECT, id),
  addSignInBrowser: (): Promise<import('../shared/ipc').SignInBrowserState> => ipcRenderer.invoke(IPC_CHANNELS.YOUTUBE_BROWSER_ADD),
  cancelYoutubeSignIn: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.YOUTUBE_SIGN_IN_CANCEL),
  importYoutubeCookies: (): Promise<import('../shared/ipc').YoutubeAccountState | null> => ipcRenderer.invoke(IPC_CHANNELS.YOUTUBE_IMPORT_COOKIES),
  signOutYoutube: (): Promise<import('../shared/ipc').YoutubeAccountState> => ipcRenderer.invoke(IPC_CHANNELS.YOUTUBE_SIGN_OUT),
  onYoutubeAccount: (listener: (state: import('../shared/ipc').YoutubeAccountState) => void): (() => void) => {
    const receive = (_event: Electron.IpcRendererEvent, state: import('../shared/ipc').YoutubeAccountState) => listener(state)
    ipcRenderer.on(IPC_CHANNELS.YOUTUBE_ACCOUNT_STATE, receive)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.YOUTUBE_ACCOUNT_STATE, receive)
  },
  getYoutubeHistory: (): Promise<import('../shared/ipc').YoutubeHistoryPage> => ipcRenderer.invoke(IPC_CHANNELS.YOUTUBE_HISTORY),
  getMoreYoutubeHistory: (continuation: string): Promise<import('../shared/ipc').YoutubeHistoryPage> => ipcRenderer.invoke(IPC_CHANNELS.YOUTUBE_HISTORY_MORE, continuation),
  removeYoutubeHistoryVideo: (historyId: string): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.YOUTUBE_HISTORY_REMOVE, historyId),
  removeLocalHistoryVideo: (videoId: string, profileId: string): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.HISTORY_REMOVE, videoId, profileId),
  reportPlaybackProgress: (progress: import('../shared/ipc').PlaybackProgress): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.PLAYBACK_PROGRESS, progress),
  getProtection: (): Promise<import('../shared/ipc').ProtectionState> => ipcRenderer.invoke(IPC_CHANNELS.PROTECTION_STATE),
  updateProtection: (): Promise<import('../shared/ipc').ProtectionState> => ipcRenderer.invoke(IPC_CHANNELS.PROTECTION_UPDATE),
  getVideoPreview: (videoId: string): Promise<import('../shared/ipc').VideoPreview | null> => ipcRenderer.invoke(IPC_CHANNELS.GET_VIDEO_PREVIEW, videoId),
  getAppPreferences: (): Promise<AppPreferences> => ipcRenderer.invoke(IPC_CHANNELS.APP_PREFERENCES_GET),
  setAppPreferences: (preferences: AppPreferences): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.APP_PREFERENCES_SET, preferences),
  getUpdateState: (): Promise<UpdateState> => ipcRenderer.invoke(IPC_CHANNELS.UPDATES_STATE),
  checkForUpdates: (): Promise<UpdateState> => ipcRenderer.invoke(IPC_CHANNELS.UPDATES_CHECK),
  downloadUpdate: (): Promise<UpdateState> => ipcRenderer.invoke(IPC_CHANNELS.UPDATES_DOWNLOAD),
  installUpdate: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.UPDATES_INSTALL),
  onUpdateState: (listener: (state: UpdateState) => void): (() => void) => {
    const receive = (_event: Electron.IpcRendererEvent, state: UpdateState) => listener(state)
    ipcRenderer.on(IPC_CHANNELS.UPDATES_STATE, receive)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.UPDATES_STATE, receive)
  },
  getPlayerAudioPreferences: (): Promise<PlayerAudioPreferences> => ipcRenderer.invoke(IPC_CHANNELS.PLAYER_AUDIO_GET),
  setPlayerAudioPreferences: (audio: PlayerAudioPreferences): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.PLAYER_AUDIO_SET, audio),
  getVideoComments: (videoId: string, cursor?: string): Promise<import('../shared/ipc').VideoCommentsResponse> => ipcRenderer.invoke(IPC_CHANNELS.GET_VIDEO_COMMENTS, videoId, cursor),
  setVideoRating: (videoId: string, rating: import('../shared/ipc').VideoRating): Promise<import('../shared/ipc').VideoRatingResponse> =>
    ipcRenderer.invoke(IPC_CHANNELS.SET_VIDEO_RATING, videoId, rating),
  getVideoInfo: (videoId: string): Promise<VideoInfoResponse> =>
    ipcRenderer.invoke(IPC_CHANNELS.GET_VIDEO_INFO, { videoId } satisfies VideoInfoRequest),
  search: (query: string, filters?: SearchFilters): Promise<SearchResponse> =>
    ipcRenderer.invoke(IPC_CHANNELS.SEARCH, { query, filters } satisfies SearchRequest),
  getCollection: (request: CollectionRequest): Promise<CollectionResponse> => ipcRenderer.invoke(IPC_CHANNELS.GET_COLLECTION, request),
  getSearchSuggestions: (query: string): Promise<SearchSuggestionsResponse> =>
    ipcRenderer.invoke(IPC_CHANNELS.SEARCH_SUGGESTIONS, { query } satisfies SearchRequest),
  getChannel: (channelId: string): Promise<ChannelResponse> => ipcRenderer.invoke(IPC_CHANNELS.GET_CHANNEL, { channelId }),
  getChannelPage: (request: ChannelPageRequest): Promise<ChannelPageResponse> => ipcRenderer.invoke(IPC_CHANNELS.CHANNEL_PAGE, request),
  getHomeFeed: (): Promise<SearchResponse> => ipcRenderer.invoke(IPC_CHANNELS.GET_HOME_FEED),
  getSessionState: (): Promise<LocalSessionState> => ipcRenderer.invoke(IPC_CHANNELS.SESSION_GET_STATE),
  createLocalUser: (request: CreateLocalUserRequest): Promise<LocalSessionState> =>
    ipcRenderer.invoke(IPC_CHANNELS.SESSION_CREATE_USER, request),
  loginLocalUser: (request: LoginLocalUserRequest): Promise<LocalSessionState> => ipcRenderer.invoke(IPC_CHANNELS.SESSION_LOGIN, request),
  logoutLocalUser: (): Promise<LocalSessionState> => ipcRenderer.invoke(IPC_CHANNELS.SESSION_LOGOUT),
  deleteLocalUser: (request: DeleteLocalUserRequest): Promise<LocalSessionState> => ipcRenderer.invoke(IPC_CHANNELS.SESSION_DELETE_USER, request),
  exportData: (): Promise<string | null> => ipcRenderer.invoke(IPC_CHANNELS.DATA_EXPORT),
  importData: (): Promise<LocalSessionState | null> => ipcRenderer.invoke(IPC_CHANNELS.DATA_IMPORT),
  getProfilesState: (): Promise<ProfilesState> => ipcRenderer.invoke(IPC_CHANNELS.PROFILES_GET_STATE),
  createProfile: (request: CreateProfileRequest): Promise<ProfilesState> => ipcRenderer.invoke(IPC_CHANNELS.PROFILES_CREATE, request),
  updateProfile: (request: UpdateProfileRequest): Promise<ProfilesState> => ipcRenderer.invoke(IPC_CHANNELS.PROFILES_UPDATE, request),
  setActiveProfile: (profileId: string): Promise<ProfilesState> => ipcRenderer.invoke(IPC_CHANNELS.PROFILES_SET_ACTIVE, profileId),
  removeProfile: (profileId: string): Promise<ProfilesState> => ipcRenderer.invoke(IPC_CHANNELS.PROFILES_REMOVE, profileId),
  getHistory: (): Promise<HistoryEntry[]> => ipcRenderer.invoke(IPC_CHANNELS.HISTORY_LIST),
  clearHistory: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.HISTORY_CLEAR),
  getLibraryVideos: (playlistId: string | null, library: LibraryKind = 'video', continuation?: string): Promise<LibraryVideosPage> => ipcRenderer.invoke(IPC_CHANNELS.LIBRARY_VIDEOS_PAGE, playlistId, library, continuation),
  getLibrarySaveOptions: (videoId: string, library: LibraryKind = 'video'): Promise<LibrarySaveOptions> => ipcRenderer.invoke(IPC_CHANNELS.LIBRARY_SAVE_OPTIONS, videoId, library),
  listSavedPlaylists: (library?: LibraryKind): Promise<SavedPlaylist[]> => ipcRenderer.invoke(IPC_CHANNELS.SAVED_PLAYLISTS_LIST, library),
  createSavedPlaylist: (request: CreateSavedPlaylistRequest): Promise<SavedPlaylist> =>
    ipcRenderer.invoke(IPC_CHANNELS.SAVED_PLAYLISTS_CREATE, request),
  listSavedVideos: (playlistId?: string | null, library?: LibraryKind): Promise<SavedVideo[]> => ipcRenderer.invoke(IPC_CHANNELS.SAVED_VIDEOS_LIST, playlistId, library),
  saveVideo: (request: SaveVideoRequest): Promise<SavedVideo> => ipcRenderer.invoke(IPC_CHANNELS.SAVED_VIDEOS_SAVE, request),
  removeSavedVideo: (videoId: string, playlistId?: string | null, library?: LibraryKind): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.SAVED_VIDEOS_REMOVE, videoId, playlistId, library),
  listSearchHistory: (): Promise<SearchHistoryEntry[]> => ipcRenderer.invoke(IPC_CHANNELS.SEARCH_HISTORY_LIST),
  recordSearchQuery: (query: string): Promise<SearchHistoryEntry[]> => ipcRenderer.invoke(IPC_CHANNELS.SEARCH_HISTORY_RECORD, query),
  listSubscriptions: (): Promise<Subscription[]> => ipcRenderer.invoke(IPC_CHANNELS.SUBSCRIPTIONS_LIST),
  getSubscriptionsFeed: (): Promise<SearchResponse> => ipcRenderer.invoke(IPC_CHANNELS.SUBSCRIPTIONS_FEED),
  subscribe: (sub: Omit<Subscription, 'subscribedAt'>): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.SUBSCRIPTIONS_ADD, sub),
  unsubscribe: (channelId: string): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.SUBSCRIPTIONS_REMOVE, channelId)
}

export type LokTubeApi = typeof api

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-expect-error only reached when contextIsolation is disabled
  window.api = api
}
