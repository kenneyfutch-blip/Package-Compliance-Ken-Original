// ---------------------------------------------------------------------------
// Out-of-band alerting for AI cost/usage telemetry failures
// ---------------------------------------------------------------------------
// The in-app notification + dashboard banner (see ai-usage.ts) only help an
// admin who is already signed in and looking. The whole reason this alert
// matters is the 2am case: telemetry breaks overnight and nobody is in the app.
// This module delivers the SAME incident out-of-band via a configurable webhook
// (Slack / PagerDuty / any JSON endpoint) so the alert reaches someone who is
// not staring at the dashboard.
//
// Design notes:
//   * DB-independent on purpose. The telemetry failure is very often the
//     database itself being down — the same DB the in-app notification write
//     needs. This channel talks only to an external webhook and reads its
//     target from the environment, so it still fires when the DB is unreachable.
//   * Configurable, not hardcoded. The webhook URL (which endpoint) and the
//     recipient list (which admins) both come from environment configuration.
//     Unconfigured ⇒ this whole module is a no-op, exactly like the Document AI
//     / openFDA "not configured" pattern.
//   * Best-effort. Delivery is guarded and time-bounded by the caller; it must
//     never block, slow, or throw into the AI path (see ai-usage.ts).

import { logger } from "./logger";

// Read a trimmed, non-empty environment value or undefined. Mirrors the helper
// used by document-ai/config.ts so configuration reads behave consistently.
function env(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : undefined;
}

function isValidWebhookUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    // Operator-configured (trusted) value; we only guard against obvious
    // misconfiguration, not SSRF (unlike the user-supplied AI provider baseUrl).
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * The configured out-of-band webhook endpoint, or null when unset/invalid.
 * A single generic JSON POST target that works with Slack incoming webhooks,
 * PagerDuty-style event intakes, or any custom receiver.
 */
export function getAlertWebhookUrl(): string | null {
  const raw = env("AI_ALERT_WEBHOOK_URL");
  return raw && isValidWebhookUrl(raw) ? raw : null;
}

/**
 * Optional, comma-separated list of admin recipients to name in the alert
 * payload (the "which admins" knob). We have no SMTP transport, so these are
 * carried in the webhook body for a downstream receiver (e.g. PagerDuty routing
 * or a Slack @-mention) to reach the right people — they are not emailed here.
 */
export function getAlertRecipients(): string[] {
  const raw = env("AI_ALERT_EMAIL_TO");
  if (!raw) return [];
  return Array.from(
    new Set(
      raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  );
}

/** True only when a valid webhook target is configured. */
export function isOutbandAlertConfigured(): boolean {
  return getAlertWebhookUrl() !== null;
}

export type OutbandIncident = {
  status: "firing" | "resolved";
  consecutiveFailures: number;
  lastFailureMessage: string | null;
  instanceId: string;
};

// Cap how long a webhook POST may run so a hung endpoint can never keep the
// detached alert task (or its timer) alive indefinitely.
const OUTBAND_TIMEOUT_MS = 5_000;

function buildPayload(incident: OutbandIncident): Record<string, unknown> {
  const recipients = getAlertRecipients();
  const firing = incident.status === "firing";
  const title = firing
    ? "AI cost logging is failing"
    : "AI cost logging has recovered";
  const text = firing
    ? `:rotating_light: AI usage telemetry writes have failed ${incident.consecutiveFailures} times in a row` +
      (incident.lastFailureMessage
        ? ` (last error: ${incident.lastFailureMessage})`
        : "") +
      ". Cost and usage dashboards may under-report until logging recovers." +
      (recipients.length ? ` cc: ${recipients.join(", ")}` : "")
    : ":white_check_mark: AI usage telemetry writes have recovered. Cost and usage logging is healthy again." +
      (recipients.length ? ` cc: ${recipients.join(", ")}` : "");

  return {
    event: "ai_cost_logging_health",
    status: incident.status,
    severity: firing ? "critical" : "info",
    title,
    // `text` makes Slack incoming webhooks render a readable message; structured
    // fields below let a custom receiver route/parse it.
    text,
    consecutiveFailures: incident.consecutiveFailures,
    lastFailureMessage: incident.lastFailureMessage,
    instanceId: incident.instanceId,
    recipients,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Deliver one out-of-band incident notice to the configured webhook. Resolves
 * on success; REJECTS on any failure (bad status, network error, timeout) so
 * the caller's incident state machine can retry on the next failed write. The
 * caller is responsible for running this detached and never awaiting it on the
 * AI path.
 */
export async function sendOutbandAlert(incident: OutbandIncident): Promise<void> {
  const url = getAlertWebhookUrl();
  if (!url) return; // not configured — nothing to do (defensive; callers gate)

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OUTBAND_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildPayload(incident)),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`out-of-band alert webhook responded ${res.status}`);
    }
    logger.debug(
      { status: incident.status, instanceId: incident.instanceId },
      "delivered out-of-band AI usage alert",
    );
  } finally {
    clearTimeout(timer);
  }
}
