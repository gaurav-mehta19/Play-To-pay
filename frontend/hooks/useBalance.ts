'use client'

import { useCallback, useEffect, useState } from 'react'
import { type BalanceResponse, getBalance } from '@/lib/api'

export function useBalance(merchantId: string) {
  const [balance, setBalance] = useState<BalanceResponse | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const refresh = useCallback(async () => {
    if (!merchantId) return
    try {
      const data = await getBalance(merchantId)
      setBalance(data)
    } catch {
      // Non-fatal — balance will just stay stale
    }
  }, [merchantId])

  useEffect(() => {
    setBalance(null)
    setIsLoading(true)
    refresh().finally(() => setIsLoading(false))
  }, [merchantId, refresh])

  return { balance, isLoading, refresh }
}
