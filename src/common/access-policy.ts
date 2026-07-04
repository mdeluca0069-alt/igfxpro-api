// Ported from igfxpro-apiv2/auth-service/access.policy.ts — pure RBAC mapping,
// no framework dependency, portable as-is.
export type Role = "trader" | "risk" | "compliance" | "admin" | "super_admin";

const ROLE_PERMISSIONS: Record<Role, string[]> = {
  trader: ["trading:read", "trading:write", "wallet:read", "profile:read", "profile:write"],
  risk: ["trading:read", "wallet:read", "risk:read", "risk:write", "kill_switch:write", "audit:read"],
  compliance: [
    "trading:read",
    "wallet:read",
    "kyc:read",
    "kyc:write",
    "aml:read",
    "aml:write",
    "audit:read",
    "report:write",
  ],
  admin: [
    "trading:read",
    "trading:write",
    "wallet:read",
    "wallet:write",
    "users:write",
    "capital:write",
    "kyc:write",
    "settings:write",
    "audit:read",
  ],
  super_admin: ["*"],
};

export function getPermissionsForRoles(roles: string[]): string[] {
  const perms = new Set<string>();
  for (const role of roles) {
    const rolePerms = ROLE_PERMISSIONS[role as Role] ?? [];
    for (const p of rolePerms) perms.add(p);
  }
  return [...perms];
}

export function isAdmin(roles: string[]): boolean {
  return roles.some((r) => ["admin", "super_admin"].includes(r));
}
