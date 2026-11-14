import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { t, useLocale } from '../i18n/LocaleContext'

/** Horizontal Home topic chips with YouTube-style navigation at either edge. */
export function TopicScroller({ children }: { children: ReactNode }) {
  useLocale()
  const viewport = useRef<HTMLDivElement>(null)
  const [edges, setEdges] = useState({ previous: false, next: false })

  const measure = useCallback(() => {
    const element = viewport.current
    if (!element) return
    const maxScroll = Math.max(0, element.scrollWidth - element.clientWidth)
    const next = {
      previous: maxScroll > 2 && element.scrollLeft > 2,
      next: maxScroll > 2 && element.scrollLeft < maxScroll - 2
    }
    setEdges(current => current.previous === next.previous && current.next === next.next
      ? current : next)
  }, [])

  useLayoutEffect(() => {
    const element = viewport.current
    if (!element) return
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    // Detect changes in chip sizes even when the header itself does not resize.
    for (const child of element.children) observer.observe(child)
    measure()
    return () => observer.disconnect()
  }, [children, measure])

  function scroll(direction: -1 | 1) {
    const element = viewport.current
    if (!element) return
    element.scrollBy({
      left: direction * Math.max(160, element.clientWidth * 0.75),
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'
    })
  }

  const arrowClass = 'absolute top-1/2 z-10 grid h-8 w-8 -translate-y-1/2 cursor-pointer place-items-center rounded-full border border-white/10 bg-neutral-900/95 text-white shadow-lg backdrop-blur-sm transition-colors hover:bg-neutral-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white'

  return <div data-home-topic-carousel className="relative min-w-0 flex-1">
    <div ref={viewport} data-home-topics aria-label={t('Home topics')} tabIndex={0}
      onScroll={measure}
      className="wt-home-topics flex min-w-0 items-center gap-2 overflow-x-auto overscroll-x-contain whitespace-nowrap">
      {children}
    </div>
    {edges.previous && <button type="button" aria-label={t('Previous topics')}
      onClick={() => scroll(-1)} className={arrowClass + ' left-0'}>
      <ChevronLeft aria-hidden="true" className="h-5 w-5" />
    </button>}
    {edges.next && <button type="button" aria-label={t('Next topics')}
      onClick={() => scroll(1)} className={arrowClass + ' right-0'}>
      <ChevronRight aria-hidden="true" className="h-5 w-5" />
    </button>}
  </div>
}
