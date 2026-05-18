import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface RequestBody {
  phone: string;       // E.164 phone number
  inviteUrl: string;
  leagueName: string;
  teamName?: string;
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

    const token = authHeader.slice(7); // strip "Bearer "

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Verify caller via service-role client using the raw token
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
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
        JSON.stringify({ success: false, error: "Invalid phone — must be E.164 format e.g. +12125551234" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
    const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
    const fromNumber = Deno.env.get("TWILIO_FROM_NUMBER");

    if (!accountSid || !authToken || !fromNumber) {
      return new Response(
        JSON.stringify({ success: false, error: "SMS service not configured (Twilio credentials missing)" }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const teamLine = teamName ? `\nYour team: ${teamName}` : "";
    const messageText = `You've been invited to join ${leagueName} on Offline4Ever!${teamLine}\n\nJoin here: ${inviteUrl}`;

    const body64 = btoa(`${accountSid}:${authToken}`);
    const params = new URLSearchParams({
      From: fromNumber,
      To: phone,
      Body: messageText,
    });

    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: "POST",
        headers: {
          "Authorization": `Basic ${body64}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params.toString(),
      }
    );

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(`Twilio error ${response.status}: ${errorBody}`);
      return new Response(
        JSON.stringify({ success: false, error: `SMS provider error: ${response.status}` }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const result = await response.json();
    const messageId = result.sid ?? `twilio-${Date.now()}`;

    await supabaseAdmin.from("notifications_outbox").insert({
      channel: "sms",
      destination: phone,
      message_text: messageText,
      status: "sent",
      sent_at: new Date().toISOString(),
      payload: { invite_url: inviteUrl, league_name: leagueName, team_name: teamName ?? null, message_id: messageId, requested_by: user.id },
    }).maybeSingle();

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
