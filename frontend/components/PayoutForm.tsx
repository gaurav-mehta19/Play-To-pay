'use client'

import { useState } from 'react'
import { inrToPaise } from '@/lib/utils'
import { Loader } from './Loader'

const BANK_ACCOUNTS = [
  { id: 'bank_hdfc_001', label: 'HDFC Bank — ****1234' },
  { id: 'bank_icici_002', label: 'ICICI Bank — ****5678' },
  { id: 'bank_axis_003', label: 'Axis Bank — ****9012' },
]

interface Props {
  onSubmit: (amountPaise: number, bankAccountId: string) => Promise<void>
  isSubmitting: boolean
  error: string | null
  onInputChange: () => void
}

export function PayoutForm({ onSubmit, isSubmitting, error, onInputChange }: Props) {
  const [amountInr, setAmountInr] = useState('')
  const [bankAccountId, setBankAccountId] = useState(BANK_ACCOUNTS[0].id)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const parsed = parseFloat(amountInr)
    if (isNaN(parsed) || parsed <= 0) return
    await onSubmit(inrToPaise(amountInr), bankAccountId)
    setAmountInr('')
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">New Payout</h2>

      <div className="space-y-4">
        <div>
          <label htmlFor="amount" className="block text-sm font-medium text-gray-700 mb-1">
            Amount (INR)
          </label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 font-medium">
              ₹
            </span>
            <input
              id="amount"
              type="number"
              min="0.01"
              step="0.01"
              value={amountInr}
              onChange={(e) => {
                setAmountInr(e.target.value)
                onInputChange()
              }}
              placeholder="0.00"
              required
              className="block w-full pl-8 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
        </div>

        <div>
          <label htmlFor="bank" className="block text-sm font-medium text-gray-700 mb-1">
            Bank Account
          </label>
          <select
            id="bank"
            value={bankAccountId}
            onChange={(e) => setBankAccountId(e.target.value)}
            className="block w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            {BANK_ACCOUNTS.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <p className="mt-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={isSubmitting || !amountInr}
        className="mt-4 w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {isSubmitting && <Loader className="text-white" />}
        {isSubmitting ? 'Initiating...' : 'Initiate Payout'}
      </button>
    </form>
  )
}
