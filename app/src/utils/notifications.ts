import { supabase } from '../lib/supabase';
import type { EnqueueNotificationInput, NotificationChannel, UserNotificationSettings } from '../types/notifications';

interface EnqueueResult {
  success: boolean;
  notificationId?: string;
  error?: string;
  status?: string;
}

async function resolveDestination(
  channel: NotificationChannel,
  explicitDestination: string | undefined,
  userId: string | undefined
): Promise<{ destination: string | null; settings: UserNotificationSettings | null }> {
  if (explicitDestination) {
    return { destination: explicitDestination, settings: null };
  }

  if (!userId) {
    return { destination: null, settings: null };
  }

  if (channel === 'email') {
    const { data: user } = await supabase.auth.getUser();
    if (user?.user?.email) {
      return { destination: user.user.email, settings: null };
    }

    const { data: authUser } = await supabase
      .from('auth.users')
      .select('email')
      .eq('id', userId)
      .maybeSingle();

    return { destination: authUser?.email || null, settings: null };
  }

  if (channel === 'sms' || channel === 'voice') {
    const { data: settings } = await supabase
      .from('user_notification_settings')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    return {
      destination: settings?.phone_e164 || null,
      settings: settings as UserNotificationSettings | null
    };
  }

  return { destination: null, settings: null };
}

function checkConsent(
  channel: NotificationChannel,
  settings: UserNotificationSettings | null
): { hasConsent: boolean; reason?: string } {
  if (channel === 'email' || channel === 'push') {
    return { hasConsent: true };
  }

  if (!settings) {
    return { hasConsent: false, reason: 'No notification settings found' };
  }

  if (channel === 'sms') {
    if (!settings.consent_sms) {
      return { hasConsent: false, reason: 'SMS consent not granted' };
    }
    if (settings.opted_out_sms) {
      return { hasConsent: false, reason: 'User opted out of SMS' };
    }
    return { hasConsent: true };
  }

  if (channel === 'voice') {
    if (!settings.consent_voice) {
      return { hasConsent: false, reason: 'Voice consent not granted' };
    }
    if (settings.opted_out_voice) {
      return { hasConsent: false, reason: 'User opted out of voice calls' };
    }
    return { hasConsent: true };
  }

  return { hasConsent: true };
}

async function writeAuditEvent(
  eventType: string,
  userId: string | undefined,
  leagueId: string | undefined,
  payload: Record<string, unknown>
): Promise<void> {
  try {
    await supabase.from('audit_events').insert({
      event_type: eventType,
      user_id: userId || null,
      league_id: leagueId || null,
      payload
    });
  } catch (err) {
    console.error('Failed to write audit event:', err);
  }
}

export async function enqueueNotification(input: EnqueueNotificationInput): Promise<EnqueueResult> {
  try {
    const { channel, userId, leagueId, teamId, templateKey, payload, messageText } = input;

    const { destination, settings } = await resolveDestination(
      channel,
      input.destination,
      userId
    );

    if (!destination) {
      const notificationData = {
        channel,
        destination: '',
        user_id: userId || null,
        league_id: leagueId || null,
        team_id: teamId || null,
        template_key: templateKey || null,
        payload: payload || {},
        message_text: messageText || null,
        status: 'blocked_no_destination',
        next_attempt_at: new Date().toISOString()
      };

      const { data: notification, error } = await supabase
        .from('notifications_outbox')
        .insert(notificationData)
        .select('id')
        .single();

      if (error) {
        console.error('Failed to create blocked notification:', error);
        return { success: false, error: error.message };
      }

      await writeAuditEvent('notification_blocked', userId, leagueId, {
        notification_id: notification.id,
        channel,
        reason: 'no_destination'
      });

      return {
        success: false,
        notificationId: notification.id,
        status: 'blocked_no_destination',
        error: 'No destination available'
      };
    }

    const consentCheck = checkConsent(channel, settings);
    if (!consentCheck.hasConsent) {
      const notificationData = {
        channel,
        destination,
        user_id: userId || null,
        league_id: leagueId || null,
        team_id: teamId || null,
        template_key: templateKey || null,
        payload: payload || {},
        message_text: messageText || null,
        status: 'blocked_no_consent',
        next_attempt_at: new Date().toISOString()
      };

      const { data: notification, error } = await supabase
        .from('notifications_outbox')
        .insert(notificationData)
        .select('id')
        .single();

      if (error) {
        console.error('Failed to create blocked notification:', error);
        return { success: false, error: error.message };
      }

      await writeAuditEvent('notification_blocked', userId, leagueId, {
        notification_id: notification.id,
        channel,
        reason: 'no_consent',
        details: consentCheck.reason
      });

      return {
        success: false,
        notificationId: notification.id,
        status: 'blocked_no_consent',
        error: consentCheck.reason || 'Consent not granted'
      };
    }

    const notificationData = {
      channel,
      destination,
      user_id: userId || null,
      league_id: leagueId || null,
      team_id: teamId || null,
      template_key: templateKey || null,
      payload: payload || {},
      message_text: messageText || null,
      status: 'pending',
      next_attempt_at: new Date().toISOString()
    };

    const { data: notification, error } = await supabase
      .from('notifications_outbox')
      .insert(notificationData)
      .select('id')
      .single();

    if (error) {
      console.error('Failed to enqueue notification:', error);
      return { success: false, error: error.message };
    }

    await writeAuditEvent('notification_enqueued', userId, leagueId, {
      notification_id: notification.id,
      channel,
      destination
    });

    return {
      success: true,
      notificationId: notification.id,
      status: 'pending'
    };
  } catch (err) {
    console.error('Error enqueueing notification:', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error'
    };
  }
}

export function validateE164PhoneNumber(phone: string): boolean {
  const e164Regex = /^\+[1-9]\d{1,14}$/;
  return e164Regex.test(phone);
}

export function formatPhoneForE164(phone: string): string | null {
  const cleaned = phone.replace(/\D/g, '');

  if (cleaned.length === 10) {
    return `+1${cleaned}`;
  }

  if (cleaned.length === 11 && cleaned.startsWith('1')) {
    return `+${cleaned}`;
  }

  if (phone.startsWith('+') && validateE164PhoneNumber(phone)) {
    return phone;
  }

  return null;
}
