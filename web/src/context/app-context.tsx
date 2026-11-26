import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import {
  getCapabilities,
  getSettings,
  getWorkspace,
  listACPAgents,
  listHarnessDescriptors,
  listProviderInstances,
  listProviders,
} from "@/lib/api"
import type {
  ACPAgent,
  CapabilitiesResponse,
  HarnessDescriptor,
  Provider,
  ProviderInstance,
  Settings,
  WorkspaceOverview,
} from "@/types"

export interface AppContextValue {
  workspace: WorkspaceOverview | undefined
  settings: Settings | undefined
  capabilities: CapabilitiesResponse | undefined
  instances: ProviderInstance[]
  providers: Provider[]
  acpAgents: ACPAgent[]
  harnessDescriptors: HarnessDescriptor[]
  isLoading: boolean
  error: Error | null
  refresh: () => Promise<void>
}

const AppContext = React.createContext<AppContextValue | null>(null)

export function AppProvider({ children }: { children: React.ReactNode }) {
  const workspaceQuery = useQuery({ queryKey: ["workspace"], queryFn: getWorkspace })
  const settingsQuery = useQuery({ queryKey: ["settings"], queryFn: getSettings })
  const capabilitiesQuery = useQuery({ queryKey: ["capabilities"], queryFn: getCapabilities })
  const instancesQuery = useQuery({ queryKey: ["provider-instances"], queryFn: listProviderInstances })
  const providersQuery = useQuery({ queryKey: ["providers"], queryFn: listProviders })
  const acpQuery = useQuery({ queryKey: ["acp-agents"], queryFn: listACPAgents })
  const descriptorsQuery = useQuery({ queryKey: ["harness-descriptors"], queryFn: listHarnessDescriptors })

  const queries = React.useMemo(
    () => [workspaceQuery, settingsQuery, capabilitiesQuery, instancesQuery, providersQuery, acpQuery, descriptorsQuery],
    [workspaceQuery, settingsQuery, capabilitiesQuery, instancesQuery, providersQuery, acpQuery, descriptorsQuery],
  )
  const error = queries.find((query) => query.error !== null)?.error ?? null
  const isLoading = queries.some((query) => query.isLoading)

  const refresh = React.useCallback(async () => {
    await Promise.all(queries.map((query) => query.refetch()))
  }, [queries])

  const value = React.useMemo<AppContextValue>(
    () => ({
      workspace: workspaceQuery.data,
      settings: settingsQuery.data,
      capabilities: capabilitiesQuery.data,
      instances: instancesQuery.data?.instances ?? [],
      providers: providersQuery.data ?? [],
      acpAgents: acpQuery.data?.agents ?? [],
      harnessDescriptors: descriptorsQuery.data?.descriptors ?? [],
      isLoading,
      error: error instanceof Error ? error : null,
      refresh,
    }),
    [
      workspaceQuery.data,
      settingsQuery.data,
      capabilitiesQuery.data,
      instancesQuery.data,
      providersQuery.data,
      acpQuery.data,
      descriptorsQuery.data,
      isLoading,
      error,
      refresh,
    ],
  )

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp(): AppContextValue {
  const value = React.useContext(AppContext)
  if (value === null) throw new Error("useApp must be used inside AppProvider")
  return value
}
