'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { MerchantSelector } from '@/components/MerchantSelector'
import { useMerchantContext } from './MerchantContext'

export function NavBar() {
  const pathname = usePathname()
  const { merchants, selectedMerchantId, setSelectedMerchantId, isLoading } = useMerchantContext()

  const navLink = (href: string, label: string) => (
    <Link
      href={href}
      className={`text-sm font-medium px-3 py-1.5 rounded-lg transition-colors ${
        pathname.startsWith(href)
          ? 'bg-blue-50 text-blue-700'
          : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
      }`}
    >
      {label}
    </Link>
  )

  return (
    <nav className="bg-white border-b border-gray-200 sticky top-0 z-10">
      <div className="max-w-5xl mx-auto px-4 h-14 flex items-center gap-6">
        <span className="font-bold text-gray-900 text-base">PlayToPay</span>
        <div className="flex items-center gap-1">
          {navLink('/dashboard', 'Dashboard')}
          {navLink('/payouts', 'Payouts')}
        </div>
        <div className="ml-auto">
          <MerchantSelector
            merchants={merchants}
            selected={selectedMerchantId}
            onChange={setSelectedMerchantId}
            isLoading={isLoading}
          />
        </div>
      </div>
    </nav>
  )
}
