import { useEffect, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Printer, X } from 'lucide-react'
import { getSettings, type AccountingSettings, type JournalEntry } from '../lib/api'
import { formatCurrency, formatDate } from '../lib/utils'
import { Button } from './ui/button'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  entry: JournalEntry
}

const voucherLabel = (v: string) =>
  v.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())

export function PrintVoucherView({ open, onOpenChange, entry }: Props) {
  const [settings, setSettings] = useState<AccountingSettings | null>(null)

  useEffect(() => {
    if (!open) return
    getSettings().then(setSettings).catch(() => { /* ignore */ })
  }, [open])

  const totals = entry.lines.reduce(
    (acc, l) => ({ dr: acc.dr + parseFloat(l.debit), cr: acc.cr + parseFloat(l.credit) }),
    { dr: 0, cr: 0 }
  )

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          className="fixed inset-0 z-50 print-hide animate-fadeIn"
          style={{ background: 'rgba(12,30,37,0.55)' }}
        />
        <Dialog.Content
          className="print-area fixed left-1/2 top-[5vh] z-50 w-[92vw] max-w-3xl -translate-x-1/2 rounded-xl overflow-hidden animate-slideUp"
          style={{
            background: '#fff',
            border: '1px solid var(--line)',
            boxShadow: '0 16px 48px rgba(0,0,0,0.20)',
            maxHeight: '90vh',
            overflowY: 'auto',
          }}
        >
          <Dialog.Title className="sr-only">Print {entry.entry_no}</Dialog.Title>

          {/* Toolbar — hidden on print */}
          <div
            className="print-hide flex items-center justify-between px-5 py-3 border-b sticky top-0 z-10"
            style={{ background: 'var(--surface-1)', borderColor: 'var(--line)' }}
          >
            <span className="text-xs mono uppercase tracking-wider" style={{ color: 'var(--ink-3)' }}>
              Print preview
            </span>
            <div className="flex items-center gap-2">
              <Button onClick={() => window.print()}>
                <Printer size={14} /> Print
              </Button>
              <Dialog.Close asChild>
                <Button variant="secondary"><X size={14} /> Close</Button>
              </Dialog.Close>
            </div>
          </div>

          {/* Printable voucher */}
          <div className="p-8" style={{ color: '#0c1e25', fontFamily: 'Inter, system-ui, sans-serif' }}>
            <header className="text-center pb-4 border-b-2" style={{ borderColor: '#0c1e25' }}>
              <h2 className="text-lg font-bold tracking-wide">
                {settings?.company_name || 'Seefmed Accounting'}
              </h2>
              {settings?.gstin && (
                <p className="text-xs mt-0.5">GSTIN: <span className="mono">{settings.gstin}</span></p>
              )}
              {settings?.registered_address && (
                <p className="text-xs mt-0.5">{settings.registered_address}</p>
              )}
            </header>

            <div className="mt-5 mb-3 text-center">
              <div
                className="inline-block px-4 py-1 mono font-bold uppercase text-sm tracking-wider"
                style={{ border: '1.5px solid #0c1e25' }}
              >
                {voucherLabel(entry.voucher_type)} Voucher
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-5 text-sm">
              <div>
                <span className="font-semibold">Voucher No: </span>
                <span className="mono">{entry.entry_no}</span>
              </div>
              <div className="text-right">
                <span className="font-semibold">Date: </span>
                {formatDate(entry.date)}
              </div>
            </div>

            <table className="w-full text-sm border" style={{ borderColor: '#0c1e25', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#f1f5f5' }}>
                  <th className="text-left px-3 py-2 border" style={{ borderColor: '#0c1e25', width: 60 }}>Type</th>
                  <th className="text-left px-3 py-2 border" style={{ borderColor: '#0c1e25' }}>Particulars</th>
                  <th className="text-right px-3 py-2 border" style={{ borderColor: '#0c1e25', width: 120 }}>Debit</th>
                  <th className="text-right px-3 py-2 border" style={{ borderColor: '#0c1e25', width: 120 }}>Credit</th>
                </tr>
              </thead>
              <tbody>
                {entry.lines.map((l, i) => {
                  const isDr = parseFloat(l.debit) > 0
                  return (
                    <tr key={i}>
                      <td className="px-3 py-2 mono font-bold border" style={{ borderColor: '#0c1e25' }}>
                        {isDr ? 'Dr' : 'Cr'}
                      </td>
                      <td className="px-3 py-2 border" style={{ borderColor: '#0c1e25' }}>
                        <div className="font-medium">{l.account_name || `Account ${l.account}`}</div>
                        {l.account_code && (
                          <div className="text-xs mono" style={{ color: '#5b6b73' }}>{l.account_code}</div>
                        )}
                        {l.narration && <div className="text-xs mt-0.5">{l.narration}</div>}
                      </td>
                      <td className="px-3 py-2 text-right font-mono border" style={{ borderColor: '#0c1e25' }}>
                        {parseFloat(l.debit) > 0 ? formatCurrency(l.debit) : ''}
                      </td>
                      <td className="px-3 py-2 text-right font-mono border" style={{ borderColor: '#0c1e25' }}>
                        {parseFloat(l.credit) > 0 ? formatCurrency(l.credit) : ''}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr style={{ background: '#f1f5f5', fontWeight: 700 }}>
                  <td className="px-3 py-2 border" style={{ borderColor: '#0c1e25' }} />
                  <td className="px-3 py-2 text-right border" style={{ borderColor: '#0c1e25' }}>Total</td>
                  <td className="px-3 py-2 text-right font-mono border" style={{ borderColor: '#0c1e25' }}>
                    {formatCurrency(totals.dr)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono border" style={{ borderColor: '#0c1e25' }}>
                    {formatCurrency(totals.cr)}
                  </td>
                </tr>
              </tfoot>
            </table>

            {entry.narration && (
              <div className="mt-4">
                <span className="font-semibold text-sm">Narration: </span>
                <span className="text-sm">{entry.narration}</span>
              </div>
            )}

            <div className="grid grid-cols-2 gap-12 mt-16 mb-2 text-sm">
              <div className="text-center">
                <div style={{ borderTop: '1px solid #0c1e25', paddingTop: 4 }}>Receiver's Signature</div>
              </div>
              <div className="text-center">
                <div style={{ borderTop: '1px solid #0c1e25', paddingTop: 4 }}>Authorised Signatory</div>
              </div>
            </div>
          </div>

          <style>{`
            @media print {
              body * { visibility: hidden !important; }
              .print-area, .print-area * { visibility: visible !important; }
              .print-area { position: absolute !important; left: 0 !important; top: 0 !important; width: 100% !important; max-width: none !important; max-height: none !important; box-shadow: none !important; border: none !important; }
              .print-hide { display: none !important; }
            }
          `}</style>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
