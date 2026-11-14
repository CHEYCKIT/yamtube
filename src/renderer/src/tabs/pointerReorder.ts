/** No native drag ghost; move tabs using compositor transforms and commit only on drop. */
export interface PointerTabSort {
  origin: HTMLElement
  strip: HTMLElement
  pointerId: number
  startX: number
  startY: number
  onStart: () => void
  onDrop: (from: string, to: string, before: Map<string, DOMRect>) => void
  onFinish: (didDrag: boolean) => void
}
const THRESHOLD = 6
const EDGE = 44

export function dropIndexAt(x: number, sourceIndex: number, centers: number[]): number {
  let destination = 0
  for (let i = 0; i < centers.length; i++) {
    if (i !== sourceIndex && x > centers[i]) destination++
  }
  return destination
}

export function beginPointerTabSort(options: PointerTabSort): () => void {
  const { origin, strip, pointerId, startX, startY, onStart, onDrop, onFinish } = options
  const nodes = Array.from(strip.querySelectorAll<HTMLElement>(':scope > [data-tab-id]'))
    .map(element => ({ id: element.dataset.tabId!, element, rect: element.getBoundingClientRect() }))
  const sourceIndex = nodes.findIndex(node => node.element === origin)
  if (sourceIndex < 0 || nodes.length < 2) return () => {}
  const startScroll = strip.scrollLeft
  const gap = parseFloat(getComputedStyle(strip).columnGap) || 4
  const source = nodes[sourceIndex]
  const width = source.rect.width + gap
  const oldSelection = document.body.style.userSelect
  const oldCursor = document.body.style.cursor
  const originals = new Map(nodes.map(node => [node.id, {
    transform: node.element.style.transform, transition: node.element.style.transition,
    boxShadow: node.element.style.boxShadow, zIndex: node.element.style.zIndex,
    position: node.element.style.position, willChange: node.element.style.willChange
  }]))
  let pointerX = startX
  let destination = sourceIndex
  let dragging = false
  let ended = false
  let frame = 0

  const paint = () => {
    if (!dragging) return
    const scrollDelta = strip.scrollLeft - startScroll
    const deltaX = pointerX - startX + scrollDelta
    const center = source.rect.left + source.rect.width / 2 + pointerX - startX
    destination = dropIndexAt(center, sourceIndex,
      nodes.map(node => node.rect.left + node.rect.width / 2 - scrollDelta))
    for (const [index, node] of nodes.entries()) {
      if (index === sourceIndex) {
        node.element.style.transform = 'translate3d(' + deltaX + 'px, -2px, 0) scale(1.015)'
      } else {
        const offset = destination > sourceIndex && index > sourceIndex && index <= destination ? -width
          : destination < sourceIndex && index < sourceIndex && index >= destination ? width : 0
        node.element.style.transform = offset ? 'translate3d(' + offset + 'px, 0, 0)' : ''
      }
    }
  }

  const velocity = () => {
    const rect = strip.getBoundingClientRect()
    if (pointerX < rect.left + EDGE)
      return -Math.min(18, Math.max(0, (rect.left + EDGE - pointerX) / 2))
    if (pointerX > rect.right - EDGE)
      return Math.min(18, Math.max(0, (pointerX - rect.right + EDGE) / 2))
    return 0
  }
  const scroll = () => {
    frame = 0
    if (!dragging || ended) return
    const speed = velocity()
    if (!speed) return
    const before = strip.scrollLeft
    strip.scrollLeft += speed
    if (before !== strip.scrollLeft) {
      paint()
      frame = requestAnimationFrame(scroll)
    }
  }
  const restore = () => {
    nodes.forEach(node => Object.assign(node.element.style, originals.get(node.id)!))
    document.body.style.userSelect = oldSelection
    document.body.style.cursor = oldCursor
  }
  const detach = () => {
    window.removeEventListener('pointermove', move, true)
    window.removeEventListener('pointerup', up, true)
    window.removeEventListener('pointercancel', cancel, true)
    window.removeEventListener('keydown', keydown, true)
    window.removeEventListener('blur', cancel)
    if (frame) cancelAnimationFrame(frame)
    frame = 0
    try { if (origin.hasPointerCapture(pointerId)) origin.releasePointerCapture(pointerId) } catch { /* released */ }
  }
  const finish = (commit: boolean) => {
    if (ended) return
    ended = true
    detach()
    if (!dragging) { onFinish(false); return }
    const before = new Map(nodes.map(node => [node.id, node.element.getBoundingClientRect()]))
    restore()
    onFinish(true)
    if (commit && destination !== sourceIndex) onDrop(source.id, nodes[destination].id, before)
  }
  const move = (event: PointerEvent) => {
    if (ended || event.pointerId !== pointerId) return
    pointerX = event.clientX
    if (!dragging) {
      if (Math.hypot(event.clientX - startX, event.clientY - startY) < THRESHOLD) return
      dragging = true
      onStart()
      document.body.style.userSelect = 'none'
      document.body.style.cursor = 'grabbing'
      source.element.style.position = 'relative'
      source.element.style.zIndex = '50'
      source.element.style.boxShadow = '0 8px 22px rgba(0,0,0,0.38)'
      source.element.style.willChange = 'transform'
      for (const node of nodes) {
        if (node !== source) {
          node.element.style.transition = 'transform 150ms cubic-bezier(0.2,0.75,0.25,1)'
          node.element.style.willChange = 'transform'
        } else node.element.style.transition = 'none'
      }
      try { origin.setPointerCapture(pointerId) } catch { /* pointer left app */ }
    }
    event.preventDefault()
    paint()
    if (!frame && velocity()) frame = requestAnimationFrame(scroll)
  }
  const up = (event: PointerEvent) => { if (event.pointerId === pointerId) finish(true) }
  const cancel = () => finish(false)
  const keydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') { event.preventDefault(); finish(false) }
  }
  window.addEventListener('pointermove', move, true)
  window.addEventListener('pointerup', up, true)
  window.addEventListener('pointercancel', cancel, true)
  window.addEventListener('keydown', keydown, true)
  window.addEventListener('blur', cancel)
  return cancel
}
