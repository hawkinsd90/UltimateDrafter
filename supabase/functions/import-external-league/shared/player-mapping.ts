// Player mapping pipeline.
// For each imported roster player, attempts to resolve to a sports_players row.
// Resolution order:
//   1. Check external_player_mappings cache (provider + external_player_id)
//   2. For Sleeper: exact match on sports_players.provider_player_id
//   3. For all providers: exact LOWER(display_name) + normalized position
//   4. Fuzzy trigram match if pg_trgm is available
//   5. Unresolved

import type {
  MappingMethod,
  NormalizedRosterPlayer,
  PlayerMappingResult,
  Provider,
} from "./types.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

interface MappingCacheRow {
  external_player_id: string;
  sports_player_id: string;
  mapping_method: MappingMethod;
  confidence: number | null;
}

interface SportsPlayerRow {
  id: string;
  display_name: string;
  fantasy_position: string | null;
  provider_player_id: string;
}

export async function mapRosterPlayers(
  players: NormalizedRosterPlayer[],
  provider: Provider,
  callerUserId: string,
  adminClient: SupabaseClient
): Promise<PlayerMappingResult[]> {
  if (players.length === 0) return [];

  // ── Step 1: Bulk-load existing mapping cache for this provider ──────────────
  const externalIds = [...new Set(players.map((p) => p.externalPlayerId))];

  const { data: cachedMappings } = await adminClient
    .from("external_player_mappings")
    .select("external_player_id, sports_player_id, mapping_method, confidence")
    .eq("provider", provider)
    .in("external_player_id", externalIds);

  const mappingCache = new Map<string, MappingCacheRow>();
  for (const row of cachedMappings ?? []) {
    mappingCache.set(row.external_player_id, row);
  }

  // ── Step 2: For Sleeper, load sports_players by provider_player_id ──────────
  // This gives us O(1) lookups for the Sleeper auto_id path.
  const sleeperPlayerMap = new Map<string, string>(); // provider_player_id → id
  if (provider === "sleeper") {
    const uncachedIds = externalIds.filter((id) => !mappingCache.has(id));
    if (uncachedIds.length > 0) {
      const { data: sleeperRows } = await adminClient
        .from("sports_players")
        .select("id, provider_player_id")
        .eq("provider", "sleeper")
        .in("provider_player_id", uncachedIds);
      for (const row of sleeperRows ?? []) {
        sleeperPlayerMap.set(row.provider_player_id, row.id);
      }
    }
  }

  // ── Step 3: Load all sports_players for name+position fallback ───────────────
  // Only fetch players whose external_player_id is not already cached.
  // We'll do individual name lookups lazily to avoid fetching the entire table.

  // ── Step 4: Check pg_trgm availability once ──────────────────────────────────
  const trgmAvailable = await checkTrgmAvailable(adminClient);

  // ── Resolve each player ──────────────────────────────────────────────────────
  const results: PlayerMappingResult[] = [];

  // Collect new mappings to batch-insert at the end
  const newMappings: Array<{
    provider: Provider;
    external_player_id: string;
    sports_player_id: string;
    external_player_name: string | null;
    external_position: string | null;
    mapping_method: MappingMethod;
    confidence: number | null;
    created_by: string;
  }> = [];

  for (const player of players) {
    const { externalPlayerId, playerName, position, externalTeamId, externalData } = player;

    // ── Cache hit ──────────────────────────────────────────────────────────────
    const cached = mappingCache.get(externalPlayerId);
    if (cached) {
      results.push({
        externalPlayerId,
        externalTeamId,
        playerName,
        position,
        externalData,
        sportsPlayerId: cached.sports_player_id,
        resolutionStatus: "matched",
        mappingMethod: cached.mapping_method,
        confidence: cached.confidence ?? undefined,
      });
      continue;
    }

    // ── Sleeper auto_id ────────────────────────────────────────────────────────
    if (provider === "sleeper") {
      const sportsPlayerId = sleeperPlayerMap.get(externalPlayerId);
      if (sportsPlayerId) {
        newMappings.push({
          provider,
          external_player_id: externalPlayerId,
          sports_player_id: sportsPlayerId,
          external_player_name: playerName || null,
          external_position: position || null,
          mapping_method: "auto_id",
          confidence: 1.0,
          created_by: callerUserId,
        });
        results.push({
          externalPlayerId,
          externalTeamId,
          playerName,
          position,
          externalData,
          sportsPlayerId,
          resolutionStatus: "matched",
          mappingMethod: "auto_id",
          confidence: 1.0,
        });
        continue;
      }
    }

    // ── auto_name: exact LOWER(display_name) + position ───────────────────────
    if (playerName && playerName.trim() !== "") {
      const nameMatch = await matchByName(playerName, position, adminClient);
      if (nameMatch) {
        newMappings.push({
          provider,
          external_player_id: externalPlayerId,
          sports_player_id: nameMatch.id,
          external_player_name: playerName,
          external_position: position || null,
          mapping_method: "auto_name",
          confidence: 0.9,
          created_by: callerUserId,
        });
        results.push({
          externalPlayerId,
          externalTeamId,
          playerName,
          position,
          externalData,
          sportsPlayerId: nameMatch.id,
          resolutionStatus: "matched",
          mappingMethod: "auto_name",
          confidence: 0.9,
        });
        continue;
      }
    }

    // ── fuzzy: trigram similarity (skip gracefully if pg_trgm unavailable) ────
    if (trgmAvailable && playerName && playerName.trim() !== "") {
      const fuzzyMatch = await matchByFuzzy(playerName, position, adminClient);
      if (fuzzyMatch) {
        newMappings.push({
          provider,
          external_player_id: externalPlayerId,
          sports_player_id: fuzzyMatch.id,
          external_player_name: playerName,
          external_position: position || null,
          mapping_method: "fuzzy",
          confidence: fuzzyMatch.similarity,
          created_by: callerUserId,
        });
        results.push({
          externalPlayerId,
          externalTeamId,
          playerName,
          position,
          externalData,
          sportsPlayerId: fuzzyMatch.id,
          resolutionStatus: "matched",
          mappingMethod: "fuzzy",
          confidence: fuzzyMatch.similarity,
        });
        continue;
      }
    }

    // ── Unresolved ─────────────────────────────────────────────────────────────
    results.push({
      externalPlayerId,
      externalTeamId,
      playerName,
      position,
      externalData,
      sportsPlayerId: null,
      resolutionStatus: "unresolved",
    });
  }

  // ── Batch-upsert new mappings ─────────────────────────────────────────────
  if (newMappings.length > 0) {
    // onConflict = (provider, external_player_id): update mapping if method or player changed
    await adminClient
      .from("external_player_mappings")
      .upsert(newMappings, {
        onConflict: "provider,external_player_id",
        ignoreDuplicates: false,
      });
  }

  return results;
}

