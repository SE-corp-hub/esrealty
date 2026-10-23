// The listing function's rate limits. Each key is hashed with the pepper, so the database never
// sees a visitor's address; the same key text always gives the same count.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";

export type Limits = {
  // At most `perHour` per key in an hour; past that, a 429 with the message.
  limit: (admin: SupabaseClient, pepper: string, key: string, perHour: number, message: string) => Promise<void>;
  // True the first time a key is seen in a day (one view or tap counted per visitor). Never throws.
  firstToday: (admin: SupabaseClient, pepper: string, key: string) => Promise<boolean>;
};

export const makeLimits = (sha256: (v: string) => Promise<string>, HttpError: new (status: number, message: string) => Error): Limits => {
  const consume = async (admin: SupabaseClient, pepper: string, key: string, max: number, seconds: number) =>
    await admin.rpc("consume_listing_inquiry_rate_limit", { p_request_key_hash: await sha256(`${pepper}:${key}`), p_limit: max, p_window_seconds: seconds });
  return {
    limit: async (admin, pepper, key, perHour, message) => {
      const { data, error } = await consume(admin, pepper, key, perHour, 3600);
      if (error) throw new Error(error.message);
      if (!data) throw new HttpError(429, message);
    },
    firstToday: async (admin, pepper, key) => {
      const { data, error } = await consume(admin, pepper, key, 1, 86400);
      if (error) { console.error(error); return false; }
      return !!data;
    },
  };
};
