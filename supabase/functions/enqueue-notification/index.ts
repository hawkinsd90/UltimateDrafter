import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface EnqueueRequest {
  channel: 'email' | 'sms' | 'voice' | 'push';
  userId: string;
  leagueId?: string;
  teamId?: string;
  templateKey?: string;
  payload?: Record<string, unknown>;
  messageText?: string;
}

interface UserNotificationSettings {
  user_id: string;
  phone_e164: string | null;
  consent_sms: boolean;
  consent_voice: boolean;
  opted_out_sms: boolean;
  opted_out_voice: boolean;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const body: EnqueueRequest = await req.json();
    const { channel, userId, leagueId, teamId, templateKey, payload, messageText } = body;

    if (!channel || !userId) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing required fields: channel, userId' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Resolve destination based on channel
    let destination: string | null = null;
    let settings: UserNotificationSettings | null = null;

    if (channel === 'email') {
      // Fetch email from auth.users using SERVICE_ROLE
      const { data: authUser, error } = await supabaseAdmin.auth.admin.getUserById(userId);
      if (error || !authUser.user?.email) {
        destination = null;
      } else {
        destination = authUser.user.email;
      }
    } else if (channel === 'sms' || channel === 'voice') {
      // Fetch phone and consent from user_notification_settings
      const { data } = await supabaseAdmin
        .from('user_notification_settings')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

      settings = data as UserNotificationSettings | null;
      destination = settings?.phone_e164 || null;
    }

    // Check if destination is available
    if (!destination) {
      const notificationData = {
        channel,
        destination: '',
        user_id: userId,
        league_id: leagueId || null,
        team_id: teamId || null,
        template_key: templateKey || null,
        payload: payload || {},
        message_text: messageText || null,
        status: 'blocked_no_destination',
        next_attempt_at: new Date().toISOString()
      };

      const { data: notification, error } = await supabaseAdmin
        .from('notifications_outbox')
        .insert(notificationData)
        .select('id')
        .single();

      if (error) {
        throw new Error(`Failed to insert blocked notification: ${error.message}`);
      }

      await supabaseAdmin.from('audit_events').insert({
        event_type: 'notification_blocked',
        user_id: userId,
        league_id: leagueId || null,
        payload: {
          notification_id: notification.id,
          channel,
          reason: 'no_destination'
        }
      });

      return new Response(
        JSON.stringify({
          success: false,
          notificationId: notification.id,
          status: 'blocked_no_destination',
          error: 'No destination available'
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check consent for SMS/voice (email doesn't require explicit consent)
    if (channel === 'sms' || channel === 'voice') {
      let hasConsent = false;
      let consentReason = '';

      if (!settings) {
        hasConsent = false;
        consentReason = 'No notification settings found';
      } else if (channel === 'sms') {
        if (!settings.consent_sms) {
          hasConsent = false;
          consentReason = 'SMS consent not granted';
        } else if (settings.opted_out_sms) {
          hasConsent = false;
          consentReason = 'User opted out of SMS';
        } else {
          hasConsent = true;
        }
      } else if (channel === 'voice') {
        if (!settings.consent_voice) {
          hasConsent = false;
          consentReason = 'Voice consent not granted';
        } else if (settings.opted_out_voice) {
          hasConsent = false;
          consentReason = 'User opted out of voice';
        } else {
          hasConsent = true;
        }
      }

      if (!hasConsent) {
        const notificationData = {
          channel,
          destination,
          user_id: userId,
          league_id: leagueId || null,
          team_id: teamId || null,
          template_key: templateKey || null,
          payload: payload || {},
          message_text: messageText || null,
          status: 'blocked_no_consent',
          next_attempt_at: new Date().toISOString()
        };

        const { data: notification, error } = await supabaseAdmin
          .from('notifications_outbox')
          .insert(notificationData)
          .select('id')
          .single();

        if (error) {
          throw new Error(`Failed to insert blocked notification: ${error.message}`);
        }

        await supabaseAdmin.from('audit_events').insert({
          event_type: 'notification_blocked',
          user_id: userId,
          league_id: leagueId || null,
          payload: {
            notification_id: notification.id,
            channel,
            reason: 'no_consent',
            details: consentReason
          }
        });

        return new Response(
          JSON.stringify({
            success: false,
            notificationId: notification.id,
            status: 'blocked_no_consent',
            error: consentReason
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // All checks passed - enqueue notification as pending
    const notificationData = {
      channel,
      destination,
      user_id: userId,
      league_id: leagueId || null,
      team_id: teamId || null,
      template_key: templateKey || null,
      payload: payload || {},
      message_text: messageText || null,
      status: 'pending',
      next_attempt_at: new Date().toISOString()
    };

    const { data: notification, error } = await supabaseAdmin
      .from('notifications_outbox')
      .insert(notificationData)
      .select('id')
      .single();

    if (error) {
      throw new Error(`Failed to enqueue notification: ${error.message}`);
    }

    await supabaseAdmin.from('audit_events').insert({
      event_type: 'notification_enqueued',
      user_id: userId,
      league_id: leagueId || null,
      payload: {
        notification_id: notification.id,
        channel,
        destination
      }
    });

    return new Response(
      JSON.stringify({
        success: true,
        notificationId: notification.id,
        status: 'pending',
        destination
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in enqueue-notification:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});