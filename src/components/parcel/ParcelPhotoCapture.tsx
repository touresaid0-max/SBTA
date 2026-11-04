import { useEffect, useRef, useState, useCallback } from 'react'
import { Camera, ImagePlus, X, ZoomIn, Loader2, AlertCircle } from 'lucide-react'
import { compressImage } from '@/utils/imageCompression'
import { uuidV4 } from '@/utils/uuid'
import { MAX_PARCEL_PHOTOS } from '@/services/courrier/photos'

/** Photo taken for a parcel not saved yet: kept in memory until the parcel is saved. */
export interface CapturedPhoto {
  id: string
  blob: Blob
}

interface Props {
  photos: CapturedPhoto[]
  onChange: (photos: CapturedPhoto[]) => void
  maxPhotos?: number
  disabled?: boolean
}

/**
 * Photos of a new parcel (audit m3). Nothing is sent from here: each photo is reduced on the
 * device (JPEG, 1 600 px) and handed to the form, which keeps it with the parcel and lets the
 * sending queue send it, with or without network.
 */
export default function ParcelPhotoCapture({ photos, onChange, maxPhotos = MAX_PARCEL_PHOTOS, disabled = false }: Props) {
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const galleryInputRef = useRef<HTMLInputElement>(null)
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lightbox, setLightbox] = useState<string | null>(null)
  const [previews, setPreviews] = useState<Record<string, string>>({})

  // Preview links of the photos in memory, released when they are removed
  useEffect(() => {
    const next: Record<string, string> = {}
    for (const p of photos) next[p.id] = previews[p.id] ?? URL.createObjectURL(p.blob)
    for (const [id, url] of Object.entries(previews)) if (!next[id]) URL.revokeObjectURL(url)
    setPreviews(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photos])
  useEffect(() => () => { Object.values(previews).forEach(u => URL.revokeObjectURL(u)) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const canAdd = photos.length < maxPhotos && !disabled

  const handleFiles = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setError(null)
    setProcessing(true)
    try {
      const remaining = maxPhotos - photos.length
      const added: CapturedPhoto[] = []
      for (const file of Array.from(files).slice(0, remaining)) {
        try {
          added.push({ id: uuidV4(), blob: await compressImage(file) })
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Photo illisible.')
        }
      }
      if (files.length > remaining) setError(`${maxPhotos} photos au maximum par courrier.`)
      if (added.length > 0) onChange([...photos, ...added])
    } finally {
      setProcessing(false)
      // Reset inputs so the same file can be chosen again
      if (cameraInputRef.current) cameraInputRef.current.value = ''
      if (galleryInputRef.current) galleryInputRef.current.value = ''
    }
  }, [photos, maxPhotos, onChange])

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="block text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
          Photos du colis (facultatif)
          <span className="ml-1 font-normal" style={{ color: 'var(--text-muted)' }}>
            ({photos.length}/{maxPhotos})
          </span>
        </span>
        {photos.length > 0 && (
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Appuyer pour agrandir</span>
        )}
      </div>

      <div className="flex flex-wrap gap-3">
        {photos.map((p, idx) => {
          const url = previews[p.id]
          return (
            <div
              key={p.id}
              className="relative rounded-xl overflow-hidden flex-shrink-0 group"
              style={{ width: 88, height: 88, border: '2px solid var(--border)' }}
            >
              {url && (
                <img
                  src={url}
                  alt={`Photo du colis ${idx + 1}`}
                  className="w-full h-full object-cover cursor-pointer"
                  onClick={() => setLightbox(url)}
                />
              )}
              <div
                className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                style={{ backgroundColor: 'rgba(0,0,0,0.35)' }}
                onClick={() => url && setLightbox(url)}
              >
                <ZoomIn className="w-5 h-5 text-white" />
              </div>
              {!disabled && (
                <button
                  type="button"
                  onClick={() => onChange(photos.filter(x => x.id !== p.id))}
                  className="absolute top-1 right-1 w-5 h-5 rounded-full flex items-center justify-center shadow-md z-10"
                  style={{ backgroundColor: '#AF3029' }}
                  title="Retirer cette photo"
                  aria-label={`Retirer la photo ${idx + 1}`}
                >
                  <X className="w-3 h-3 text-white" />
                </button>
              )}
            </div>
          )
        })}

        {canAdd && !processing && (
          <>
            {/* Camera (on a phone or tablet: opens the rear camera) */}
            <button
              type="button"
              onClick={() => cameraInputRef.current?.click()}
              className="flex flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed transition-colors flex-shrink-0"
              style={{ width: 88, height: 88, borderColor: '#0B7439', backgroundColor: '#f0faf4', color: '#0B7439' }}
              title="Prendre une photo"
            >
              <Camera className="w-5 h-5" />
              <span style={{ fontSize: 10, fontWeight: 600 }}>Caméra</span>
            </button>
            <button
              type="button"
              onClick={() => galleryInputRef.current?.click()}
              className="flex flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed transition-colors flex-shrink-0"
              style={{ width: 88, height: 88, borderColor: 'var(--border)', backgroundColor: 'var(--bg-subtle)', color: 'var(--text-muted)' }}
              title="Choisir une photo"
            >
              <ImagePlus className="w-5 h-5" />
              <span style={{ fontSize: 10, fontWeight: 600 }}>Fichier</span>
            </button>
          </>
        )}

        {processing && (
          <div
            className="flex flex-col items-center justify-center gap-1 rounded-xl flex-shrink-0"
            style={{ width: 88, height: 88, backgroundColor: 'var(--bg-subtle)', border: '2px solid var(--border)' }}
          >
            <Loader2 className="w-5 h-5 animate-spin" style={{ color: '#0B7439' }} />
            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Réduction…</span>
          </div>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ backgroundColor: '#f8d7d5', border: '1px solid #AF3029' }} role="alert">
          <AlertCircle className="w-4 h-4 flex-shrink-0" style={{ color: '#AF3029' }} />
          <p className="text-xs" style={{ color: '#AF3029' }}>{error}</p>
          <button type="button" onClick={() => setError(null)} className="ml-auto" aria-label="Fermer le message">
            <X className="w-3.5 h-3.5" style={{ color: '#AF3029' }} />
          </button>
        </div>
      )}

      <input
        ref={cameraInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/*"
        capture="environment"
        className="hidden"
        onChange={e => handleFiles(e.target.files)}
      />
      <input
        ref={galleryInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/*"
        multiple
        className="hidden"
        onChange={e => handleFiles(e.target.files)}
      />

      {lightbox && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(0,0,0,0.85)' }}
          onClick={() => setLightbox(null)}
        >
          <button
            type="button"
            className="absolute top-4 right-4 w-10 h-10 rounded-full flex items-center justify-center z-10"
            style={{ backgroundColor: 'rgba(255,255,255,0.15)' }}
            onClick={() => setLightbox(null)}
            aria-label="Fermer"
          >
            <X className="w-5 h-5 text-white" />
          </button>
          <img src={lightbox} alt="Photo du colis agrandie" className="max-w-full max-h-full rounded-lg" onClick={e => e.stopPropagation()} />
        </div>
      )}
    </div>
  )
}
