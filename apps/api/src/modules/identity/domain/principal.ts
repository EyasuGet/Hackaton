// Who is acting, and which learner-owned resources they may reach. Roles and
// course grants always come from server-side storage; nothing a client sends
// can change them.

export type Role = 'learner' | 'support' | 'teacher' | 'employer';

export interface Principal {
  readonly id: string;
  readonly role: Role;
  readonly label: string;
  /** True for synthetic demo identities; real host identities arrive with T3-004-B. */
  readonly demo: boolean;
  readonly courseIds: readonly string[];
}

/** The resources a principal may see: only their own, and only in courses they are granted. */
export interface OwnedScope {
  readonly ownerId: string;
  readonly courseIds: readonly string[];
}

/**
 * The single access rule for learner-owned resources, applied by both list and
 * single-object queries. Support staff get no scope: they may not browse
 * learner records until help-request assignment (T3-017) grants specific access.
 */
export function ownedScope(principal: Principal): OwnedScope | null {
  if (principal.role !== 'learner') return null;
  return { ownerId: principal.id, courseIds: principal.courseIds };
}
