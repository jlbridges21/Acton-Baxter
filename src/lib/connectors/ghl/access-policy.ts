import "server-only";

export type GhlResourceType =
  | "contacts"
  | "opportunities"
  | "pipelines"
  | "calendars"
  | "conversations"
  | "users"
  | "custom_fields"
  | "tags"
  | "phone_numbers"
  | "documents"
  | "voice_agents"
  | "knowledge_bases";

export type GhlAccessLevel = "none" | "read" | "write" | "admin";

export type UserRole = "admin" | "salesperson" | "viewer";

type UserContext = {
  id: string;
  email: string;
  role: UserRole;
  isActive: boolean;
};

const RESOURCE_ACCESS_BY_ROLE: Record<UserRole, Record<GhlResourceType, GhlAccessLevel>> = {
  admin: {
    contacts: "admin",
    opportunities: "admin",
    pipelines: "admin",
    calendars: "admin",
    conversations: "admin",
    users: "admin",
    custom_fields: "admin",
    tags: "admin",
    phone_numbers: "admin",
    documents: "admin",
    voice_agents: "admin",
    knowledge_bases: "admin",
  },
  salesperson: {
    contacts: "read",
    opportunities: "read",
    pipelines: "read",
    calendars: "read",
    conversations: "read",
    users: "read",
    custom_fields: "read",
    tags: "read",
    phone_numbers: "none",
    documents: "read",
    voice_agents: "none",
    knowledge_bases: "none",
  },
  viewer: {
    contacts: "none",
    opportunities: "none",
    pipelines: "none",
    calendars: "none",
    conversations: "none",
    users: "none",
    custom_fields: "none",
    tags: "none",
    phone_numbers: "none",
    documents: "none",
    voice_agents: "none",
    knowledge_bases: "none",
  },
};

export function getAccessLevel(user: UserContext, resource: GhlResourceType): GhlAccessLevel {
  if (!user.isActive) {
    return "none";
  }
  return RESOURCE_ACCESS_BY_ROLE[user.role]?.[resource] ?? "none";
}

export function canUserAccessGhlData(
  user: UserContext,
  resource: GhlResourceType,
  requiredLevel: GhlAccessLevel = "read",
): boolean {
  const userLevel = getAccessLevel(user, resource);

  if (userLevel === "none") return false;
  if (requiredLevel === "none") return true;
  if (requiredLevel === "read") return ["read", "write", "admin"].includes(userLevel);
  if (requiredLevel === "write") return ["write", "admin"].includes(userLevel);
  if (requiredLevel === "admin") return userLevel === "admin";

  return false;
}

export function canManageGhlConnector(user: UserContext): boolean {
  if (!user.isActive) return false;
  return user.role === "admin";
}

export function getAccessibleResources(user: UserContext): GhlResourceType[] {
  if (!user.isActive) return [];

  const resources: GhlResourceType[] = [];
  const roleAccess = RESOURCE_ACCESS_BY_ROLE[user.role];

  for (const [resource, level] of Object.entries(roleAccess)) {
    if (level !== "none") {
      resources.push(resource as GhlResourceType);
    }
  }

  return resources;
}

export function describeAccessPolicy(role: UserRole): {
  role: UserRole;
  description: string;
  canRead: GhlResourceType[];
  canWrite: GhlResourceType[];
  canManage: boolean;
} {
  const access = RESOURCE_ACCESS_BY_ROLE[role];
  const canRead: GhlResourceType[] = [];
  const canWrite: GhlResourceType[] = [];

  for (const [resource, level] of Object.entries(access)) {
    if (level !== "none") {
      canRead.push(resource as GhlResourceType);
    }
    if (level === "write" || level === "admin") {
      canWrite.push(resource as GhlResourceType);
    }
  }

  const descriptions: Record<UserRole, string> = {
    admin: "Full access to all GoHighLevel data and connector management.",
    salesperson:
      "Read-only access to contacts, opportunities, calendars, and conversations for Baxter context.",
    viewer: "No access to GoHighLevel data.",
  };

  return {
    role,
    description: descriptions[role],
    canRead,
    canWrite,
    canManage: role === "admin",
  };
}
