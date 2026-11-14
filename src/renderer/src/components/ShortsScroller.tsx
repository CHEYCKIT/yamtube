import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { t, useLocale } from '../i18n/LocaleContext'

interface ShortsScrollerProps {
  children: ReactNode
  label: string
  kind: 'home' | 'history'
}

/**
 * YouTube-style shelf controls: circular arrows float at the far edges of
 * the cards, not beside the heading. Each arrow is available only while
 * there is content beyond that edge. Both shelves share identical behavior.
 */
export function ShortsScroller({ children, label, kind }: ShortsScrollerProps) {
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
    setEdges((current) => current.previous === next.previous && current.next === next.next
      ? current : next)
  }, [])

  useLayoutEffect(() => {
    const element = viewport.current
    if (!element) return
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    // The scroll viewport can stay the same width when new Shorts are added.
    // Observe the card widths as well so arrows react to content changes.
    for (const child of element.children) observer.observe(child)
    measure()
    return () => observer.disconnect()
  }, [children, measure])

  const scroll = (direction: -1 | 1) => {
    const element = viewport.current
    if (!element) return
    const first = element.firstElementChild as HTMLElement | null
    const itemWidth = (first?.getBoundingClientRect().width || 160)
      + (parseFloat(getComputedStyle(element).columnGap) || 12)
    const itemsPerPage = Math.max(1, Math.floor((element.clientWidth - 32) / itemWidth))
    element.scrollBy({
      left: direction * itemsPerPage * itemWidth,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'
    })
  }

  const arrowClass = 'absolute top-1/2 z-10 grid h-11 w-11 -translate-y-1/2 cursor-pointer place-items-center rounded-full border border-white/10 bg-neutral-900/95 text-white shadow-lg backdrop-blur-sm transition-colors hover:bg-neutral-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white'

  return <div className="relative min-w-0" data-shorts-carousel={kind}>
    <div ref={viewport} data-home-shorts-strip={kind === 'home' ? '' : undefined}
      data-history-shorts-strip={kind === 'history' ? '' : undefined}
      tabIndex={0} aria-label={label} onScroll={measure}
      className="wt-shorts-scroll flex snap-x snap-mandatory gap-3 overflow-x-auto overscroll-x-contain pb-2">
      {children}
    </div>
    {edges.previous && <button type="button" aria-label={t('Previous Shorts')}
      onClick={() => scroll(-1)} className={arrowClass + ' left-0'}>
      <ChevronLeft aria-hidden="true" className="h-6 w-6" />
    </button>}
    {edges.next && <button type="button" aria-label={t('Next Shorts')}
      onClick={() => scroll(1)} className={arrowClass + ' right-0'}>
      <ChevronRight aria-hidden="true" className="h-6 w-6" />
    </button>}
  </div>
}
