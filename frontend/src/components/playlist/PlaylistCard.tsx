/**
 * PlaylistCard.tsx
 *
 * A remote (YouTube) playlist as it appears in search results.
 * Clicking opens the playlist page, which lists its videos and offers "Play all".
 */

import { useNavigate } from 'react-router-dom'
import { ListVideo } from 'lucide-react'
import { remotePlaylistPath, thumbnailUrl } from '../../utils/playback'
import type { RemotePlaylistItem } from '../../types'

export default function PlaylistCard({ playlist }: { playlist: RemotePlaylistItem }) {
  const navigate = useNavigate()

  return (
    <div onClick={() => navigate(remotePlaylistPath(playlist.url))} className="card group cursor-pointer">
      <div className="relative aspect-video bg-neutral-800">
        <img
          src={thumbnailUrl(playlist.thumbnailUrl)}
          alt={playlist.name}
          className="w-full h-full object-cover"
          loading="lazy"
          onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
        />
        {/* Stacked-list overlay on the right, like YouTube's playlist tiles */}
        <div className="absolute inset-y-0 right-0 w-2/5 bg-black/75 flex flex-col items-center
                        justify-center gap-1 text-white">
          <ListVideo size={22} />
          <span className="text-xs font-medium">
            {playlist.streamCount >= 0 ? `${playlist.streamCount} videos` : 'Playlist'}
          </span>
        </div>
      </div>

      <div className="p-3">
        <h3 className="text-sm font-medium line-clamp-2 text-white
                       group-hover:text-red-400 transition-colors leading-snug mb-1">
          {playlist.name}
        </h3>
        {playlist.uploader && (
          <p className="text-xs text-neutral-400 truncate">{playlist.uploader}</p>
        )}
      </div>
    </div>
  )
}
