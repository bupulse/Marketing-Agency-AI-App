import { Network } from "lucide-react";
import { Button, Input } from "@/components/ui";
import { num } from "@/lib/admin/format";
import { cn } from "@/lib/cn";
import type { DepartmentView } from "@/lib/support/agents";
import { CARD, IconBadge } from "../kit";

/** The four departments (they route chats, so they cannot be added or removed): rename them, see who is in each. */
export function DepartmentsView({ departments, rename }: { departments: DepartmentView[]; rename: (f: FormData) => Promise<void> }) {
  return (
    <ul aria-label="Departments" className="kit-rise grid gap-3 sm:grid-cols-2">
      {departments.map((d) => (
        <li key={d.key} className={cn("flex min-w-0 flex-col gap-3 p-4 sm:p-5", CARD)}>
          <div className="flex items-center gap-3">
            <IconBadge icon={Network} tone="teal" size="sm" />
            <span className="min-w-0 flex-1 truncate text-[15px] font-bold">{d.name}</span>
            <span className="text-right">
              <span className="block text-[20px] font-bold leading-none tabular-nums">{num(d.agents)}</span>
              <span className="text-[11.5px] text-muted">{d.agents === 1 ? "agent" : "agents"}</span>
            </span>
          </div>
          <form action={rename} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="key" value={d.key} />
            <Input name="name" defaultValue={d.name} required minLength={2} maxLength={40} aria-label={`Name of the ${d.name} department`} className="min-h-11 min-w-0 flex-1" />
            <Button type="submit" size="sm" variant="outline">Rename</Button>
          </form>
        </li>
      ))}
    </ul>
  );
}
