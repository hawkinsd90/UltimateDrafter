import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const WORKER_ID = `worker-${crypto.randomUUID().slice(0, 8)}`;
const BATCH_SIZE = 25;
const MAX_ATTEMPTS = 6;

interface NotificationRow {
  id: string;
  channel: string;
  destination: string;
  message_text: string | null;
  payload: Record<string, unknown>;
  template_key: string | null;
  attempt_count: number;
  user_id: string | null;
  league_id: string | null;
}

function calculateBackoff(attemptCount: number): number {
  if (attemptCount === 1) return 60;
  if (attemptCount === 2) return 300;
  if (attemptCount === 3) return 900;
  return 3600;
}

async function sendEmail(notification: NotificationRow): Promise<{ success: boolean; error?: string; provider: string; messageId?: string }> {
  console.log(`[MOCK] Sending email to ${notification.destination}: ${notification.message_text || 'Template: ' + notification.template_key}`);

  return {
    success: true,
    provider: 'mock',
    messageId: `mock-email-${Date.now()}`
  };
}

async function sendSMS(notification: NotificationRow): Promise<{ success: boolean; error?: string; provider: string; messageId?: string }> {
  const telnyxApiKey = Deno.env.get("TELNYX_API_KEY");
  const telnyxFromNumber = Deno.env.get("TELNYX_FROM_NUMBER");

  if (!telnyxApiKey || !telnyxFromNumber) {
    console.error("Telnyx credentials not configured");
    return {
      success: false,
      error: "SMS service not configured",
      provider: 'telnyx'
    };
  }

  const maskedDestination = notification.destination.slice(0, -4).replace(/./g, '*') + notification.destination.slice(-4);

  try {
    console.log(`Sending SMS to ${maskedDestination} via Telnyx`);

    const response = await fetch('https://api.telnyx.com/v2/messages', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${telnyxApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: telnyxFromNumber,
        to: notification.destination,
        text: notification.message_text || 'You have a notification'
      })
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(`Telnyx API error: ${response.status} - ${errorBody}`);

      return {
        success: false,
        error: `Telnyx error: ${response.status}`,
        provider: 'telnyx'
      };
    }

    const result = await response.json();

    console.log(`SMS sent successfully to ${maskedDestination}, message_id: ${result.data?.id}`);

    return {
      success: true,
      provider: 'telnyx',
      messageId: result.data?.id || `telnyx-${Date.now()}`
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`Failed to send SMS to ${maskedDestination}:`, errorMessage);

    return {
      success: false,
      error: errorMessage,
      provider: 'telnyx'
    };
  }
}

async function sendVoice(notification: NotificationRow): Promise<{ success: boolean; error?: string; provider: string; messageId?: string }> {
  console.log(`[STUB] Voice call to ${notification.destination}: ${notification.message_text || 'Template: ' + notification.template_key}`);

  return {
    success: true,
    provider: 'mock',
    messageId: `mock-voice-${Date.now()}`
  };
}

async function sendNotification(notification: NotificationRow): Promise<{ success: boolean; error?: string; provider: string; messageId?: string }> {
  switch (notification.channel) {
    case 'email':
      return await sendEmail(notification);
    case 'sms':
      return await sendSMS(notification);
    case 'voice':
      return await sendVoice(notification);
    case 'push':
      return { success: false, error: 'Push notifications not implemented', provider: 'none' };
    default:
      return { success: false, error: `Unknown channel: ${notification.channel}`, provider: 'none' };
  }
}

function isTransientError(error: string): boolean {
  const transientPatterns = [
    'timeout',
    'network',
    'connection',
    'rate limit',
    '5xx',
    'service unavailable',
    'temporary'
  ];

  const errorLower = error.toLowerCase();
  return transientPatterns.some(pattern => errorLower.includes(pattern));
}