// ── Name + position exact match ───────────────────────────────────────────────
async function matchByName(
  playerName: string,
  position: string | undefined,
  adminClient: SupabaseClient
): Promise<SportsPlayerRow | null> {
  const normalized = playerName.trim().toLowerCase();

  let query = adminClient
    .from("sports_players")
    .select("id, display_name, fantasy_position, provider_player_id")
    .ilike("display_name", normalized)
    .limit(5);

  if (position) {
    query = query.eq("fantasy_position", position);
  }

  const { data } = await query;
  if (!data || data.length === 0) return null;
  // If multiple players share the same name+position, we cannot auto-resolve safely
  if (data.length > 1) return null;
  return data[0];
}

// ── Fuzzy trigram match ───────────────────────────────────────────────────────
async function matchByFuzzy(
  playerName: string,
  position: string | undefined,
  adminClient: SupabaseClient
): Promise<{ id: string; similarity: number } | null> {
  try {
    // Use Supabase RPC or raw SQL via the admin client
    // We call a raw query through the admin postgres connection
    const posFilter = position ? `AND fantasy_position = '${position.replace(/'/g, "''")}'` : "";
    const { data, error } = await adminClient.rpc("find_player_by_similarity", {
      p_name: playerName,
      p_position: position ?? null,
      p_threshold: 0.7,
    });

    if (error || !data || data.length === 0) return null;
    return { id: data[0].id, similarity: data[0].similarity };
  } catch {
    // pg_trgm RPC not available — fall through gracefully
    return null;
  }
}

// ── Check if pg_trgm is available via a safe probe ───────────────────────────
async function checkTrgmAvailable(adminClient: SupabaseClient): Promise<boolean> {
  try {
    const { error } = await adminClient.rpc("find_player_by_similarity", {
      p_name: "__probe__",
      p_position: null,
      p_threshold: 0.99,
    });
    // If we get a "function not found" error, trgm is unavailable
    return !error || !error.message.includes("does not exist");
  } catch {
    return false;
  }
}
