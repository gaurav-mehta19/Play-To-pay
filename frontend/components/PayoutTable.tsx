import type { Payout } from '@/lib/api'
import { formatDate, truncateId } from '@/lib/utils'
import { Loader } from './Loader'
import { StatusBadge } from './StatusBadge'

interface Props {
  payouts: Payout[]
  isLoading: boolean
  page: number
  totalPages: number
  totalCount: number
  onPageChange: (page: number) => void
}

function SkeletonRow() {
  return (
    <tr className="border-t border-gray-100">
      {[1, 2, 3, 4].map((i) => (
        <td key={i} className="px-4 py-3">
          <div className="h-4 bg-gray-200 rounded animate-pulse" />
        </td>
      ))}
    </tr>
  )
}

export function PayoutTable({ payouts, isLoading, page, totalPages, totalCount, onPageChange }: Props) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden flex flex-col h-full">
      <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">Payout History</h2>
        {totalCount > 0 && (
          <span className="text-sm text-gray-500">{totalCount} total</span>
        )}
      </div>

      <div className="overflow-x-auto flex-1">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-left">
              <th className="px-4 py-3 font-medium text-gray-500">ID</th>
              <th className="px-4 py-3 font-medium text-gray-500">Amount</th>
              <th className="px-4 py-3 font-medium text-gray-500">Status</th>
              <th className="px-4 py-3 font-medium text-gray-500">Created At</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && payouts.length === 0 ? (
              <>
                <SkeletonRow />
                <SkeletonRow />
                <SkeletonRow />
              </>
            ) : payouts.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-12 text-center text-gray-400">
                  No payouts yet
                </td>
              </tr>
            ) : (
              payouts.map((payout) => (
                <tr
                  key={payout.id}
                  className="border-t border-gray-100 hover:bg-gray-50 transition-colors"
                >
                  <td className="px-4 py-3 font-mono text-gray-600">
                    {truncateId(payout.id)}
                  </td>
                  <td className="px-4 py-3 font-medium text-gray-900">
                    ₹{payout.amount_inr}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <StatusBadge status={payout.status} />
                      {payout.status === 'processing' && (
                        <Loader className="text-blue-500" />
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {formatDate(payout.created_at)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="px-6 py-3 border-t border-gray-200 flex items-center justify-between">
          <span className="text-sm text-gray-500">
            Page {page} of {totalPages}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => onPageChange(page - 1)}
              disabled={page <= 1 || isLoading}
              className="px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              ← Prev
            </button>
            <button
              onClick={() => onPageChange(page + 1)}
              disabled={page >= totalPages || isLoading}
              className="px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
