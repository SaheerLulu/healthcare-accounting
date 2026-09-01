import PartyListPage from './PartyListPage'

/**
 * Customers register — a thin alias for the shared party list.
 *
 * The whole keyboard contract (F2 search, F3 into the rows, ↑↓/Enter roving
 * navigation, Alt+R refresh, Alt+C clear filters) lives in PartyListPage and
 * applies here unchanged. Do NOT add a second usePageKeyboard call in this
 * wrapper: registerHints REPLACES the page hint set, so the later of the two
 * registrations would blank the other's chords out of the bottom bar. There is
 * no Alt+N here on purpose — customers arrive from the inventory sync and have
 * no create route (App.tsx exposes only the list and the detail screen).
 */
export default function CustomersListPage() {
  return <PartyListPage partyType="Customer" />
}
