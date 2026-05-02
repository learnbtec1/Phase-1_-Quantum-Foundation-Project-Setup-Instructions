/**
 * Client-side: extract text via /api/parse-file (PDF, DOCX, PPTX) or file.text (txt/md).
 */
export async function parseDocumentToText(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".txt") || name.endsWith(".md")) {
    return (await file.text()).replace(/\0/g, " ").trim();
  }
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch("/api/parse-file", { method: "POST", body: fd });
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(j.error || "فشل استخراج النص من الملف");
  }
  const data = (await res.json()) as { text?: string };
  return (data.text || "").replace(/\0/g, " ").trim();
}
