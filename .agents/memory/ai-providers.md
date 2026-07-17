---
name: AI provider integrations
description: How configurable AI model providers are stored, secured, and resolved in the Compliance AI app.
---

# AI provider integrations (Settings > AI Integrations)

The compliance analysis engine runs through a configurable provider layer, not a
hardcoded client. Reviewers can add OpenAI / OpenRouter / any OpenAI-compatible
endpoint (BYO key) alongside the built-in Replit-managed OpenAI provider.

## Rules that must be preserved
- **Keys are encrypted at rest** (AES-256-GCM, key derived from
  `AI_KEY_ENCRYPTION_SECRET`/`SESSION_SECRET` via scrypt with a per-payload
  random salt) in `ai_providers.api_key`, stored as `v2:<salt>:<iv>:<tag>:<ct>`.
  Legacy `v1:<iv>:<tag>:<ct>` (unsalted sha256 KDF) still decrypts but is never
  written; do not remove v1 decrypt support while old rows may exist.
  `key_last4` holds the plaintext last 4 chars for masked display. The API never
  returns the full key. **Why:** plaintext secrets in the DB are an at-rest
  exposure risk. **How to apply:** always `encryptSecret` before persisting and
  `decryptSecret` only at call time (in `ai-client.ts buildClient`).
- **At most one active provider.** Enforced by a partial unique index
  (`ai_providers_one_active` on `active` where `active`) AND transactional
  activate/delete flows. Activation is ONLY via `POST /ai-providers/:id/activate`
  — the generic PATCH must never set `active`. **Why:** multiple active rows make
  `resolveAiClient()` nondeterministic.
- **baseUrl is SSRF-validated** (`provider-security.ts`): HTTPS only, reject
  localhost/.local/.internal, and DNS-resolve to reject private/link-local/
  metadata IPs. Applied on create + update; provider type is enum-checked.
- Deleting the active custom provider falls back to the managed provider. If a
  stored key fails to decrypt (e.g. rotated `SESSION_SECRET`), `buildClient`
  falls back to the managed client instead of crashing.

## Detection taxonomy
`analyzePackaging` prompt enumerates 8 engines and labels each violation's
`engine`: Spelling & Grammar, Contextual Language, FDA, EPA, Missing Disclosures
& Warnings, Packaging Formatting, Dollar Tree Standards, Category Regulation.
Claims get a "Potential EPA/FDA/FTC/Legal Review" note in the description.
