import { useListUsers } from "@workspace/api-client-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Users } from "lucide-react"
import {
  SpellCheck, MessageSquareWarning, Pill, Leaf, AlertTriangle, LayoutTemplate, Store, Gavel,
} from "lucide-react"
import { AiIntegrations } from "@/components/ai-integrations"
import { DocumentAiStatusCard } from "@/components/document-ai-status-card"

const CAPABILITIES = [
  { icon: SpellCheck, name: "Spelling & Grammar", desc: "Misspellings, grammar, punctuation, and typography errors in artwork copy." },
  { icon: MessageSquareWarning, name: "Contextual Language", desc: "Correctly spelled but wrong-in-context words (\"dye\" vs \"die\", \"sale\" vs \"sail\") with reasoning." },
  { icon: Pill, name: "FDA Compliance", desc: "Food, cosmetic, and drug labeling: Nutrition/Drug Facts, ingredients, allergens, net contents." },
  { icon: Leaf, name: "EPA Compliance", desc: "Pesticide/disinfectant rules: EPA registration numbers, signal words, precautionary statements." },
  { icon: AlertTriangle, name: "Missing Disclosures & Warnings", desc: "Absent required warnings: choking, Prop 65, flammability, allergen and origin statements." },
  { icon: LayoutTemplate, name: "Packaging Formatting", desc: "Type sizes, principal display panel, legibility, required panels, and net-quantity placement." },
  { icon: Store, name: "Dollar Tree Standards", desc: "Internal brand standards: price legends, UPC placement, supplier/item numbers, approved claims." },
  { icon: Gavel, name: "Category Regulation", desc: "Product-category-specific rules: CPSC toy safety, USDA, textile fiber/care, tracking labels." },
]

export default function AdminPage() {
  const { data: users = [], isLoading } = useListUsers()

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground mt-1">Manage AI integrations, detection capabilities, and platform users.</p>
      </div>

      <AiIntegrations />

      <DocumentAiStatusCard />

      <Card>
        <CardHeader>
          <CardTitle>Detection Capabilities</CardTitle>
          <p className="text-sm text-muted-foreground">Every review runs these AI-powered engines against the submitted packaging.</p>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {CAPABILITIES.map((c) => (
            <div key={c.name} className="flex gap-3 rounded-lg border border-border p-3">
              <div className="w-9 h-9 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                <c.icon className="w-5 h-5 text-primary" />
              </div>
              <div className="min-w-0">
                <div className="font-medium text-sm">{c.name}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{c.desc}</div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-primary" />
            <CardTitle>Users & Roles</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name / Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Joined</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={4} className="text-center h-24">Loading...</TableCell></TableRow>
              ) : users.map(user => (
                <TableRow key={user.id}>
                  <TableCell>
                    <div className="font-medium">{user.name}</div>
                    <div className="text-xs text-muted-foreground">{user.email}</div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs">{user.role}</Badge>
                    {user.roleKey && (
                      <div className="text-[10px] text-muted-foreground font-mono mt-1">{user.roleKey}</div>
                    )}
                  </TableCell>
                  <TableCell>
                    {user.active ? (
                      <Badge variant="success" className="bg-success/10 text-success hover:bg-success/20">Active</Badge>
                    ) : (
                      <Badge variant="secondary">Inactive</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground font-mono">
                    {new Date(user.createdAt).toLocaleDateString()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
