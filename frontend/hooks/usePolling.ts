'use client'

import { useEffect, useRef } from 'react'

export function usePolling(
  callback: () => void | Promise<void>,
  intervalMs: number,
  active: boolean,
) {
  const callbackRef = useRef(callback)
  callbackRef.current = callback

  useEffect(() => {
    if (!active) return

    let cancelled = false

    const tick = async () => {
      if (cancelled) return
      await callbackRef.current()
      if (!cancelled) {
        timeoutId = setTimeout(tick, intervalMs)
      }
    }

    let timeoutId = setTimeout(tick, intervalMs)

    return () => {
      cancelled = true
      clearTimeout(timeoutId)
    }
  }, [active, intervalMs])
}
