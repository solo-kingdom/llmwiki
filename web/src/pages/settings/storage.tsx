import * as React from "react"
import { useMutation } from "@tanstack/react-query"
import { AlertCircleIcon, CheckCircle2Icon, PlugZapIcon } from "lucide-react"
import { notify } from "@/components/blocks/notify"
import { RowsSkeleton } from "@/components/blocks/state-boundary"
import { Actions, Inline, Panel, Rows, Section, Stack } from "@/components/blocks/surfaces"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { useApp } from "@/context/app-context"
import { checkArchiveStorage } from "@/lib/api"
import type { ArchiveStorageCheckResult, Settings } from "@/types"
import { SettingRow, useSettingsSave } from "./shared"

export function StorageSection() {
  const { settings } = useApp()
  if (settings === undefined) return <RowsSkeleton rows={8} />
  return <StorageForm key={settings.archive_storage_backend ?? "local"} settings={settings} />
}

function StorageForm({ settings }: { settings: Settings }) {
  const save = useSettingsSave()
  const [checkResult, setCheckResult] = React.useState<ArchiveStorageCheckResult | null>(null)

  const initialBytes = Number.parseInt(settings.archive_inline_max_bytes ?? "131072", 10)
  const [inlineKb, setInlineKb] = React.useState(() =>
    String(Math.round((Number.isFinite(initialBytes) ? initialBytes : 131072) / 1024)),
  )
  const [backend, setBackend] = React.useState<"local" | "s3">(
    settings.archive_storage_backend === "s3" ? "s3" : "local",
  )
  const [localDir, setLocalDir] = React.useState(settings.archive_local_dir ?? "")
  const [s3Endpoint, setS3Endpoint] = React.useState(settings.archive_s3_endpoint ?? "")
  const [s3Region, setS3Region] = React.useState(settings.archive_s3_region || "us-east-1")
  const [s3Bucket, setS3Bucket] = React.useState(settings.archive_s3_bucket ?? "")
  const [s3Prefix, setS3Prefix] = React.useState(settings.archive_s3_prefix ?? "")
  const [s3AccessKeyId, setS3AccessKeyId] = React.useState("")
  const [s3SecretAccessKey, setS3SecretAccessKey] = React.useState("")
  const [s3ForcePathStyle, setS3ForcePathStyle] = React.useState(
    Boolean(settings.archive_s3_force_path_style),
  )

  const checkMut = useMutation({
    mutationFn: () =>
      checkArchiveStorage({
        archive_storage_backend: backend,
        archive_local_dir: localDir,
        archive_s3_endpoint: s3Endpoint,
        archive_s3_region: s3Region,
        archive_s3_bucket: s3Bucket,
        archive_s3_prefix: s3Prefix,
        archive_s3_access_key_id: s3AccessKeyId,
        archive_s3_secret_access_key: s3SecretAccessKey,
        archive_s3_force_path_style: s3ForcePathStyle,
      }),
    onSuccess: (res) => {
      setCheckResult(res)
      if (res.ok) notify.success(res.message)
      else notify.error(new Error(res.message), "存储连通性检查失败")
    },
    onError: (err: Error) => notify.error(err, "连通性测试失败"),
  })

  function saveInlineKb() {
    const kb = Number.parseInt(inlineKb.trim(), 10)
    if (!Number.isFinite(kb) || kb < 0 || kb > 10240) {
      notify.error(new Error("阈值需在 0 ~ 10240 KB 之间"))
      return
    }
    save.mutate({ archive_inline_max_bytes: String(kb * 1024) })
  }

  return (
    <Stack gap="lg">
      <Section
        size="lg"
        gap="lg"
        title="档案存储"
        description="小文件直接存入数据库；超过阈值的大文件（及编辑后超限的文件）自动存放到本地目录或对象存储。"
      >
        <Panel padding="none">
          <Rows label="分层策略">
            <SettingRow
              label="小文件入库阈值 (KB)"
              description="默认 128 KB；≤ 此大小直接存数据库，超出自动落大文件存储"
              control={
                <Input
                  aria-label="小文件入库阈值"
                  type="number"
                  min={0}
                  max={10240}
                  className="w-36"
                  value={inlineKb}
                  onChange={(e) => setInlineKb(e.target.value)}
                  onBlur={saveInlineKb}
                />
              }
            />
            <SettingRow
              label="大文件存储方式"
              description="切换后新上传或超限文件生效，既有文件仍按原位置读取"
              control={
                <Select
                  value={backend}
                  onValueChange={(value) => {
                    const next = value === "s3" ? "s3" : "local"
                    setBackend(next)
                    setCheckResult(null)
                    save.mutate({ archive_storage_backend: next })
                  }}
                >
                  <SelectTrigger aria-label="大文件存储方式" className="w-52">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="local">本地目录 (local)</SelectItem>
                    <SelectItem value="s3">对象存储 (S3 / OSS / MinIO)</SelectItem>
                  </SelectContent>
                </Select>
              }
            />
            {backend === "local" ? (
              <SettingRow
                label="本地存储路径"
                description={`留空默认使用 ${settings.archive_local_dir_effective || "<workspace>/.archive-blobs"}`}
                control={
                  <Input
                    aria-label="本地存储路径"
                    className="w-64 max-sm:w-full"
                    placeholder={settings.archive_local_dir_effective || "<workspace>/.archive-blobs"}
                    value={localDir}
                    onChange={(e) => setLocalDir(e.target.value)}
                    onBlur={() => save.mutate({ archive_local_dir: localDir.trim() })}
                  />
                }
              />
            ) : (
              <>
                <SettingRow
                  label="Endpoint"
                  description="S3 / 阿里云 OSS / MinIO 服务端点（AWS 可留空）"
                  control={
                    <Input
                      aria-label="S3 Endpoint"
                      className="w-64 max-sm:w-full"
                      placeholder="https://oss-cn-hangzhou.aliyuncs.com"
                      value={s3Endpoint}
                      onChange={(e) => setS3Endpoint(e.target.value)}
                      onBlur={() => save.mutate({ archive_s3_endpoint: s3Endpoint.trim() })}
                    />
                  }
                />
                <SettingRow
                  label="Region"
                  control={
                    <Input
                      aria-label="S3 Region"
                      className="w-52 max-sm:w-full"
                      placeholder="us-east-1"
                      value={s3Region}
                      onChange={(e) => setS3Region(e.target.value)}
                      onBlur={() => save.mutate({ archive_s3_region: s3Region.trim() || "us-east-1" })}
                    />
                  }
                />
                <SettingRow
                  label="Bucket"
                  control={
                    <Input
                      aria-label="S3 Bucket"
                      className="w-52 max-sm:w-full"
                      placeholder="my-llmwiki-archives"
                      value={s3Bucket}
                      onChange={(e) => setS3Bucket(e.target.value)}
                      onBlur={() => save.mutate({ archive_s3_bucket: s3Bucket.trim() })}
                    />
                  }
                />
                <SettingRow
                  label="对象前缀 (Prefix)"
                  description="可选，例如 archives"
                  control={
                    <Input
                      aria-label="S3 Prefix"
                      className="w-52 max-sm:w-full"
                      placeholder="archives"
                      value={s3Prefix}
                      onChange={(e) => setS3Prefix(e.target.value)}
                      onBlur={() => save.mutate({ archive_s3_prefix: s3Prefix.trim() })}
                    />
                  }
                />
                <SettingRow
                  label="Access Key ID"
                  description={settings.archive_s3_access_key_id_set ? `已配置（${settings.archive_s3_access_key_id_masked}）` : "尚未配置"}
                  control={
                    <Input
                      aria-label="Access Key ID"
                      className="w-64 max-sm:w-full"
                      placeholder={settings.archive_s3_access_key_id_set ? "留空保持不变" : "输入 Access Key ID"}
                      value={s3AccessKeyId}
                      onChange={(e) => setS3AccessKeyId(e.target.value)}
                      onBlur={() => {
                        if (s3AccessKeyId.trim()) {
                          save.mutate({ archive_s3_access_key_id: s3AccessKeyId.trim() })
                          setS3AccessKeyId("")
                        }
                      }}
                    />
                  }
                />
                <SettingRow
                  label="Secret Access Key"
                  description={settings.archive_s3_secret_access_key_set ? `已配置（${settings.archive_s3_secret_access_key_masked}）` : "尚未配置"}
                  control={
                    <Input
                      aria-label="Secret Access Key"
                      type="password"
                      className="w-64 max-sm:w-full"
                      placeholder={settings.archive_s3_secret_access_key_set ? "留空保持不变" : "输入 Secret Access Key"}
                      value={s3SecretAccessKey}
                      onChange={(e) => setS3SecretAccessKey(e.target.value)}
                      onBlur={() => {
                        if (s3SecretAccessKey.trim()) {
                          save.mutate({ archive_s3_secret_access_key: s3SecretAccessKey.trim() })
                          setS3SecretAccessKey("")
                        }
                      }}
                    />
                  }
                />
                <SettingRow
                  label="Force Path Style"
                  description="MinIO 等自建对象存储通常需要开启"
                  control={
                    <Switch
                      aria-label="Force Path Style"
                      checked={s3ForcePathStyle}
                      onCheckedChange={(checked) => {
                        setS3ForcePathStyle(checked)
                        save.mutate({ archive_s3_force_path_style: checked })
                      }}
                    />
                  }
                />
              </>
            )}
          </Rows>
        </Panel>

        <Actions align="start">
          <Button
            variant="outline"
            disabled={checkMut.isPending}
            onClick={() => checkMut.mutate()}
          >
            <PlugZapIcon />
            {checkMut.isPending ? "测试中…" : "测试存储连通性"}
          </Button>
          {checkResult ? (
            <Inline gap="sm">
              {checkResult.ok ? (
                <CheckCircle2Icon className="size-4 text-primary" />
              ) : (
                <AlertCircleIcon className="size-4 text-destructive" />
              )}
              <span className="text-xs text-muted-foreground">
                [{checkResult.backend}] {checkResult.target ? `${checkResult.target} — ` : ""}
                {checkResult.message}
              </span>
            </Inline>
          ) : null}
        </Actions>
      </Section>
    </Stack>
  )
}
