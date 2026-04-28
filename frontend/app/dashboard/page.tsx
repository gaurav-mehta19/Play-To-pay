'use client'

import { BalanceCard } from '@/components/BalanceCard'
import { useBalance } from '@/hooks/useBalance'
import { useMerchantContext } from '../MerchantContext'

export default function DashboardPage() {
  const { selectedMerchantId, isLoading: merchantsLoading } = useMerchantContext()
  const { balance, isLoading: balanceLoading } = useBalance(selectedMerchantId)

  const isLoading = merchantsLoading || balanceLoading

  return (
    <div className="space-y-6">
      <div className="h-8 flex items-center">
        {merchantsLoading ? (
          <div className="w-32 h-7 bg-gray-200 rounded-lg animate-pulse" />
        ) : (
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        )}
      </div>
      <BalanceCard balance={balance} isLoading={isLoading} />
    </div>
  )
}
