import React, { useEffect, useRef, useState, useCallback } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { QrCode, CheckCircle2, AlertTriangle, ArrowLeft, RefreshCw, Loader2, CameraOff } from 'lucide-react'
import toast from 'react-hot-toast'
import { supabase } from '@/services/supabase'
import { useAuthStore } from '@/store/authStore'
import { sendCourierArrivedSms } from '@/services/emisSms.service'

type ScanState = 'idle' | 'scanning' | 'processing' | 'success' | 'error'

interface ScanResult {
  code: string
  message: string
  parcel_id: string | null
}

// BarcodeDetector is not yet in lib.dom.d.ts universally
declare class BarcodeDetector {
  constructor(options?: { formats: string[] })
  detect(source: ImageBitmapSource): Promise<Array<{ rawValue: string; format: string }>>
  static getSupportedFormats(): Promise<string[]>
}

export default function QrScanner() {
  const navigate   = useNavigate()
  const location   = useLocation()
  const basePath   = location.pathname.startsWith('/guichet/courrier') ? '/guichet/courrier' : '/agent-colis'
  const { user }   = useAuthStore()
  const stationId  = user?.station_id ?? null

  const videoRef    = useRef<HTMLVideoElement>(null)
  const streamRef   = useRef<MediaStream | null>(null)
  const detectorRef = useRef<BarcodeDetector | null>(null)
  const rafRef      = useRef<number | null>(null)
  const lastScan    = useRef<string>('') // debounce duplicate scans

  const [scanState,    setScanState]    = useState<ScanState>('idle')
  const [scanResult,   setScanResult]   = useState<ScanResult | null>(null)
  const [cameraError,  setCameraError]  = useState<string | null>(null)
  const [nativeSupport, setNativeSupport] = useState<boolean | null>(null)

  const stopCamera = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
  }, [])

  // Process a decoded QR value
  const handleQrValue = useCallback(async (rawValue: string) => {
    const value = rawValue.trim()
    if (!value || value === lastScan.current) return
    lastScan.current = value

    stopCamera()
    setScanState('processing')

    if (!stationId) {
      setScanResult({ code: 'error', message: 'Votre gare n\'est pas configurée.', parcel_id: null })
      setScanState('error')
      return
    }

    try {
      const { data, error } = await supabase.rpc('receive_parcel_by_qr', {
        p_parcel_code: value,
        p_station_id:  stationId,
      })

      if (error) throw error

      const result = data as { success: boolean; code: string; message: string; parcel_id: string | null; recipient_phone?: string }

      setScanResult({ code: result.code, message: result.message, parcel_id: result.parcel_id })

      if (result.success) {
        setScanState('success')
        toast.success('Courrier receptionne !')

        if (result.parcel_id) {
          try {
            const { data: p } = await supabase
              .from('parcels')
              .select('id, recipient_phone')
              .eq('id', result.parcel_id)
              .maybeSingle()
            if (p?.recipient_phone) {
              await sendCourierArrivedSms({ id: p.id, recipient_phone: p.recipient_phone })
            }
          } catch { /* SMS must not block */ }
        }
      } else {
        setScanState('error')
      }
    } catch {
      setScanResult({ code: 'error', message: 'Erreur réseau, veuillez réessayer.', parcel_id: null })
      setScanState('error')
    }
  }, [stationId, stopCamera])

  // Scan loop using BarcodeDetector
  const startScanLoop = useCallback((detector: BarcodeDetector) => {
    const loop = async () => {
      if (!videoRef.current || videoRef.current.readyState < 2) {
        rafRef.current = requestAnimationFrame(loop)
        return
      }
      try {
        const barcodes = await detector.detect(videoRef.current)
        if (barcodes.length > 0) {
          await handleQrValue(barcodes[0].rawValue)
          return // stop loop after detection
        }
      } catch {
        // detector may throw on bad frame — just continue
      }
      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)
  }, [handleQrValue])

  const startCamera = useCallback(async () => {
    setCameraError(null)
    setScanState('scanning')
    setScanResult(null)
    lastScan.current = ''

    // Check BarcodeDetector support
    if (typeof BarcodeDetector === 'undefined') {
      setNativeSupport(false)
      setCameraError('native_unsupported')
      setScanState('idle')
      return
    }

    setNativeSupport(true)

    try {
      const formats = await BarcodeDetector.getSupportedFormats()
      if (!formats.includes('qr_code')) {
        setNativeSupport(false)
        setCameraError('native_unsupported')
        setScanState('idle')
        return
      }

      detectorRef.current = new BarcodeDetector({ formats: ['qr_code'] })
    } catch {
      setNativeSupport(false)
      setCameraError('native_unsupported')
      setScanState('idle')
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
      startScanLoop(detectorRef.current!)
    } catch (err) {
      const msg = err instanceof DOMException && err.name === 'NotAllowedError'
        ? 'Accès à la caméra refusé. Veuillez autoriser l\'accès dans les paramètres du navigateur.'
        : 'Impossible d\'accéder à la caméra.'
      setCameraError(msg)
      setScanState('idle')
    }
  }, [startScanLoop])

  useEffect(() => {
    return () => stopCamera()
  }, [stopCamera])

  const reset = () => {
    setScanState('idle')
    setScanResult(null)
    setCameraError(null)
    lastScan.current = ''
    startCamera()
  }

  return (
    <div className="agent-colis-theme flex flex-col overflow-x-hidden" style={{ backgroundColor: 'var(--bg)', minHeight: '100%' }}>

      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-4 border-b" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
        <button
          onClick={() => { stopCamera(); navigate(`${basePath}/dashboard`) }}
          className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
        >
          <ArrowLeft className="w-5 h-5" style={{ color: 'var(--text-secondary)' }} />
        </button>
        <div className="flex items-center gap-2">
          <QrCode className="w-5 h-5" style={{ color: '#0B7439' }} />
          <h1 className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>Scanner QR Code</h1>
        </div>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center gap-6 p-4 pb-6 max-w-lg mx-auto w-full">

        {/* Idle state — start button */}
        {scanState === 'idle' && !cameraError && (
          <div className="w-full flex flex-col items-center gap-6">
            <div className="w-24 h-24 rounded-2xl flex items-center justify-center" style={{ backgroundColor: '#d4edda' }}>
              <QrCode className="w-12 h-12" style={{ color: '#0B7439' }} />
            </div>
            <div className="text-center">
              <p className="text-lg font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
                Réception par QR Code
              </p>
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                Scannez le QR code sur le ticket du courrier pour confirmer son arrivée à votre gare.
              </p>
            </div>
            <button
              onClick={startCamera}
              className="w-full py-3.5 rounded-xl text-white font-semibold text-sm flex items-center justify-center gap-2"
              style={{ backgroundColor: '#0B7439' }}
            >
              <QrCode className="w-4 h-4" />
              Démarrer le scanner
            </button>
          </div>
        )}

        {/* Camera not supported fallback */}
        {cameraError === 'native_unsupported' && (
          <div className="w-full rounded-xl p-5 text-center" style={{ backgroundColor: '#FEF3C7', border: '1px solid #FCD34D' }}>
            <CameraOff className="w-10 h-10 mx-auto mb-3" style={{ color: '#D97706' }} />
            <p className="font-bold mb-1" style={{ color: '#92400E' }}>Scanner non supporté</p>
            <p className="text-sm mb-4" style={{ color: '#92400E' }}>
              Votre navigateur ne supporte pas la lecture QR Code automatique.
              Utilisez Chrome ou Edge sur Android/PC pour cette fonctionnalité.
            </p>
            <button
              onClick={() => navigate(`${basePath}/dashboard`)}
              className="px-4 py-2 rounded-lg text-sm font-medium"
              style={{ backgroundColor: '#D97706', color: '#fff' }}
            >
              Retour au tableau de bord
            </button>
          </div>
        )}

        {/* Camera error */}
        {cameraError && cameraError !== 'native_unsupported' && (
          <div className="w-full rounded-xl p-5 text-center" style={{ backgroundColor: '#fee2e2', border: '1px solid #fca5a5' }}>
            <CameraOff className="w-10 h-10 mx-auto mb-3" style={{ color: '#DC2626' }} />
            <p className="font-bold mb-1" style={{ color: '#991B1B' }}>Caméra inaccessible</p>
            <p className="text-sm mb-4" style={{ color: '#991B1B' }}>{cameraError}</p>
            <button
              onClick={startCamera}
              className="px-4 py-2 rounded-lg text-sm font-medium"
              style={{ backgroundColor: '#DC2626', color: '#fff' }}
            >
              Réessayer
            </button>
          </div>
        )}

        {/* Scanning — live camera view */}
        {scanState === 'scanning' && (
          <div className="w-full flex flex-col items-center gap-4">
            <div className="relative w-full aspect-square rounded-2xl overflow-hidden bg-black max-w-sm" style={{ border: '2px solid #0B7439' }}>
              <video
                ref={videoRef}
                playsInline
                muted
                className="w-full h-full object-cover"
              />
              {/* Scan frame overlay */}
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="relative w-48 h-48">
                  {/* Corner brackets */}
                  {[
                    'top-0 left-0 border-t-4 border-l-4 rounded-tl-lg',
                    'top-0 right-0 border-t-4 border-r-4 rounded-tr-lg',
                    'bottom-0 left-0 border-b-4 border-l-4 rounded-bl-lg',
                    'bottom-0 right-0 border-b-4 border-r-4 rounded-br-lg',
                  ].map((cls, i) => (
                    <div
                      key={i}
                      className={`absolute w-8 h-8 ${cls}`}
                      style={{ borderColor: '#0B7439' }}
                    />
                  ))}
                  {/* Scan line animation */}
                  <div
                    className="absolute left-2 right-2 h-0.5 animate-bounce"
                    style={{ backgroundColor: '#0B7439', top: '50%' }}
                  />
                </div>
              </div>
            </div>
            <p className="text-sm text-center" style={{ color: 'var(--text-secondary)' }}>
              Pointez la caméra vers le QR Code du ticket
            </p>
            <button
              onClick={() => { stopCamera(); setScanState('idle') }}
              className="px-4 py-2 rounded-lg text-sm font-medium"
              style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
            >
              Annuler
            </button>
          </div>
        )}

        {/* Processing */}
        {scanState === 'processing' && (
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="w-12 h-12 animate-spin" style={{ color: '#0B7439' }} />
            <p className="font-medium" style={{ color: 'var(--text-primary)' }}>Vérification du courrier…</p>
          </div>
        )}

        {/* Success */}
        {scanState === 'success' && scanResult && (
          <div className="w-full flex flex-col items-center gap-5">
            <div className="w-20 h-20 rounded-full flex items-center justify-center" style={{ backgroundColor: '#d4edda' }}>
              <CheckCircle2 className="w-10 h-10" style={{ color: '#0B7439' }} />
            </div>
            <div className="text-center">
              <p className="text-xl font-bold mb-1" style={{ color: '#0B7439' }}>Courrier réceptionné !</p>
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{scanResult.message}</p>
            </div>
            <div className="w-full rounded-xl p-4 flex flex-col gap-3" style={{ backgroundColor: '#d4edda', border: '1px solid #0B7439' }}>
              <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: '#0B7439' }}>Statut mis à jour</p>
              <div className="flex items-center gap-3">
                <span className="px-2 py-0.5 rounded text-xs font-bold" style={{ backgroundColor: '#FEF3C7', color: '#D97706' }}>Expédié</span>
                <ArrowForward />
                <span className="px-2 py-0.5 rounded text-xs font-bold" style={{ backgroundColor: '#d4edda', color: '#0B7439', border: '1px solid #0B7439' }}>Arrivé</span>
              </div>
            </div>
            <div className="w-full flex flex-col gap-2">
              {scanResult.parcel_id && (
                <button
                  onClick={() => { stopCamera(); navigate(`${basePath}/parcels/${scanResult.parcel_id}`) }}
                  className="w-full py-3 rounded-xl font-semibold text-sm"
                  style={{ backgroundColor: '#0B7439', color: '#fff' }}
                >
                  Voir le détail du courrier
                </button>
              )}
              <button
                onClick={reset}
                className="w-full py-3 rounded-xl font-semibold text-sm flex items-center justify-center gap-2"
                style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
              >
                <RefreshCw className="w-4 h-4" />
                Scanner un autre courrier
              </button>
            </div>
          </div>
        )}

        {/* Error */}
        {scanState === 'error' && scanResult && (
          <div className="w-full flex flex-col items-center gap-5">
            <div className="w-20 h-20 rounded-full flex items-center justify-center" style={{ backgroundColor: '#fee2e2' }}>
              <AlertTriangle className="w-10 h-10" style={{ color: '#DC2626' }} />
            </div>
            <div className="text-center">
              <p className="text-xl font-bold mb-1" style={{ color: '#DC2626' }}>
                {scanResult.code === 'wrong_station' ? 'Mauvaise gare' :
                 scanResult.code === 'already_arrived' ? 'Déjà réceptionné' :
                 scanResult.code === 'already_delivered' ? 'Déjà retiré' :
                 scanResult.code === 'not_found' ? 'Courrier introuvable' :
                 'Erreur'}
              </p>
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{scanResult.message}</p>
            </div>
            <div className="w-full flex flex-col gap-2">
              {scanResult.parcel_id && (
                <button
                  onClick={() => { stopCamera(); navigate(`${basePath}/parcels/${scanResult.parcel_id}`) }}
                  className="w-full py-3 rounded-xl font-semibold text-sm"
                  style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
                >
                  Voir le détail du courrier
                </button>
              )}
              <button
                onClick={reset}
                className="w-full py-3 rounded-xl font-semibold text-sm flex items-center justify-center gap-2"
                style={{ backgroundColor: '#0B7439', color: '#fff' }}
              >
                <RefreshCw className="w-4 h-4" />
                Réessayer
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}

// Small inline arrow icon to avoid importing extra
function ArrowForward() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: '#6B7280' }}>
      <path d="M5 12h14M12 5l7 7-7 7" />
    </svg>
  )
}
