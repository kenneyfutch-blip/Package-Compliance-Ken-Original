import { useState } from "react";
import { useListReviewAssignments, useListTeams, useListUsers } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Loader2, Filter, Layers } from "lucide-react";

export default function ReviewQueue() {
  const [status, setStatus] = useState<string>("__any__");
  const [team, setTeam] = useState<string>("__any__");
  const [assignee, setAssignee] = useState<string>("__any__");
  
  const { data: allAssignments, isLoading } = useListReviewAssignments();
  const { data: teams } = useListTeams();
  const { data: users } = useListUsers();

  const assignments = allAssignments?.filter(a => {
    if (status !== "__any__" && a.assignment.status !== status) return false;
    
    if (team !== "__any__") {
      const selectedTeam = teams?.find(t => String(t.id) === team);
      if (selectedTeam && a.assignment.teamName !== selectedTeam.name) return false;
    }
    
    if (assignee !== "__any__") {
      const selectedUser = users?.find(u => String(u.id) === assignee);
      if (selectedUser && a.assignment.assigneeName !== selectedUser.name) return false;
    }
    
    return true;
  });

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
          <Layers className="w-7 h-7 text-primary" /> Org Review Queue
        </h1>
        <p className="text-muted-foreground mt-1">Cross-team review assignments and SLA monitoring.</p>
      </div>

      <Card>
        <CardContent className="p-4 grid gap-4 sm:grid-cols-2 md:grid-cols-4">
          <div className="space-y-1.5">
            <div className="text-sm font-medium">Status</div>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger><SelectValue placeholder="Any Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__any__">Any Status</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="in_progress">In Progress</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <div className="text-sm font-medium">Team</div>
            <Select value={team} onValueChange={setTeam}>
              <SelectTrigger><SelectValue placeholder="Any Team" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__any__">Any Team</SelectItem>
                {teams?.map(t => (
                  <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <div className="text-sm font-medium">Assignee</div>
            <Select value={assignee} onValueChange={setAssignee}>
              <SelectTrigger><SelectValue placeholder="Any Assignee" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__any__">Any Assignee</SelectItem>
                {users?.map(u => (
                  <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end">
            <Button variant="outline" className="w-full" onClick={() => { setStatus("__any__"); setTeam("__any__"); setAssignee("__any__"); }}>
              <Filter className="w-4 h-4 mr-2" /> Clear Filters
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Package</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead>Assignee / Team</TableHead>
                <TableHead>SLA Due</TableHead>
                <TableHead className="text-right">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-32 text-center">
                    <Loader2 className="w-6 h-6 animate-spin text-primary mx-auto" />
                  </TableCell>
                </TableRow>
              ) : assignments?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">
                    No matching review assignments.
                  </TableCell>
                </TableRow>
              ) : assignments?.map((a, i) => (
                <TableRow key={i}>
                  <TableCell>
                    <div className="font-medium text-foreground">{a.packageName}</div>
                    <div className="text-xs text-muted-foreground">{a.packageSku}</div>
                  </TableCell>
                  <TableCell>{a.category || "—"}</TableCell>
                  <TableCell>
                    {a.assignment.priority === "high" ? (
                      <Badge variant="destructive">High</Badge>
                    ) : a.assignment.priority === "medium" ? (
                      <Badge variant="outline" className="border-warning text-warning bg-warning/10">Medium</Badge>
                    ) : (
                      <Badge variant="secondary">Low</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="font-medium text-sm text-foreground">{a.assignment.assigneeName || "Unassigned"}</div>
                    <div className="text-xs text-muted-foreground">{a.assignment.teamName || "—"}</div>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm">{a.assignment.dueAt ? new Date(a.assignment.dueAt).toLocaleDateString() : "—"}</div>
                    {a.assignment.slaHours != null && <div className="text-xs text-muted-foreground">{a.assignment.slaHours}h SLA</div>}
                  </TableCell>
                  <TableCell className="text-right">
                    <Badge variant="outline" className={
                      a.assignment.status === "completed" ? "border-success text-success bg-success/10" :
                      a.assignment.status === "in_progress" ? "border-primary text-primary bg-primary/10" : "border-muted-foreground text-muted-foreground"
                    }>
                      {a.assignment.status.replace("_", " ").toUpperCase()}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
