import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface RequestBody {
  email: string;
  inviteUrl: string;
  leagueName: string;
  teamName?: string;   // Optional: pre-tied imported team name
  inviterName?: string;
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
    const { email, inviteUrl, leagueName, teamName, inviterName } = body;

    if (!email || !inviteUrl || !leagueName) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing required fields: email, inviteUrl, leagueName" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return new Response(
        JSON.stringify({ success: false, error: "Invalid email address" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (!resendApiKey) {
      // Log as pending but return a descriptive error
      await supabaseAdmin.from("notifications_outbox").insert({
        channel: "email",
        destination: email,
        message_text: `League invite for ${leagueName}`,
        status: "blocked_no_destination",
        payload: { invite_url: inviteUrl, league_name: leagueName, team_name: teamName ?? null, reason: "RESEND_API_KEY not configured", requested_by: user.id },
      });
      return new Response(
        JSON.stringify({ success: false, error: "Email service not configured. Add RESEND_API_KEY to edge function secrets." }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const from = inviterName ? `${inviterName} via Offline4Ever <invites@offline4ever.com>` : "Offline4Ever <invites@offline4ever.com>";
    const subject = `You're invited to join ${leagueName}!`;

    const teamSection = teamName
      ? `<p style="margin:0 0 16px;"><strong>Your team:</strong> ${teamName}</p>`
      : "";

    const htmlBody = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:system-ui,sans-serif;background:#0f172a;margin:0;padding:40px 20px;">
  <div style="max-width:480px;margin:0 auto;background:#1e293b;border-radius:12px;padding:32px;color:#f1f5f9;">
    <h1 style="margin:0 0 8px;font-size:24px;color:#f1f5f9;">You're invited!</h1>
    <p style="margin:0 0 20px;color:#94a3b8;font-size:15px;">
      ${inviterName ? `<strong style="color:#e2e8f0">${inviterName}</strong> has invited you to join` : "You've been invited to join"}
      <strong style="color:#e2e8f0"> ${leagueName}</strong> on Offline4Ever.
    </p>
    ${teamSection}
    <a href="${inviteUrl}"
       style="display:inline-block;padding:14px 28px;background:#2563eb;color:#fff;text-decoration:none;border-radius:8px;font-weight:700;font-size:16px;margin-bottom:20px;">
      Accept Invite &amp; Join League
    </a>
    <p style="margin:20px 0 0;font-size:12px;color:#475569;">
      Or copy this link: <a href="${inviteUrl}" style="color:#60a5fa;word-break:break-all;">${inviteUrl}</a>
    </p>
    <p style="margin:12px 0 0;font-size:11px;color:#334155;">This invite expires in 7 days.</p>
  </div>
</body>
</html>`;

    const textBody = `You've been invited to join ${leagueName} on Offline4Ever!${teamName ? `\nYour team: ${teamName}` : ""}\n\nJoin here: ${inviteUrl}\n\nThis invite expires in 7 days.`;

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [email],
        subject,
        html: htmlBody,
        text: textBody,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(`Resend error ${response.status}: ${errorBody}`);
      return new Response(
        JSON.stringify({ success: false, error: `Email provider error: ${response.status}` }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const result = await response.json();
    const messageId = result.id ?? `resend-${Date.now()}`;

    await supabaseAdmin.from("notifications_outbox").insert({
      channel: "email",
      destination: email,
      message_text: subject,
      status: "sent",
      sent_at: new Date().toISOString(),
      payload: { invite_url: inviteUrl, league_name: leagueName, team_name: teamName ?? null, message_id: messageId, requested_by: user.id },
    });

    return new Response(
      JSON.stringify({ success: true, messageId }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("send-invite-email error:", err);
    return new Response(
      JSON.stringify({ success: false, error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
