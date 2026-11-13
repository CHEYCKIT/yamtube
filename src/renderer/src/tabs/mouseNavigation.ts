export type HistoryDirection = 'back' | 'forward'
export type HistoryInput = 'native' | 'mouse'

// Windows can report the same side-button press through WM_APPCOMMAND and
// Chromium's mouse events. Ignore that duplicate, retaining real repeated clicks.
export class MouseHistoryNavigation {
  private previous: { direction: HistoryDirection; source: HistoryInput; at: number } | null = null
  constructor(private navigate: (direction: HistoryDirection) => void, private now = () => performance.now()) {}
  handle(direction: HistoryDirection, source: HistoryInput): void {
    const at = this.now()
    if (this.previous?.direction === direction && this.previous.source !== source && at - this.previous.at < 150) return
    this.previous = { direction, source, at }
    this.navigate(direction)
  }
}
