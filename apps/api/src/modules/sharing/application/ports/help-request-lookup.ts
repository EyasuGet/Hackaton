// Minimal read-only port for the sharing module to verify help-request
// participants. Only the fields needed for session creation are exposed so the
// sharing module does not take a full HelpRepository dependency.

export interface HelpRequestParticipants {
  readonly ownerId: string;
  readonly claimedBy: string | null;
  readonly state: string;
}

export interface HelpRequestLookup {
  /**
   * Returns the participant fields for a help request, or null when not found.
   * No ownership scope is applied — this is an internal lookup used only after
   * the caller's role and claim have already been verified.
   */
  findParticipantsById(id: string): Promise<HelpRequestParticipants | null>;
}
