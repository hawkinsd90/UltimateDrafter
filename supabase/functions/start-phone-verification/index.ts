import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function normalizePhoneToE164(phone: string): string | null {
  const cleaned = phone.replace(/\D/g, "");

  if (cleaned.length === 10) {
    return `+1${cleaned}`;
  }

  if (cleaned.length === 11 && cleaned[0] === "1") {
    return `+${cleaned}`;
  }

  if (phone.startsWith("+") && cleaned.length >= 11 && cleaned.length <= 15) {
    return `+${cleaned}`;
  }

  return null;
}

function validateE164(phone: string): boolean {
  return /^\+[1-9]\d{1,14}$/.test(phone);
}

function generateVerificationCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function hashCode(code: string): Promise<string> {
  const encoder = new TextEncoder();
  const salt = Deno.env.get("VERIFICATION_SALT") ?? "default-salt";
  const data = encoder.encode(code + salt);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    console.log("[start-phone-verification] Authorization header present:", !!authHeader);

    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const accessToken = authHeader.replace(/^Bearer\s+/i, "").trim();
    console.log("[start-phone-verification] Bearer token extracted, length:", accessToken.length);

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    );

    const {
      data: { user },
      error: userError,
    } = await supabaseClient.auth.getUser(accessToken);

    console.log("[start-phone-verification] getUser result - user:", !!user, "error:", userError?.message ?? null);

    if (userError || !user) {
      console.error("Authentication failed:", userError);
      return new Response(
        JSON.stringify({ error: "Unauthorized", details: userError?.message }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const { phone } = await req.json();

    if (!phone || typeof phone !== "string") {
      return new Response(
        JSON.stringify({ error: "Phone number is required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const phoneE164 = normalizePhoneToE164(phone);

    if (!phoneE164 || !validateE164(phoneE164)) {
      return new Response(
        JSON.stringify({ error: "Invalid phone number. Please use format: +1 (555) 123-4567" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const { data: canSend } = await supabaseAdmin.rpc("can_send_phone_verification", {
      p_user_id: user.id,
    });

    if (!canSend) {
      return new Response(
        JSON.stringify({
          error: "Rate limit exceeded. Please wait before requesting another code.",
          retryAfter: 30
        }),
        {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const { data: existingProfile } = await supabaseAdmin
      .from("user_profile")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!existingProfile) {
      await supabaseAdmin
        .from("user_profile")
        .insert({
          user_id: user.id,
          phone_e164: phoneE164,
        });
    } else {
      await supabaseAdmin
        .from("user_profile")
        .update({ phone_e164: phoneE164 })
        .eq("user_id", user.id);
    }

    const code = generateVerificationCode();
    const codeHash = await hashCode(code);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    await supabaseAdmin.rpc("set_phone_verification_code", {
      p_user_id: user.id,
      p_code_hash: codeHash,
      p_expires_at: expiresAt,
    });

    // --- Twilio direct send ---
    // OTP is sent immediately via Twilio in this request.
    // process-notifications-outbox is NOT used for OTP delivery.
    // notifications_outbox is written as an audit record only, after the Twilio attempt.

    const twilioAccountSid = Deno.env.get("TWILIO_ACCOUNT_SID")?.trim();
    const twilioAuthToken = Deno.env.get("TWILIO_AUTH_TOKEN")?.trim();
    const twilioFromNumber = Deno.env.get("TWILIO_FROM_NUMBER")?.trim();

    // Temporary diagnostic logging — token value is never logged
    console.log("[start-phone-verification] Twilio credential check:", {
      hasAccountSid: !!twilioAccountSid,
      accountSidPrefix: twilioAccountSid ? twilioAccountSid.slice(0, 2) : null,
      accountSidLength: twilioAccountSid?.length ?? 0,
      hasAuthToken: !!twilioAuthToken,
      authTokenLength: twilioAuthToken?.length ?? 0,
      hasFromNumber: !!twilioFromNumber,
      fromNumber: twilioFromNumber ?? null,
    });

    if (!twilioAccountSid || !twilioAuthToken || !twilioFromNumber) {
      console.error("[start-phone-verification] Twilio credentials not configured");
      return new Response(
        JSON.stringify({ error: "SMS service is not configured. Please contact support." }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const messageText = `Your DraftMaster verification code is: ${code}. This code expires in 10 minutes.`;
    const now = new Date().toISOString();

    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${twilioAccountSid}/Messages.json`;
    const auth = btoa(`${twilioAccountSid}:${twilioAuthToken}`);

    const formData = new URLSearchParams();
    formData.append("To", phoneE164);
    formData.append("From", twilioFromNumber);
    formData.append("Body", messageText);

    let twilioSid: string | null = null;
    let twilioError: string | null = null;

    try {
      const twilioResponse = await fetch(twilioUrl, {
        method: "POST",
        headers: {
          "Authorization": `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: formData.toString(),
      });

      const twilioData = await twilioResponse.json();

      if (!twilioResponse.ok) {
        // Log Twilio error server-side only; do not expose raw error to frontend
        console.error("[start-phone-verification] Twilio error:", {
          status: twilioResponse.status,
          code: twilioData.code,
          message: twilioData.message,
        });
        twilioError = `Twilio error ${twilioData.code}: ${twilioData.message || "Unknown error"}`;
      } else {
        twilioSid = twilioData.sid;
        console.log("[start-phone-verification] Twilio accepted OTP SMS, SID:", twilioSid);
      }
    } catch (fetchErr) {
      const errMsg = fetchErr instanceof Error ? fetchErr.message : "Network error";
      console.error("[start-phone-verification] Twilio fetch failed:", errMsg);
      twilioError = errMsg;
    }

    // Write audit row to notifications_outbox reflecting actual outcome.
    // This row is purely for audit — process-notifications-outbox will not pick it up
    // because it is inserted as 'sent' or 'failed', never 'pending'.
    await supabaseAdmin.from("notifications_outbox").insert({
      user_id: user.id,
      notification_type: "phone_verification",
      channel: "sms",
      destination: phoneE164,
      message_text: messageText,
      metadata: { code_type: "verification" },
      next_attempt_at: now,
      status: twilioSid ? "sent" : "failed",
      sent_at: twilioSid ? now : null,
      provider: "twilio",
      provider_message_id: twilioSid ?? null,
      last_error: twilioError ?? null,
    });

    if (twilioError) {
      return new Response(
        JSON.stringify({ error: "Failed to send verification code. Please try again." }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: "Verification code sent",
        phone: phoneE164.slice(0, -4).replace(/./g, "*") + phoneE164.slice(-4)
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error in start-phone-verification:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
