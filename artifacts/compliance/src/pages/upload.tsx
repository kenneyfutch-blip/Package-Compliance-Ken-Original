import { useState } from "react"
import { useLocation } from "wouter"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { useCreatePackage } from "@workspace/api-client-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { UploadCloud, Wand2, Loader2, Info, Badge } from "lucide-react"

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
  const [dragActive, setDragActive] = useState(false)
  const [demoLoaded, setDemoLoaded] = useState(false)

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

  const onSubmit = (data: UploadFormValues) => {
    createPackage.mutate({ data }, {
      onSuccess: (res) => {
        setLocation(`/reviews/${res.id}`)
      }
    })
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
    // In a real app, handle file processing. Here we just pretend.
  }

  const isPending = createPackage.isPending

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
        <div 
          className={`
            border-2 border-dashed rounded-xl p-12 text-center transition-colors
            ${dragActive ? "border-primary bg-primary/5" : "border-border bg-card"}
          `}
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
        >
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
            <UploadCloud className="w-8 h-8 text-primary" />
          </div>
          <h3 className="text-lg font-semibold mb-1">Drag and drop artwork here</h3>
          <p className="text-sm text-muted-foreground mb-4">Supports PDF, AI, PSD, PNG, JPG up to 50MB</p>
          <div className="flex items-center gap-4 justify-center">
            <Button type="button" variant="outline">Browse Files</Button>
          </div>
        </div>

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
          <Button type="submit" disabled={isPending} className="min-w-[150px]">
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
