import * as React from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { notify } from "@/components/blocks/notify"
import { ErrorState, RowsSkeleton } from "@/components/blocks/state-boundary"
import { Section, Stack } from "@/components/blocks/surfaces"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { getWorkspaceRuleFiles, updateWorkspaceRuleFiles } from "@/lib/api"

function RuleFiles() {
  const ruleFiles = useQuery({ queryKey: ["rule-files"], queryFn: getWorkspaceRuleFiles })
  const [draft, setDraft] = React.useState<{ purpose: string; rules: string } | null>(null)
  const [open, setOpen] = React.useState(false)
  const purpose = draft?.purpose ?? ruleFiles.data?.purpose_preview ?? ""
  const rules = draft?.rules ?? ruleFiles.data?.rules_preview ?? ""

  const save = useMutation({
    mutationFn: () => updateWorkspaceRuleFiles({
      ...(purpose.trim() !== "" ? { purpose } : {}),
      ...(rules.trim() !== "" ? { rules } : {}),
    }),
    onSuccess: async () => {
      notify.success("规则文件已保存")
      setOpen(false)
      setDraft(null)
      await ruleFiles.refetch()
    },
    onError: (error) => notify.error(error, "保存失败"),
  })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>编辑规则文件</Button>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>工作区规则文件</DialogTitle>
          <DialogDescription>purpose.md 与 rules.md 会参与摄入和整理提示词。</DialogDescription>
        </DialogHeader>
        {ruleFiles.isError ? <ErrorState error={ruleFiles.error} onRetry={() => void ruleFiles.refetch()} /> : null}
        {ruleFiles.isLoading ? <RowsSkeleton rows={3} /> : null}
        <Stack gap="md">
          <div className="text-sm font-medium">purpose.md</div>
          <Textarea className="min-h-32 font-mono text-xs break-words field-sizing-fixed" value={purpose} onChange={(event) => setDraft({ purpose: event.target.value, rules })} />
          <div className="text-sm font-medium">rules.md</div>
          <Textarea className="min-h-32 font-mono text-xs break-words field-sizing-fixed" value={rules} onChange={(event) => setDraft({ purpose, rules: event.target.value })} />
        </Stack>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function RulesSection() {
  return (
    <Section size="lg" gap="lg" title="规则文件" description="purpose.md 与 rules.md 参与摄入与整理提示词。">
      <RuleFiles />
    </Section>
  )
}
