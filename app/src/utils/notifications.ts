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

    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) {
      console.warn('[enqueueNotification] No active session — skipping notification', { channel: input.channel, userId: input.userId });
      return { success: false, error: 'No active session' };
    }

    const supabaseUrl = (supabase as unknown as { supabaseUrl: string }).supabaseUrl
      ?? import.meta.env.VITE_SUPABASE_URL;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${session.access_token}`,
    };

    const res = await fetch(`${supabaseUrl}/functions/v1/enqueue-notification`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ channel, userId, leagueId, teamId, templateKey, payload, messageText }),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error('enqueue-notification error:', res.status, text);
      return { success: false, error: `HTTP ${res.status}` };
    }

    return await res.json() as EnqueueResult;
  } catch (err) {
    console.error('Error enqueueing notification:', err);
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
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
