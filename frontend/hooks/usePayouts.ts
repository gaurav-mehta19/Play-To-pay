'use client'

import { useCallback, useEffect, useState } from 'react'
import { type Payout, createPayout as apiCreatePayout, getPayouts } from '@/lib/api'
import { usePolling } from './usePolling'

const PAGE_SIZE = 10
const ACTIVE_STATUSES = new Set(['pending', 'processing'])

export function usePayouts(merchantId: string, onBalanceRefresh?: () => void) {
  const [payouts, setPayouts] = useState<Payout[]>([])
  const [page, setPage] = useState(1)
  const [totalCount, setTotalCount] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setPage(1)
    setPayouts([])
    setTotalCount(0)
  }, [merchantId])

  const fetchCurrentPage = useCallback(async () => {
    if (!merchantId) return
    try {
      const result = await getPayouts(merchantId, page)
      setPayouts(result.results)
      setTotalCount(result.count)
      onBalanceRefresh?.()
    } catch (e: unknown) {
      if (e instanceof Error) setError(e.message)
    }
  }, [merchantId, page, onBalanceRefresh])

  useEffect(() => {
    setIsLoading(true)
    fetchCurrentPage().finally(() => setIsLoading(false))
  }, [fetchCurrentPage])

  const hasActive = payouts.some((p) => ACTIVE_STATUSES.has(p.status))
  usePolling(fetchCurrentPage, 3_000, hasActive)

  const submitPayout = useCallback(
    async (amountPaise: number, bankAccountId: string) => {
      setError(null)
      const payout = await apiCreatePayout(merchantId, amountPaise, bankAccountId)
      if (page === 1) {
        setPayouts((prev) => [payout, ...prev].slice(0, PAGE_SIZE))
        setTotalCount((prev) => prev + 1)
      } else {
        setPage(1)
      }
    },
    [merchantId, page],
  )

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))

  return {
    payouts,
    isLoading,
    error,
    setError,
    createPayout: submitPayout,
    page,
    totalPages,
    totalCount,
    goToPage: setPage,
  }
}
