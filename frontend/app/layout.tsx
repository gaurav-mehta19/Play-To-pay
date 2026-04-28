import type { Metadata } from 'next'
import './globals.css'
import { MerchantProvider } from './MerchantContext'
import { NavBar } from './NavBar'

export const metadata: Metadata = {
  title: 'PlayToPay — Payout Engine',
  description: 'Merchant payout management',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-50 font-sans antialiased">
        <MerchantProvider>
          <NavBar />
          <main className="max-w-5xl mx-auto px-4 py-8">{children}</main>
        </MerchantProvider>
      </body>
    </html>
  )
}
