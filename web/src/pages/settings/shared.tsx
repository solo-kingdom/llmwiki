import * as React from "react"
import { useMutation } from "@tanstack/react-query"
import { notify } from "@/components/blocks/notify"
import { Grid, Row, Stack } from "@/components/blocks/surfaces"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { useApp } from "@/context/app-context"
import { updateSettings } from "@/lib/api"
import type { Settings } from "@/types"

/** Shared save path for every settings section: patch + toast + refetch the app context. */
export function useSettingsSave() {
  const { refresh } = useApp()
  return useMutation({
    mutationFn: (patch: Partial<Settings>) => updateSettings(patch),
    onSuccess: async () => {
      notify.success("已保存")
      await refresh()
    },
    onError: (error: Error) => notify.error(error, "保存失败"),
  })
}

export function SettingRow({ label, description, control }: { label: string; description?: string | undefined; control: React.ReactNode }) {
  return (
    <Row>
      <div className="min-w-0 flex-1">
        <Grid columns={2}>
          <div className="min-w-0">
            <div className="text-sm font-medium">{label}</div>
            {description !== undefined ? <div className="text-xs text-muted-foreground">{description}</div> : null}
          </div>
          <div className="min-w-0 max-sm:w-full">{control}</div>
        </Grid>
      </div>
    </Row>
  )
}

export function NumberSetting({ label, description, value, defaultValue, onSave, step = "1" }: {
  label: string
  description?: string
  value: number | undefined
  defaultValue: number
  onSave: (value: number) => void
  step?: string
}) {
  const [draft, setDraft] = React.useState<string | null>(null)
  const display = draft ?? (value === undefined ? "" : String(value))
  return (
    <SettingRow
      label={label}
      description={description}
      control={
        <Input
          className="w-32 max-sm:w-full"
          type="number"
          step={step}
          aria-label={label}
          placeholder={String(defaultValue)}
          value={display}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => {
            const parsed = Number(display)
            if (display !== "" && Number.isFinite(parsed) && parsed !== value) onSave(parsed)
            setDraft(null)
          }}
        />
      }
    />
  )
}

export function JsonDialog({ title, description, value, onChange, onSave, onCheck, checkResult }: {
  title: string
  description: string
  value: string
  onChange: (value: string) => void
  onSave: () => void
  onCheck: () => void
  checkResult: React.ReactNode
}) {
  const [open, setOpen] = React.useState(false)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>编辑</Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <Stack gap="md">
          <Textarea className="min-h-48 font-mono text-xs" value={value} onChange={(event) => onChange(event.target.value)} />
          {checkResult}
        </Stack>
        <DialogFooter>
          <Button variant="outline" onClick={onCheck}>检查</Button>
          <Button onClick={() => { onSave(); setOpen(false) }}>保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