async function writeAuditEvent(
  supabase: any,
  eventType: string,
  userId: string | null,
  leagueId: string | null,
  payload: Record<string, unknown>
) {
  try {
    await supabase
      .from('audit_events')
      .insert({
        event_type: eventType,
        user_id: userId,
        league_id: leagueId,
        payload
      });
  } catch (err) {
    console.error('Failed to write audit event:', err);
  }
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

    const now = new Date().toISOString();

    const { data: claimedNotifications, error: claimError } = await supabase
      .rpc('claim_pending_notifications', {
        p_batch_size: BATCH_SIZE,
        p_worker_id: WORKER_ID,
        p_now: now
      })
      .select();

    let notifications: NotificationRow[] = [];

    if (claimError && claimError.message.includes('function') && claimError.message.includes('does not exist')) {
      console.log('Using fallback manual claim logic');

      const { data: pending, error: fetchError } = await supabase
        .from('notifications_outbox')
        .select('id, channel, destination, message_text, payload, template_key, attempt_count, user_id, league_id')
        .in('status', ['pending', 'retry_scheduled'])
        .lte('next_attempt_at', now)
        .order('next_attempt_at', { ascending: true })
        .limit(BATCH_SIZE);

      if (fetchError) {
        throw fetchError;
      }

      if (pending && pending.length > 0) {
        const ids = pending.map(n => n.id);

        const { data: claimed, error: updateError } = await supabase
          .from('notifications_outbox')
          .update({
            status: 'processing',
            locked_at: now,
            locked_by: WORKER_ID
          })
          .in('id', ids)
          .in('status', ['pending', 'retry_scheduled'])
          .select('id, channel, destination, message_text, payload, template_key, attempt_count, user_id, league_id');

        if (updateError) {
          throw updateError;
        }

        notifications = (claimed || []) as NotificationRow[];
      }
    } else if (claimError) {
      throw claimError;
    } else {
      notifications = (claimedNotifications || []) as NotificationRow[];
    }

    if (notifications.length === 0) {
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

    console.log(`Processing ${notifications.length} notifications`);

    const results = {
      sent: 0,
      retryScheduled: 0,
      failed: 0,
      errors: [] as string[]
    };

    for (const notification of notifications) {
      try {
        const result = await sendNotification(notification);

        if (result.success) {
          await supabase
            .from('notifications_outbox')
            .update({
              status: 'sent',
              sent_at: now,
              provider: result.provider,
              provider_message_id: result.messageId,
              last_attempt_at: now
            })
            .eq('id', notification.id);

          await writeAuditEvent(
            supabase,
            'notification_sent',
            notification.user_id,
            notification.league_id,
            {
              notification_id: notification.id,
              channel: notification.channel,
              provider: result.provider
            }
          );

          results.sent++;
        } else {
          const newAttemptCount = notification.attempt_count + 1;
          const shouldRetry = isTransientError(result.error || '') && newAttemptCount < MAX_ATTEMPTS;

          if (shouldRetry) {
            const backoffSeconds = calculateBackoff(newAttemptCount);
            const nextAttempt = new Date(Date.now() + backoffSeconds * 1000).toISOString();

            await supabase
              .from('notifications_outbox')
              .update({
                status: 'retry_scheduled',
                attempt_count: newAttemptCount,
                last_attempt_at: now,
                last_error: result.error,
                next_attempt_at: nextAttempt,
                locked_at: null,
                locked_by: null
              })
              .eq('id', notification.id);

            await writeAuditEvent(
              supabase,
              'notification_retry_scheduled',
              notification.user_id,
              notification.league_id,
              {
                notification_id: notification.id,
                channel: notification.channel,
                attempt: newAttemptCount,
                next_attempt_at: nextAttempt,
                error: result.error
              }
            );

            results.retryScheduled++;
          } else {
            await supabase
              .from('notifications_outbox')
              .update({
                status: 'failed',
                attempt_count: newAttemptCount,
                last_attempt_at: now,
                last_error: result.error
              })
              .eq('id', notification.id);

            await writeAuditEvent(
              supabase,
              'notification_failed',
              notification.user_id,
              notification.league_id,
              {
                notification_id: notification.id,
                channel: notification.channel,
                attempt: newAttemptCount,
                error: result.error,
                reason: shouldRetry ? 'max_attempts_reached' : 'permanent_error'
              }
            );

            results.failed++;
          }
        }
      } catch (err) {
        console.error(`Failed to process notification ${notification.id}:`, err);
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        results.errors.push(`${notification.id}: ${errorMessage}`);

        await supabase
          .from('notifications_outbox')
          .update({
            status: 'failed',
            last_error: errorMessage,
            last_attempt_at: now,
            attempt_count: notification.attempt_count + 1
          })
          .eq('id', notification.id);
      }
    }

    return new Response(
      JSON.stringify({
        message: "Notifications processed",
        workerId: WORKER_ID,
        claimed: notifications.length,
        ...results
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