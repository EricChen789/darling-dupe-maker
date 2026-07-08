/**
 * Safely trigger a PDF download from a base64-encoded string.
 * Handles the click/removeChild race condition safely.
 */
export function downloadBase64Pdf(base64: string, filename: string): void {
  const byteChars = atob(base64);
  const byteArray = new Uint8Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) byteArray[i] = byteChars.charCodeAt(i);
  const blob = new Blob([byteArray], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  // Delay removal — click() may trigger async download that messes with the DOM
  setTimeout(() => {
    try {
      if (a.parentNode) a.parentNode.removeChild(a);
    } catch (_) { /* already removed by browser */ }
    URL.revokeObjectURL(url);
  }, 100);
}

/**
 * Same as above but also opens the PDF in a new tab.
 */
export function downloadAndOpenBase64Pdf(base64: string, filename: string): void {
  const byteChars = atob(base64);
  const byteArray = new Uint8Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) byteArray[i] = byteChars.charCodeAt(i);
  const blob = new Blob([byteArray], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.target = '_blank';
  document.body.appendChild(a);
  a.click();
  window.open(url, '_blank');
  setTimeout(() => {
    try {
      if (a.parentNode) a.parentNode.removeChild(a);
    } catch (_) { /* already removed */ }
    // Don't revoke — opened tab still needs the blob URL
  }, 200);
}

/**
 * Generic base64 → file download with an explicit MIME type.
 * Used for .docx and other non-PDF artifacts. Same DOM-safe removal as above.
 */
export function downloadBase64File(base64: string, filename: string, mime: string): void {
  const byteChars = atob(base64);
  const byteArray = new Uint8Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) byteArray[i] = byteChars.charCodeAt(i);
  const blob = new Blob([byteArray], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    try {
      if (a.parentNode) a.parentNode.removeChild(a);
    } catch (_) { /* already removed by browser */ }
    URL.revokeObjectURL(url);
  }, 100);
}

export const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
