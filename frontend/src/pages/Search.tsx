/**
 * Search.tsx
 *
 * Search results page.
 * Reads ?q= and ?service= from the URL — both set by the Navbar search form.
 * Service label is shown above results so users know where they're searching.
 */

import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { extractorApi } from '../api/client'
import VideoGrid from '../components/video/VideoGrid'
import PlaylistCard from '../components/playlist/PlaylistCard'
import { LoadingSpinner, ErrorMessage, EmptyState } from '../components/common'

export default function Search() {
  const [params]  = useSearchParams()
  const query     = params.get('q') ?? ''
  const service   = params.get('service') ?? 'youtube'

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['search', query, service],
    queryFn:  () => extractorApi.search(query, service),
    enabled:  query.length > 0,
    staleTime: 1000 * 60 * 5,
  })

  if (!query)            return <EmptyState icon="🔍" title="Search for something" />
  if (isLoading)         return <LoadingSpinner text={`Searching ${service} for "${query}"...`} />
  if (isError)           return <ErrorMessage message="Search failed." onRetry={refetch} />
  const playlists = data?.playlists ?? []
  if (!data?.items.length && !playlists.length) return (
    <EmptyState icon="😕" title="No results found"
      subtitle={`Nothing found for "${query}" on ${service}`} />
  )

  return (
    <div className="p-6">
      <p className="text-neutral-400 text-sm mb-4">
        Results for{' '}
        <span className="text-white font-medium">"{query}"</span>
        {' '}on{' '}
        <span className="text-red-400 font-medium capitalize">{service}</span>
      </p>
      {playlists.length > 0 && (
        <section className="mb-8">
          <h2 className="text-sm font-semibold text-neutral-400 mb-3 uppercase tracking-wide">Playlists</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {playlists.map(p => <PlaylistCard key={p.url} playlist={p} />)}
          </div>
        </section>
      )}
      {data!.items.length > 0 && <VideoGrid videos={data!.items} />}
    </div>
  )
}
