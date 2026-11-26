import { RowsSkeleton } from "@/components/blocks/state-boundary"
import { Panel, Rows, Section } from "@/components/blocks/surfaces"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { useApp } from "@/context/app-context"
import { NumberSetting, SettingRow, useSettingsSave } from "./shared"

export function IngestSection() {
  const { settings } = useApp()
  const save = useSettingsSave()
  if (settings === undefined) return <RowsSkeleton rows={6} />

  return (
    <Section size="lg" gap="lg" title="摄入与检索" description="内容切分、索引与向量化。">
      <Panel padding="none">
        <Rows label="摄入设置">
          <NumberSetting label="最大 token" value={settings.max_tokens} defaultValue={4096} onSave={(value) => save.mutate({ max_tokens: value })} />
          <NumberSetting label="温度" step="0.1" value={settings.temperature} defaultValue={0.7} onSave={(value) => save.mutate({ temperature: value })} />
          <NumberSetting label="Chunk 大小" value={settings.chunk_size} defaultValue={512} onSave={(value) => save.mutate({ chunk_size: value })} />
          <NumberSetting label="Chunk 重叠" value={settings.chunk_overlap} defaultValue={128} onSave={(value) => save.mutate({ chunk_overlap: value })} />
          <SettingRow
            label="自动重建索引"
            description="内容变化后刷新派生索引"
            control={<Switch aria-label="自动重建索引" checked={settings.auto_reindex} onCheckedChange={(value) => save.mutate({ auto_reindex: value })} />}
          />
          <SettingRow
            label="监控来源目录"
            description="发现新文件时自动创建摄入任务"
            control={<Switch aria-label="监控来源目录" checked={settings.watch_sources} onCheckedChange={(value) => save.mutate({ watch_sources: value })} />}
          />
          <SettingRow
            label="并行处理摄入任务"
            description="多个任务同时调用模型；写同一页面时会自动排队"
            control={
              <Switch
                aria-label="并行处理摄入任务"
                checked={settings.job_parallel_enabled === true || settings.job_parallel_enabled === "true"}
                onCheckedChange={(value) => save.mutate({ job_parallel_enabled: value })}
              />
            }
          />
          <NumberSetting
            label="最大并发数"
            description="并行处理时同时在跑的任务数（1–32），改动即时生效"
            value={Number(settings.job_max_concurrent) || undefined}
            defaultValue={3}
            onSave={(value) => save.mutate({ job_max_concurrent: value })}
          />
          <SettingRow
            label="Embedding 实例"
            description="用于 chunk 向量化"
            control={<Input aria-label="Embedding 实例" className="w-52 max-sm:w-full" defaultValue={settings.embedding_instance_id ?? ""} onBlur={(event) => save.mutate({ embedding_instance_id: event.target.value })} />}
          />
          <SettingRow
            label="Embedding 模型"
            control={<Input aria-label="Embedding 模型" className="w-52 max-sm:w-full" defaultValue={settings.embedding_model ?? ""} onBlur={(event) => save.mutate({ embedding_model: event.target.value })} />}
          />
        </Rows>
      </Panel>
    </Section>
  )
}
