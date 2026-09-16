/**
 * RemotePlaylist.tsx
 *
 * A playlist hosted on the service itself (YouTube playlists and mixes),
 * opened via /playlist?url=<playlist url>. Lists the videos with "load more"
 * pagination and lets the user play them in order: every video link carries
 * ?list=<url>, which the Watch page uses to show the queue and autoplay the next item.
 *
 * Local user playlists live at /playlist/:id (PlaylistView.tsx).
 */

import { Link, useSearchParams } from 'react-router-dom'
import { Play, ListVideo } from 'lucide-react'
import { useRemotePlaylist } from '../hooks'
import { LoadingSpinner, ErrorMessage, EmptyState } from '../components/common'
import { thumbnailUrl, watchPath, formatDuration, formatCount, youtubeChannelIdFromUrl } from '../utils/playback'

export default function RemotePlaylist() {
  const [params] = useSearchParams()
  const url = params.get('url') ?? ''
  const {
    info, videos, isLoading, isError, refetch,
    hasNextPage, fetchNextPage, isFetchingNextPage,
  } = useRemotePlaylist(url)

  if (!url) return <ErrorMessage message="No playlist URL provided." />
  if (isLoading) return <LoadingSpinner text="Loading playlist..." />
  if (isError || !info) return <ErrorMessage message="Could not load playlist." onRetry={refetch} />
  if (!videos.length) return <EmptyState icon="🎵" title="Playlist is empty" />

  const channelId = youtubeChannelIdFromUrl(info.uploaderUrl)
  const first = videos[0]

  return (
    <div className="p-6 max-w-screen-xl mx-auto flex flex-col lg:flex-row gap-6">

      {/* ── Playlist header ─────────────────────────────── */}
      <div className="w-full lg:w-80 shrink-0">
        <div className="lg:sticky lg:top-0">
          <div className="aspect-video bg-neutral-800 rounded-xl overflow-hidden">
            <img
              src={thumbnailUrl(info.thumbnailUrl || first.thumbnailUrl)}
              alt={info.name}
              className="w-full h-full object-cover"
              onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
            />
          </div>
          <h1 className="text-xl font-bold mt-4 leading-snug">{info.name}</h1>
          {info.uploader && (
            channelId
              ? <Link to={`/channel/${channelId}`} className="text-sm text-neutral-300 hover:text-white mt-1 block">{info.uploader}</Link>
              : <p className="text-sm text-neutral-300 mt-1">{info.uploader}</p>
          )}
          <p className="text-xs text-neutral-500 mt-1 flex items-center gap-1.5">
            <ListVideo size={12} />
            {info.streamCount >= 0 ? `${formatCount(info.streamCount)} videos` : `${videos.length}+ videos`}
          </p>
          {info.description && (
            <p className="text-sm text-neutral-400 mt-3 whitespace-pre-line line-clamp-6">{info.description}</p>
          )}
          <Link to={watchPath(first, info.url)} className="btn-primary inline-flex items-center gap-2 mt-4">
            <Play size={14} /> Play all
          </Link>
        </div>
      </div>

      {/* ── Video list ──────────────────────────────────── */}
      <div className="flex-1 min-w-0">
        <div className="space-y-2">
          {videos.map((video, index) => (
            <Link
              key={`${video.id}-${index}`}
              to={watchPath(video, info.url)}
              className="flex items-center gap-3 p-2 rounded-xl hover:bg-neutral-800 transition-colors"
            >
              <span className="text-neutral-500 text-sm w-7 text-center shrink-0">{index + 1}</span>
              <div className="relative w-40 aspect-video shrink-0 bg-neutral-800 rounded-lg overflow-hidden">
                <img
                  src={thumbnailUrl(video.thumbnailUrl)} alt=""
                  className="w-full h-full object-cover" loading="lazy"
                  onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
                />
                <span className="absolute bottom-1 right-1 bg-black/80 text-white text-[11px] px-1 rounded font-mono">
                  {formatDuration(video.duration)}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm line-clamp-2 leading-snug">{video.title}</p>
                <p className="text-xs text-neutral-400 mt-1 truncate">
                  {video.uploader}
                  {video.viewCount > 0 && <> · {formatCount(video.viewCount)} views</>}
                  {video.uploadDate && <> · {video.uploadDate}</>}
                </p>
              </div>
            </Link>
          ))}
        </div>

        {hasNextPage && (
          <div className="flex justify-center mt-6">
            <button onClick={() => fetchNextPage()} disabled={isFetchingNextPage} className="btn-secondary">
              {isFetchingNextPage ? 'Loading…' : 'Load more'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
