import type { Payout } from '@/lib/api'
import { formatDate, truncateId } from '@/lib/utils'
import { Loader } from './Loader'
import { StatusBadge } from './StatusBadge'

interface Props {
  payouts: Payout[]
  isLoading: boolean
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

export function PayoutTable({ payouts, isLoading }: Props) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-200">
        <h2 className="text-lg font-semibold text-gray-900">Payout History</h2>
      </div>

      <div className="overflow-x-auto">
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
                <td colSpan={4} className="px-4 py-8 text-center text-gray-400">
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
    </div>
  )
}
