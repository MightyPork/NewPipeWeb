import type { Level } from 'hls.js'
import type { StreamModel, StreamUrl } from '../types'

/** Build the watch page path for any service. */
export function watchPath(video: { id: string; url?: string }): string {
  if (video.url?.startsWith('http')) {
    return `/watch?url=${encodeURIComponent(video.url)}`
  }
  return `/watch/${video.id}`
}

/**
 * Thumbnails load fine cross-origin in <img> tags — no proxy needed.
 * Proxying every card thumbnail was overloading /api/proxy and causing 500s.
 */
export function thumbnailUrl(url: string): string {
  return url || ''
}

/** True when the URL already points at our own media proxy (relative or absolute). */
export function isProxiedUrl(url: string): boolean {
  if (url.startsWith('/api/')) return true
  try {
    const u = new URL(url, window.location.href)
    return u.origin === window.location.origin && u.pathname.startsWith('/api/')
  } catch {
    return false
  }
}

/** Route playable media through our backend proxy to avoid CDN CORS blocks. */
export function proxyMediaUrl(url: string, title?: string): string {
  if (!url || isProxiedUrl(url)) return url
  const safeTitle = title ? title.replace(/[^a-zA-Z0-9.-]/g, '_').substring(0, 100) : ''
  const titleParam = safeTitle ? `&title=${encodeURIComponent(safeTitle)}` : ''
  return `/api/proxy?url=${encodeURIComponent(url)}${titleParam}`
}

export function isHlsSource(url: string, format?: string): boolean {
  const f = format?.toUpperCase() ?? ''
  const u = url.toLowerCase()
  return f.includes('M3U8') || u.includes('.m3u8') || u.includes('application/vnd.apple.mpegurl')
}

/**
 * Pick the best source for HTML5 playback.
 *
 * YouTube only offers muxed (video+audio) progressive files up to 360p; every
 * higher quality is video-only. The extractor also returns YouTube's own HLS
 * master playlist, which carries the full quality ladder with separate audio,
 * so for YouTube we play that through hls.js and keep the muxed file only as a
 * fallback (and as the download source).
 *
 * SoundCloud and similar services often expose audio-only streams.
 */
export function pickDefaultStream(
  stream: StreamModel,
  preferredQuality: string,
): { stream: StreamUrl | null; useHls: boolean; hlsUrl: string | null } {
  const progressiveVideo = stream.videoStreams.filter(s => !s.isVideoOnly)
  const preferredVideo = progressiveVideo.find(s =>
    s.quality.startsWith(preferredQuality),
  )
  const video = preferredVideo ?? progressiveVideo[0]

  if (stream.service === 'youtube' && stream.hlsUrl) {
    return { stream: video ?? null, useHls: true, hlsUrl: stream.hlsUrl }
  }

  if (video) {
    return {
      stream: video,
      useHls: isHlsSource(video.url, video.format),
      hlsUrl: null,
    }
  }

  const audio = stream.audioStreams[0]
  if (audio) {
    return {
      stream: audio,
      useHls: isHlsSource(audio.url, audio.format),
      hlsUrl: null,
    }
  }

  if (stream.hlsUrl) {
    return { stream: null, useHls: true, hlsUrl: stream.hlsUrl }
  }

  return { stream: null, useHls: false, hlsUrl: null }
}

// ─────────────────────────────────────────────
// HLS quality levels
// ─────────────────────────────────────────────

/** A user-selectable quality built from one or more hls.js levels. */
export interface QualityOption {
  label: string        // e.g. "1080p60"
  height: number
  levelIndex: number   // index into hls.levels
}

/** Human label for a level, matching YouTube's "1080p60" style. */
export function levelLabel(level: Level): string {
  const fps = level.frameRate && level.frameRate > 30 ? Math.round(level.frameRate) : ''
  return `${level.height}p${fps}`
}

/**
 * Collapse hls.js levels into one option per resolution.
 * YouTube lists every resolution twice (H.264 and VP9); we keep one per label,
 * preferring H.264 for broad hardware decoding, and VP9 where it is the only choice.
 */
export function buildQualityOptions(levels: Level[]): QualityOption[] {
  const byLabel = new Map<string, QualityOption & { isAvc: boolean }>()
  levels.forEach((level, levelIndex) => {
    if (!level.height) return
    const label = levelLabel(level)
    const isAvc = (level.videoCodec ?? '').startsWith('avc1')
    const existing = byLabel.get(label)
    if (!existing || (isAvc && !existing.isAvc)) {
      byLabel.set(label, { label, height: level.height, levelIndex, isAvc })
    }
  })
  return [...byLabel.values()]
    .sort((a, b) => b.height - a.height || b.levelIndex - a.levelIndex)
    .map(({ label, height, levelIndex }) => ({ label, height, levelIndex }))
}

/**
 * Choose the option closest to the preferred quality ("720p", "1080p", …)
 * without exceeding it; falls back to the lowest available.
 */
export function pickQualityOption(options: QualityOption[], preferredQuality: string): QualityOption | null {
  if (options.length === 0) return null
  const wanted = parseInt(preferredQuality, 10)
  if (Number.isNaN(wanted)) return options[0]
  const fitting = options.filter(o => o.height <= wanted)
  return fitting[0] ?? options[options.length - 1]
}
