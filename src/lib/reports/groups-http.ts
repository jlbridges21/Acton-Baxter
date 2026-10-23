/** Validated commands for /api/reports/groups (each re-checks permissions in groups.ts). */

import "server-only";

import { z } from "zod";
import type { ReportsContext } from "./http";
import {
  GROUP_COLORS,
  GROUP_ICONS,
  assignReportToGroup,
  createGroup,
  deleteGroup,
  removeReportFromGroup,
  reorderGroups,
  setGroupArchived,
  ungroupReport,
  updateGroup,
} from "./groups";

const id = z.string().uuid();
export const groupCommandSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("create"),
    name: z.string().max(80),
    description: z.string().max(300).optional(),
    color: z.enum(GROUP_COLORS).optional(),
    icon: z.enum(GROUP_ICONS).optional(),
    scope: z.enum(["personal", "company"]).optional(),
  }),
  z.object({
    op: z.literal("update"),
    groupId: id,
    name: z.string().max(80).optional(),
    description: z.string().max(300).optional(),
    color: z.enum(GROUP_COLORS).optional(),
    icon: z.enum(GROUP_ICONS).optional(),
  }),
  z.object({ op: z.literal("archive"), groupId: id }),
  z.object({ op: z.literal("restore"), groupId: id }),
  z.object({ op: z.literal("delete"), groupId: id }),
  z.object({ op: z.literal("reorder"), groupIds: z.array(id).max(200) }),
  z.object({ op: z.literal("assign"), reportId: id, groupId: id }),
  z.object({ op: z.literal("remove"), reportId: id, groupId: id }),
  z.object({ op: z.literal("ungroup"), reportId: id }),
]);

export async function runGroupCommand(ctx: ReportsContext, raw: unknown): Promise<unknown> {
  const cmd = groupCommandSchema.parse(raw);
  const c = {
    requester: ctx.requester,
    access: ctx.access,
    actorLabel: ctx.user.profile.full_name || ctx.user.email,
  };
  switch (cmd.op) {
    case "create": {
      const g = await createGroup({
        ...c,
        name: cmd.name,
        description: cmd.description,
        color: cmd.color,
        icon: cmd.icon,
        scope: cmd.scope,
      });
      return { id: g.id, name: g.name };
    }
    case "update": {
      const g = await updateGroup({
        ...c,
        groupId: cmd.groupId,
        patch: { name: cmd.name, description: cmd.description, color: cmd.color, icon: cmd.icon },
      });
      return { id: g.id, name: g.name };
    }
    case "archive":
      return setGroupArchived({ ...c, groupId: cmd.groupId, archived: true });
    case "restore":
      return setGroupArchived({ ...c, groupId: cmd.groupId, archived: false });
    case "delete":
      return deleteGroup({ ...c, groupId: cmd.groupId });
    case "reorder":
      return reorderGroups({ ...c, groupIds: cmd.groupIds });
    case "assign":
      return assignReportToGroup({ ...c, reportId: cmd.reportId, groupId: cmd.groupId });
    case "remove":
      return removeReportFromGroup({ ...c, reportId: cmd.reportId, groupId: cmd.groupId });
    case "ungroup":
      return { removed: await ungroupReport({ ...c, reportId: cmd.reportId }) };
  }
}
