import shaka from 'shaka-player/dist/shaka-player.ui.js'
import { t } from '../i18n/LocaleContext'

class AutoplaySetting extends shaka.ui.Element {
  private readonly button: HTMLButtonElement
  private enabled = true
  private pending = false
  constructor(parent: HTMLElement, controls: shaka.ui.Controls) {
    super(parent, controls)
    this.button = document.createElement('button')
    this.button.type = 'button'
    this.button.className = 'shaka-autoplay-button'
    this.button.setAttribute('role', 'menuitemcheckbox')
    parent.appendChild(this.button)
    this.eventManager?.listen(this.button, 'click', () => { void this.toggle() })
    this.eventManager?.listen(window, 'worldtube:preferences-changed', () => { void this.refresh() })
    void this.refresh()
  }
  private render(): void {
    this.button.setAttribute('aria-label', t('Autoplay next video'))
    this.button.setAttribute('aria-checked', String(this.enabled))
    this.button.textContent = `${t('Autoplay next video')} · ${t(this.enabled ? 'On' : 'Off')}`
  }
  private async refresh(): Promise<void> {
    try { this.enabled = (await window.api.getAppPreferences()).autoplayNext !== false }
    catch { /* Keep the last known setting on an unavailable IPC response. */ }
    this.render()
  }
  private async toggle(): Promise<void> {
    if (this.pending) return
    this.pending = true
    this.button.disabled = true
    try {
      const preferences = await window.api.getAppPreferences()
      await window.api.setAppPreferences({ ...preferences, autoplayNext: preferences.autoplayNext === false })
      await this.refresh()
      this.button.removeAttribute('title')
      window.dispatchEvent(new Event('worldtube:preferences-changed'))
    } catch {
      this.button.title = t('Could not save autoplay setting. Try again.')
    } finally { this.pending = false; this.button.disabled = false }
  }
}

shaka.ui.OverflowMenu.registerElement('yamtube_autoplay', {
  create: (parent: HTMLElement, controls: shaka.ui.Controls) => new AutoplaySetting(parent, controls)
})
