import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

function App() {
  const MAX_FILES = 20
  const MAX_SIZE_MB = 50
  const [files, setFiles] = useState([]) // { id, file, previewUrl, pngUrl, status, error }
  const [isConvertingAll, setIsConvertingAll] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef(null)
  // Compression controls
  const [outputFormat, setOutputFormat] = useState('png') // png | webp | jpeg
  const [quality, setQuality] = useState(0.9)

  // Global controls
  const [maxWidth, setMaxWidth] = useState(0)
  const [maxHeight, setMaxHeight] = useState(0)
  const [fitMode, setFitMode] = useState('contain') // contain | stretch
  const [keepAspect, setKeepAspect] = useState(true)

  const reset = useCallback(() => {
    setFiles([])
    setError('')
    if (inputRef.current) {
      inputRef.current.value = ''
    }
  }, [])

  const createItem = (f) => {
    const objectUrl = URL.createObjectURL(f)
    return {
      id: `${f.name}-${f.size}-${f.lastModified}-${Math.random().toString(36).slice(2,8)}`,
      file: f,
      previewUrl: objectUrl,
      pngUrl: '',
      status: 'idle',
      error: '',
      width: 0,
      height: 0
    }
  }

  const onSelectFiles = useCallback((list) => {
    setError('')
    if (!list || list.length === 0) return
    const valid = []
    for (const f of Array.from(list)) {
      const isJpg = /^image\/(jpeg|jpg)$/i.test(f.type) || /\.(jpe?g)$/i.test(f.name)
      const underSize = f.size <= MAX_SIZE_MB * 1024 * 1024
      if (isJpg && underSize) valid.push(f)
    }
    if (valid.length === 0) {
      setError(`Please choose JPG/JPEG images up to ${MAX_SIZE_MB} MB each.`)
      return
    }
    setFiles((prev) => {
      const availableSlots = MAX_FILES - prev.length
      const toAdd = valid.slice(0, Math.max(0, availableSlots))
      if (valid.length > toAdd.length) {
        setError(`Only ${MAX_FILES} images allowed at once.`)
      }
      return [...prev, ...toAdd.map(createItem)]
    })
  }, [])

  const handleInputChange = useCallback((e) => {
    const list = e.target.files
    onSelectFiles(list)
  }, [onSelectFiles])

  const handleDrop = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
    const dropped = e.dataTransfer.files
    onSelectFiles(dropped)
  }, [onSelectFiles])

  const handleDragOver = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const convertItem = useCallback(async (item) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.src = item.previewUrl
    await new Promise((resolve, reject) => {
      img.onload = resolve
      img.onerror = reject
    })

    const srcW = img.naturalWidth
    const srcH = img.naturalHeight
    // store dimensions once loaded
    setFiles((prev) => prev.map((it) => (it.id === item.id ? { ...it, width: srcW, height: srcH } : it)))

    // Determine target size
    let targetW = srcW
    let targetH = srcH
    const limitW = Number(maxWidth) || 0
    const limitH = Number(maxHeight) || 0

    if (fitMode === 'stretch') {
      targetW = limitW > 0 ? limitW : srcW
      targetH = limitH > 0 ? limitH : srcH
    } else {
      // contain with optional aspect keeping
      if (limitW > 0 || limitH > 0) {
        const scaleW = limitW > 0 ? limitW / srcW : Infinity
        const scaleH = limitH > 0 ? limitH / srcH : Infinity
        const scale = keepAspect ? Math.min(scaleW, scaleH) : scaleW
        const finalScale = Number.isFinite(scale) ? Math.min(scale, 1e6) : 1
        targetW = Math.max(1, Math.round((keepAspect ? srcW : limitW > 0 ? limitW : srcW) * finalScale))
        targetH = Math.max(1, Math.round((keepAspect ? srcH : limitH > 0 ? limitH : srcH) * finalScale))
      }
    }

    const canvas = document.createElement('canvas')
    canvas.width = targetW
    canvas.height = targetH
    const ctx = canvas.getContext('2d')
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, 0, 0, targetW, targetH)

    const mime = outputFormat === 'png' ? 'image/png' : outputFormat === 'webp' ? 'image/webp' : 'image/jpeg'
    const q = outputFormat === 'png' ? undefined : Math.max(0, Math.min(1, quality))
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, mime, q))
    if (!blob) throw new Error('Failed to create output')
    return URL.createObjectURL(blob)
  }, [fitMode, keepAspect, maxHeight, maxWidth, outputFormat, quality])

  const moveItem = useCallback((id, delta) => {
    setFiles((prev) => {
      const index = prev.findIndex((f) => f.id === id)
      if (index < 0) return prev
      const next = [...prev]
      const newIndex = Math.min(prev.length - 1, Math.max(0, index + delta))
      const [item] = next.splice(index, 1)
      next.splice(newIndex, 0, item)
      return next
    })
  }, [])

  const convertOne = useCallback(async (id) => {
    setFiles((prev) => prev.map((it) => (it.id === id ? { ...it, status: 'converting', error: '' } : it)))
    try {
      const target = files.find((f) => f.id === id)
      if (!target) return
      const url = await convertItem(target)
      setFiles((prev) => prev.map((it) => (it.id === id ? { ...it, pngUrl: url, status: 'done' } : it)))
    } catch (e) {
      setFiles((prev) => prev.map((it) => (it.id === id ? { ...it, status: 'error', error: 'Failed to convert' } : it)))
    }
  }, [files, convertItem])

  const convertAll = useCallback(async () => {
    if (files.length === 0) return
    setIsConvertingAll(true)
    for (const it of files) {
      if (!it.pngUrl) {
        // eslint-disable-next-line no-await-in-loop
        await convertOne(it.id)
      }
    }
    setIsConvertingAll(false)
  }, [files, convertOne])

  const revokeUrls = (item) => {
    try { item.previewUrl && URL.revokeObjectURL(item.previewUrl) } catch {}
    try { item.pngUrl && URL.revokeObjectURL(item.pngUrl) } catch {}
  }

  const removeOne = useCallback((id) => {
    setFiles((prev) => {
      const target = prev.find((f) => f.id === id)
      if (target) revokeUrls(target)
      return prev.filter((f) => f.id !== id)
    })
  }, [])

  const clearAll = useCallback(() => {
    setFiles((prev) => {
      prev.forEach(revokeUrls)
      return []
    })
    reset()
  }, [reset])

  const downloadAllZip = useCallback(async () => {
    const { default: JSZip } = await import('jszip')
    const zip = new JSZip()
    const folder = zip.folder('png')
    for (const it of files) {
      if (!it.pngUrl) continue
      // eslint-disable-next-line no-await-in-loop
      const blob = await fetch(it.pngUrl).then((r) => r.blob())
      const name = `${it.file.name.replace(/\.(jpe?g)$/i, '') || 'image'}.png`
      folder.file(name, blob)
    }
    const content = await zip.generateAsync({ type: 'blob' })
    const url = URL.createObjectURL(content)
    const a = document.createElement('a')
    a.href = url
    a.download = 'converted_pngs.zip'
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }, [files])

  const allConverted = useMemo(() => files.length > 0 && files.every((f) => !!f.pngUrl), [files])
  const anySelected = files.length > 0
  const convertedCount = useMemo(() => files.filter((f) => !!f.pngUrl).length, [files])

  // Auto clear after 60 minutes
  const autoClearTimerRef = useRef(null)
  useEffect(() => {
    if (autoClearTimerRef.current) {
      clearTimeout(autoClearTimerRef.current)
      autoClearTimerRef.current = null
    }
    if (anySelected) {
      autoClearTimerRef.current = setTimeout(() => {
        clearAll()
        setError('Session cleared automatically after 60 minutes.')
      }, 60 * 60 * 1000)
    }
    return () => {
      if (autoClearTimerRef.current) clearTimeout(autoClearTimerRef.current)
    }
  }, [anySelected, clearAll])

  return (
    <div className="page">
      <header className="header">
        <div className="brand">
          <svg className="logo-icon" width="28" height="28" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <defs>
              <linearGradient id="g1" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
                <stop stop-color="#646cff"/>
                <stop offset="1" stop-color="#61dafb"/>
              </linearGradient>
            </defs>
            <rect x="4" y="4" width="40" height="40" rx="10" fill="url(#g1)"/>
            <path d="M16 18h8l-3-3m3 3-3 3" stroke="#0f1222" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M32 30h-8l3 3m-3-3 3-3" stroke="#0f1222" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <span className="brand-text">jpg2png.in</span>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          {anySelected && (
            <span className="count">{files.length} / {MAX_FILES}</span>
          )}
          {anySelected ? (
            <button className="link" onClick={reset}>New conversion</button>
          ) : null}
        </div>
      </header>

      <main className="container">
        {/* always-present hidden file input for adding files anytime */}
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,.jpg,.jpeg"
          multiple
          onChange={handleInputChange}
          hidden
        />
        <h1 className="title">Fast JPG to PNG Converter</h1>
        <p className="subtitle">Convert locally in your browser. No uploads. Instant results.</p>

        {!anySelected && (
          <div
            className="dropzone"
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onClick={() => inputRef.current?.click()}
          >
            <div className="dropzone-inner">
              <div className="icon">📷</div>
              <div className="dz-title">Drag & drop JPGs here</div>
              <div className="dz-sub">or click to choose files</div>
            </div>
          </div>
        )}

        {anySelected && (
          <section className="grid">
            {files.map((it, idx) => {
              const ext = outputFormat === 'png' ? 'png' : outputFormat === 'webp' ? 'webp' : 'jpg'
              const downloadName = `${it.file.name.replace(/\.(jpe?g)$/i, '') || 'image'}.${ext}`
              return (
                <div key={it.id} className="card">
                  <div className="thumb-wrap">
                    <div className="checker"></div>
                    <img className="thumb" src={it.previewUrl} alt={it.file.name} />
                  </div>
                  <div className="filename" title={it.file.name}>{it.file.name}</div>
                  <div className="meta">
                    <span>{(it.file.size / (1024 * 1024)).toFixed(2)} MB</span>
                    {it.width && it.height ? <span>• {it.width}×{it.height}</span> : null}
                  </div>
                  <div className="row">
                    {!it.pngUrl ? (
                      <button className="ghost" onClick={() => convertOne(it.id)} disabled={it.status === 'converting'}>
                        {it.status === 'converting' ? 'Converting…' : 'Convert'}
                      </button>
                    ) : (
                      <a className="primary" href={it.pngUrl} download={downloadName}>Download</a>
                    )}
                    <button className="ghost" onClick={() => removeOne(it.id)}>Remove</button>
                    <button className="ghost" disabled={idx === 0} onClick={() => moveItem(it.id, -1)}>↑</button>
                    <button className="ghost" disabled={idx === files.length - 1} onClick={() => moveItem(it.id, 1)}>↓</button>
                  </div>
                  {it.error && <div className="error">{it.error}</div>}
                </div>
              )
            })}
          </section>
        )}

        {anySelected && (
          <div className="batch-actions">
            <div className="compress-controls">
              <label>
                <span>Format</span>
                <select value={outputFormat} onChange={(e) => setOutputFormat(e.target.value)}>
                  <option value="png">PNG</option>
                  <option value="webp">WebP</option>
                  <option value="jpeg">JPEG</option>
                </select>
              </label>
              {(outputFormat === 'webp' || outputFormat === 'jpeg') && (
                <label>
                  <span>Quality {Math.round(quality * 100)}%</span>
                  <input type="range" min="0.1" max="1" step="0.01" value={quality} onChange={(e) => setQuality(Number(e.target.value))} />
                </label>
              )}
            </div>
            <button className="primary" onClick={convertAll} disabled={isConvertingAll || allConverted}>
              {isConvertingAll ? 'Converting All…' : allConverted ? 'All Converted' : 'Convert All'}
            </button>
            {anySelected && (
              <span className="muted">{convertedCount} / {files.length} converted</span>
            )}
            {allConverted && (
              <button className="primary" onClick={downloadAllZip}>Download All (ZIP)</button>
            )}
            {!allConverted && files.length > 0 && (
              <button className="ghost" onClick={async () => { await convertAll(); downloadAllZip(); }}>Convert & Download All</button>
            )}
            <button className="ghost" onClick={() => inputRef.current?.click()}>Add more</button>
            <button className="ghost" onClick={clearAll}>Clear all</button>
          </div>
        )}

        {error && <div className="error">{error}</div>}

        

        <section className="seo-section">
          <h2>Why convert JPG to PNG?</h2>
          <p>PNG supports transparency and lossless compression, making it ideal for logos, UI elements, and images that need crisp edges. This tool converts your JPG or JPEG files to high‑quality PNGs directly in your browser for maximum privacy and speed.</p>
          <h2>Features</h2>
          <ul className="features">
            <li>Batch conversion: add multiple JPGs and convert all at once</li>
            <li>No uploads: everything runs on‑device for privacy</li>
            <li>Instant download: save converted PNGs individually or as a ZIP</li>
            <li>Modern UI: drag & drop, previews, and responsive layout</li>
          </ul>
          <h2>FAQ</h2>
          <h3>Is this JPG to PNG converter free?</h3>
          <p>Yes. It is completely free to use without limits or watermarks.</p>
          <h3>Do my images get uploaded?</h3>
          <p>No. Conversion happens entirely in your browser using the HTML5 canvas API.</p>
          <h3>Can I convert multiple images?</h3>
          <p>Yes. Drag and drop several JPG/JPEG files and click Convert All.</p>
        </section>

        <footer className="footer">
          <span>All conversions happen on-device. Your images never leave your browser.</span>
        </footer>
      </main>
    </div>
  )
}

export default App
