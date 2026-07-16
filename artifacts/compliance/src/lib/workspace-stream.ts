// SSE client for the AI Workspace streaming endpoint. The typed Orval client
// cannot express a streaming response, so this hand-written helper POSTs to the
// same `/api` base the generated client uses (web session cookies are attached
// automatically via credentials:"include") and parses the text/event-stream
// body with a ReadableStream reader. EventSource cannot POST, so fetch is used.

export type WorkspacePageContextPayload = {
  path?: string | null;
  title?: string | null;
  summary?: string | null;
};

// A single uploaded attachment. Text attachments carry client-extracted text;
// image attachments carry a data URL that the server OCRs.
export type WorkspaceAttachmentPayload =
  | { name: string; kind: "text"; content: string }
  | { name: string; kind: "image"; imageDataUrl: string };

// A grounded source reference the assistant drew on, emitted before `done`.
export type WorkspaceCitation = {
  type: string;
  id: string | number;
  label: string;
  href?: string | null;
};

// A state-changing action the assistant has PROPOSED and the user must confirm
// before it runs. Mirrors the server's mapProposal shape.
export type WorkspaceProposedAction = {
  id: number;
  conversationId: number;
  messageId: number | null;
  actionName: string;
  summary: string;
  status: "pending" | "executing" | "executed" | "cancelled" | "failed";
  resultRef?: WorkspaceCitation | null;
  resultText?: string | null;
  createdAt: string;
};

export type StreamHandlers = {
  onDelta: (text: string) => void;
  // A tool-activity status update (e.g. "Searching packages").
  onStatus?: (info: { tool: string; label: string }) => void;
  // Grounded citations for the turn (fires at most once, before onDone).
  onCitations?: (citations: WorkspaceCitation[]) => void;
  // A proposed state-changing action awaiting the user's confirmation.
  onProposedAction?: (proposal: WorkspaceProposedAction) => void;
  onDone?: () => void;
  onError?: (message: string) => void;
};

// Mirror the generated client's base path. In the web app requests are relative
// to the origin and the platform proxy routes `/api` to the API server.
const API_BASE = "/api";

/**
 * Stream an assistant answer for a conversation. Returns a function that aborts
 * the in-flight stream (used when the user navigates away or sends again).
 */
export function streamWorkspaceMessage(
  conversationId: number,
  body: {
    message: string;
    pageContext?: WorkspacePageContextPayload | null;
    attachments?: WorkspaceAttachmentPayload[];
  },
  handlers: StreamHandlers,
): () => void {
  const controller = new AbortController();

  // Completion is signalled exactly once. The server emits an `event: done`
  // frame AND the stream then ends, so without this guard onDone would fire
  // twice (duplicate invalidations/state transitions).
  let settled = false;
  const finishDone = () => {
    if (settled) return;
    settled = true;
    handlers.onDone?.();
  };
  const finishError = (message: string) => {
    if (settled) return;
    settled = true;
    handlers.onError?.(message);
  };

  void (async () => {
    try {
      const res = await fetch(
        `${API_BASE}/workspace/conversations/${conversationId}/stream`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(body),
          signal: controller.signal,
        },
      );

      if (!res.ok || !res.body) {
        finishError("The assistant is unavailable right now. Please try again.");
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      // Parse SSE frames separated by a blank line. Each frame has an optional
      // `event:` line and one or more `data:` lines.
      const processFrame = (frame: string) => {
        const lines = frame.split("\n");
        let event = "message";
        const dataLines: string[] = [];
        for (const line of lines) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
        }
        if (dataLines.length === 0) return;
        let payload: unknown = null;
        try {
          payload = JSON.parse(dataLines.join("\n"));
        } catch {
          return;
        }
        if (event === "delta") {
          const text = (payload as { text?: string })?.text ?? "";
          if (text) handlers.onDelta(text);
        } else if (event === "status") {
          const info = payload as { tool?: string; label?: string };
          if (info?.label)
            handlers.onStatus?.({ tool: info.tool ?? "", label: info.label });
        } else if (event === "citations") {
          const list = (payload as { citations?: WorkspaceCitation[] })?.citations;
          if (Array.isArray(list) && list.length) handlers.onCitations?.(list);
        } else if (event === "proposed_action") {
          const p = payload as WorkspaceProposedAction;
          if (p && typeof p.id === "number") handlers.onProposedAction?.(p);
        } else if (event === "done") {
          finishDone();
        } else if (event === "error") {
          finishError(
            (payload as { error?: string })?.error ??
              "The assistant ran into a problem.",
          );
        }
      };

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf("\n\n")) !== -1) {
          const frame = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          if (frame.trim()) processFrame(frame);
        }
      }
      // Flush any trailing frame, then finalize (no-op if `done` already fired).
      if (buffer.trim()) processFrame(buffer);
      finishDone();
    } catch (err) {
      // On abort the caller resets its own UI state; don't emit a completion.
      if ((err as Error)?.name === "AbortError") return;
      finishError("The assistant is unavailable right now. Please try again.");
    }
  })();

  return () => controller.abort();
}

/**
 * Fetch up to 3 suggested follow-up questions for the last Q&A. Never throws —
 * returns [] on any failure so the chat UI simply shows no suggestions.
 */
export async function fetchWorkspaceFollowups(
  question: string,
  answer: string,
): Promise<string[]> {
  try {
    const res = await fetch(`${API_BASE}/workspace/followups`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ question, answer }),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { questions?: unknown };
    if (!Array.isArray(data.questions)) return [];
    return data.questions
      .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
      .slice(0, 3);
  } catch {
    return [];
  }
}

export type ConfirmActionResult = {
  proposal: WorkspaceProposedAction;
  message: {
    id: number;
    role: string;
    content: string;
    citations?: WorkspaceCitation[] | null;
  } | null;
};

/**
 * Confirm a proposed state-changing action. The server re-derives the action
 * and parameters from the persisted proposal (never the client), re-checks
 * permissions, executes via existing service logic, and appends a result turn.
 */
export async function confirmWorkspaceAction(
  conversationId: number,
  proposalId: number,
): Promise<ConfirmActionResult> {
  const res = await fetch(
    `${API_BASE}/workspace/conversations/${conversationId}/actions/${proposalId}/confirm`,
    { method: "POST", credentials: "include" },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "The action could not be completed.");
  }
  return (await res.json()) as ConfirmActionResult;
}

/** Decline a proposed action. */
export async function cancelWorkspaceAction(
  conversationId: number,
  proposalId: number,
): Promise<{ proposal: WorkspaceProposedAction }> {
  const res = await fetch(
    `${API_BASE}/workspace/conversations/${conversationId}/actions/${proposalId}/cancel`,
    { method: "POST", credentials: "include" },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "Could not cancel the action.");
  }
  return (await res.json()) as { proposal: WorkspaceProposedAction };
}
