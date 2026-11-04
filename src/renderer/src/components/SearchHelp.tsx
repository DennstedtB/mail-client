import { useId, useRef, type ToggleEvent } from 'react'
import { createPortal } from 'react-dom'
import { CircleHelp } from 'lucide-react'
import { SEARCH_OPERATORS, SEARCH_SYNTAX } from '@shared/search-query'

/** Width of the panel in pixels (w-88), so it can be placed before it renders. */
const PANEL_WIDTH = 352

/**
 * The "?" in the search field and the panel it opens: how to combine terms
 * and every operator, straight from SEARCH_OPERATORS, so new operators show
 * up here by themselves. Choosing an operator or value adds it to the search.
 *
 * The panel is a native popover (top layer; closes on Escape or a click
 * outside), placed under the button.
 */
export function SearchHelp({ onAddTerm }: { onAddTerm: (term: string) => void }) {
  const id = useId()
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  function place(event: ToggleEvent<HTMLDivElement>) {
    const button = buttonRef.current
    if (event.newState !== 'open' || !button) return
    const rect = button.getBoundingClientRect()
    const left = Math.min(rect.right + 4, window.innerWidth - 8) - PANEL_WIDTH
    event.currentTarget.style.top = `${rect.bottom + 8}px`
    event.currentTarget.style.left = `${Math.max(8, left)}px`
  }

  function add(term: string) {
    panelRef.current?.hidePopover()
    onAddTerm(term)
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        popoverTarget={id}
        aria-label="Search options"
        title="Search options"
        className="grid size-5 shrink-0 place-items-center rounded text-ink-muted hover:bg-ink/8 hover:text-ink"
      >
        <CircleHelp className="size-3.5" strokeWidth={2} aria-hidden />
      </button>
      {/* Outside the search field's <label>, so clicks in the panel don't focus the field. */}
      {createPortal(
        <div
          ref={panelRef}
          id={id}
          popover="auto"
          role="dialog"
          aria-labelledby={`${id}-title`}
          onBeforeToggle={place}
          onToggle={(event) => {
            // Start at the top each time, not where the last visit left off.
            if (event.newState === 'open') event.currentTarget.scrollTop = 0
          }}
          className="inset-auto m-0 max-h-[min(36rem,calc(100vh-6rem))] w-88 overflow-y-auto rounded-lg border border-line bg-paper p-0 text-ink shadow-[0_12px_32px_rgba(0,0,0,0.18)]"
        >
          <div className="px-4 pt-3 pb-2">
            <h2 id={`${id}-title`} className="text-[13px] font-semibold">
              Search options
            </h2>
            <p className="mt-0.5 text-[11.5px] leading-snug text-ink-muted">
              Words match the start of words anywhere: “rech” finds “Rechnung”. Choose an operator
              to add it to the search.
            </p>
          </div>

          <h3 className="px-4 pt-2 pb-1 text-[11px] font-semibold text-ink-faint">Combine</h3>
          <dl className="px-4 pb-1">
            {SEARCH_SYNTAX.map((row) => (
              <div key={row.example} className="flex gap-3 py-1">
                <dt className="w-26 shrink-0 font-mono text-[11.5px] text-ink">{row.example}</dt>
                <dd className="text-[11.5px] leading-snug text-ink-muted">{row.description}</dd>
              </div>
            ))}
          </dl>

          <h3 className="px-4 pt-2 pb-1 text-[11px] font-semibold text-ink-faint">Operators</h3>
          <ul className="px-2 pb-2">
            {SEARCH_OPERATORS.map((op) => {
              const name = op.names[0]
              return (
                <li key={name}>
                  <button
                    type="button"
                    onClick={() => add(`${name}:`)}
                    className="flex w-full gap-3 rounded-md px-2 py-1 text-left hover:bg-ink/5 focus-visible:bg-ink/5 focus-visible:outline-none"
                  >
                    <code className="w-26 shrink-0 font-mono text-[11.5px] text-accent">
                      {name}:
                    </code>
                    <span className="text-[11.5px] leading-snug text-ink-muted">
                      {op.description}
                    </span>
                  </button>
                  {op.values && (
                    <div className="flex flex-wrap gap-1 pb-1 pl-31">
                      {op.values.map((value) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => add(`${name}:${value}`)}
                          aria-label={`${name}:${value}`}
                          className="rounded border border-line px-1.5 py-px font-mono text-[11px] text-ink-muted hover:bg-ink/5 hover:text-ink focus-visible:ring-1 focus-visible:ring-accent focus-visible:outline-none"
                        >
                          {value}
                        </button>
                      ))}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>

          <p className="border-t border-line px-4 py-2.5 text-[11px] leading-snug text-ink-faint">
            Message text is searched in messages MailClient has downloaded: the ones you opened, and
            the newest of each folder you open.
          </p>
        </div>,
        document.body,
      )}
    </>
  )
}
