/**
 * Adds a term chosen in the search help to what's in the search field.
 *
 * A word still being typed that the term starts with is completed rather
 * than kept ("fro" + "from:" → "from:"), and a minus in front stays
 * ("invoice -" + "from:" → "invoice -from:"). An operator without a value
 * ("from:") gets no space after it, so the value can follow; a complete
 * term ("is:unread") does, so the next term can.
 */
export function appendSearchTerm(text: string, term: string): string {
  const last = /(^|\s)(-?)(\S*)$/.exec(text)
  const minus = last?.[2] ?? ''
  const word = last?.[3] ?? ''
  const unfinished =
    last !== null &&
    (minus !== '' || word !== '') &&
    term.toLowerCase().startsWith(word.toLowerCase())
  const before = unfinished ? text.slice(0, last.index + (last[1]?.length ?? 0)) : text
  const added = (unfinished ? minus : '') + term + (term.endsWith(':') ? '' : ' ')
  const head = before.trimEnd()
  return head ? `${head} ${added}` : added
}
