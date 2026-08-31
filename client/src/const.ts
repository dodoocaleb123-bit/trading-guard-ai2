export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { supabase } from "./lib/supabase";

export const startLogin = async () => {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: window.location.origin,
    },
  });
  if (error) {
    console.error("[Supabase Auth] Google sign-in failed", error);
    throw error;
  }
};
