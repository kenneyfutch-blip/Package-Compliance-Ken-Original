import { useEffect, useRef, useState } from "react"
import { Link, useLocation } from "wouter"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import {
  useCreatePackage,
  useExtractArtworkText,
  useExtractArtworkFields,
  useCheckPackageDuplicates,
  getCheckPackageDuplicatesQueryKey,
  type Package,
} from "@workspace/api-client-react"
import { useUpload, MAX_UPLOAD_LABEL } from "@workspace/object-storage-web"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { UploadCloud, Wand2, Loader2, Info, FileText, X, CheckCircle2, ScanText, AlertTriangle } from "lucide-react"
import { fileTypeFromName } from "@/lib/proof-utils"

const ACCEPT = ".png,.jpg,.jpeg,.pdf,.ai,.indd"
const RENDERABLE = ["png", "jpg", "pdf"]

const MAX_DIMENSION = 1600

// Load an image file, downscale it (longest edge <= MAX_DIMENSION), and return a
// JPEG data URL. Keeps the OCR payload small.
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

const uploadSchema = z.object({
  sku: z.string().min(1, "SKU is required"),
  upc: z.string().optional(),
  name: z.string().min(1, "Product name is required"),
  brand: z.string().min(1, "Brand is required"),
  vendor: z.string().min(1, "Vendor is required"),
  category: z.string().optional(),
  country: z.string().optional(),
  netWeight: z.string().optional(),
  dimensions: z.string().optional(),
  packageType: z.string().optional(),
  productType: z.string().optional(),
  manufacturingRegion: z.string().optional(),
  extractedText: z.string().optional(),
})

type UploadFormValues = z.infer<typeof uploadSchema>

