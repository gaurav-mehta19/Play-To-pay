'use client'

import { useState } from 'react'
import { BalanceCard } from '@/components/BalanceCard'
import { PayoutForm } from '@/components/PayoutForm'
import { PayoutTable } from '@/components/PayoutTable'
import { useBalance } from '@/hooks/useBalance'
import { usePayouts } from '@/hooks/usePayouts'
import { useMerchantContext } from '../MerchantContext'

export default function PayoutsPage() {
  const { selectedMerchantId } = useMerchantContext()
  const { balance, isLoading: balanceLoading, refresh: refreshBalance } = useBalance(selectedMerchantId)
  const {
    payouts,
    isLoading,
    error,
    setError,
    createPayout,
    page,
    totalPages,
    totalCount,
    goToPage,
  } = usePayouts(selectedMerchantId, refreshBalance)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (amountPaise: number, bankAccountId: string) => {
    setIsSubmitting(true)
    try {
      await createPayout(amountPaise, bankAccountId)
    } catch (e: unknown) {
      if (e instanceof Error) setError(e.message)
    } finally {
      refreshBalance()
      setIsSubmitting(false)
    }
  }

  if (!selectedMerchantId) {
    return (
      <div className="text-center text-gray-400 py-16">
        Select a merchant to manage payouts
      </div>
    )
  }

  return (
    <div className="space-y-6 h-full">
      <h1 className="text-2xl font-bold text-gray-900">Payouts</h1>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        {/* Left — wallet + new payout */}
        <div className="space-y-6">
          <BalanceCard balance={balance} isLoading={balanceLoading} />
          <PayoutForm
            onSubmit={handleSubmit}
            isSubmitting={isSubmitting}
            error={error}
            onInputChange={() => setError(null)}
          />
        </div>

        {/* Right — payout history */}
        <PayoutTable
          payouts={payouts}
          isLoading={isLoading}
          page={page}
          totalPages={totalPages}
          totalCount={totalCount}
          onPageChange={goToPage}
        />
      </div>
    </div>
  )
}
