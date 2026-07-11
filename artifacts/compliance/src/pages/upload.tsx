import { useRef, useState } from "react"
import { useLocation } from "wouter"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { useCreatePackage, useExtractArtworkText } from "@workspace/api-client-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { UploadCloud, Wand2, Loader2, Info, ScanText, X, ImageIcon } from "lucide-react"

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

const MAX_DIMENSION = 1600
const MAX_FILE_BYTES = 25 * 1024 * 1024

// Load an image file, downscale it (longest edge <= MAX_DIMENSION), and return a
// JPEG data URL. Keeps the OCR payload and stored artwork small.
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

export default function UploadPage() {
  const [, setLocation] = useLocation()
  const createPackage = useCreatePackage()
  const extractText = useExtractArtworkText()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [dragActive, setDragActive] = useState(false)
  const [demoLoaded, setDemoLoaded] = useState(false)
  const [artworkPreview, setArtworkPreview] = useState<string | null>(null)
  const [artworkName, setArtworkName] = useState<string | null>(null)
  const [ocrError, setOcrError] = useState<string | null>(null)

  const { register, handleSubmit, formState: { errors }, setValue, watch } = useForm<UploadFormValues>({
    resolver: zodResolver(uploadSchema),
    defaultValues: { sku: "", name: "", brand: "", vendor: "", extractedText: "" },
  })

  const extractedText = watch("extractedText")

  const onSubmit = (data: UploadFormValues) => {
    createPackage.mutate(
      { data: { ...data, artworkUrl: artworkPreview ?? undefined } },
      { onSuccess: (res) => setLocation(`/reviews/${res.id}`) },
    )
  }

  const processFile = async (file: File) => {
    setOcrError(null)
    if (!file.type.startsWith("image/")) {
      setOcrError("Please upload an image file (PNG or JPG). PDF/AI/PSD OCR is not supported yet.")
      return
    }
    if (file.size > MAX_FILE_BYTES) {
      setOcrError("Image is too large. Please use a file under 25MB.")
      return
    }
    try {
      const dataUrl = await fileToDownscaledDataUrl(file)
      setArtworkPreview(dataUrl)
      setArtworkName(file.name)
      const result = await extractText.mutateAsync({ data: { imageDataUrl: dataUrl } })
      const text = result.text?.trim() ?? ""
      if (text) {
        setValue("extractedText", text, { shouldValidate: true })
      } else {
        setOcrError("No readable text was found in that image. You can type or paste the copy manually.")
      }
    } catch (err) {
      setOcrError(err instanceof Error ? err.message : "Failed to read text from the image.")
    }
  }

  const onFilePicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) void processFile(file)
    e.target.value = ""
  }

  const clearArtwork = () => {
    setArtworkPreview(null)
    setArtworkName(null)
    setOcrError(null)
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
    if (e.type === "dragenter" || e.type === "dragover") setDragActive(true)
    else if (e.type === "dragleave") setDragActive(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)
    const file = e.dataTransfer.files?.[0]
    if (file) void processFile(file)
  }

  const isPending = createPackage.isPending
  const isOcrRunning = extractText.isPending

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
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={onFilePicked}
        />

        {/* Dropzone / artwork preview */}
        {artworkPreview ? (
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="flex gap-4">
              <div className="relative w-40 shrink-0 overflow-hidden rounded-lg border border-border bg-muted">
                <img src={artworkPreview} alt="Artwork preview" className="h-40 w-full object-contain" />
              </div>
              <div className="flex flex-1 flex-col justify-between">
                <div>
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <ImageIcon className="h-4 w-4 text-primary" />
                    {artworkName ?? "Artwork"}
                  </div>
                  <div className="mt-2 text-sm">
                    {isOcrRunning ? (
                      <span className="inline-flex items-center gap-2 text-primary">
                        <Loader2 className="h-4 w-4 animate-spin" /> Extracting text with OCR...
                      </span>
                    ) : ocrError ? (
                      <span className="text-destructive">{ocrError}</span>
                    ) : extractedText ? (
                      <span className="inline-flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
                        <ScanText className="h-4 w-4" /> Text extracted — review it below before analyzing.
                      </span>
                    ) : (
                      <span className="text-muted-foreground">Ready.</span>
                    )}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isOcrRunning}
                  >
                    Replace image
                  </Button>
                  <Button type="button" variant="ghost" size="sm" className="gap-1 text-muted-foreground" onClick={clearArtwork}>
                    <X className="h-4 w-4" /> Remove
                  </Button>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div
            className={`border-2 border-dashed rounded-xl p-12 text-center transition-colors cursor-pointer ${
              dragActive ? "border-primary bg-primary/5" : "border-border bg-card hover:border-primary/50"
            }`}
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
              <UploadCloud className="w-8 h-8 text-primary" />
            </div>
            <h3 className="text-lg font-semibold mb-1">Drag and drop artwork here</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Upload a packaging image (PNG, JPG, WEBP up to 25MB) — we'll OCR the text automatically.
            </p>
            <Button type="button" variant="outline" onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click() }}>
              Browse Files
            </Button>
            {ocrError && <p className="mt-4 text-sm text-destructive">{ocrError}</p>}
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
                  <Label htmlFor="upc">UPC</Label>
                  <Input id="upc" {...register("upc")} />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="name">Product Name <span className="text-destructive">*</span></Label>
                <Input id="name" {...register("name")} className={errors.name ? "border-destructive" : ""} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="brand">Brand <span className="text-destructive">*</span></Label>
                  <Input id="brand" {...register("brand")} className={errors.brand ? "border-destructive" : ""} />
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
                  <Label htmlFor="country">Country</Label>
                  <Input id="country" {...register("country")} />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex justify-between items-center">
                Artwork Text
                <Badge variant="outline" className="font-normal text-muted-foreground gap-1"><Info className="w-3 h-3"/> AI Analysis Input</Badge>
              </CardTitle>
              <CardDescription>Auto-filled by OCR from the uploaded image. Edit before analyzing if needed.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 h-full">
                <Textarea
                  id="extractedText"
                  {...register("extractedText")}
                  className="min-h-[280px] font-mono text-sm leading-relaxed"
                  placeholder="Upload an image to auto-extract text, or paste ingredients, warnings, marketing copy..."
                />
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="flex justify-end gap-4">
          <Button type="button" variant="outline" onClick={() => window.history.back()}>Cancel</Button>
          <Button type="submit" disabled={isPending || isOcrRunning} className="min-w-[150px]">
            {isPending ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Analyzing...</>
            ) : (
              "Upload & Analyze"
            )}
          </Button>
        </div>
      </form>
    </div>
  )
}
