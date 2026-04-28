import type { Merchant } from '@/lib/api'

interface Props {
  merchants: Merchant[]
  selected: string
  onChange: (id: string) => void
}

export function MerchantSelector({ merchants, selected, onChange }: Props) {
  return (
    <select
      value={selected}
      onChange={(e) => onChange(e.target.value)}
      className="block w-48 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
      aria-label="Select merchant"
    >
      {merchants.length === 0 && (
        <option value="" disabled>
          Loading merchants...
        </option>
      )}
      {merchants.map((m) => (
        <option key={m.id} value={m.id}>
          {m.name}
        </option>
      ))}
    </select>
  )
}
