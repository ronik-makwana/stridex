import { useQuery } from '@tanstack/react-query'
import { tagsApi } from './api'

export const tagKeys = {
  all: ['tags'] as const,
  list: () => [...tagKeys.all, 'list'] as const,
}

/**
 * The whole list, filtered in the browser. Tags are short strings and there are
 * a few hundred at most — a request per keystroke would be slower to answer
 * than the filter it is replacing, and the input has to feel like typing.
 */
export function useTags() {
  return useQuery({
    queryKey: tagKeys.list(),
    queryFn: () => tagsApi.list(),
    staleTime: 5 * 60_000,
  })
}
