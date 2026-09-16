/**
 * Watch.tsx
 *
 * The video watch page. Handles:
 * - Video playback with quality selection
 * - Playlist queue (?list=<playlist url>) with autoplay of the next item
 * - Subtitle track switching
 * - Picture-in-Picture (PiP)
 * - Background audio mode (audio-only stream)
 * - SponsorBlock auto-skip (if enabled in Settings)
 * - Resume position (restores where you left off)
 * - Add to watchlist
 * - Add to playlist (via modal)
 * - Subscribe / unsubscribe to channel
 * - Download video
 * - Comments section
 * - Related videos sidebar
 */

import { useParams, useSearchParams, Link, useNavigate } from 'react-router-dom'
import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import Hls from 'hls.js'
import {
  useStream, useComments, useAddToHistory,
  useSubscribe, useSubscriptions, useUnsubscribe,
  useHistory, useAddToWatchlist, useWatchlist,
  useRemoveFromWatchlist, useStartDownload, useRemotePlaylist,
} from '../hooks'
import { useSponsorBlock } from '../hooks/useSponsorBlock'
import VideoCard from '../components/video/VideoCard'
import { LoadingSpinner, ErrorMessage } from '../components/common'
import AddToPlaylistModal from '../components/playlist/AddToPlaylistModal'
import { useAppStore } from '../store/useAppStore'
import {
  ThumbsUp, Download, BookmarkPlus, BookmarkCheck,
  Bell, BellOff, ListVideo, PictureInPicture2,
  Headphones, Subtitles, SkipForward, SkipBack,
} from 'lucide-react'
import type { StreamUrl, SubtitleTrack } from '../types'
import {
  pickDefaultStream, proxyMediaUrl, isHlsSource,
  formatDuration, watchPath, remotePlaylistPath,
} from '../utils/playback'

