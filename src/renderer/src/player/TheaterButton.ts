import shaka from 'shaka-player/dist/shaka-player.ui.js'
import { t } from '../i18n/LocaleContext'
import { THEATER_STATE_EVENT, THEATER_TOGGLE_EVENT } from './events'

class TheaterButton extends shaka.ui.Element {
  private readonly button: HTMLButtonElement
  constructor(parent: HTMLElement, controls: shaka.ui.Controls) {
    super(parent, controls)
    this.button = document.createElement('button')
    this.button.type = 'button'
    this.button.className = 'shaka-theater-button shaka-tooltip shaka-no-propagation'
    parent.appendChild(this.button)
    const render = () => {
      const active = document.querySelector('.wt-app-shell')?.classList.contains('wt-theater') ?? false
      const label = t(active ? 'Exit theater mode' : 'Theater mode')
      this.button.setAttribute('aria-label', label)
      this.button.setAttribute('aria-pressed', String(active))
      this.button.title = `${label} (T)`
      this.button.innerHTML = `<svg aria-hidden="true" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"><rect x="${active ? 6 : 3}" y="6" width="${active ? 12 : 18}" height="12" rx="1" /></svg>`
    }
    this.eventManager?.listen(this.button, 'click', () => {
      const tabId = controls.getVideoContainer().dataset.playerTabId
      window.dispatchEvent(new CustomEvent(THEATER_TOGGLE_EVENT, { detail: { tabId } }))
    })
    this.eventManager?.listen(window, THEATER_STATE_EVENT, render)
    this.eventManager?.listen(this.localization, 'localechanged', render)
    render()
  }
}

shaka.ui.Controls.registerElement('yamtube_theater', {
  create: (parent: HTMLElement, controls: shaka.ui.Controls) => new TheaterButton(parent, controls)
})
