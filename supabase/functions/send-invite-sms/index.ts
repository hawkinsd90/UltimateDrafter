import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface RequestBody {
  phone: string;       // E.164 phone number
  inviteUrl: string;   // Full invite URL
  leagueName: string;
  teamName?: string;   // Optional: pre-tied imported team name
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing Authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Verify caller is authenticated
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ success: false, error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body: RequestBody = await req.json();
    const { phone, inviteUrl, leagueName, teamName } = body;

    if (!phone || !inviteUrl || !leagueName) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing required fields: phone, inviteUrl, leagueName" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!/^\+[1-9]\d{1,14}$/.test(phone)) {
      return new Response(
        JSON.stringify({ success: false, error: "Invalid phone number — must be E.164 format (e.g. +12125551234)" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const telnyxApiKey = Deno.env.get("TELNYX_API_KEY");
    const telnyxFromNumber = Deno.env.get("TELNYX_FROM_NUMBER");

    if (!telnyxApiKey || !telnyxFromNumber) {
      return new Response(
        JSON.stringify({ success: false, error: "SMS service not configured (TELNYX_API_KEY missing)" }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const teamLine = teamName ? `\nYour team: ${teamName}` : "";
    const messageText =
      `You've been invited to join ${leagueName} on Offline4Ever!${teamLine}\n\nJoin here: ${inviteUrl}`;

    const response = await fetch("https://api.telnyx.com/v2/messages", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${telnyxApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: telnyxFromNumber,
        to: phone,
        text: messageText,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(`Telnyx error ${response.status}: ${errorBody}`);
      return new Response(
        JSON.stringify({ success: false, error: `SMS provider error: ${response.status}` }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const result = await response.json();
    const messageId = result.data?.id ?? `telnyx-${Date.now()}`;

    // Log to outbox for audit trail
    await supabaseAdmin.from("notifications_outbox").insert({
      channel: "sms",
      destination: phone,
      message_text: messageText,
      status: "sent",
      sent_at: new Date().toISOString(),
      payload: { invite_url: inviteUrl, league_name: leagueName, team_name: teamName ?? null, message_id: messageId, requested_by: user.id },
    });

    return new Response(
      JSON.stringify({ success: true, messageId }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("send-invite-sms error:", err);
    return new Response(
      JSON.stringify({ success: false, error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
