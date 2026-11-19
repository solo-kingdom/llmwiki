/**
 * SettingsPage — centered narrow column: page title, then groups of rows inside bordered cards. Each row is a label
 * with an optional description on the left and one control on the right. Pages pass data only.
 */
import * as React from "react"
import { ScrollRegion } from "@/components/blocks/surfaces"

export type SettingsRow = {
  id: string
  label: string
  description?: string | undefined
  /** id of the control element, so the label is announced with it */
  controlId?: string | undefined
  control: React.ReactNode
}
export type SettingsGroup = { title: string; rows: SettingsRow[] }

export function SettingsPage({ title, groups }: { title: string; groups: SettingsGroup[] }) {
  return (
    <div data-surface="page" className="flex min-h-0 min-w-0 flex-1 flex-col">
      <ScrollRegion>
        <div className="mx-auto flex w-full max-w-[600px] flex-col gap-10 px-6 pt-16 pb-16">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {groups.map((group) => (
            <section key={group.title} className="flex flex-col gap-3">
              <h2 className="text-lg font-medium">{group.title}</h2>
              <div className="divide-y rounded-lg border bg-card">
                {group.rows.map((row) => (
                  <div key={row.id} className="flex min-h-15 items-center justify-between gap-6 px-4 py-3">
                    <div className="min-w-0">
                      <label htmlFor={row.controlId} className="block text-sm font-medium">{row.label}</label>
                      {row.description !== undefined ? <p className="text-xs text-muted-foreground">{row.description}</p> : null}
                    </div>
                    <div className="shrink-0">{row.control}</div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </ScrollRegion>
    </div>
  )
}
