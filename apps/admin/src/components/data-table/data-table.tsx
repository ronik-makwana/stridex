import * as React from 'react'
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type Row,
} from '@tanstack/react-table'
import { AlertCircle, ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

/**
 * Extra column metadata. `sortKey` is the API's name for the column — the
 * server decides what is sortable, so a column without one renders a plain
 * header rather than a control that would 400.
 */
declare module '@tanstack/react-table' {
  /**
   * The parameters are unused here and the constraint is redundant, and both
   * have to stay: a module augmentation only merges when its signature matches
   * the declaration upstream, which is `<TData extends RowData, TValue>`.
   * Tidying either one silently detaches this from the interface it extends.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-unnecessary-type-constraint
  interface ColumnMeta<TData extends unknown, TValue> {
    sortKey?: string
    headerClassName?: string
    cellClassName?: string
  }
}

export type SortState = { sort: string; onSortChange: (sort: string) => void }

type DataTableProps<TData> = {
  /**
   * `any` for the cell value, deliberately: one table's columns render
   * different types per column, and the alternative — `unknown` — makes every
   * `cell` callback cast before it can read the value it was handed.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  columns: ColumnDef<TData, any>[]
  data: TData[]
  isLoading?: boolean
  error?: Error | null
  /** Rendered in place of the table body when there is no data and no error. */
  empty?: React.ReactNode
  /** Server-side sorting. Omit for an unsorted table. */
  sorting?: SortState
  onRowClick?: (row: TData) => void
  getRowId?: (row: TData) => string
  /** Skeleton rows while the first page loads. */
  skeletonRows?: number
}

function parseSort(sort: string) {
  const [field, direction = 'asc'] = sort.split(':')
  return { field, direction: direction === 'desc' ? 'desc' : 'asc' } as const
}

export function DataTable<TData>({
  columns,
  data,
  isLoading = false,
  error = null,
  empty,
  sorting,
  onRowClick,
  getRowId,
  skeletonRows = 6,
}: DataTableProps<TData>) {
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    // Sorting, filtering and pagination are all the server's job: the client
    // holds one page and must not reorder it behind the API's back.
    manualSorting: true,
    manualFiltering: true,
    manualPagination: true,
    getRowId: getRowId ? (row) => getRowId(row) : undefined,
  })

  const active = sorting ? parseSort(sorting.sort) : null

  const handleSort = (sortKey: string) => {
    if (!sorting) return
    const next =
      active?.field === sortKey && active.direction === 'asc' ? `${sortKey}:desc` : `${sortKey}:asc`
    sorting.onSortChange(next)
  }

  // A click on the kebab menu inside a row must not also open the row.
  const rowClick = (row: Row<TData>) => (event: React.MouseEvent) => {
    if (!onRowClick) return
    const target = event.target as HTMLElement

    // React bubbles events through the *component* tree, not the DOM tree, so
    // a click on a portaled menu item still lands on this handler even though
    // the item is mounted on document.body. Anything outside the row's own DOM
    // is somebody else's click.
    if (!event.currentTarget.contains(target)) return
    if (target.closest('[data-row-action]')) return

    onRowClick(row.original)
  }

  return (
    <div className="bg-card overflow-hidden rounded-lg border">
      <Table>
        <TableHeader className="bg-muted/40">
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id} className="hover:bg-transparent">
              {headerGroup.headers.map((header) => {
                const sortKey = header.column.columnDef.meta?.sortKey
                const isActive = Boolean(sortKey && active?.field === sortKey)
                const label = flexRender(header.column.columnDef.header, header.getContext())

                return (
                  <TableHead
                    key={header.id}
                    className={header.column.columnDef.meta?.headerClassName}
                    aria-sort={
                      isActive ? (active!.direction === 'asc' ? 'ascending' : 'descending') : undefined
                    }
                  >
                    {sortKey && sorting ? (
                      <button
                        type="button"
                        onClick={() => handleSort(sortKey)}
                        className="hover:text-foreground -mx-1 inline-flex items-center gap-1 rounded px-1 py-0.5 uppercase transition-colors"
                      >
                        {label}
                        {isActive ? (
                          active!.direction === 'asc' ? (
                            <ArrowUp className="size-3" />
                          ) : (
                            <ArrowDown className="size-3" />
                          )
                        ) : (
                          <ChevronsUpDown className="size-3 opacity-40" />
                        )}
                      </button>
                    ) : (
                      label
                    )}
                  </TableHead>
                )
              })}
            </TableRow>
          ))}
        </TableHeader>

        <TableBody>
          {error ? (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={columns.length} className="p-4">
                <Alert variant="destructive">
                  <AlertCircle />
                  <AlertTitle>Could not load this list</AlertTitle>
                  <AlertDescription>{error.message}</AlertDescription>
                </Alert>
              </TableCell>
            </TableRow>
          ) : isLoading ? (
            Array.from({ length: skeletonRows }, (_, rowIndex) => (
              <TableRow key={rowIndex} className="hover:bg-transparent">
                {columns.map((_, cellIndex) => (
                  <TableCell key={cellIndex}>
                    <Skeleton className="h-4 w-full max-w-32" />
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : table.getRowModel().rows.length === 0 ? (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={columns.length} className="p-0">
                {empty}
              </TableCell>
            </TableRow>
          ) : (
            table.getRowModel().rows.map((row) => (
              <TableRow
                key={row.id}
                onClick={rowClick(row)}
                className={cn(onRowClick && 'cursor-pointer')}
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id} className={cell.column.columnDef.meta?.cellClassName}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  )
}
