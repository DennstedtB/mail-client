import type { Address } from '@shared/types/mail'
import { initials } from '../lib/format'

export function Avatar({ address }: { address: Address }) {
  return (
    <div
      aria-hidden
      className="grid size-10 shrink-0 place-items-center rounded-full bg-accent-soft text-[14px] font-semibold text-accent"
    >
      {initials(address)}
    </div>
  )
}
