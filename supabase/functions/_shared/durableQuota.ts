// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.42.0";

const subjectHash = async (request: Request) => {
  const address = request.headers.get('cf-connecting-ip')
    || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || 'unknown';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(address));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
};

export const enforceDurableRateLimit = async (request: Request, scope: string, limit: number) => {
  const url = Deno.env.get('SUPABASE_URL') || '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (!url || !serviceRoleKey) throw new Error('Durable quota configuration is unavailable');
  const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
  const { data: allowed, error } = await admin.rpc('consume_edge_quota', {
    p_scope: scope,
    p_subject_hash: await subjectHash(request),
    p_limit: limit,
  });
  if (error) throw new Error('Durable quota check failed');
  if (!allowed) {
    const quotaError = new Error('Rate limit exceeded');
    quotaError.status = 429;
    quotaError.retryAfterSeconds = 60;
    throw quotaError;
  }
};
