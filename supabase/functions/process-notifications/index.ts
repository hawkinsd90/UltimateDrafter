import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface NotificationRecord {
  id: string;
  draft_id: string | null;
  participant_id: string | null;
  notification_type: string;
  channel: string;
  recipient: string;
  message: string;
  metadata: Record<string, unknown>;
}

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

    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

    const { data: pendingNotifications, error: fetchError } = await supabase
      .from("notifications_outbox")
      .select("*")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(100);

    if (fetchError) {
      throw fetchError;
    }

    if (!pendingNotifications || pendingNotifications.length === 0) {
      return new Response(
        JSON.stringify({ message: "No pending notifications", processed: 0 }),
        {
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    const processedIds: string[] = [];
    const failedIds: string[] = [];

    for (const notification of pendingNotifications as NotificationRecord[]) {
      try {
        console.log(
          `Processing notification ${notification.id}: ${notification.notification_type} to ${notification.recipient} via ${notification.channel}`
        );

        const { error: updateError } = await supabase
          .from("notifications_outbox")
          .update({
            status: "sent",
            sent_at: new Date().toISOString(),
          })
          .eq("id", notification.id);

        if (updateError) {
          throw updateError;
        }

        processedIds.push(notification.id);
      } catch (err) {
        console.error(`Failed to process notification ${notification.id}:`, err);

        const errorMessage = err instanceof Error ? err.message : "Unknown error";

        await supabase
          .from("notifications_outbox")
          .update({
            status: "failed",
            error: errorMessage,
          })
          .eq("id", notification.id);

        failedIds.push(notification.id);
      }
    }

    return new Response(
      JSON.stringify({
        message: "Notifications processed",
        processed: processedIds.length,
        failed: failedIds.length,
        processedIds,
        failedIds,
      }),
      {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (error) {
    console.error("Error processing notifications:", error);

    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  }
});
