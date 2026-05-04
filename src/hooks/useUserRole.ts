import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export type AppRole = 'admin' | 'moderator' | 'user';

/**
 * Returns the current user's roles and convenience flags.
 * Roles are stored in the `user_roles` table (RLS: user can read own roles).
 */
export function useUserRole() {
  const { user } = useAuth();
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    async function load() {
      if (!user) {
        if (active) {
          setRoles([]);
          setLoading(false);
        }
        return;
      }
      setLoading(true);
      const { data, error } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id);
      if (!active) return;
      if (error) {
        console.error('Failed to load user roles:', error);
        setRoles([]);
      } else {
        setRoles((data || []).map((r: any) => r.role as AppRole));
      }
      setLoading(false);
    }
    load();
    return () => {
      active = false;
    };
  }, [user]);

  const isAdmin = roles.includes('admin');
  const isModerator = roles.includes('moderator');
  const canDelete = isAdmin || isModerator;

  return { roles, isAdmin, isModerator, canDelete, loading };
}
