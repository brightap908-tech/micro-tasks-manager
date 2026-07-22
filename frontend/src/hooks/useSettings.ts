import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getSetting, setSetting } from '../db/settings'

export function useSetting(key: string) {
  return useQuery({
    queryKey: ['settings', key],
    queryFn: () => getSetting(key),
  })
}

export function useUpsertSetting() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) => setSetting(key, value),
    onSuccess: (_data, vars) => qc.invalidateQueries({ queryKey: ['settings', vars.key] }),
  })
}
