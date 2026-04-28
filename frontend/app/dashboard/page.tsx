'use client'

import { BalanceCard } from '@/components/BalanceCard'
import { useBalance } from '@/hooks/useBalance'
import { useMerchantContext } from '../MerchantContext'

export default function DashboardPage() {
  const { selectedMerchantId } = useMerchantContext()
  const { balance, isLoading } = useBalance(selectedMerchantId)

  if (!selectedMerchantId) {
    return (
      <div className="text-center text-gray-400 py-16">
        Select a merchant to view balance
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
      <BalanceCard balance={balance} isLoading={isLoading} />
    </div>
  )
}