export default function Watch() {
  const { id } = useParams<{ id: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  // Support both /watch/:id (YouTube) and /watch?url= (any service)
  const contentUrl = searchParams.get('url') ?? (id ? `https://www.youtube.com/watch?v=${id}` : '')
  const youtubeVideoId =
    id ??
    contentUrl.match(/[?&]v=([^&]+)/)?.[1] ??
    ''
  // Playing inside a remote (YouTube) playlist: ?list=<playlist url>
  const playlistUrl = searchParams.get('list') ?? ''

  // ─── Data fetching ────────────────────────────────────────
  const { data: stream, isLoading, isError, refetch } = useStream(contentUrl)
  const { data: comments } = useComments(contentUrl)
  const { data: history } = useHistory()
  const { data: watchlist } = useWatchlist()
  const { data: subscriptions } = useSubscriptions()
  const playlist = useRemotePlaylist(playlistUrl)

  // ─── Mutations ────────────────────────────────────────────
  const addToHistory = useAddToHistory()
  const addToWatchlist = useAddToWatchlist()
  const removeFromWatchlist = useRemoveFromWatchlist()
  const subscribe = useSubscribe()
  const unsubscribe = useUnsubscribe()
  const startDownload = useStartDownload()

  // ─── Global preferences from store ────────────────────────
  const {
    volume, setVolume,
    playbackRate, setPlaybackRate,
    preferredQuality,
    subtitlesEnabled, setSubtitlesEnabled,
    preferredSubtitleLang,
    backgroundAudioMode, setBackgroundAudioMode,
    sponsorBlockEnabled,
  } = useAppStore()

  // ─── Local UI state ───────────────────────────────────────
  const videoRef = useRef<HTMLVideoElement>(null)
  const trackRef = useRef<HTMLTrackElement>(null)

  const [selectedStream, setSelectedStream] = useState<StreamUrl | null>(null)
  const [useHls, setUseHls] = useState(false)
  const [hlsSourceUrl, setHlsSourceUrl] = useState<string | null>(null)
  const [selectedSubtitle, setSelectedSubtitle] = useState<SubtitleTrack | null>(null)
  const [showComments, setShowComments] = useState(false)
  const [showPlaylistModal, setShowPlaylistModal] = useState(false)
  const [isPiP, setIsPiP] = useState(false)
  const [skippedCount, setSkippedCount] = useState(0) // how many segments skipped this session
  const [lastSkipLabel, setLastSkipLabel] = useState<string | null>(null) // toast message

  // ─── SponsorBlock ─────────────────────────────────────────
  const isYoutube = stream?.service === 'youtube'
  const { segments, getSkipTarget } = useSponsorBlock(
    isYoutube ? youtubeVideoId : '',
  )

  const contentKey = stream?.id ?? id ?? contentUrl

  const playbackSourceUrl = useMemo(() => {
    if (useHls && hlsSourceUrl) return hlsSourceUrl
    return selectedStream?.url ?? ''
  }, [useHls, hlsSourceUrl, selectedStream?.url])

  const playbackUrl = playbackSourceUrl ? proxyMediaUrl(playbackSourceUrl, stream?.title) : ''

  // ─── Playlist queue ───────────────────────────────────────
  const queue = playlist.videos
  const queueIndex = queue.findIndex(v => v.id === contentKey || (id && v.id === id))
  const nextInQueue = queueIndex >= 0 ? queue[queueIndex + 1] : undefined
  const prevInQueue = queueIndex > 0 ? queue[queueIndex - 1] : undefined
  const currentQueueItemRef = useRef<HTMLAnchorElement>(null)

  // If the current video is beyond the loaded pages, keep loading until we find it.
  useEffect(() => {
    if (!playlistUrl || !playlist.info) return
    if (queueIndex === -1 && playlist.hasNextPage && !playlist.isFetchingNextPage) {
      playlist.fetchNextPage()
    }
  }, [playlistUrl, playlist.info, queueIndex, playlist.hasNextPage, playlist.isFetchingNextPage])

  // Pre-load the following page when we are near the end of what is loaded.
  useEffect(() => {
    if (queueIndex >= 0 && queueIndex >= queue.length - 2 && playlist.hasNextPage && !playlist.isFetchingNextPage) {
      playlist.fetchNextPage()
    }
  }, [queueIndex, queue.length, playlist.hasNextPage, playlist.isFetchingNextPage])

  useEffect(() => {
    currentQueueItemRef.current?.scrollIntoView({ block: 'nearest' })
  }, [queueIndex, queue.length])

  const goToQueueItem = useCallback((video: { id: string; url?: string } | undefined) => {
    if (!video) return
    navigate(watchPath(video, playlistUrl))
  }, [navigate, playlistUrl])

  // ─────────────────────────────────────────────────────────
  // On stream load: pick best quality stream + restore resume position
  // ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!stream) return

    const picked = pickDefaultStream(stream, preferredQuality)
    setSelectedStream(picked.stream)
    setUseHls(picked.useHls)
    setHlsSourceUrl(picked.hlsUrl)

    if (subtitlesEnabled && stream.subtitles.length > 0) {
      const preferred = stream.subtitles.find(s => s.languageCode === preferredSubtitleLang)
      setSelectedSubtitle(preferred ?? stream.subtitles[0])
    }
  }, [stream?.id, preferredQuality, subtitlesEnabled, preferredSubtitleLang])

  // HLS playback (PeerTube and other HLS-only sources)
  useEffect(() => {
    const video = videoRef.current
    if (!video || !playbackUrl || !useHls) return

    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = playbackUrl
      return
    }

    if (!Hls.isSupported()) return

    const hls = new Hls({
      xhrSetup: (xhr, url) => {
        xhr.open('GET', proxyMediaUrl(url, stream?.title), true)
      },
    })
    hls.loadSource(playbackUrl)
    hls.attachMedia(video)
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      video.play().catch(() => { })
    })

    return () => hls.destroy()
  }, [playbackUrl, useHls])

  // ─────────────────────────────────────────────────────────
  // Restore resume position after video element loads
  // ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!videoRef.current || !id || !history) return

    // Find the last watch position for this video from history
    const entry = history.find(h => h.videoId === contentKey)
    if (entry && entry.watchedSeconds > 10) {
      // Only restore if more than 10 seconds in (ignore near-start)
      videoRef.current.currentTime = entry.watchedSeconds
    }
  }, [playbackUrl, history, contentKey])

  // ─────────────────────────────────────────────────────────
  // Sync volume and playback rate from stored preferences
  // ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!videoRef.current) return
    videoRef.current.volume = volume
    videoRef.current.playbackRate = playbackRate
  }, [playbackUrl])

  // ─────────────────────────────────────────────────────────
  // Add to history when video first loads
  // ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (stream && contentKey) {
      addToHistory.mutate({
        videoId: contentKey,
        title: stream.title,
        uploader: stream.uploader,
        thumbnailUrl: stream.thumbnailUrl,
        duration: stream.duration,
        watchedSeconds: 0,
      })
    }
  }, [stream?.id])

  // ─────────────────────────────────────────────────────────
  // Save resume position periodically (every 5 seconds of playback)
  // ─────────────────────────────────────────────────────────
  const handleTimeUpdate = useCallback(() => {
    const video = videoRef.current
    if (!video || !stream || !contentKey) return

    // SponsorBlock: check if we should skip the current position
    if (sponsorBlockEnabled && isYoutube) {
      const skipTo = getSkipTarget(video.currentTime)
      if (skipTo !== null) {
        video.currentTime = skipTo
        setSkippedCount(c => c + 1)
        const seg = segments.find(
          s => video.currentTime >= s.startTime && video.currentTime <= s.endTime + 1
        )
        setLastSkipLabel(seg?.category ?? 'segment')
        // Clear the toast after 2.5 seconds
        setTimeout(() => setLastSkipLabel(null), 2500)
      }
    }

    // Save progress every ~5 seconds (250ms interval × 20 = 5s)
    // We use a simple modulo trick on the floored second count
    const currentSec = Math.floor(video.currentTime)
    if (currentSec > 0 && currentSec % 5 === 0) {
      addToHistory.mutate({
        videoId: contentKey,
        title: stream.title,
        uploader: stream.uploader,
        thumbnailUrl: stream.thumbnailUrl,
        duration: stream.duration,
        watchedSeconds: currentSec,
      })
    }
  }, [stream?.id, sponsorBlockEnabled, segments, getSkipTarget, contentKey, isYoutube])

  // Autoplay the next playlist item when the video ends
  const handleEnded = () => {
    if (nextInQueue) goToQueueItem(nextInQueue)
  }

  // ─────────────────────────────────────────────────────────
  // Volume + playback rate change handlers (persist to store)
  // ─────────────────────────────────────────────────────────
  const handleVolumeChange = () => {
    if (videoRef.current) setVolume(videoRef.current.volume)
  }

  const handleRateChange = () => {
    if (videoRef.current) setPlaybackRate(videoRef.current.playbackRate)
  }

  // ─────────────────────────────────────────────────────────
  // Picture-in-Picture toggle
  // ─────────────────────────────────────────────────────────
  const handlePiP = async () => {
    if (!videoRef.current) return

    try {
      if (document.pictureInPictureElement) {
        // Exit PiP if already active
        await document.exitPictureInPicture()
        setIsPiP(false)
      } else {
        // Request PiP — browser shows a small floating window
        await videoRef.current.requestPictureInPicture()
        setIsPiP(true)
      }
    } catch (err) {
      console.warn('[PiP] Not supported or denied:', err)
    }
  }

  // Listen for PiP exit via browser controls (not our button)
  useEffect(() => {
    const onPiPLeave = () => setIsPiP(false)
    document.addEventListener('leavepictureinpicture', onPiPLeave)
    return () => document.removeEventListener('leavepictureinpicture', onPiPLeave)
  }, [])

  // ─────────────────────────────────────────────────────────
  // Background audio mode — switch to audio-only stream
  // ─────────────────────────────────────────────────────────
  const handleBackgroundAudio = () => {
    if (!stream) return
    const newMode = !backgroundAudioMode
    setBackgroundAudioMode(newMode)

    if (newMode && stream.audioStreams.length > 0) {
      const bestAudio = stream.audioStreams[0]
      setSelectedStream({
        url: bestAudio.url,
        quality: bestAudio.quality,
        format: bestAudio.format,
        isVideoOnly: false,
      })
      setUseHls(isHlsSource(bestAudio.url, bestAudio.format))
      setHlsSourceUrl(null)
    } else if (!newMode) {
      const picked = pickDefaultStream(stream, preferredQuality)
      setSelectedStream(picked.stream)
      setUseHls(picked.useHls)
      setHlsSourceUrl(picked.hlsUrl)
    }
  }

  // ─────────────────────────────────────────────────────────
  // Download handler
  // ─────────────────────────────────────────────────────────
  const handleDownload = async () => {
    if (!selectedStream || !stream) return
    await startDownload.mutateAsync({
      videoId: stream.id,
      title: stream.title,
      uploader: stream.uploader,
      thumbnailUrl: stream.thumbnailUrl,
      streamUrl: selectedStream.url,
      quality: selectedStream.quality,
      isAudioOnly: backgroundAudioMode,
    })
    alert('Download started! Check the Downloads page.')
  }

  // ─────────────────────────────────────────────────────────
  // Watchlist toggle
  // ─────────────────────────────────────────────────────────
  const watchlistEntry = watchlist?.find(w => w.videoId === contentKey)

  const handleWatchlistToggle = () => {
    if (!stream || !contentKey) return
    if (watchlistEntry) {
      removeFromWatchlist.mutate(watchlistEntry.id)
    } else {
      addToWatchlist.mutate({
        videoId: contentKey,
        title: stream.title,
        uploader: stream.uploader,
        thumbnailUrl: stream.thumbnailUrl,
        duration: stream.duration,
      })
    }
  }

  // ─────────────────────────────────────────────────────────
  // Subscribe / unsubscribe
  // ─────────────────────────────────────────────────────────
  const sub = subscriptions?.find(s => s.channelId === contentKey)

  const handleSubscribeToggle = () => {
    if (!stream || !stream.uploaderUrl) return
    if (sub) {
      unsubscribe.mutate(sub.id)
    } else {
      subscribe.mutate({
        channelId: contentKey,
        channelName: stream.uploader,
        channelUrl: stream.uploaderUrl,
        avatarUrl: '',
      })
    }
  }

  // ─────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────
  if (!contentUrl) {
    return <ErrorMessage message="No video URL provided." />
  }
  if (isLoading) return <LoadingSpinner text="Loading video..." />
  if (isError || !stream) return <ErrorMessage message="Could not load video." onRetry={refetch} />

  return (
    <div className="flex flex-col lg:flex-row gap-6 p-6 max-w-screen-2xl mx-auto">

      {/* ── Left column: player + info ────────────────────── */}
      <div className="flex-1 min-w-0">

        {/* ── Video player ──────────────────────────────── */}
        <div className="aspect-video bg-black rounded-xl overflow-hidden relative">
          {playbackUrl ? (
            <video
              ref={videoRef}
              key={playbackUrl}
              src={useHls ? undefined : playbackUrl}
              controls
              autoPlay
              playsInline
              className="w-full h-full"
              onTimeUpdate={handleTimeUpdate}
              onVolumeChange={handleVolumeChange}
              onRateChange={handleRateChange}
              onEnded={handleEnded}
            >
              {selectedSubtitle && subtitlesEnabled && !useHls && (
                <track
                  ref={trackRef}
                  kind="subtitles"
                  src={proxyMediaUrl(selectedSubtitle.url)}
                  srcLang={selectedSubtitle.languageCode}
                  label={selectedSubtitle.languageName}
                  default
                />
              )}
            </video>
          ) : (
            <div className="flex items-center justify-center h-full text-neutral-400">
              No playable stream found
            </div>
          )}

          {/* SponsorBlock skip toast — shown briefly when a segment is skipped */}
          {lastSkipLabel && (
            <div className="absolute bottom-14 right-4 bg-black/90 text-white
                            text-xs px-3 py-1.5 rounded-lg flex items-center gap-1.5
                            animate-fade-in">
              <SkipForward size={12} className="text-yellow-400" />
              Skipped: <span className="capitalize text-yellow-400">{lastSkipLabel}</span>
            </div>
          )}
        </div>

        {/* ── Player toolbar ─────────────────────────────── */}
        <div className="mt-3 flex items-center gap-2 flex-wrap">

          {/* Playlist prev / next */}
          {playlistUrl && queue.length > 0 && (
            <>
              <button
                onClick={() => goToQueueItem(prevInQueue)}
                disabled={!prevInQueue}
                title="Previous in playlist"
                className="p-2 rounded-lg bg-neutral-800 text-neutral-300 hover:bg-neutral-700
                           disabled:opacity-40 disabled:hover:bg-neutral-800 transition-colors"
              >
                <SkipBack size={15} />
              </button>
              <button
                onClick={() => goToQueueItem(nextInQueue)}
                disabled={!nextInQueue}
                title="Next in playlist"
                className="p-2 rounded-lg bg-neutral-800 text-neutral-300 hover:bg-neutral-700
                           disabled:opacity-40 disabled:hover:bg-neutral-800 transition-colors"
              >
                <SkipForward size={15} />
              </button>
            </>
          )}

          {/* Picture-in-Picture */}
          {document.pictureInPictureEnabled && (
            <button
              onClick={handlePiP}
              title="Picture in Picture"
              className={`p-2 rounded-lg transition-colors text-sm flex items-center gap-1.5
                ${isPiP ? 'bg-red-600 text-white' : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'}`}
            >
              <PictureInPicture2 size={15} />
              <span className="hidden sm:inline">PiP</span>
            </button>
          )}

          {/* Background audio mode */}
          <button
            onClick={handleBackgroundAudio}
            title="Background audio only"
            className={`p-2 rounded-lg transition-colors text-sm flex items-center gap-1.5
              ${backgroundAudioMode ? 'bg-red-600 text-white' : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'}`}
          >
            <Headphones size={15} />
            <span className="hidden sm:inline">{backgroundAudioMode ? 'Audio' : 'Audio only'}</span>
          </button>

          {/* Subtitle toggle (only shown if subtitles are available) */}
          {stream.subtitles.length > 0 && (
            <button
              onClick={() => setSubtitlesEnabled(!subtitlesEnabled)}
              title="Toggle subtitles"
              className={`p-2 rounded-lg transition-colors text-sm flex items-center gap-1.5
                ${subtitlesEnabled ? 'bg-red-600 text-white' : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'}`}
            >
              <Subtitles size={15} />
              <span className="hidden sm:inline">CC</span>
            </button>
          )}

          {/* SponsorBlock indicator (read-only — configure in Settings) */}
          {sponsorBlockEnabled && (
            <div
              title={`SponsorBlock active — ${skippedCount} segments skipped`}
              className="p-2 rounded-lg bg-yellow-600/20 text-yellow-400 text-sm
                         flex items-center gap-1.5 cursor-default"
            >
              <SkipForward size={15} />
              <span className="hidden sm:inline">SponsorBlock {skippedCount > 0 ? `(${skippedCount})` : ''}</span>
            </div>
          )}
        </div>

        {/* ── Quality selector ───────────────────────────── */}
        {stream.videoStreams.filter(s => !s.isVideoOnly).length > 0 && !backgroundAudioMode && (
          <div className="mt-3 flex items-center gap-2 flex-wrap">
            <span className="text-xs text-neutral-400">Quality:</span>
            {stream.videoStreams
              .filter(s => !s.isVideoOnly)
              .map(s => (
                <button
                  key={s.url}
                  onClick={() => {
                    setSelectedStream(s)
                    setUseHls(isHlsSource(s.url, s.format))
                    setHlsSourceUrl(null)
                  }}
                  className={`text-xs px-2.5 py-1 rounded-lg transition-colors
                    ${selectedStream?.url === s.url
                      ? 'bg-red-600 text-white'
                      : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'}`}
                >
                  {s.quality}
                </button>
              ))}
          </div>
        )}

        {/* ── Subtitle track selector ────────────────────── */}
        {subtitlesEnabled && stream.subtitles.length > 0 && (
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            <span className="text-xs text-neutral-400">Subtitles:</span>
            {stream.subtitles.map(sub => (
              <button
                key={sub.languageCode}
                onClick={() => setSelectedSubtitle(sub)}
                className={`text-xs px-2.5 py-1 rounded-lg transition-colors
                  ${selectedSubtitle?.languageCode === sub.languageCode
                    ? 'bg-red-600 text-white'
                    : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'}`}
              >
                {sub.languageName}
                {sub.isAutoGenerated && ' (auto)'}
              </button>
            ))}
          </div>
        )}

        {/* ── Title and action buttons ───────────────────── */}
        <div className="mt-4">
          <h1 className="text-xl font-bold leading-snug">{stream.title}</h1>

          <div className="flex items-center justify-between mt-3 flex-wrap gap-3">
            {/* Channel link */}
            <Link
              to={`/channel/${id}`}
              className="text-sm text-neutral-300 hover:text-white transition-colors font-medium"
            >
              {stream.uploader}
            </Link>

            {/* Action buttons */}
            <div className="flex items-center gap-2 flex-wrap">

              {/* Subscribe / Unsubscribe */}
              <button
                onClick={handleSubscribeToggle}
                className={sub ? 'btn-secondary' : 'btn-primary'}
              >
                {sub
                  ? <><BellOff size={14} className="inline mr-1" />Subscribed</>
                  : <><Bell size={14} className="inline mr-1" />Subscribe</>
                }
              </button>

              {/* Watchlist toggle */}
              <button
                onClick={handleWatchlistToggle}
                title={watchlistEntry ? 'Remove from watchlist' : 'Add to watchlist'}
                className="btn-secondary"
              >
                {watchlistEntry
                  ? <BookmarkCheck size={14} className="inline mr-1 text-red-400" />
                  : <BookmarkPlus size={14} className="inline mr-1" />
                }
                {watchlistEntry ? 'Saved' : 'Save'}
              </button>

              {/* Add to playlist */}
              <button
                onClick={() => setShowPlaylistModal(true)}
                title="Add to playlist"
                className="btn-secondary"
              >
                <ListVideo size={14} className="inline mr-1" />
                Playlist
              </button>

              {/* Download */}
              <button onClick={handleDownload} className="btn-secondary">
                <Download size={14} className="inline mr-1" />
                Download
              </button>
            </div>
          </div>
        </div>

        {/* ── Comments section ────────────────────────────── */}
        <div className="mt-6">
          <button
            onClick={() => setShowComments(!showComments)}
            className="btn-secondary"
          >
            <ThumbsUp size={14} className="inline mr-1.5" />
            {showComments ? 'Hide' : 'Show'} Comments
            {comments?.comments.length ? ` (${comments.comments.length})` : ''}
          </button>

          {showComments && (
            <div className="mt-4 space-y-5">
              {!comments?.comments.length && (
                <p className="text-neutral-400 text-sm">No comments available.</p>
              )}
              {comments?.comments.map(comment => (
                <div key={comment.id} className="flex gap-3">
                  <img
                    src={comment.authorAvatarUrl}
                    alt={comment.author}
                    className="w-8 h-8 rounded-full bg-neutral-800 shrink-0 object-cover"
                    onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium">{comment.author}</span>
                      {comment.isPinned && (
                        <span className="text-xs text-neutral-400 bg-neutral-800 px-1.5 py-0.5 rounded">
                          📌 Pinned
                        </span>
                      )}
                      {comment.isHeartedByUploader && (
                        <span className="text-xs text-red-400">❤️ Creator</span>
                      )}
                    </div>
                    <p className="text-sm text-neutral-300 mt-1 whitespace-pre-line">
                      {comment.text}
                    </p>
                    <div className="flex items-center gap-2 mt-1.5 text-xs text-neutral-500">
                      <ThumbsUp size={11} />
                      <span>{comment.likeCount.toLocaleString()}</span>
                      <span>· {comment.publishedDate}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Right column: playlist queue + related videos ─── */}
      <div className="w-full lg:w-96 shrink-0">

        {playlistUrl && (
          <div className="mb-6 bg-neutral-900 rounded-xl overflow-hidden">
            <div className="p-3 border-b border-neutral-800">
              {playlist.info ? (
                <>
                  <Link to={remotePlaylistPath(playlistUrl)} className="font-semibold text-sm hover:text-red-400 line-clamp-2">
                    {playlist.info.name}
                  </Link>
                  <p className="text-xs text-neutral-400 mt-0.5">
                    {playlist.info.uploader && <>{playlist.info.uploader} · </>}
                    {queueIndex >= 0 ? `${queueIndex + 1} / ` : ''}
                    {playlist.info.streamCount >= 0 ? playlist.info.streamCount : queue.length}
                  </p>
                </>
              ) : playlist.isError ? (
                <p className="text-xs text-red-400">Could not load playlist.</p>
              ) : (
                <p className="text-xs text-neutral-400">Loading playlist…</p>
              )}
            </div>
            {queue.length > 0 && (
              <div className="max-h-[420px] overflow-y-auto">
                {queue.map((video, index) => {
                  const isCurrent = index === queueIndex
                  return (
                    <Link
                      key={`${video.id}-${index}`}
                      ref={isCurrent ? currentQueueItemRef : undefined}
                      to={watchPath(video, playlistUrl)}
                      className={`flex items-center gap-2 px-2 py-1.5 text-sm transition-colors
                        ${isCurrent ? 'bg-neutral-800' : 'hover:bg-neutral-800/60'}`}
                    >
                      <span className="w-5 text-center text-xs text-neutral-500 shrink-0">
                        {isCurrent ? '▶' : index + 1}
                      </span>
                      <div className="relative w-24 aspect-video shrink-0 bg-neutral-800 rounded overflow-hidden">
                        <img
                          src={video.thumbnailUrl} alt="" loading="lazy"
                          className="w-full h-full object-cover"
                          onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
                        />
                        <span className="absolute bottom-0.5 right-0.5 bg-black/80 text-white text-[10px] px-1 rounded font-mono">
                          {formatDuration(video.duration)}
                        </span>
                      </div>
                      <div className="min-w-0">
                        <p className={`text-xs leading-snug line-clamp-2 ${isCurrent ? 'font-semibold' : ''}`}>{video.title}</p>
                        <p className="text-[11px] text-neutral-500 truncate">{video.uploader}</p>
                      </div>
                    </Link>
                  )
                })}
                {playlist.hasNextPage && (
                  <button
                    onClick={() => playlist.fetchNextPage()}
                    disabled={playlist.isFetchingNextPage}
                    className="w-full py-2 text-xs text-neutral-400 hover:text-white hover:bg-neutral-800/60"
                  >
                    {playlist.isFetchingNextPage ? 'Loading…' : 'Load more'}
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        <h3 className="text-sm font-semibold text-neutral-400 mb-3 uppercase tracking-wide">
          Up Next
        </h3>
        <div className="space-y-3">
          {stream.relatedVideos.map(video => (
            <VideoCard key={video.id} video={video} />
          ))}
        </div>
      </div>

      {/* ── Add to playlist modal (portal-style overlay) ──── */}
      {showPlaylistModal && stream && id && (
        <AddToPlaylistModal
          videoId={id}
          title={stream.title}
          uploader={stream.uploader}
          thumbnailUrl={stream.thumbnailUrl}
          duration={stream.duration}
          onClose={() => setShowPlaylistModal(false)}
        />
      )}
    </div>
  )
}
