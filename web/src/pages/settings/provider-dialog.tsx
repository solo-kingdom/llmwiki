import * as React from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { ArrowUpIcon, CheckIcon, ChevronsUpDownIcon, PlusIcon, RefreshCwIcon, XIcon } from "lucide-react"
import { notify } from "@/components/blocks/notify"
import { Inline, Stack } from "@/components/blocks/surfaces"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  createProviderInstance,
  discoverProviderModels,
  listProviderModels,
  testProviderDraft,
  updateProviderInstance,
} from "@/lib/api"
import {
  MAX_INSTANCE_MODELS,
  mergeModelCandidates,
  normalizeSelectedModels,
  promoteDefaultModel,
  removeSelectedModel,
  toggleSelectedModel,
} from "@/lib/instance-models"
import {
  adapterBaseUrl,
  adapterFromProvider,
  catalogBaseUrl,
  endpointForFormat,
  inferProtocolFromBaseUrl,
  isUsableBaseUrl,
  KNOWN_BASE_URLS,
} from "@/lib/provider-autofill"
import type {
  CatalogStatus,
  Provider,
  ProviderApiFormat,
  ProviderDraftTestResult,
  ProviderInstance,
} from "@/types"

function useDebounced<T>(value: T, delay = 400): T {
  const [debounced, setDebounced] = React.useState(value)
  React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return debounced
}

const API_FORMAT_LABELS: Record<ProviderApiFormat, string> = {
  openai: "OpenAI 兼容",
  anthropic: "Anthropic",
  ollama: "Ollama",
}

export interface ProviderDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: "create" | "edit" | "copy"
  seed?: ProviderInstance | undefined
  providers: Provider[]
  catalogStatus?: CatalogStatus | undefined
  onSyncCatalog?: (() => void) | undefined
  syncingCatalog?: boolean | undefined
  onSaved: () => Promise<void>
}

