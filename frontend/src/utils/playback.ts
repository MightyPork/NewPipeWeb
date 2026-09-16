import type { StreamModel, StreamUrl } from '../types'

/** Build the watch page path for any service. */
export function watchPath(video: { id: string; url?: string }, playlistUrl?: string): string {
  const list = playlistUrl ? `list=${encodeURIComponent(playlistUrl)}` : ''
  if (video.url?.startsWith('http') && !isYoutubeWatchUrl(video.url)) {
    return `/watch?url=${encodeURIComponent(video.url)}${list ? `&${list}` : ''}`
  }
  return `/watch/${video.id}${list ? `?${list}` : ''}`
}

/** Path of the remote (YouTube) playlist page for a playlist URL. */
export function remotePlaylistPath(playlistUrl: string): string {
  return `/playlist?url=${encodeURIComponent(playlistUrl)}`
}

export function isYoutubeWatchUrl(url: string): boolean {
  return /^https?:\/\/(www\.|m\.|music\.)?youtube\.com\/watch\?/.test(url) || /^https?:\/\/youtu\.be\//.test(url)
}

/**
 * Recognise pasted YouTube links so the search box can open them directly.
 * Returns an in-app path, or null when the text is not a YouTube URL.
 */
export function pathForPastedUrl(text: string): string | null {
  const t = text.trim()
  if (!/^https?:\/\//i.test(t)) return null
  let u: URL
  try { u = new URL(t) } catch { return null }
  const host = u.hostname.replace(/^www\.|^m\.|^music\./, '')
  if (host !== 'youtube.com' && host !== 'youtu.be') return null

  const list = u.searchParams.get('list')
  const videoId = host === 'youtu.be'
    ? u.pathname.slice(1).split('/')[0]
    : (u.searchParams.get('v') ?? (u.pathname.startsWith('/shorts/') ? u.pathname.split('/')[2] : null))

  if (u.pathname === '/playlist' && list) {
    return remotePlaylistPath(`https://www.youtube.com/playlist?list=${list}`)
  }
  if (videoId) {
    // Mixes (RD...) need the video id in the playlist URL itself.
    const playlistUrl = list
      ? (list.startsWith('RD')
          ? `https://www.youtube.com/watch?v=${videoId}&list=${list}`
          : `https://www.youtube.com/playlist?list=${list}`)
      : undefined
    return watchPath({ id: videoId }, playlistUrl)
  }
  return null
}

/** YouTube channel id (UC...) or handle from an uploader URL; null for other services. */
export function youtubeChannelIdFromUrl(url: string | undefined): string | null {
  if (!url) return null
  const m = url.match(/youtube\.com\/(?:channel\/)?(UC[\w-]{20,}|@[\w.-]+)/)
  return m ? m[1] : null
}

/**
 * Thumbnails load fine cross-origin in <img> tags — no proxy needed.
 * Proxying every card thumbnail was overloading /api/proxy and causing 500s.
 */
export function thumbnailUrl(url: string): string {
  return url || ''
}

/** Route playable media through our backend proxy to avoid CDN CORS blocks. */
export function proxyMediaUrl(url: string, title?: string): string {
  if (!url || url.startsWith('/api/')) return url
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
 * Pick the best stream for HTML5 playback.
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
// Display helpers
// ─────────────────────────────────────────────

export function formatCount(n: number): string {
  if (n < 0) return ''
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1).replace(/\.0$/, '')}B`
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 100_000 ? 0 : 1).replace(/\.0$/, '')}K`
  return `${n}`
}

/** Format seconds as M:SS or H:MM:SS */
export function formatDuration(seconds: number): string {
  if (seconds < 0) return 'LIVE'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}
