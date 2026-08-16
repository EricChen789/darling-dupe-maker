// Shared helpers for CR-form generation: retrying POST, base64 download,
// name/date parsing and ND2A officer chunking.
// Retry/backoff tuned for CF Pages free-plan Error 1102 (isolate CPU accumulation):
//   fontkit/font-parsing per request is the biggest killer — long backoff windows help.

export function getJwt(): string {
  return localStorage.getItem('secretary_jwt') || '';
}

/**
 * POST JSON with retries: 4 attempts, 30s timeout, 3s/6s/9s backoff.
 * 5xx/429/timeout/network errors are retried; 4xx are not.
 * `?t=` cache-busts the endpoint (incl. cached 503/1102 error pages).
 */
export async function postJson(endpoint: string, payload: any): Promise<any> {
  let lastErr: Error = new Error('Network error');
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30000);
      const sep = endpoint.includes('?') ? '&' : '?';
      const resp = await fetch(`${endpoint}${sep}t=${Date.now()}-${attempt}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getJwt()}` },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!resp.ok) {
        if (resp.status >= 500 || resp.status === 429) throw new Error(`HTTP ${resp.status}`);
        const err = await resp.json().catch(() => ({ error: resp.statusText }));
        throw new Error(err.error || `HTTP ${resp.status}`);
      }
      return resp.json();
    } catch (err: any) {
      lastErr = err;
      const retriable = err.name === 'AbortError' || err.name === 'TypeError'
        || /^HTTP (5\d\d|429)$/.test(err.message || '');
      if (attempt < 4 && retriable) {
        await new Promise(r => setTimeout(r, 3000 * attempt));
        continue;
      }
      throw lastErr;
    }
  }
  throw lastErr;
}

export const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/** Filesystem-safe filename fragment from a company name. */
export function safeFileName(name: string): string {
  return (name || 'company').replace(/[^a-zA-Z0-9一-鿿]/g, '_');
}

/**
 * Parse English full name into surname + otherNames.
 * Matches Flask `_parse_english_name`: comma → "SURNAME, Other Names";
 * otherwise Chinese/HK convention → first word = surname, rest = otherNames.
 */
export function parseEnglishName(fullName: string): { surname: string; otherNames: string } {
  if (!fullName) return { surname: '', otherNames: '' };
  const cleaned = fullName.trim();
  // Comma-separated: "SMITH, John" or "CHAN, Tai Man"
  if (cleaned.includes(',')) {
    const segs = cleaned.split(',').map(s => s.trim()).filter(Boolean);
    if (segs.length >= 2) return { surname: segs[0], otherNames: segs.slice(1).join(' ') };
    return { surname: segs[0] || '', otherNames: '' };
  }
  // Chinese/HK convention: first word = surname
  const parts = cleaned.split(/\s+/);
  if (parts.length <= 1) return { surname: parts[0] || '', otherNames: '' };
  return { surname: parts[0], otherNames: parts.slice(1).join(' ') };
}

/** Parse DD/MM/YYYY, YYYY-MM-DD or DDMMYYYY into { day, month, year }. */
export function parseDateParts(dateStr: string): { day: string; month: string; year: string } {
  if (!dateStr) return { day: '', month: '', year: '' };
  // DD/MM/YYYY
  let m = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return { day: m[1].padStart(2, '0'), month: m[2].padStart(2, '0'), year: m[3] };
  // YYYY-MM-DD
  m = dateStr.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return { day: m[3].padStart(2, '0'), month: m[2].padStart(2, '0'), year: m[1] };
  // DDMMYYYY (8 digits)
  m = dateStr.match(/^(\d{2})(\d{2})(\d{4})$/);
  if (m) return { day: m[1], month: m[2], year: m[3] };
  return { day: '', month: '', year: '' };
}

/** Normalise any supported date format to YYYY-MM-DD. */
export function normalizeDate(dateStr: string): string {
  const { day, month, year } = parseDateParts(dateStr);
  return day && month && year ? `${year}-${month}-${day}` : dateStr || '';
}

/**
 * Split ND2A officers into forms respecting template capacity:
 * 2 cessations (P.1/P.4) + 2 natural appointments (P.2/P.5) + 2 corporate (P.3/P.6) per form.
 */
export function chunkNd2aOfficers(officers: any[]): any[][] {
  const cess = officers.filter(o => o.type === 'cessation');
  const nat = officers.filter(o => o.type === 'appointment' && o.identity === 'natural');
  const corp = officers.filter(o => o.type === 'appointment' && o.identity === 'corporate');
  const nForms = Math.max(1, Math.ceil(cess.length / 2), Math.ceil(nat.length / 2), Math.ceil(corp.length / 2));
  const chunks: any[][] = [];
  for (let i = 0; i < nForms; i++) {
    chunks.push([
      ...cess.slice(i * 2, i * 2 + 2),
      ...nat.slice(i * 2, i * 2 + 2),
      ...corp.slice(i * 2, i * 2 + 2),
    ]);
  }
  return chunks;
}
