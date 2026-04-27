// Preflight ownership and status check.
// Called immediately after request validation, before any external provider fetch.
// saveImport re-checks as defense-in-depth, but this prevents wasting a provider
// network call on a request that was never going to be authorized.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export interface ImportAccessContext {
  draftId: string;
  leagueId: string;
  draftStatus: string;
}

export interface AccessDenied {
  status: 401 | 403 | 404 | 409;
  message: string;
}

export function isAccessDenied(v: unknown): v is AccessDenied {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as AccessDenied).status === "number" &&
    typeof (v as AccessDenied).message === "string"
  );
}

export async function verifyImportAccess(
  draftId: string,
  callerUserId: string,
  adminClient: SupabaseClient
): Promise<ImportAccessContext | AccessDenied> {
  // Derive league_id from drafts — never trust this from the client
  const { data: draft, error: draftErr } = await adminClient
    .from("drafts")
    .select("id, league_id, status")
    .eq("id", draftId)
    .maybeSingle();

  if (draftErr || !draft) {
    return { status: 404, message: "Draft not found." };
  }

  if (draft.status !== "pending") {
    return {
      status: 409,
      message: `Import is only allowed while the draft is pending (current status: ${draft.status}).`,
    };
  }

  const { data: league, error: leagueErr } = await adminClient
    .from("leagues")
    .select("id, owner_id")
    .eq("id", draft.league_id)
    .maybeSingle();

  if (leagueErr || !league) {
    return { status: 404, message: "League not found." };
  }

  if (league.owner_id !== callerUserId) {
    return { status: 403, message: "Only the league owner can import an external league." };
  }

  return {
    draftId: draft.id,
    leagueId: draft.league_id,
    draftStatus: draft.status,
  };
}
