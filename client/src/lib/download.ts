/**
 * Trigger a browser file download from a Blob.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Fetch a URL as a blob and trigger a browser download.
 */
export async function downloadUrl(src: string, filename: string): Promise<void> {
  const response = await fetch(src);
  const blob = await response.blob();
  downloadBlob(blob, filename);
}
