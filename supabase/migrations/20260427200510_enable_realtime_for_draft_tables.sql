/*
  # Enable Realtime for Draft Tables

  Adds draft_picks, drafts, and draft_participants to the supabase_realtime
  publication so that postgres_changes subscriptions actually fire for clients.
  Without this, INSERT/UPDATE events on these tables are never broadcast.
*/

ALTER PUBLICATION supabase_realtime ADD TABLE drafts;
ALTER PUBLICATION supabase_realtime ADD TABLE draft_picks;
ALTER PUBLICATION supabase_realtime ADD TABLE draft_participants;
