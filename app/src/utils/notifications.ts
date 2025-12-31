import { supabase } from '../lib/supabase';
import type { EnqueueNotificationInput } from '../types/notifications';

interface EnqueueResult {
  success: boolean;
  notificationId?: string;
  error?: string;
  status?: string;
  destination?: string;
}

export async function enqueueNotification(input: EnqueueNotificationInput): Promise<EnqueueResult> {
  try {
    const { channel, userId, leagueId, teamId, templateKey, payload, messageText } = input;

    const { data, error } = await supabase.functions.invoke('enqueue-notification', {
      body: {
        channel,
        userId,
        leagueId,
        teamId,
        templateKey,
        payload,
        messageText
      }
    });

    if (error) {
      console.error('Edge function error:', error);
      return {
        success: false,
        error: error.message || 'Failed to invoke notification function'
      };
    }

    return data as EnqueueResult;
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
