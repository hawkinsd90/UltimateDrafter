import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const MAX_VERIFY_ATTEMPTS = 10;

async function hashCode(code: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(code + Deno.env.get("VERIFICATION_SALT") || "default-salt");
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
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const { code, smsConsent } = await req.json();

    if (!code || typeof code !== "string" || !/^\d{6}$/.test(code)) {
      return new Response(
        JSON.stringify({ error: "Invalid verification code format" }),
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

    const { data: profile, error: profileError } = await supabaseAdmin
      .from("user_profile")
      .select("*")
      .eq("user_id", user.id)
      .single();

    if (profileError || !profile) {
      return new Response(
        JSON.stringify({ error: "Profile not found. Please start verification first." }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (profile.phone_verification_attempts >= MAX_VERIFY_ATTEMPTS) {
      return new Response(
        JSON.stringify({ 
          error: "Too many verification attempts. Please request a new code." 
        }),
        {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (!profile.phone_verification_code_hash || !profile.phone_verification_expires_at) {
      return new Response(
        JSON.stringify({ error: "No verification code found. Please request a new code." }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (new Date(profile.phone_verification_expires_at) < new Date()) {
      return new Response(
        JSON.stringify({ error: "Verification code expired. Please request a new code." }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const codeHash = await hashCode(code);

    if (codeHash !== profile.phone_verification_code_hash) {
      await supabaseAdmin.rpc("increment_phone_verification_attempts", {
        p_user_id: user.id,
      });

      const attemptsLeft = MAX_VERIFY_ATTEMPTS - (profile.phone_verification_attempts + 1);

      return new Response(
        JSON.stringify({ 
          error: "Invalid verification code",
          attemptsLeft: Math.max(0, attemptsLeft)
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    await supabaseAdmin.rpc("mark_phone_verified", {
      p_user_id: user.id,
    });

    if (smsConsent === true) {
      await supabaseAdmin
        .from("user_profile")
        .update({ sms_consent: true })
        .eq("user_id", user.id);
    }

    await supabaseAdmin.from("audit_events").insert({
      event_type: "phone_verified",
      user_id: user.id,
      metadata: {
        phone: profile.phone_e164?.slice(0, -4).replace(/./g, "*") + profile.phone_e164?.slice(-4),
        sms_consent: smsConsent === true,
      },
    });

    console.log(`Phone verified for user ${user.id}`);

    return new Response(
      JSON.stringify({ 
        success: true,
        message: "Phone verified successfully",
        phoneVerified: true
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error in verify-phone-code:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});