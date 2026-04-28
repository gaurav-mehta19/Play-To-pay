import type { Merchant } from '@/lib/api'

interface Props {
  merchants: Merchant[]
  selected: string
  onChange: (id: string) => void
  isLoading?: boolean
}

export function MerchantSelector({ merchants, selected, onChange, isLoading }: Props) {
  if (isLoading) {
    return (
      <div className="w-48 h-9 rounded-lg border border-gray-200 bg-gray-100 animate-pulse" />
    )
  }

  return (
    <select
      value={selected}
      onChange={(e) => onChange(e.target.value)}
      className="block w-48 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
      aria-label="Select merchant"
    >
      {merchants.map((m) => (
        <option key={m.id} value={m.id}>
          {m.name}
        </option>
      ))}
    </select>
  )
}
