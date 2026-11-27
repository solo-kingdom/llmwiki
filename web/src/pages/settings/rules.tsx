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
  const purpose = draft?.purpose ?? ruleFiles.data?.purpose ?? ruleFiles.data?.purpose_preview ?? ""
  const rules = draft?.rules ?? ruleFiles.data?.rules ?? ruleFiles.data?.rules_preview ?? ""

  const save = useMutation({
    mutationFn: () => updateWorkspaceRuleFiles({
      ...(purpose.trim() !== "" ? { purpose } : {}),
      ...(rules.trim() !== "" ? { rules } : {}),
    }),
    onSuccess: async () => {
      notify.success("知识库规则已保存")
      setOpen(false)
      setDraft(null)
      await ruleFiles.refetch()
    },
    onError: (error) => notify.error(error, "保存失败"),
  })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>编辑知识库规则</Button>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>知识库规则</DialogTitle>
          <DialogDescription>研究目标与全局规则保存在 PostgreSQL 中，参与摄入、对话和整理提示词。</DialogDescription>
        </DialogHeader>
        {ruleFiles.isError ? <ErrorState error={ruleFiles.error} onRetry={() => void ruleFiles.refetch()} /> : null}
        {ruleFiles.isLoading ? <RowsSkeleton rows={3} /> : null}
        <Stack gap="md">
          <div className="text-sm font-medium">研究目标（Purpose）</div>
          <Textarea className="min-h-32 font-mono text-xs break-words field-sizing-fixed" value={purpose} onChange={(event) => setDraft({ purpose: event.target.value, rules })} />
          <div className="text-sm font-medium">全局规则（Rules）</div>
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
    <Section size="lg" gap="lg" title="知识库规则" description="研究目标与全局规则保存在数据库中，参与摄入与整理提示词。">
      <RuleFiles />
    </Section>
  )
}
