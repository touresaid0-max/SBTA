import { useState, useEffect, useCallback, useRef } from 'react'
import {
  fetchScheduleSeatMap,
  subscribeToSeatChanges,
  tryLockSeat,
  releaseSeatLock,
  getSiblingScheduleIds,
} from '../services/seatMap.service'
import type { ScheduleSeatMap, EnrichedSeat } from '../types/seatMap.types'

// Stable per-tab session id — correlates locks with this browser tab
const SESSION_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

interface UseSeatMapOptions {
  scheduleId: string | null
  enableRealtime?: boolean
  deckLevel?: 'simple' | 'lower' | 'upper'
}

interface UseSeatMapReturn {
  seatMap: ScheduleSeatMap | null
  isLoading: boolean
  error: string | null
  selectedSeats: EnrichedSeat[]
  toggleSeat: (seat: EnrichedSeat) => void
  clearSelection: () => void
  refresh: () => Promise<void>
  totalSelectedPrice: number
  lockCountdowns: Record<string, number>
}

export function useSeatMap({
  scheduleId,
  enableRealtime = true,
  deckLevel = 'simple',
}: UseSeatMapOptions): UseSeatMapReturn {
  const [seatMap, setSeatMap] = useState<ScheduleSeatMap | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedSeats, setSelectedSeats] = useState<EnrichedSeat[]>([])
  const [lockCountdowns, setLockCountdowns] = useState<Record<string, number>>({})

  // ── Refs (stable, never trigger re-renders) ────────────────────────────────
  const scheduleIdRef = useRef(scheduleId)
  const deckLevelRef = useRef(deckLevel)

  // Set of seat IDs currently selected by this user — source of truth for selection
  const selectedIdsRef = useRef<Set<string>>(new Set())

  // seat.id → ISO expiry string for locks WE own
  const lockExpiriesRef = useRef<Record<string, string>>({})

  // How many realtime-suppress credits we have (incremented before each write,
  // decremented when the realtime event arrives — no fixed timeout needed)
  const suppressCountRef = useRef(0)

  const unsubRef = useRef<(() => void) | null>(null)
  const countdownTimerRef = useRef<NodeJS.Timeout | null>(null)

  // Keep refs in sync every render
  scheduleIdRef.current = scheduleId
  deckLevelRef.current = deckLevel

  // ── fetchMap ───────────────────────────────────────────────────────────────
  // When `silent`, no loading spinner is shown.
  // CRITICAL: never removes a seat from selectedIds — that is only done by
  // explicit user action or confirmed lock expiry.
  const fetchMap = useCallback(async (silent: boolean) => {
    const sid = scheduleIdRef.current
    if (!sid) return
    if (!silent) setIsLoading(true)
    setError(null)
    try {
      const data = await fetchScheduleSeatMap(sid, deckLevelRef.current)

      // Merge our optimistic selection into the fetched layout so selected seats
      // always appear as locked_by_me regardless of what the DB says at this instant
      const mergedLayout = data.enriched_layout.map(row => ({
        ...row,
        seats: row.seats.map(seat => {
          if (selectedIdsRef.current.has(seat.id)) {
            // Force the seat to locked_by_me — we own it regardless of DB timing
            return { ...seat, status: 'locked_by_me' as const }
          }
          return seat
        }),
      }))

      // Recompute counts after merge
      const allSeats = mergedLayout.flatMap(r => r.seats)
      const available_count = allSeats.filter(s => s.status === 'available').length
      const occupied_count = allSeats.filter(s =>
        ['occupied', 'boarding', 'my_reservation'].includes(s.status)
      ).length

      setSeatMap({
        ...data,
        enriched_layout: mergedLayout,
        available_count,
        occupied_count,
      })

      // Sync lock expiries ONLY for seats we own AND DB confirms locked_by_me
      // Never delete an expiry for a seat that is in selectedIds
      for (const row of data.enriched_layout) {
        for (const seat of row.seats) {
          if (selectedIdsRef.current.has(seat.id)) {
            // Keep or refresh expiry from DB
            if (seat.lock_expires_at) {
              lockExpiriesRef.current[seat.id] = seat.lock_expires_at
            }
            // If no expiry from DB yet (lock write still in flight), keep existing expiry
          } else {
            // Not our seat — clean up any stale expiry
            delete lockExpiriesRef.current[seat.id]
          }
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erreur inconnue'
      if (msg === '__NO_BUS__') {
        setSeatMap(null)
        setError(null)
      } else {
        setError(msg)
      }
    } finally {
      if (!silent) setIsLoading(false)
    }
  }, []) // stable — uses only refs

  const refresh = useCallback(() => fetchMap(false), [fetchMap])

  // ── Initial load + realtime ────────────────────────────────────────────────
  useEffect(() => {
    if (!scheduleId) {
      setSeatMap(null)
      setSelectedSeats([])
      selectedIdsRef.current = new Set()
      lockExpiriesRef.current = {}
      return
    }

    fetchMap(false)

    if (enableRealtime) {
      unsubRef.current?.()
      // Subscribe to all sibling schedules for realtime seat updates
      getSiblingScheduleIds(scheduleId).then(siblingIds => {
        if (scheduleIdRef.current !== scheduleId) return
        unsubRef.current = subscribeToSeatChanges(scheduleId, () => {
          if (suppressCountRef.current > 0) {
            suppressCountRef.current--
            return
          }
          fetchMap(true)
        }, siblingIds)
      })
    }

    return () => {
      unsubRef.current?.()
      unsubRef.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scheduleId, enableRealtime, deckLevel]) // fetchMap is stable, listed for clarity

  // ── Release all our locks on unmount ───────────────────────────────────────
  useEffect(() => {
    return () => {
      const sid = scheduleIdRef.current
      if (!sid) return
      for (const seatId of Object.keys(lockExpiriesRef.current)) {
        releaseSeatLock(sid, seatId).catch(() => {})
      }
      lockExpiriesRef.current = {}
      selectedIdsRef.current = new Set()
    }
  }, []) // only on unmount

  // ── Countdown ticker ───────────────────────────────────────────────────────
  useEffect(() => {
    if (countdownTimerRef.current) clearInterval(countdownTimerRef.current)

    countdownTimerRef.current = setInterval(() => {
      const expiries = lockExpiriesRef.current
      if (Object.keys(expiries).length === 0) return

      const now = Date.now()
      const next: Record<string, number> = {}
      const expired: string[] = []

      for (const [seatId, expStr] of Object.entries(expiries)) {
        const remaining = Math.max(0, Math.round((new Date(expStr).getTime() - now) / 1000))
        next[seatId] = remaining
        if (remaining === 0) expired.push(seatId)
      }

      setLockCountdowns(next)

      if (expired.length > 0) {
        // Remove confirmed-expired locks
        for (const id of expired) {
          delete lockExpiriesRef.current[id]
          selectedIdsRef.current.delete(id)
        }
        setSelectedSeats(prev => {
          const kept = prev.filter(s => !expired.includes(s.id))
          return kept
        })
        // Refresh to reflect expired locks on the map
        fetchMap(true)
      }
    }, 1000)

    return () => {
      if (countdownTimerRef.current) clearInterval(countdownTimerRef.current)
    }
  }, [fetchMap])

  // ── toggleSeat ─────────────────────────────────────────────────────────────
  const toggleSeat = useCallback(async (seat: EnrichedSeat) => {
    const sid = scheduleIdRef.current
    if (!sid) return

    const isAlreadySelected = selectedIdsRef.current.has(seat.id)

    // Only allow selecting available seats (or re-toggling our own locked seats)
    if (!isAlreadySelected && seat.status !== 'available' && seat.status !== 'locked_by_me') return

    if (isAlreadySelected) {
      // ── Deselect ──────────────────────────────────────────────────────────
      selectedIdsRef.current.delete(seat.id)
      delete lockExpiriesRef.current[seat.id]

      setSelectedSeats(prev => prev.filter(s => s.id !== seat.id))

      // Optimistically mark available
      setSeatMap(prev => {
        if (!prev) return prev
        return {
          ...prev,
          available_count: prev.available_count + 1,
          enriched_layout: prev.enriched_layout.map(row => ({
            ...row,
            seats: row.seats.map(s =>
              s.id === seat.id ? { ...s, status: 'available' as const } : s
            ),
          })),
        }
      })

      // Suppress the realtime event caused by our own DELETE from seat_locks
      suppressCountRef.current++
      releaseSeatLock(sid, seat.id).catch(() => {})

    } else {
      // ── Select ────────────────────────────────────────────────────────────

      // Register selection BEFORE the async lock call — this protects the seat
      // from being removed by any fetchMap call that might race in
      selectedIdsRef.current.add(seat.id)

      setSelectedSeats(prev => [...prev, seat])

      // Optimistically mark as locked_by_me on the map
      setSeatMap(prev => {
        if (!prev) return prev
        return {
          ...prev,
          available_count: Math.max(0, prev.available_count - 1),
          enriched_layout: prev.enriched_layout.map(row => ({
            ...row,
            seats: row.seats.map(s =>
              s.id === seat.id ? { ...s, status: 'locked_by_me' as const } : s
            ),
          })),
        }
      })

      // Suppress the realtime event from our own INSERT into seat_locks
      suppressCountRef.current++
      const lock = await tryLockSeat(sid, seat.id, SESSION_ID)

      if (!lock) {
        // Race: someone else grabbed it — revert
        selectedIdsRef.current.delete(seat.id)
        setSelectedSeats(prev => prev.filter(s => s.id !== seat.id))
        setSeatMap(prev => {
          if (!prev) return prev
          return {
            ...prev,
            available_count: prev.available_count + 1,
            enriched_layout: prev.enriched_layout.map(row => ({
              ...row,
              seats: row.seats.map(s =>
                s.id === seat.id ? { ...s, status: 'locked' as const } : s
              ),
            })),
          }
        })
        // Full refresh to show accurate competitor state
        fetchMap(true)
        return
      }

      // Lock confirmed — store expiry
      lockExpiriesRef.current[seat.id] = lock.expires_at
    }
  }, [fetchMap]) // fetchMap is stable; no other deps needed

  // ── clearSelection ─────────────────────────────────────────────────────────
  const clearSelection = useCallback(async () => {
    const sid = scheduleIdRef.current
    const toRelease = [...selectedIdsRef.current]

    selectedIdsRef.current = new Set()
    lockExpiriesRef.current = {}
    setSelectedSeats([])

    if (!sid || toRelease.length === 0) return

    // Optimistically restore all released seats to available
    setSeatMap(prev => {
      if (!prev) return prev
      const releasedSet = new Set(toRelease)
      return {
        ...prev,
        available_count: prev.available_count + toRelease.length,
        enriched_layout: prev.enriched_layout.map(row => ({
          ...row,
          seats: row.seats.map(s =>
            releasedSet.has(s.id) ? { ...s, status: 'available' as const } : s
          ),
        })),
      }
    })

    // Suppress one realtime event per lock we release
    suppressCountRef.current += toRelease.length
    await Promise.all(toRelease.map(id => releaseSeatLock(sid, id).catch(() => {})))
  }, []) // stable — uses only refs

  const totalSelectedPrice = selectedSeats.reduce((sum, s) => sum + s.price, 0)

  return {
    seatMap,
    isLoading,
    error,
    selectedSeats,
    toggleSeat,
    clearSelection,
    refresh,
    totalSelectedPrice,
    lockCountdowns,
  }
}
