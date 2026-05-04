/**
 * Browser-safe base64 of raw file bytes (for assessment submission_files).
 */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const d = r.result as string;
      const i = d.indexOf("base64,");
      resolve(i >= 0 ? d.slice(i + 7) : btoa(d));
    };
    r.onerror = () => reject(r.error ?? new Error("read failed"));
    r.readAsDataURL(file);
  });
}
