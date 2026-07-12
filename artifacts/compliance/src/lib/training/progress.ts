import { useCallback, useMemo } from "react"
import { useQueryClient } from "@tanstack/react-query"
import {
  useGetTrainingProgress,
  useSetTrainingProgress,
  getGetTrainingProgressQueryKey,
} from "@workspace/api-client-react"

// Client wrapper over the training-progress API. Progress is saved per-user on
// the server (persists across devices). The GET endpoint returns only completed
// items, so membership in the set means "done".
export function useTrainingProgress() {
  const qc = useQueryClient()
  const { data, isLoading } = useGetTrainingProgress()
  const mutation = useSetTrainingProgress()

  const completed = useMemo(() => {
    const set = new Set<string>()
    for (const item of data?.items ?? []) set.add(item.itemKey)
    return set
  }, [data])

  const setComplete = useCallback(
    async (itemKey: string, value: boolean, itemType = "guide") => {
      await mutation.mutateAsync({ data: { itemKey, itemType, completed: value } })
      await qc.invalidateQueries({ queryKey: getGetTrainingProgressQueryKey() })
    },
    [mutation, qc],
  )

  const toggle = useCallback(
    (itemKey: string, itemType = "guide") =>
      setComplete(itemKey, !completed.has(itemKey), itemType),
    [setComplete, completed],
  )

  const isComplete = useCallback((key: string) => completed.has(key), [completed])

  return {
    completed,
    isComplete,
    setComplete,
    toggle,
    isLoading,
    isSaving: mutation.isPending,
  }
}

// How many of the given keys are complete — for progress bars / rollups.
export function countComplete(completed: Set<string>, keys: string[]): number {
  return keys.reduce((n, k) => (completed.has(k) ? n + 1 : n), 0)
}
