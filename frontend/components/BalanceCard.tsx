import type { BalanceResponse } from '@/lib/api'

interface Props {
  balance: BalanceResponse | null
  isLoading: boolean
}

function SkeletonBlock({
  width = 'w-24',
  height = 'h-8',
  color = 'bg-gray-200',
}: {
  width?: string
  height?: string
  color?: string
}) {
  return <div className={`${height} ${width} ${color} rounded-lg animate-pulse`} />
}

export function BalanceCard({ balance, isLoading }: Props) {
  const showSkeleton = isLoading && !balance

  const availablePaise = balance?.available_paise ?? 0
  const heldPaise = balance?.held_paise ?? 0
  const totalPaise = availablePaise + heldPaise
  const totalInr = (totalPaise / 100).toFixed(2)

  const availablePct = totalPaise > 0 ? (availablePaise / totalPaise) * 100 : 0
  const heldPct = totalPaise > 0 ? (heldPaise / totalPaise) * 100 : 0

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">
            Wallet Balance
          </p>
          {showSkeleton ? (
            <SkeletonBlock width="w-36" height="h-9" color="bg-gray-200" />
          ) : (
            <p className="text-4xl font-bold text-gray-900">
              ₹{totalInr}
            </p>
          )}
          <p className="text-xs text-gray-400 mt-1">Total funds in wallet</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="bg-green-50 border border-green-100 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
            <p className="text-xs font-medium text-green-700">Available</p>
          </div>
          {showSkeleton ? (
            <SkeletonBlock width="w-24" height="h-7" color="bg-green-200" />
          ) : (
            <p className="text-2xl font-bold text-green-700">
              ₹{balance?.available_inr ?? '0.00'}
            </p>
          )}
          <p className="text-xs text-green-600 mt-1">Ready to pay out</p>
        </div>

        <div className="bg-amber-50 border border-amber-100 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="w-2 h-2 rounded-full bg-amber-500 inline-block" />
            <p className="text-xs font-medium text-amber-700">On Hold</p>
          </div>
          {showSkeleton ? (
            <SkeletonBlock width="w-20" height="h-7" color="bg-amber-200" />
          ) : (
            <p className="text-2xl font-bold text-amber-600">
              ₹{balance?.held_inr ?? '0.00'}
            </p>
          )}
          <p className="text-xs text-amber-600 mt-1">Payout in progress</p>
        </div>
      </div>

      {showSkeleton && (
        <div className="space-y-1.5">
          <div className="h-2 w-full bg-gray-200 rounded-full animate-pulse" />
          <div className="h-3 w-20 bg-gray-100 rounded animate-pulse" />
        </div>
      )}

      {balance && totalPaise > 0 && (
        <div>
          <div className="flex rounded-full overflow-hidden h-2 bg-gray-100">
            <div
              className="bg-green-500 transition-all duration-500"
              style={{ width: `${availablePct}%` }}
            />
            <div
              className="bg-amber-400 transition-all duration-500"
              style={{ width: `${heldPct}%` }}
            />
          </div>
          <div className="flex justify-between mt-1.5 text-xs text-gray-400">
            <span>{availablePct.toFixed(0)}% available</span>
            {heldPct > 0 && <span>{heldPct.toFixed(0)}% on hold</span>}
          </div>
        </div>
      )}
    </div>
  )
}
