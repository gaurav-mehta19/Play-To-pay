import { generateUUID } from './utils'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

export interface Merchant {
  id: string
  name: string
  created_at: string
}

export interface BalanceResponse {
  available_paise: number
  held_paise: number
  available_inr: string
  held_inr: string
}

export interface Payout {
  id: string
  amount_paise: number
  amount_inr: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  created_at: string
  updated_at: string
}

export interface LedgerEntry {
  id: string
  merchant_id: string
  amount_paise: number
  amount_inr: string
  entry_type: 'credit' | 'hold' | 'debit' | 'release'
  reference_id: string | null
  created_at: string
}

export interface LedgerPage {
  count: number
  next: string | null
  previous: string | null
  results: LedgerEntry[]
}

class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `HTTP ${res.status}`
    try {
      const body = await res.json()
      message = body.error || body.detail || message
    } catch {
      // non-JSON error body
    }
    throw new ApiError(message, res.status)
  }
  return res.json() as Promise<T>
}

export async function getMerchants(): Promise<Merchant[]> {
  const res = await fetch(`${API_BASE}/api/v1/merchants/`)
  return handleResponse<Merchant[]>(res)
}

export async function getBalance(merchantId: string): Promise<BalanceResponse> {
  const res = await fetch(`${API_BASE}/api/v1/merchants/${merchantId}/balance/`)
  return handleResponse<BalanceResponse>(res)
}

export interface PayoutsPage {
  count: number
  next: string | null
  previous: string | null
  results: Payout[]
}

export async function getPayouts(merchantId: string, page = 1): Promise<PayoutsPage> {
  const res = await fetch(`${API_BASE}/api/v1/merchants/${merchantId}/payouts/?page=${page}`)
  return handleResponse<PayoutsPage>(res)
}

export async function getLedger(merchantId: string, page: number): Promise<LedgerPage> {
  const res = await fetch(`${API_BASE}/api/v1/merchants/${merchantId}/ledger/?page=${page}`)
  return handleResponse<LedgerPage>(res)
}

export async function createPayout(
  merchantId: string,
  amountPaise: number,
  bankAccountId: string,
): Promise<Payout> {
  const idempotencyKey = generateUUID()
  const res = await fetch(`${API_BASE}/api/v1/payouts/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify({
      merchant_id: merchantId,
      amount_paise: amountPaise,
      bank_account_id: bankAccountId,
    }),
  })
  return handleResponse<Payout>(res)
}
