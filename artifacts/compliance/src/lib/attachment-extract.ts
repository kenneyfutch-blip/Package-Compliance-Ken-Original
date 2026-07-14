import * as pdfjsLib from "pdfjs-dist"
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url"

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

const MAX_DIMENSION = 1600

/** File types the assistant "add documents" picker accepts. */
export const ATTACHMENT_ACCEPT =
  ".pdf,.png,.jpg,.jpeg,.webp,.gif,.txt,.md,.csv,.log,application/pdf,text/*,image/*"

/** Reject anything above this before we try to read it into memory. */
export const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024
export const MAX_ATTACHMENT_LABEL = "15MB"

/** Cap on the text we forward per document, to keep the chat payload sane. */
const MAX_TEXT_CHARS = 20_000

/** Runs server-side OCR on an image data URL and returns the transcribed text. */
export type RunOcr = (imageDataUrl: string) => Promise<string>

function clamp(text: string): string {
  const trimmed = text.trim()
  return trimmed.length > MAX_TEXT_CHARS
    ? trimmed.slice(0, MAX_TEXT_CHARS) + "\n\n[document truncated]"
    : trimmed
}

function isTextFile(file: File): boolean {
  return (
    file.type.startsWith("text/") ||
    /\.(txt|md|csv|log)$/i.test(file.name)
  )
}

function isPdf(file: File): boolean {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name)
}

function isImage(file: File): boolean {
  return file.type.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/i.test(file.name)
}

/** Downscale an image file (longest edge <= MAX_DIMENSION) to a JPEG data URL. */
function fileToDownscaledDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error("Could not read file"))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error("Could not load image"))
      img.onload = () => {
        const scale = Math.min(1, MAX_DIMENSION / Math.max(img.width, img.height))
        const w = Math.round(img.width * scale)
        const h = Math.round(img.height * scale)
        const canvas = document.createElement("canvas")
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext("2d")
        if (!ctx) {
          reject(new Error("Canvas not supported"))
          return
        }
        ctx.drawImage(img, 0, 0, w, h)
        resolve(canvas.toDataURL("image/jpeg", 0.85))
      }
      img.src = reader.result as string
    }
    reader.readAsDataURL(file)
  })
}

/** Pull the embedded text layer out of a PDF in the browser (no AI round-trip). */
async function extractPdfText(file: File): Promise<string> {
  const buf = await file.arrayBuffer()
  const doc = await pdfjsLib.getDocument({ data: buf }).promise
  try {
    const maxPages = Math.min(doc.numPages, 20)
    const parts: string[] = []
    for (let i = 1; i <= maxPages; i++) {
      const page = await doc.getPage(i)
      const content = await page.getTextContent()
      const text = content.items
        .map((it) => ("str" in it ? it.str : ""))
        .join(" ")
        .trim()
      if (text) parts.push(text)
    }
    return parts.join("\n\n")
  } finally {
    await doc.destroy()
  }
}

/**
 * Turn an attached file into plain text the assistant can reason over.
 * - Text files are read directly.
 * - PDFs use their embedded text layer (client-side, instant).
 * - Images (and PDFs with no text layer, via a rendered fallback is out of
 *   scope) are OCR'd server-side through `runOcr`.
 * Throws a user-friendly Error when the file can't be turned into text.
 */
export async function extractAttachmentText(
  file: File,
  runOcr: RunOcr,
): Promise<string> {
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new Error(`${file.name} is larger than ${MAX_ATTACHMENT_LABEL}.`)
  }

  if (isTextFile(file)) {
    const text = clamp(await file.text())
    if (!text) throw new Error(`${file.name} appears to be empty.`)
    return text
  }

  if (isPdf(file)) {
    const text = clamp(await extractPdfText(file))
    if (!text) {
      throw new Error(
        `Couldn't read text from ${file.name}. Scanned PDFs aren't supported yet — try a text-based PDF or an image.`,
      )
    }
    return text
  }

  if (isImage(file)) {
    const dataUrl = await fileToDownscaledDataUrl(file)
    const text = clamp(await runOcr(dataUrl))
    if (!text) throw new Error(`Couldn't read any text from ${file.name}.`)
    return text
  }

  throw new Error(`${file.name} isn't a supported document type.`)
}
