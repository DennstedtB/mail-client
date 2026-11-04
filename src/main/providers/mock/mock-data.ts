/**
 * Sample mailbox for M0. Times are minutes before "now" so the list always
 * looks current. All people and domains are fictional (example.* domains).
 */

import type { Address, Attachment, FolderRole } from '@shared/types/mail'

export interface MockFolder {
  id: string
  name: string
  role: FolderRole
}

export interface MockMessage {
  id: string
  folderId: string
  from: Address
  to: Address[]
  cc?: Address[]
  subject: string
  minutesAgo: number
  isRead: boolean
  isFlagged?: boolean
  attachments?: Attachment[]
  bodyText: string
}

export const ME: Address = { name: 'Bastian', email: 'bastian@example.com' }

export const MOCK_FOLDERS: MockFolder[] = [
  { id: 'inbox', name: 'Inbox', role: 'inbox' },
  { id: 'drafts', name: 'Drafts', role: 'drafts' },
  { id: 'sent', name: 'Sent', role: 'sent' },
  { id: 'archive', name: 'Archive', role: 'archive' },
  { id: 'junk', name: 'Junk', role: 'junk' },
  { id: 'trash', name: 'Trash', role: 'trash' },
]

const HOUR = 60
const DAY = 24 * HOUR

export const MOCK_MESSAGES: MockMessage[] = [
  {
    id: 'm-welcome',
    folderId: 'inbox',
    from: { name: 'MailClient', email: 'hello@mailclient.example' },
    to: [ME],
    subject: 'Welcome to your own mail client',
    minutesAgo: 4,
    isRead: false,
    bodyText: `Hi Bastian,

everything in this mailbox is sample data. It's shown until you add your own account.

What works now:
- adding an IMAP/SMTP account: MailClient checks both servers first and keeps the password in the macOS Keychain
- your account's real folders in the sidebar, with unread counts
- the three-pane layout, arrow keys in the message list, light and dark mode

What comes next:
- M2: read your real mail, with HTML messages rendered safely and remote images blocked
- M3: write, reply, forward and send

Use "Add account" in the sidebar to get started. While developing, the dialog can fill in the local test server for you.`,
  },
  {
    id: 'm-workshop',
    folderId: 'inbox',
    from: { name: 'Lena Hoffmann', email: 'lena.hoffmann@example.org' },
    to: [ME],
    subject: 'Notizen aus dem Workshop am Donnerstag',
    minutesAgo: 52,
    isRead: false,
    attachments: [
      {
        id: 'a-1',
        filename: 'Workshop-Notizen.pdf',
        mimeType: 'application/pdf',
        size: 482_133,
      },
    ],
    bodyText: `Hallo Bastian,

anbei die Notizen aus unserem Workshop. Die wichtigsten Punkte in Kürze:

1. Die Schnittstelle bleibt bei einem täglichen Lauf, Änderungen werden aber künftig als Delta übertragen.
2. Für die Testphase brauchen wir zwei zusätzliche Mandanten.
3. Der nächste Termin ist in zwei Wochen, gleiche Uhrzeit.

Schau gern drüber und ergänze, was ich vergessen habe.

Viele Grüße
Lena`,
  },
  {
    id: 'm-caldav',
    folderId: 'inbox',
    from: { name: 'Jonas Weber', email: 'jonas@example.net' },
    to: [ME],
    subject: 'Re: Calendar sync, CalDAV or Graph first?',
    minutesAgo: 3 * HOUR + 10,
    isRead: true,
    isFlagged: true,
    bodyText: `Bastian,

I'd start with CalDAV. It's an open standard, you can test it locally, and once the provider interface is right, Graph is "just" another implementation.

The part I would budget real time for is recurring events. Exceptions to a series (one meeting moved, one cancelled) are where most clients get it wrong, and time zones make it worse. Keep the recurrence logic in one place and test it hard.

Jonas

> Which one would you build first?`,
  },
  {
    id: 'm-invite',
    folderId: 'inbox',
    from: { name: 'Team calendar', email: 'calendar@example.net' },
    to: [ME],
    subject: 'Invitation: Sprint review, Friday 10:00',
    minutesAgo: 20 * HOUR,
    isRead: false,
    bodyText: `You have been invited to an event.

Sprint review
Friday, 10:00 to 11:00
Room 2.14 and online

Accept, decline or propose a new time from your calendar.

(Answering invitations directly from the message comes after the calendar milestone.)`,
  },
  {
    id: 'm-invoice',
    folderId: 'inbox',
    from: { name: 'Miriam Schulz', email: 'buchhaltung@example.com' },
    to: [ME],
    subject: 'Rechnung 2026-114',
    minutesAgo: 2 * DAY + 5 * HOUR,
    isRead: true,
    attachments: [
      {
        id: 'a-2',
        filename: 'Rechnung-2026-114.pdf',
        mimeType: 'application/pdf',
        size: 96_420,
      },
    ],
    bodyText: `Guten Tag,

im Anhang finden Sie die Rechnung 2026-114 für den Oktober.

Bei Rückfragen melden Sie sich gern.

Freundliche Grüße
Miriam Schulz`,
  },
  {
    id: 'm-release',
    folderId: 'inbox',
    from: { name: 'Release notes digest', email: 'digest@example.org' },
    to: [ME],
    subject: 'This week: three releases you follow',
    minutesAgo: 4 * DAY,
    isRead: true,
    bodyText: `Here is what changed this week in the projects you follow.

- A major version of a UI framework with a new compiler
- A patch release of a mail library fixing IDLE reconnects
- A minor release of a calendar library with better time zone handling

Open each project page for the full notes.`,
  },
  {
    id: 'm-tickets',
    folderId: 'inbox',
    from: { name: 'Rail booking', email: 'tickets@example.com' },
    to: [ME],
    subject: 'Your tickets for Hamburg',
    minutesAgo: 18 * DAY,
    isRead: true,
    attachments: [
      { id: 'a-3', filename: 'Tickets.pdf', mimeType: 'application/pdf', size: 210_004 },
    ],
    bodyText: `Your booking is confirmed.

Outbound: Monday, 07:12
Return: Wednesday, 18:40

Your tickets are attached. Please have them ready on your phone or printed.`,
  },
  {
    id: 'm-sent-workshop',
    folderId: 'sent',
    from: ME,
    to: [{ name: 'Lena Hoffmann', email: 'lena.hoffmann@example.org' }],
    subject: 'Re: Notizen aus dem Workshop am Donnerstag',
    minutesAgo: 30,
    isRead: true,
    bodyText: `Danke Lena, das passt so. Ich ergänze bis Freitag noch die offenen Punkte zur Testphase.

Bastian`,
  },
  {
    id: 'm-draft',
    folderId: 'drafts',
    from: ME,
    to: [{ name: 'Jonas Weber', email: 'jonas@example.net' }],
    subject: 'Recurring events, test cases',
    minutesAgo: 2 * HOUR,
    isRead: true,
    bodyText: `Jonas,

good point. My first list of test cases:
- weekly series with one occurrence moved
- daily series across the daylight saving change
- `,
  },
  {
    id: 'm-archive',
    folderId: 'archive',
    from: { name: 'Lena Hoffmann', email: 'lena.hoffmann@example.org' },
    to: [ME],
    subject: 'Projektstart',
    minutesAgo: 40 * DAY,
    isRead: true,
    bodyText: `Hallo Bastian,

schön, dass es losgeht. Den Kick-off planen wir für die erste Woche.

Lena`,
  },
]
