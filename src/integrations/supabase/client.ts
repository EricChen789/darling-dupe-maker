// D1 + R2 API client (no Supabase dependency)
import { createHybridClient } from '@/lib/d1Api';

// Standalone client - no Supabase needed
const standaloneClient = {
  auth: {
    getSession: async () => {
      const token = localStorage.getItem("secretary_jwt");
      const user = localStorage.getItem("secretary_user");
      return {
        data: {
          session: token ? { access_token: token, user: user ? JSON.parse(user) : null } : null,
        },
      };
    },
    onAuthStateChange: (cb: any) => {
      // Simplified: no real-time auth state changes
      setTimeout(() => cb("SIGNED_IN", null), 0);
      return { data: { subscription: { unsubscribe: () => {} } } };
    },
    signOut: async () => {
      localStorage.removeItem("secretary_jwt");
      localStorage.removeItem("secretary_user");
    },
    signInWithOtp: async () => ({ data: {}, error: null }),
    verifyOtp: async () => ({ data: {}, error: null }),
  },
};

export const supabase = createHybridClient(standaloneClient);
