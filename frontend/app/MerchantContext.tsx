'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import { type Merchant, getMerchants } from '@/lib/api'

interface MerchantContextValue {
  merchants: Merchant[]
  selectedMerchantId: string
  setSelectedMerchantId: (id: string) => void
  isLoading: boolean
}

const MerchantContext = createContext<MerchantContextValue>({
  merchants: [],
  selectedMerchantId: '',
  setSelectedMerchantId: () => {},
  isLoading: true,
})

export function MerchantProvider({ children }: { children: React.ReactNode }) {
  const [merchants, setMerchants] = useState<Merchant[]>([])
  const [selectedMerchantId, setSelectedMerchantId] = useState('')
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    getMerchants()
      .then((list) => {
        setMerchants(list)
        if (list.length > 0) setSelectedMerchantId(list[0].id)
      })
      .catch(() => {})
      .finally(() => setIsLoading(false))
  }, [])

  return (
    <MerchantContext.Provider value={{ merchants, selectedMerchantId, setSelectedMerchantId, isLoading }}>
      {children}
    </MerchantContext.Provider>
  )
}

export function useMerchantContext() {
  return useContext(MerchantContext)
}
