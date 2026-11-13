export interface YoutubeIdentity {
  name: string
  handle: string | null
  byline: string | null
  avatarUrl: string | null
}
interface Account extends YoutubeIdentity { selected: boolean; disabled: boolean }
type ObjectData = Record<string, unknown>
const object = (value: unknown): ObjectData | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as ObjectData : null

function text(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  const data = object(value)
  if (!data) return ''
  if (typeof data.simpleText === 'string') return data.simpleText.trim()
  if (typeof data.content === 'string') return data.content.trim()
  return Array.isArray(data.runs) ? data.runs.map((run) => object(run)?.text ?? '').join('').trim() : ''
}

function identity(value: unknown): Account | null {
  const data = object(value)
  if (!data) return null
  const endpoint = object(data.serviceEndpoint)
  if (data.isGuest === true || endpoint?.signInEndpoint || endpoint?.signOutEndpoint) return null
  const field = (value: unknown) => { const result = text(value); return result === 'N/A' ? '' : result }
  const name = field(data.accountName)
  const handle = field(data.channelHandle)
  const byline = field(data.accountByline)
  if (![name, handle, byline].some(Boolean)) return null
  const photo = object(data.accountPhoto)
  const images = photo?.thumbnails ?? photo?.sources
  const avatar = Array.isArray(images) ? images.map((image) => object(image)?.url).find((url) => typeof url === 'string' && url.startsWith('https://')) : null
  return { name: name || handle || byline, handle: handle || null, byline: byline || null,
    avatarUrl: typeof avatar === 'string' ? avatar : null, selected: data.isSelected === true, disabled: data.isDisabled === true }
}

// Only inspect identity renderers returned by authenticated account endpoints.
// Home-feed content, arbitrary display names and a locally-set logged_in flag
// are not proof of an authenticated account.
export function inspectAccountResponse(response: unknown): { identity: YoutubeIdentity | null; items: number; selected: number; headers: number } {
  const accounts: Account[] = []
  const headers: Account[] = []
  let count = 0
  const walk = (value: unknown, depth: number) => {
    if (depth > 24 || ++count > 20_000 || !value || typeof value !== 'object') return
    if (Array.isArray(value)) { value.forEach((item) => walk(item, depth + 1)); return }
    for (const [key, item] of Object.entries(value)) {
      if (['activeAccountHeaderRenderer', 'activeAccountHeaderViewModel'].includes(key)) {
        const account = identity(item)
        if (account && !account.disabled) headers.push(account)
      } else if (['accountItem', 'accountItemRenderer'].includes(key)) {
        const account = identity(item)
        if (account && !account.disabled) accounts.push(account)
      } else walk(item, depth + 1)
    }
  }
  walk(response, 0)
  const selected = accounts.filter((account) => account.selected)
  // A sole enabled account does not need an isSelected flag. Never arbitrarily
  // pick the first entry when several different accounts are available.
  const chosen = headers.length === 1 ? headers[0] : selected.length === 1 ? selected[0] : accounts.length === 1 ? accounts[0] : null
  return { identity: chosen, items: accounts.length, selected: selected.length, headers: headers.length }
}
