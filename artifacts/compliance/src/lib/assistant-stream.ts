// SSE client for the AI Assistant side panel's streaming chat endpoint.
// Mirrors workspace-stream.ts: the typed Orval client cannot express a
// streaming response and EventSource cannot POST, so we fetch and parse the
// text/event-stream body ourselves.

import type { AssistantToolSuggestion } from "@workspace/api-client-react";

export type AssistantStreamHandlers = {
  onDelta: (text: string) => void;
  onSuggestions?: (suggestions: AssistantToolSuggestion[]) => void;
  onDone?: () => void;
  onError?: (message: string) => void;
};

const API_BASE = "/api";

/**
 * Stream an assistant answer. Returns an abort function.
 */
export function streamAssistantChat(
  body: { messages: { role: string; content: string }[] },
  handlers: AssistantStreamHandlers,
): () => void {
  const controller = new AbortController();
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
      const res = await fetch(`${API_BASE}/assistant/chat/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        finishError("The assistant is unavailable right now. Please try again.");
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

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
        } else if (event === "suggestions") {
          const list = (payload as { suggestions?: AssistantToolSuggestion[] })
            ?.suggestions;
          if (Array.isArray(list) && list.length)
            handlers.onSuggestions?.(list);
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
      if (buffer.trim()) processFrame(buffer);
      finishDone();
    } catch (err) {
      if ((err as Error)?.name === "AbortError") return;
      finishError("The assistant is unavailable right now. Please try again.");
    }
  })();

  return () => controller.abort();
}
