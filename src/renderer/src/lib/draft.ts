import type { Draft, DraftField } from '@shared/types/compose'

const EDITABLE = ['to', 'cc', 'bcc', 'subject', 'body'] as const

/** True once the user changed anything compared to the prepared draft. */
export function isDraftChanged(initial: Draft, current: Draft): boolean {
  if (EDITABLE.some((field) => initial[field] !== current[field])) return true
  const ids = (d: Draft) => d.attachments.map((a) => a.id).join(',')
  return ids(initial) !== ids(current)
}

/** Which field the cursor starts in: the body for replies, the recipients otherwise. */
export function initialFocus(draft: Draft): DraftField | 'body' {
  return draft.kind === 'reply' || draft.kind === 'replyAll' ? 'body' : 'to'
}

/** Title of the compose pane. */
export function composeTitle(draft: Draft): string {
  if (draft.subject.trim()) return draft.subject.trim()
  return draft.kind === 'forward' ? 'Forward' : draft.kind === 'new' ? 'New message' : 'Reply'
}
