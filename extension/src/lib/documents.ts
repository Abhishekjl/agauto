import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export interface StoredDocument {
  name: string;
  mime: string;
  /** base64 (no data: prefix) — used to attach the file to form file-inputs */
  dataBase64: string;
}

export interface PreparedDocument {
  /** raw file, kept for upload_document */
  stored: StoredDocument;
  /** page images as data URLs — for PDF/image docs (empty otherwise) */
  images: string[];
  /** extracted text — for .txt docs (undefined otherwise) */
  text?: string;
  /** true when we can't extract content vision-only (e.g. .doc/.docx) — attach-only */
  extractable: boolean;
}

// Keep extraction images small so requests stay well under any gateway limit
// and vision token cost stays low. These are only for reading the document —
// the original file bytes (stored.dataBase64) are kept intact for form uploads.
const MAX_PAGES = 3;
const MAX_DIM = 1300; // px, longest side
const JPEG_QUALITY = 0.75;

export async function prepareDocument(file: File): Promise<PreparedDocument> {
  const dataUrl = await readAsDataURL(file);
  const dataBase64 = dataUrl.split(",")[1] ?? "";
  const mime = file.type || guessMime(file.name);
  const stored: StoredDocument = { name: file.name, mime, dataBase64 };

  if (isPdf(file, mime)) {
    const images = await pdfToImages(file);
    return { stored, images, extractable: images.length > 0 };
  }
  if (mime.startsWith("image/")) {
    const image = await downscaleImage(dataUrl);
    return { stored, images: [image], extractable: true };
  }
  if (isText(file, mime)) {
    const text = await file.text();
    return { stored, images: [], text, extractable: text.trim().length > 0 };
  }
  // .doc/.docx and anything else: can't read vision-only → attach-only.
  return { stored, images: [], extractable: false };
}

/* ------------------------------ helpers ------------------------------ */

async function pdfToImages(file: File): Promise<string[]> {
  const buf = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjs.getDocument({ data: buf }).promise;
  const pages = Math.min(pdf.numPages, MAX_PAGES);
  const images: string[] = [];
  for (let p = 1; p <= pages; p++) {
    const page = await pdf.getPage(p);
    const base = page.getViewport({ scale: 1 });
    // scale so the longest side is ~MAX_DIM (don't upscale tiny pages past 2x)
    const scale = Math.min(2, MAX_DIM / Math.max(base.width, base.height));
    const viewport = page.getViewport({ scale: scale > 0 ? scale : 1 });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) continue;
    await page.render({ canvasContext: ctx, viewport }).promise;
    images.push(canvas.toDataURL("image/jpeg", JPEG_QUALITY));
  }
  return images;
}

/** Downscale an uploaded image and re-encode as JPEG to shrink the payload. */
async function downscaleImage(dataUrl: string): Promise<string> {
  const img = await loadImage(dataUrl);
  const longest = Math.max(img.width, img.height) || 1;
  const scale = Math.min(1, MAX_DIM / longest);
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return dataUrl;
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", JPEG_QUALITY);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("could not load image"));
    img.src = src;
  });
}

function readAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error ?? new Error("read failed"));
    r.readAsDataURL(file);
  });
}

function isPdf(file: File, mime: string): boolean {
  return mime === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

function isText(file: File, mime: string): boolean {
  return (
    mime.startsWith("text/") ||
    /\.(txt|md|csv|json)$/i.test(file.name)
  );
}

function guessMime(name: string): string {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  const map: Record<string, string> = {
    pdf: "application/pdf",
    txt: "text/plain",
    md: "text/markdown",
    csv: "text/csv",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  };
  return map[ext] ?? "application/octet-stream";
}
