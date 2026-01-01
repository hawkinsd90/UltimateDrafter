import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.39.3";

const ALLOWED_ORIGINS = [
  "http://localhost:5173",
  // TODO: Add production origins when deployed:
  // "https://your-app.netlify.app",
  // "https://yourdomain.com"
];

function getCorsHeaders(origin: string | null): Record<string, string> {
  const isAllowed = origin && ALLOWED_ORIGINS.includes(origin);
  const headers: Record<string, string> = {
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
  };

  if (isAllowed) {
    headers["Access-Control-Allow-Origin"] = origin;
  } else {
    headers["Access-Control-Allow-Origin"] = "null";
  }

  return headers;
}

interface EnqueueRequest {
  channel: 'email' | 'sms' | 'voice' | 'push';
  userId: string;
  leagueId?: string;
  teamId?: string;
  templateKey?: string;
  payload?: Record<string, unknown>;
  messageText?: string;
}

interface UserProfile {
  user_id: string;
  phone_e164: string | null;
  phone_verified: boolean;
  sms_consent: boolean;
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  const corsHeaders = getCorsHeaders(origin);

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing Authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      {
        global: {
          headers: {
            Authorization: authHeader
          }
        }
      }
    );

    const { data: { user: caller }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !caller) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid or expired token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const body: EnqueueRequest = await req.json();
    const { channel, userId, leagueId, teamId, templateKey, payload, messageText } = body;

    if (!channel || !userId) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing required fields: channel, userId' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (leagueId) {
      const { data: league } = await supabaseAdmin
        .from('leagues')
        .select('created_by')
        .eq('id', leagueId)
        .maybeSingle();

      if (!league) {
        return new Response(
          JSON.stringify({ success: false, error: 'League not found' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const isCreator = league.created_by === caller.id;

      if (!isCreator) {
        const { data: callerMembership } = await supabaseAdmin
          .from('league_members')
          .select('id')
          .eq('league_id', leagueId)
          .eq('user_id', caller.id)
          .maybeSingle();

        if (!callerMembership) {
          return new Response(
            JSON.stringify({ success: false, error: 'Not authorized to send notifications for this league' }),
            { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      }

      if (!isCreator) {
        const { data: targetMembership } = await supabaseAdmin
          .from('league_members')
          .select('id')
          .eq('league_id', leagueId)
          .eq('user_id', userId)
          .maybeSingle();

        if (!targetMembership) {
          return new Response(
            JSON.stringify({ success: false, error: 'Target user is not a member of this league' }),
            { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      }
    }

    // Resolve destination based on channel
    let destination: string | null = null;
    let profile: UserProfile | null = null;

    if (channel === 'email') {
      // Fetch email from auth.users using SERVICE_ROLE
      const { data: authUser, error } = await supabaseAdmin.auth.admin.getUserById(userId);
      if (error || !authUser.user?.email) {
        destination = null;
      } else {
        destination = authUser.user.email;
      }
    } else if (channel === 'sms' || channel === 'voice') {
      // Fetch phone and verification status from user_profile
      const { data } = await supabaseAdmin
        .from('user_profile')
        .select('user_id, phone_e164, phone_verified, sms_consent')
        .eq('user_id', userId)
        .maybeSingle();

      profile = data as UserProfile | null;
      destination = profile?.phone_e164 || null;
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
          reason: 'no_destination',
          requested_by: caller.id
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

    // Check verification and consent for SMS/voice (email doesn't require explicit consent)
    if (channel === 'sms' || channel === 'voice') {
      let isAllowed = false;
      let blockReason = '';

      if (!profile) {
        isAllowed = false;
        blockReason = 'No user profile found';
      } else if (!profile.phone_verified) {
        isAllowed = false;
        blockReason = 'Phone number not verified';
      } else if (channel === 'sms' && !profile.sms_consent) {
        isAllowed = false;
        blockReason = 'SMS consent not granted';
      } else if (channel === 'voice') {
        isAllowed = false;
        blockReason = 'Voice notifications not yet supported';
      } else {
        isAllowed = true;
      }

      if (!isAllowed) {
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
            details: blockReason,
            requested_by: caller.id
          }
        });

        return new Response(
          JSON.stringify({
            success: false,
            notificationId: notification.id,
            status: 'blocked_no_consent',
            error: blockReason
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
        destination,
        requested_by: caller.id
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