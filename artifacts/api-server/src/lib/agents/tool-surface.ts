import type { Request } from "express";
import {
  availableToolsFor,
  type WorkspaceTool,
} from "../workspace/tools";
import {
  availableActionsFor,
  type WorkspaceAction,
} from "../workspace/actions";
import type { AgentToolDef } from "./types";

// The unified tool surface offered to the agent for a single caller: the
// read-only data tools (workspace/tools.ts) PLUS the action registry
// (workspace/actions.ts), each already permission- and tenant-scoped to exactly
// what THIS user may see/do. Sensitive actions are intercepted (proposed, not
// executed) by the loop; non-sensitive actions and read tools execute inline.
//
// This is the agent's capability boundary: a provider is only ever offered
// what this returns, and every tool/action re-checks its own scope at execution
// time (defense in depth). Assembling it in one place keeps the offer identical
// no matter which provider answers.
export type AgentToolSurface = {
  tools: WorkspaceTool[];
  actions: WorkspaceAction[];
  toolDefs: AgentToolDef[];
};

export function buildAgentToolSurface(req: Request): AgentToolSurface {
  const tools = availableToolsFor(req);
  const actions = availableActionsFor(req);
  const toolDefs: AgentToolDef[] = [...tools, ...actions].map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
  return { tools, actions, toolDefs };
}
