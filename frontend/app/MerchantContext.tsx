'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import { type Merchant, getMerchants } from '@/lib/api'

interface MerchantContextValue {
  merchants: Merchant[]
  selectedMerchantId: string
  setSelectedMerchantId: (id: string) => void
}

const MerchantContext = createContext<MerchantContextValue>({
  merchants: [],
  selectedMerchantId: '',
  setSelectedMerchantId: () => {},
})

export function MerchantProvider({ children }: { children: React.ReactNode }) {
  const [merchants, setMerchants] = useState<Merchant[]>([])
  const [selectedMerchantId, setSelectedMerchantId] = useState('')

  useEffect(() => {
    getMerchants()
      .then((list) => {
        setMerchants(list)
        if (list.length > 0) setSelectedMerchantId(list[0].id)
      })
      .catch(() => {})
  }, [])

  return (
    <MerchantContext.Provider value={{ merchants, selectedMerchantId, setSelectedMerchantId }}>
      {children}
    </MerchantContext.Provider>
  )
}

export function useMerchantContext() {
  return useContext(MerchantContext)
}