export default function UploadPage() {
  const [, setLocation] = useLocation()
  const createPackage = useCreatePackage()
  const { uploadFile, isUploading, error: uploadError, progress: uploadProgress } = useUpload()
  const extractText = useExtractArtworkText()
  const extractFields = useExtractArtworkFields()
  const [dragActive, setDragActive] = useState(false)
  const [demoLoaded, setDemoLoaded] = useState(false)
  const [ocrError, setOcrError] = useState<string | null>(null)
  // Metadata fields that were auto-filled from the artwork and should be reviewed.
  const [autoFilled, setAutoFilled] = useState<Set<string>>(new Set())
  const [artwork, setArtwork] = useState<{ name: string; type: string; url: string; preview: string | null } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const { register, handleSubmit, formState: { errors }, setValue, watch } = useForm<UploadFormValues>({
    resolver: zodResolver(uploadSchema),
    defaultValues: {
      sku: "",
      name: "",
      brand: "",
      vendor: "",
      extractedText: ""
    }
  })

  // Debounce the identifiers so we only hit the duplicate-check endpoint after
  // the user pauses typing, not on every keystroke.
  const skuValue = watch("sku")
  const upcValue = watch("upc")
  const [dupQuery, setDupQuery] = useState({ sku: "", upc: "" })
  useEffect(() => {
    const t = setTimeout(() => setDupQuery({ sku: skuValue?.trim() ?? "", upc: upcValue?.trim() ?? "" }), 400)
    return () => clearTimeout(t)
  }, [skuValue, upcValue])

  const dupParams = { sku: dupQuery.sku || undefined, upc: dupQuery.upc || undefined }
  const { data: dupData } = useCheckPackageDuplicates(dupParams, {
    query: {
      enabled: dupQuery.sku.length > 0 || dupQuery.upc.length > 0,
      queryKey: getCheckPackageDuplicatesQueryKey(dupParams),
    },
  })

  // Client-side detected matches (proactive warning) plus any surfaced by the
  // server as a 409 backstop when the client check missed a late duplicate.
  const [serverDuplicates, setServerDuplicates] = useState<Package[]>([])
  const duplicates: Package[] = serverDuplicates.length > 0 ? serverDuplicates : (dupData?.matches ?? [])
  const hasDuplicates = duplicates.length > 0

  // Reset any server-surfaced conflict once the identifiers change.
  useEffect(() => { setServerDuplicates([]) }, [dupQuery.sku, dupQuery.upc])

  const onSubmit = (data: UploadFormValues) => {
    // Only treat the submit as an explicit override when the duplicates we're
    // showing were computed for the EXACT identifiers now being submitted. If
    // the user edited SKU/UPC within the debounce window, dupQuery is stale, so
    // we withhold allowDuplicate and let the server's 409 guard re-check.
    const submitSku = data.sku?.trim() ?? ""
    const submitUpc = data.upc?.trim() ?? ""
    const checkedCurrentValues = dupQuery.sku === submitSku && dupQuery.upc === submitUpc
    const override = hasDuplicates && checkedCurrentValues
    const payload = {
      ...data,
      ...(artwork ? { artworkUrl: artwork.url } : {}),
      ...(override ? { allowDuplicate: true } : {}),
    }
    createPackage.mutate({ data: payload }, {
      onSuccess: (res) => {
        setLocation(`/reviews/${res.id}`)
      },
      onError: (err: unknown) => {
        // Backstop: a duplicate slipped past the client check (e.g. a race).
        if (err && typeof err === "object" && (err as { status?: number }).status === 409) {
          const body = (err as { data?: { duplicates?: Package[] } }).data
          if (body?.duplicates?.length) setServerDuplicates(body.duplicates)
        }
      },
    })
  }

  const handleFiles = async (files: FileList | null) => {
    const file = files?.[0]
    if (!file) return
    setOcrError(null)
    const type = fileTypeFromName(file.name)
    const preview = RENDERABLE.includes(type) && type !== "pdf" ? URL.createObjectURL(file) : null
    const res = await uploadFile(file)
    if (!res) return
    // objectPath like /objects/uploads/uuid -> stored as-is; served via /api/storage
    setArtwork({ name: file.name, type, url: res.objectPath, preview })
    // For renderable images, auto-extract copy via OCR to pre-fill the analysis
    // input, and (best-effort) structured fields to pre-fill the metadata form.
    if (type === "png" || type === "jpg") {
      let dataUrl: string
      try {
        dataUrl = await fileToDownscaledDataUrl(file)
      } catch (err) {
        setOcrError(err instanceof Error ? err.message : "Failed to read the image.")
        return
      }

      // Kick off the best-effort field extraction alongside the OCR text read.
      // It is fail-safe: unread fields come back empty and it never blocks the
      // upload or surfaces an error.
      const fieldsPromise = extractFields
        .mutateAsync({ data: { imageDataUrl: dataUrl } })
        .then((fields) => {
          // Non-destructive: only fill metadata inputs the user hasn't touched.
          const map: Array<[keyof UploadFormValues, string]> = [
            ["name", fields.productName],
            ["brand", fields.brand],
            ["upc", fields.upc],
            ["netWeight", fields.netWeight],
            ["country", fields.country],
          ]
          const filled = new Set<string>()
          for (const [field, value] of map) {
            const v = value?.trim() ?? ""
            const current = (watch(field) ?? "").toString().trim()
            if (v && !current) {
              setValue(field, v, { shouldValidate: true })
              filled.add(field)
            }
          }
          if (filled.size > 0) setAutoFilled((prev) => new Set([...prev, ...filled]))
        })
        .catch(() => {
          // Field extraction is best-effort; swallow errors silently.
        })

      try {
        const result = await extractText.mutateAsync({ data: { imageDataUrl: dataUrl } })
        const text = result.text?.trim() ?? ""
        if (text) setValue("extractedText", text, { shouldValidate: true })
        else setOcrError("No readable text was found in that image. You can type or paste the copy manually.")
      } catch (err) {
        setOcrError(err instanceof Error ? err.message : "Failed to read text from the image.")
      }
      await fieldsPromise
    }
  }

  const loadDemo = () => {
    setValue("sku", "PK-ORG-789")
    setValue("upc", "012345678905")
    setValue("name", "Organic Almond Butter 16oz")
    setValue("brand", "Nature's Promise")
    setValue("vendor", "Nutty Farms LLC")
    setValue("category", "Grocery / Spreads")
    setValue("country", "USA")
    setValue("netWeight", "16 oz (454g)")
    setValue("packageType", "Glass Jar")
    setValue("extractedText", "NATURE'S PROMISE ORGANIC ALMOND BUTTER. Ingredients: Roasted Organic Almonds, Sea Salt. Warning: Contains Tree Nuts. Manufactured in a facility that also processes peanuts. Nutrition Facts: Calories 190, Total Fat 17g. Certified Organic by CCOF. Keep Refrigerated after opening.")
    setDemoLoaded(true)
  }

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true)
    } else if (e.type === "dragleave") {
      setDragActive(false)
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)
    handleFiles(e.dataTransfer.files)
  }

  const isPending = createPackage.isPending

  // Subtle affordance for fields auto-filled from the artwork that need review.
  const reviewClass = (field: string) =>
    autoFilled.has(field) ? "border-amber-500/60 focus-visible:ring-amber-500/40" : ""
  const ReviewHint = ({ field }: { field: string }) =>
    autoFilled.has(field) ? (
      <span className="text-[11px] text-amber-600 dark:text-amber-400 inline-flex items-center gap-1">
        <Wand2 className="w-3 h-3" /> Auto-filled — review
      </span>
    ) : null

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-in fade-in duration-300">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Upload Package</h1>
          <p className="text-muted-foreground mt-1">Submit new packaging artwork for AI compliance review.</p>
        </div>
        <Button variant="outline" onClick={loadDemo} disabled={demoLoaded} className="gap-2 text-primary">
          <Wand2 className="w-4 h-4" />
          Load Demo Data
        </Button>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-8">
        {/* Dropzone */}
        <input ref={fileInputRef} type="file" accept={ACCEPT} className="hidden" onChange={(e) => handleFiles(e.target.files)} />
        {artwork ? (
          <div className="border border-border rounded-xl p-4 bg-card flex items-center gap-4">
            <div className="w-20 h-20 rounded-lg border border-border bg-accent/40 flex items-center justify-center overflow-hidden shrink-0">
              {artwork.preview ? <img src={artwork.preview} alt="preview" className="w-full h-full object-contain" /> : <FileText className="w-8 h-8 text-muted-foreground" />}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-success shrink-0" />
                <span className="font-medium truncate">{artwork.name}</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {artwork.type.toUpperCase()} uploaded{!RENDERABLE.includes(artwork.type) ? " — tracked only (no visual proof rendering)" : " — ready for visual proofing"}
              </p>
              {(artwork.type === "png" || artwork.type === "jpg") && (
                <div className="mt-1 text-xs space-y-0.5">
                  {(extractText.isPending || extractFields.isPending) ? (
                    <span className="inline-flex items-center gap-1 text-primary"><Loader2 className="w-3 h-3 animate-spin" /> Extracting text with OCR…</span>
                  ) : (
                    <>
                      {ocrError ? (
                        <span className="text-destructive">{ocrError}</span>
                      ) : watch("extractedText") ? (
                        <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400"><ScanText className="w-3 h-3" /> Text extracted — review it below.</span>
                      ) : null}
                      {autoFilled.size > 0 && (
                        <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400"><Wand2 className="w-3 h-3" /> Metadata auto-filled from artwork — review the highlighted fields.</span>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
            <Button type="button" variant="ghost" size="icon" onClick={() => { setArtwork(null); setOcrError(null); setAutoFilled(new Set()) }}><X className="w-4 h-4" /></Button>
          </div>
        ) : (
          <div
            className={`border-2 border-dashed rounded-xl p-12 text-center transition-colors cursor-pointer ${dragActive ? "border-primary bg-primary/5" : "border-border bg-card"}`}
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
              {isUploading ? <Loader2 className="w-8 h-8 text-primary animate-spin" /> : <UploadCloud className="w-8 h-8 text-primary" />}
            </div>
            <h3 className="text-lg font-semibold mb-1">{isUploading ? `Uploading… ${uploadProgress}%` : "Drag and drop artwork here"}</h3>
            <p className="text-sm text-muted-foreground mb-4">PNG, JPG, PDF render as proofs · AI, INDD tracked only · up to {MAX_UPLOAD_LABEL}</p>
            {isUploading ? (
              <div className="max-w-xs mx-auto mb-2">
                <Progress value={uploadProgress} className="h-2" />
              </div>
            ) : (
              <div className="flex items-center gap-4 justify-center">
                <Button type="button" variant="outline" onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click() }}>Browse Files</Button>
              </div>
            )}
          </div>
        )}

        {uploadError && !isUploading && (
          <div className="border border-destructive/40 bg-destructive/10 rounded-xl p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="font-medium text-destructive">Upload failed</p>
                <p className="text-muted-foreground">{uploadError.message}{uploadError.retryable ? " You can try uploading again." : ""}</p>
              </div>
            </div>
          </div>
        )}

        {hasDuplicates && (
          <div className="border border-amber-500/40 bg-amber-500/10 rounded-xl p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="font-medium text-amber-900 dark:text-amber-200">
                  {duplicates.length === 1 ? "A matching package already exists" : `${duplicates.length} matching packages already exist`}
                </p>
                <p className="text-sm text-amber-800/80 dark:text-amber-200/70 mt-0.5">
                  These records share this SKU or UPC. Creating another will produce a duplicate review. Confirm this is intentional before proceeding.
                </p>
                <ul className="mt-3 space-y-1.5">
                  {duplicates.slice(0, 5).map((d) => (
                    <li key={d.id} className="flex items-center gap-2 text-sm">
                      <Link href={`/reviews/${d.id}`} className="font-medium text-primary hover:underline truncate">
                        {d.name}
                      </Link>
                      <span className="text-muted-foreground shrink-0">
                        SKU {d.sku}{d.upc ? ` · UPC ${d.upc}` : ""} · {d.status}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}

        <div className="grid md:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Package Metadata</CardTitle>
              <CardDescription>Core product identifiers</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="sku">SKU <span className="text-destructive">*</span></Label>
                  <Input id="sku" {...register("sku")} className={errors.sku ? "border-destructive" : ""} />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <Label htmlFor="upc">UPC</Label>
                    <ReviewHint field="upc" />
                  </div>
                  <Input id="upc" {...register("upc")} className={reviewClass("upc")} />
                </div>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="name">Product Name <span className="text-destructive">*</span></Label>
                  <ReviewHint field="name" />
                </div>
                <Input id="name" {...register("name")} className={errors.name ? "border-destructive" : reviewClass("name")} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <Label htmlFor="brand">Brand <span className="text-destructive">*</span></Label>
                    <ReviewHint field="brand" />
                  </div>
                  <Input id="brand" {...register("brand")} className={errors.brand ? "border-destructive" : reviewClass("brand")} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="vendor">Vendor <span className="text-destructive">*</span></Label>
                  <Input id="vendor" {...register("vendor")} className={errors.vendor ? "border-destructive" : ""} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="category">Category</Label>
                  <Input id="category" {...register("category")} />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <Label htmlFor="country">Country</Label>
                    <ReviewHint field="country" />
                  </div>
                  <Input id="country" {...register("country")} className={reviewClass("country")} />
                </div>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="netWeight">Net Weight</Label>
                  <ReviewHint field="netWeight" />
                </div>
                <Input id="netWeight" {...register("netWeight")} className={reviewClass("netWeight")} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex justify-between items-center">
                Artwork Text
                <Badge variant="outline" className="font-normal text-muted-foreground gap-1"><Info className="w-3 h-3"/> AI Analysis Input</Badge>
              </CardTitle>
              <CardDescription>Paste extracted OCR text or copy deck here.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 h-full">
                <Textarea 
                  id="extractedText" 
                  {...register("extractedText")} 
                  className="min-h-[280px] font-mono text-sm leading-relaxed"
                  placeholder="Paste ingredients, warnings, marketing copy..."
                />
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="flex justify-end gap-4">
          <Button type="button" variant="outline" onClick={() => window.history.back()}>Cancel</Button>
          <Button
            type="submit"
            disabled={isPending}
            variant={hasDuplicates ? "destructive" : "default"}
            className="min-w-[150px]"
          >
            {isPending ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Analyzing...</>
            ) : hasDuplicates ? (
              "Upload Anyway"
            ) : (
              "Upload & Analyze"
            )}
          </Button>
        </div>
      </form>
    </div>
  )
}