export function ProviderDialog({
  open,
  onOpenChange,
  mode,
  seed,
  providers,
  catalogStatus,
  onSyncCatalog,
  syncingCatalog,
  onSaved,
}: ProviderDialogProps) {
  const editing = mode === "edit" && seed !== undefined
  const formKey = `${mode}:${seed?.id ?? "new"}:${open ? "1" : "0"}`

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {editing ? "编辑 Provider 实例" : mode === "copy" ? "复制为新 Provider 实例" : "添加 Provider 实例"}
          </DialogTitle>
          <DialogDescription>
            {editing
              ? "修改连接参数或增减可用模型；留空 API Key 则保留已保存的密钥。"
              : "从 models.dev 目录自动填充，或手动填写兼容端点，并选择该实例要使用的模型。"}
          </DialogDescription>
        </DialogHeader>
        {open ? (
          <ProviderDialogForm
            key={formKey}
            mode={mode}
            seed={seed}
            providers={providers}
            catalogStatus={catalogStatus}
            onSyncCatalog={onSyncCatalog}
            syncingCatalog={syncingCatalog}
            onCancel={() => onOpenChange(false)}
            onSaved={async () => {
              onOpenChange(false)
              await onSaved()
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function ProviderDialogForm({
  mode,
  seed,
  providers,
  catalogStatus,
  onSyncCatalog,
  syncingCatalog,
  onCancel,
  onSaved,
}: {
  mode: "create" | "edit" | "copy"
  seed?: ProviderInstance | undefined
  providers: Provider[]
  catalogStatus?: CatalogStatus | undefined
  onSyncCatalog?: (() => void) | undefined
  syncingCatalog?: boolean | undefined
  onCancel: () => void
  onSaved: () => Promise<void>
}) {
  const editing = mode === "edit" && seed !== undefined
  const initialMode: "catalog" | "manual" =
    seed && seed.catalog_id === "custom" ? "manual" : "catalog"

  const [tab, setTab] = React.useState<"catalog" | "manual">(initialMode)
  const [catalogId, setCatalogId] = React.useState(
    seed && seed.catalog_id !== "custom" ? seed.catalog_id : "",
  )
  const initialProvider = providers.find((p) => p.id === catalogId)
  const [name, setName] = React.useState(() =>
    mode === "copy" && seed ? `${seed.name} 副本` : (seed?.name ?? ""),
  )
  const [apiFormat, setApiFormat] = React.useState<ProviderApiFormat>(() => {
    const raw = seed?.api_format || initialProvider?.api_format || "openai"
    return raw === "anthropic" || raw === "ollama" ? raw : "openai"
  })
  const [baseUrl, setBaseUrl] = React.useState(() => seed?.base_url ?? "")
  const [apiKey, setApiKey] = React.useState("")
  const [selectedModels, setSelectedModels] = React.useState<string[]>(() =>
    normalizeSelectedModels(seed?.models ?? []),
  )
  const [nameTouched, setNameTouched] = React.useState(Boolean(seed?.name))
  const [providerOpen, setProviderOpen] = React.useState(false)
  const [modelsOpen, setModelsOpen] = React.useState(false)
  const [modelQuery, setModelQuery] = React.useState("")
  const [testResult, setTestResult] = React.useState<ProviderDraftTestResult | undefined>()

  const selectedProvider = providers.find((p) => p.id === catalogId)
  const autoBase = catalogBaseUrl(selectedProvider, apiFormat)
  const baseUrlValid = isUsableBaseUrl(baseUrl)
  const inferredProtocol = inferProtocolFromBaseUrl(baseUrl)
  const protocolMismatch =
    baseUrlValid && inferredProtocol !== undefined && inferredProtocol !== apiFormat
      ? inferredProtocol
      : undefined
  const protocolFixUrl =
    protocolMismatch !== undefined ? endpointForFormat(baseUrl, apiFormat) : undefined

  const catalogModelsQuery = useQuery({
    queryKey: ["provider-models", catalogId],
    queryFn: () => listProviderModels(catalogId),
    enabled: tab === "catalog" && catalogId !== "",
  })

  const baseUrlFromCatalog = autoBase !== undefined && baseUrl.trim() === autoBase.url
  // The stored key may follow a catalog endpoint of the same provider (protocol switch),
  // but never an arbitrary URL or a different provider's endpoint.
  const sameCatalogProvider =
    seed !== undefined && tab === "catalog" && catalogId === seed.catalog_id
  const usingStoredCredential =
    editing &&
    seed !== undefined &&
    apiKey.trim() === "" &&
    (baseUrl.trim() === seed.base_url.trim() || (sameCatalogProvider && baseUrlFromCatalog))
  const liveKey = useDebounced(
    `${apiFormat}\u0000${baseUrl.trim()}\u0000${apiKey.length}`,
    500,
  )
  const liveDiscoveryEnabled =
    baseUrlValid && (usingStoredCredential || apiFormat === "ollama" || apiKey.trim() !== "")

  const liveModelsQuery = useQuery({
    queryKey: [
      "provider-live-models",
      usingStoredCredential ? seed?.id : "draft",
      usingStoredCredential ? `${apiFormat}\u0000${baseUrl.trim()}` : liveKey,
    ],
    queryFn: () =>
      usingStoredCredential && seed
        ? discoverProviderModels({
            instance_id: seed.id,
            api_format: apiFormat,
            base_url: baseUrl.trim(),
          })
        : discoverProviderModels({
            catalog_id: tab === "catalog" && catalogId ? catalogId : "custom",
            api_format: apiFormat,
            base_url: baseUrl.trim(),
            ...(apiKey.trim() ? { api_key: apiKey.trim() } : {}),
          }),
    enabled: liveDiscoveryEnabled,
    retry: false,
    staleTime: 5 * 60_000,
  })

  const catalogModelList = catalogModelsQuery.data ?? []
  const catalogById = React.useMemo(
    () => new Map(catalogModelList.map((m) => [m.model_id, m])),
    [catalogModelList],
  )
  const liveModels = liveModelsQuery.data?.models ?? []
  const allCandidates = React.useMemo(
    () =>
      mergeModelCandidates(
        catalogModelList.map((m) => m.model_id),
        liveModels,
      ),
    [catalogModelList, liveModels],
  )

  const saveMutation = useMutation({
    mutationFn: async () => {
      const effectiveCatalogId = tab === "catalog" && catalogId ? catalogId : "custom"
      const payload = {
        name: name.trim(),
        catalog_id: effectiveCatalogId,
        api_format: apiFormat,
        base_url: baseUrl.trim(),
        models: selectedModels,
        ...(apiKey.trim() ? { api_key: apiKey.trim() } : {}),
      }
      if (editing && seed) {
        return updateProviderInstance(seed.id, payload)
      }
      return createProviderInstance(payload)
    },
    onSuccess: async () => {
      notify.success(editing ? "已更新 Provider 实例" : "已添加 Provider 实例")
      await onSaved()
    },
    onError: (error) => notify.error(error, editing ? "保存失败" : "添加失败"),
  })

  const testMutation = useMutation({
    mutationFn: () =>
      testProviderDraft({
        ...(usingStoredCredential && seed ? { instance_id: seed.id } : {}),
        catalog_id: tab === "catalog" && catalogId ? catalogId : "custom",
        api_format: apiFormat,
        base_url: baseUrl.trim(),
        ...(apiKey.trim() ? { api_key: apiKey.trim() } : {}),
        ...(selectedModels[0] ? { model_id: selectedModels[0] } : {}),
      }),
    onSuccess: (result) => setTestResult(result),
    onError: (error) => notify.error(error, "测试连接失败"),
  })

  const pickProvider = (provider: Provider) => {
    const nextFormat = adapterFromProvider(provider)
    const nextAuto = catalogBaseUrl(provider, nextFormat)
    const changed = provider.id !== catalogId
    setCatalogId(provider.id)
    setApiFormat(nextFormat)
    if (!nameTouched) setName(provider.name)
    // Switching provider always adopts its catalog endpoint for the selected protocol,
    // even in edit mode: an endpoint left over from another provider/format is wrong.
    if (nextAuto) setBaseUrl(nextAuto.url)
    if (changed && !editing) {
      setSelectedModels([])
    }
    setTestResult(undefined)
    setProviderOpen(false)
  }

  const changeFormat = (nextFormat: ProviderApiFormat) => {
    setApiFormat(nextFormat)
    // The protocol decides the endpoint: always recompute it from the catalog. Previously
    // a seeded base URL counted as "touched", so edit mode never followed a protocol change.
    const nextUrl =
      catalogBaseUrl(selectedProvider, nextFormat)?.url ??
      endpointForFormat(baseUrl, nextFormat) ??
      adapterBaseUrl(nextFormat, catalogId || undefined, baseUrl)
    if (nextUrl) setBaseUrl(nextUrl)
    setTestResult(undefined)
  }

  const apiKeyRequired = !editing && apiFormat !== "ollama"
  const canSubmit =
    name.trim() !== "" &&
    baseUrlValid &&
    selectedModels.length > 0 &&
    (!apiKeyRequired || apiKey.trim() !== "") &&
    !saveMutation.isPending

  const trimmedQuery = modelQuery.trim()
  const exactInCandidates = allCandidates.some(
    (id) => id.toLowerCase() === trimmedQuery.toLowerCase(),
  )

  return (
    <Stack gap="md">
      <Tabs
        value={tab}
        onValueChange={(next) => {
          setTab(next as "catalog" | "manual")
          setTestResult(undefined)
        }}
      >
        <TabsList className="w-full">
          <TabsTrigger value="catalog">来自 models.dev</TabsTrigger>
          <TabsTrigger value="manual">手动配置</TabsTrigger>
        </TabsList>
      </Tabs>

      {tab === "catalog" && catalogStatus && catalogStatus.availability !== "available" ? (
        <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          <span>
            {catalogStatus.availability === "empty"
              ? "目录缓存为空，请先同步 models.dev 或切换到手动配置。"
              : `当前使用内置快照（${catalogStatus.provider_count} 个供应商），可同步获取最新目录。`}
          </span>
          {onSyncCatalog ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={syncingCatalog}
              onClick={onSyncCatalog}
            >
              <RefreshCwIcon className={syncingCatalog ? "animate-spin" : ""} />
              立即同步
            </Button>
          ) : null}
        </div>
      ) : null}

      {tab === "catalog" ? (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <Label>供应商</Label>
            <span className="text-xs text-muted-foreground">
              目录共 {providers.length} 个供应商
            </span>
          </div>
          <Popover open={providerOpen} onOpenChange={setProviderOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                role="combobox"
                aria-expanded={providerOpen}
                className="w-full justify-between font-normal"
              >
                <span className="truncate">
                  {selectedProvider ? `${selectedProvider.name} (${selectedProvider.id})` : "搜索并选择供应商…"}
                </span>
                <ChevronsUpDownIcon className="opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-(--radix-popover-trigger-width) p-0">
              <Command>
                <CommandInput placeholder="输入供应商名称或 ID…" />
                <CommandList>
                  <CommandEmpty>没有匹配的供应商</CommandEmpty>
                  <CommandGroup>
                    {providers.map((provider) => {
                      const hasEndpoint =
                        Boolean(provider.api_base) || Boolean(KNOWN_BASE_URLS[provider.id])
                      return (
                        <CommandItem
                          key={provider.id}
                          value={`${provider.name} ${provider.id}`}
                          data-checked={provider.id === catalogId ? "true" : undefined}
                          onSelect={() => pickProvider(provider)}
                        >
                          <div className="flex min-w-0 flex-1 items-center gap-2">
                            <span className="truncate">{provider.name}</span>
                            <span className="truncate text-xs text-muted-foreground">
                              {provider.id}
                            </span>
                          </div>
                          {!hasEndpoint ? (
                            <Badge variant="outline" className="text-[10px]">
                              无默认端点
                            </Badge>
                          ) : null}
                        </CommandItem>
                      )
                    })}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="provider-base-url">Base URL</Label>
            {autoBase && baseUrl.trim() !== autoBase.url ? (
              <button
                type="button"
                className="text-xs text-primary hover:underline"
                onClick={() => {
                  setBaseUrl(autoBase.url)
                  setTestResult(undefined)
                }}
              >
                使用目录默认值
              </button>
            ) : null}
          </div>
          <Input
            id="provider-base-url"
            placeholder="https://api.openai.com/v1"
            value={baseUrl}
            onChange={(event) => {
              setBaseUrl(event.target.value)
              setTestResult(undefined)
            }}
          />
          {baseUrl !== "" && !baseUrlValid ? (
            <span className="text-xs text-destructive">请输入有效的 http:// 或 https:// 地址</span>
          ) : protocolMismatch ? (
            <Inline gap="sm" wrap>
              <span className="text-xs text-destructive">
                该地址是 {API_FORMAT_LABELS[protocolMismatch]} 端点，与当前协议格式（
                {API_FORMAT_LABELS[apiFormat]}）不匹配，请求可能返回 401。
              </span>
              {protocolFixUrl ? (
                <button
                  type="button"
                  className="text-xs text-destructive underline underline-offset-2"
                  onClick={() => {
                    setBaseUrl(protocolFixUrl)
                    setTestResult(undefined)
                  }}
                >
                  改用 {protocolFixUrl}
                </button>
              ) : null}
            </Inline>
          ) : autoBase ? (
            <span className="text-xs text-muted-foreground">
              {autoBase.source === "provider" ? "来自 models.dev 端点" : "来自已知默认端点"}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">支持 https:// 或本地 http:// 端点</span>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>协议格式</Label>
          <Select value={apiFormat} onValueChange={(v) => changeFormat(v as ProviderApiFormat)}>
            <SelectTrigger aria-label="协议格式" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="openai">OpenAI 兼容</SelectItem>
              <SelectItem value="anthropic">Anthropic</SelectItem>
              <SelectItem value="ollama">Ollama</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="provider-instance-name">实例名称</Label>
          <Input
            id="provider-instance-name"
            placeholder="例如：DeepSeek 主力"
            value={name}
            onChange={(event) => {
              setName(event.target.value)
              setNameTouched(true)
            }}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="provider-api-key">
            API Key {apiFormat === "ollama" ? "（Ollama 可选）" : ""}
          </Label>
          <Input
            id="provider-api-key"
            type="password"
            autoComplete="off"
            placeholder={editing ? "••••••••（留空保持不变）" : "sk-..."}
            value={apiKey}
            onChange={(event) => {
              setApiKey(event.target.value)
              setTestResult(undefined)
            }}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <Label>使用的模型 · {selectedModels.length} 个</Label>
          <span className="text-xs text-muted-foreground">
            {liveModelsQuery.isFetching
              ? "正在从端点拉取模型…"
              : liveModelsQuery.isSuccess
                ? `端点返回 ${liveModels.length} 个模型`
                : liveModelsQuery.isError
                  ? "端点模型列表不可用，显示目录候选"
                  : "可选自目录或端点 /models"}
          </span>
        </div>

        <Popover open={modelsOpen} onOpenChange={setModelsOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              role="combobox"
              aria-expanded={modelsOpen}
              disabled={selectedModels.length >= MAX_INSTANCE_MODELS}
              className="w-full justify-between font-normal"
            >
              <span className="truncate text-muted-foreground">
                {selectedModels.length >= MAX_INSTANCE_MODELS
                  ? `已达上限 ${MAX_INSTANCE_MODELS} 个模型`
                  : "搜索并勾选要使用的模型…"}
              </span>
              <ChevronsUpDownIcon className="opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-(--radix-popover-trigger-width) p-0">
            <Command shouldFilter={false}>
              <CommandInput
                placeholder="输入模型 ID 或名称筛选，也可直接添加自定义 ID…"
                value={modelQuery}
                onValueChange={setModelQuery}
              />
              <CommandList>
                {allCandidates
                  .filter((id) => {
                    if (!trimmedQuery) return true
                    const info = catalogById.get(id)
                    const needle = trimmedQuery.toLowerCase()
                    return (
                      id.toLowerCase().includes(needle) ||
                      (info?.name.toLowerCase().includes(needle) ?? false)
                    )
                  })
                  .slice(0, 100)
                  .map((id) => {
                    const info = catalogById.get(id)
                    const checked = selectedModels.includes(id)
                    return (
                      <CommandItem
                        key={id}
                        value={id}
                        data-checked={checked ? "true" : undefined}
                        onSelect={() => setSelectedModels((cur) => toggleSelectedModel(cur, id))}
                      >
                        <div className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate text-sm">{info?.name || id}</span>
                          {info?.name && info.name !== id ? (
                            <span className="truncate font-mono text-xs text-muted-foreground">
                              {id}
                            </span>
                          ) : null}
                        </div>
                        {checked ? <CheckIcon className="size-4 text-primary" /> : null}
                      </CommandItem>
                    )
                  })}
                {trimmedQuery !== "" && !exactInCandidates ? (
                  <CommandItem
                    value={`__custom__:${trimmedQuery}`}
                    onSelect={() => {
                      setSelectedModels((cur) =>
                        cur.includes(trimmedQuery) ? cur : toggleSelectedModel(cur, trimmedQuery),
                      )
                      setModelQuery("")
                    }}
                  >
                    <PlusIcon className="size-4" />
                    <span>添加自定义模型：{trimmedQuery}</span>
                  </CommandItem>
                ) : null}
                {allCandidates.length === 0 && trimmedQuery === "" ? (
                  <CommandEmpty>
                    暂无候选模型，可先填写 Base URL 与 API Key，或直接输入模型 ID 添加。
                  </CommandEmpty>
                ) : null}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>

        {selectedModels.length > 0 ? (
          <div className="divide-y divide-border rounded-md border border-border">
            {selectedModels.map((id, index) => (
              <div key={id} className="flex items-center gap-2 px-2.5 py-1.5 text-xs">
                <span className="min-w-0 flex-1 truncate font-mono">{id}</span>
                {index === 0 ? (
                  <Badge variant="secondary">首选</Badge>
                ) : (
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    title="设为首选"
                    aria-label={`将 ${id} 设为首选`}
                    onClick={() => setSelectedModels((cur) => promoteDefaultModel(cur, id))}
                  >
                    <ArrowUpIcon />
                  </Button>
                )}
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  title={`移除 ${id}`}
                  aria-label={`移除 ${id}`}
                  onClick={() => setSelectedModels((cur) => removeSelectedModel(cur, id))}
                >
                  <XIcon />
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">
            请至少选择一个模型，保存后「默认模型」与「摄入任务模型」将从这些模型中选择。
          </span>
        )}
      </div>

      <Inline gap="sm">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!baseUrlValid || testMutation.isPending}
          onClick={() => testMutation.mutate()}
        >
          {testMutation.isPending ? "测试中…" : "测试连接"}
        </Button>
        {testResult ? (
          <span
            className={
              testResult.status === "ok"
                ? "text-xs text-emerald-600 dark:text-emerald-400"
                : testResult.status === "unauthorized"
                  ? "text-xs text-destructive"
                  : "text-xs text-amber-600 dark:text-amber-400"
            }
          >
            {testResult.message}
          </span>
        ) : null}
      </Inline>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          取消
        </Button>
        <Button type="button" disabled={!canSubmit} onClick={() => saveMutation.mutate()}>
          {saveMutation.isPending ? "保存中…" : editing ? "保存" : "添加"}
        </Button>
      </DialogFooter>
    </Stack>
  )
}
