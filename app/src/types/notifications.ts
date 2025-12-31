export type NotificationChannel = 'email' | 'sms' | 'voice' | 'push';

export type NotificationStatus =
  | 'pending'
  | 'processing'
  | 'sent'
  | 'failed'
  | 'retry_scheduled'
  | 'blocked_no_consent'
  | 'blocked_no_destination';

export type AuditEventType =
  | 'notification_enqueued'
  | 'notification_sent'
  | 'notification_failed'
  | 'notification_retry_scheduled'
  | 'notification_blocked';

export interface EnqueueNotificationInput {
  channel: NotificationChannel;
  destination?: string;
  userId?: string;
  leagueId?: string;
  teamId?: string;
  templateKey?: string;
  payload?: Record<string, unknown>;
  messageText?: string;
}

export interface UserNotificationSettings {
  user_id: string;
  phone_e164: string | null;
  phone_verified: boolean;
  consent_sms: boolean;
  consent_voice: boolean;
  consent_updated_at: string | null;
  consent_text_version: string | null;
  opted_out_sms: boolean;
  opted_out_voice: boolean;
  created_at: string;
  updated_at: string;
}

export const CONSENT_TEXT_VERSION = 'v1.0';
export const CONSENT_TEXT = `By providing your phone number, you agree to receive notifications about your fantasy drafts via SMS and/or voice calls. Message and data rates may apply. Reply STOP to opt out at any time. Reply HELP for assistance.`;
