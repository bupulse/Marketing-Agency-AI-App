import { Button, Input } from "@/components/ui";
import { num } from "@/lib/admin/format";
import type { DepartmentView } from "@/lib/support/agents";
import { Panel, TableWrap, Td, Th } from "../ui";

/** The four departments (they route chats, so they cannot be added or removed): rename them, see who is in each. */
export function DepartmentsView({ departments, rename }: { departments: DepartmentView[]; rename: (f: FormData) => Promise<void> }) {
  return (
    <Panel title="Departments" description="Visitors pick one when they start a chat, and it reaches the agents in it. Supervisors see every department.">
      <TableWrap caption="Departments">
        <thead><tr><Th>Name</Th><Th right>Agents</Th></tr></thead>
        <tbody>
          {departments.map((d) => (
            <tr key={d.key}>
              <Td>
                <form action={rename} className="flex flex-wrap items-center gap-2">
                  <input type="hidden" name="key" value={d.key} />
                  <Input name="name" defaultValue={d.name} required minLength={2} maxLength={40} aria-label={`Name of the ${d.name} department`} className="min-h-11 max-w-xs" />
                  <Button type="submit" size="sm" variant="outline">Rename</Button>
                </form>
              </Td>
              <Td right>{num(d.agents)}</Td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
    </Panel>
  );
}
