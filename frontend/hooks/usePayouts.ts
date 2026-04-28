'use client'

import { useCallback, useEffect, useState } from 'react'
import { type Payout, createPayout as apiCreatePayout, getPayouts } from '@/lib/api'
import { usePolling } from './usePolling'

const ACTIVE_STATUSES = new Set(['pending', 'processing'])

function mergePayouts(existing: Payout[], fresh: Payout[]): Payout[] {
  const map = new Map(existing.map((p) => [p.id, p]))
  for (const p of fresh) {
    map.set(p.id, p)
  }
  // Preserve order: most recently created first
  return Array.from(map.values()).sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  )
}

export function usePayouts(merchantId: string, onBalanceRefresh?: () => void) {
  const [payouts, setPayouts] = useState<Payout[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchPayouts = useCallback(async () => {
    if (!merchantId) return
    try {
      const fresh = await getPayouts(merchantId)
      setPayouts((prev) => mergePayouts(prev, fresh))
      onBalanceRefresh?.()
    } catch (e: unknown) {
      // Non-fatal during polling
      if (e instanceof Error) setError(e.message)
    }
  }, [merchantId, onBalanceRefresh])

  // Initial load
  useEffect(() => {
    setPayouts([])
    setIsLoading(true)
    fetchPayouts().finally(() => setIsLoading(false))
  }, [merchantId, fetchPayouts])

  const isPolling = payouts.some((p) => ACTIVE_STATUSES.has(p.status))

  usePolling(fetchPayouts, 3_000, isPolling)

  const submitPayout = useCallback(
    async (amountPaise: number, bankAccountId: string) => {
      setError(null)
      const payout = await apiCreatePayout(merchantId, amountPaise, bankAccountId)
      // Optimistically insert as pending so the row appears immediately
      setPayouts((prev) => mergePayouts(prev, [payout]))
      // Balance will refresh on the next poll cycle via onBalanceRefresh
    },
    [merchantId],
  )

  return { payouts, isLoading, error, setError, createPayout: submitPayout, isPolling }
}
