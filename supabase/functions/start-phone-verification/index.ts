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
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      {
        global: {
          headers: { Authorization: authHeader },
        },
      }
    );

    const {
      data: { user },
      error: userError,
    } = await supabaseClient.auth.getUser();

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

    await supabaseAdmin.from("notifications_outbox").insert({
      user_id: user.id,
      notification_type: "phone_verification",
      channel: "sms",
      recipient: phoneE164,
      message: `Your DraftMaster verification code is: ${code}. This code expires in 10 minutes.`,
      metadata: {
        code_type: "verification",
      },
    });

    console.log(`Verification code sent to ${phoneE164.slice(0, -4).replace(/./g, "*")}${phoneE164.slice(-4)}`);

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