import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

const API = '/api/presenters';

export interface Presenter {
  id: string;
  name: string;
  address: string;
  contact: string;
  type: string;
  phone: string;
  fax: string;
  email: string;
  reference: string;
  created_at: string;
  updated_at: string;
}

async function api(opts: { method?: string; body?: any; id?: string } = {}) {
  const token = localStorage.getItem('secretary_jwt') || '';
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
  const url = opts.id ? `${API}/${opts.id}` : API;
  const resp = await fetch(url, {
    method: opts.method || 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }));
    throw new Error(err.error || `HTTP ${resp.status}`);
  }
  return resp.json();
}

export function usePresenterList() {
  return useQuery<Presenter[]>({
    queryKey: ['presenters'],
    queryFn: () => api(),
  });
}

export function useCreatePresenter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Omit<Presenter, 'id' | 'created_at' | 'updated_at'>) =>
      api({ method: 'POST', body: data }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['presenters'] }),
  });
}

export function useUpdatePresenter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: Partial<Presenter> & { id: string }) =>
      api({ method: 'PUT', body: data, id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['presenters'] }),
  });
}

export function useDeletePresenter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api({ method: 'DELETE', id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['presenters'] }),
  });
}
