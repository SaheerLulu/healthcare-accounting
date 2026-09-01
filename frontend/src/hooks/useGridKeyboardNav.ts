import { useCallback } from 'react'

/**
 * Cell-to-cell movement across an EDITABLE grid — voucher lines, allocation
 * rows, payroll rows. The counterpart to useListKeyboardNav, which is for
 * read-only rows you open; this is for rows you type into.
 *
 * Ported from the pharmacy app's useTableKeyboardNav so the muscle memory
 * carries across the two apps a counter clerk uses side by side.
 *
 *   Tab / Shift+Tab   next / previous cell, wrapping across row boundaries
 *   Enter             same column, next row (the spreadsheet convention —
 *                     you enter a column of amounts without reaching for Tab)
 *   Ctrl+Enter        let the caller submit; this hook ignores it
 *
 * Past the last cell of the last row, Tab calls `onAppendRow` instead of
 * escaping the grid, so a clerk keys line after line without pausing to click
 * "Add row". Enter on the last row does the same via `onEnterAppendRow`. Leave
 * both undefined and the grid simply ends — Tab then falls through to the next
 * control, which is the right behaviour for a fixed-size grid.
 *
 * Cells are addressed by a DOM id the caller builds, rather than by refs,
 * because rows are re-keyed on every insert and delete — an id survives that,
 * a ref array does not.
 */
export interface UseGridKeyboardNavOptions {
  /** Rows currently rendered. */
  rowCount: number
  /** Column ids in tab order; length = logical column count. */
  columnIds: string[]
  /** Builds the focusable element id for a cell. */
  buildCellId: (rowIdx: number, colId: string) => string
  /** Tab on the very last cell. Omit to let focus leave the grid. */
  onAppendRow?: () => void
  /** Enter on the last row. Omit to stop at the last row. */
  onEnterAppendRow?: () => void
}

export function useGridKeyboardNav({
  rowCount,
  columnIds,
  buildCellId,
  onAppendRow,
  onEnterAppendRow,
}: UseGridKeyboardNavOptions) {
  const focusCell = useCallback(
    (rowIdx: number, colId: string) => {
      const el = document.getElementById(buildCellId(rowIdx, colId)) as
        | HTMLInputElement
        | null
      if (!el) return
      el.focus()
      // Select the contents so the next keystroke REPLACES the value. Keying
      // over a pre-filled amount is the whole point of a grid; landing with a
      // caret at position 0 would make the clerk clear it by hand every time.
      if (typeof el.select === 'function') {
        // Deferred: some inputs re-render on focus and would drop the selection.
        setTimeout(() => el.select?.(), 0)
      }
    },
    [buildCellId],
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent, rowIdx: number, colId: string) => {
      const colIdx = columnIds.indexOf(colId)
      if (colIdx < 0) return

      // Ctrl/Cmd+Enter is the caller's "save" — never a cell move.
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) return

      if (e.key === 'Tab' && !e.shiftKey) {
        const lastCol = colIdx === columnIds.length - 1
        const lastRow = rowIdx === rowCount - 1
        if (lastCol && lastRow) {
          if (!onAppendRow) return // let Tab leave the grid
          e.preventDefault()
          onAppendRow()
          // The append is a setState; the new row exists only next tick.
          setTimeout(() => focusCell(rowIdx + 1, columnIds[0]), 0)
          return
        }
        e.preventDefault()
        if (lastCol) focusCell(rowIdx + 1, columnIds[0])
        else focusCell(rowIdx, columnIds[colIdx + 1])
        return
      }

      if (e.key === 'Tab' && e.shiftKey) {
        // Shift+Tab out of the first cell leaves the grid backwards, which is
        // how the user reaches the header fields above it.
        if (colIdx === 0 && rowIdx === 0) return
        e.preventDefault()
        if (colIdx === 0) focusCell(rowIdx - 1, columnIds[columnIds.length - 1])
        else focusCell(rowIdx, columnIds[colIdx - 1])
        return
      }

      if (e.key === 'Enter') {
        e.preventDefault()
        if (rowIdx === rowCount - 1) {
          if (!onEnterAppendRow) return
          onEnterAppendRow()
          setTimeout(() => focusCell(rowIdx + 1, colId), 0)
        } else {
          focusCell(rowIdx + 1, colId)
        }
        return
      }

      // Vertical movement without leaving the column. Arrow keys inside a
      // <select> or a typeahead belong to that widget, so those cells should
      // not forward their keydown here.
      if (e.key === 'ArrowDown' && rowIdx < rowCount - 1) {
        e.preventDefault()
        focusCell(rowIdx + 1, colId)
        return
      }
      if (e.key === 'ArrowUp' && rowIdx > 0) {
        e.preventDefault()
        focusCell(rowIdx - 1, colId)
      }
    },
    [columnIds, rowCount, onAppendRow, onEnterAppendRow, focusCell],
  )

  return { handleKeyDown, focusCell }
}
