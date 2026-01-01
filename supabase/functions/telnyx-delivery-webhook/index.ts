import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceRoleKey) {
      throw new Error("Missing Supabase environment variables");
    }

    const payload = await req.json();

    console.log("Telnyx webhook received:", JSON.stringify(payload).slice(0, 200));

    if (!payload.data || !payload.data.event_type) {
      return new Response(
        JSON.stringify({ error: "Invalid webhook payload" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const eventType = payload.data.event_type;
    const messageId = payload.data.payload?.id;

    if (!messageId) {
      return new Response(
        JSON.stringify({ error: "Missing message ID" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

    const deliveryStatus = eventType === "message.sent" ? "delivered" : 
                          eventType === "message.finalized" ? "delivered" :
                          eventType === "message.delivery_failed" ? "delivery_failed" :
                          null;

    if (!deliveryStatus) {
      console.log(`Ignoring event type: ${eventType}`);
      return new Response(
        JSON.stringify({ message: "Event ignored" }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const { error: updateError } = await supabase
      .from("notifications_outbox")
      .update({
        delivery_status: deliveryStatus,
        provider_delivered_at: deliveryStatus === "delivered" ? new Date().toISOString() : null,
      })
      .eq("provider_message_id", messageId);

    if (updateError) {
      console.error("Failed to update delivery status:", updateError);
      return new Response(
        JSON.stringify({ error: "Failed to update status" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    console.log(`Updated delivery status for message ${messageId}: ${deliveryStatus}`);

    return new Response(
      JSON.stringify({ message: "Webhook processed" }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error processing Telnyx webhook:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});