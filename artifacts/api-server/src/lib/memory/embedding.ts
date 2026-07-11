import { COMPLIANCE_MEMORY_DIM } from "@workspace/db";

// ---------------------------------------------------------------------------
// Compliance-finding text embedder.
//
// This produces a fixed-dimension semantic vector for a piece of finding text so
// that pgvector can rank past findings by similarity to a new review. It is a
// self-contained, dependency-free embedder: a hashed bag-of-words model over
// unigrams + bigrams with sublinear term weighting, signed hashing to reduce
// collision bias, light domain-synonym expansion for compliance vocabulary, and
// L2 normalization so cosine distance behaves well.
//
// WHY not a neural/model embedding: the managed OpenAI and Gemini proxies do not
// expose an embeddings endpoint, and the local transformers.js runtime is blocked
// by the package firewall. A hashed lexical embedding is deterministic, free, and
// effective for this domain because compliance findings share a dense, consistent
// vocabulary ("allergen", "Contains", "net weight", "EPA registration", etc.).
//
// SWAP-IN PATH: to upgrade to neural embeddings, replace `embed()` with a call to
// a real embedding model that returns COMPLIANCE_MEMORY_DIM floats, keep the L2
// normalization, and re-embed existing rows (the raw `content` is stored for that
// purpose). Update COMPLIANCE_MEMORY_DIM in the schema in lockstep.
// ---------------------------------------------------------------------------

export const EMBED_DIM = COMPLIANCE_MEMORY_DIM;

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with", "is",
  "are", "be", "this", "that", "it", "as", "at", "by", "from", "was", "were",
  "has", "have", "had", "not", "no", "but", "if", "so", "than", "then", "into",
  "should", "must", "may", "can", "will", "would", "there", "their", "which",
]);

// Domain synonym clusters. Each token expands to shared canonical concept tokens
// so lexically different phrasings of the same compliance issue land near each
// other in vector space (e.g. "soy" and "allergen", "warning" and "caution").
const SYNONYMS: Record<string, string[]> = {
  soy: ["allergen", "contains"],
  peanut: ["allergen", "contains"],
  peanuts: ["allergen", "contains"],
  milk: ["allergen", "contains"],
  wheat: ["allergen", "contains"],
  gluten: ["allergen", "contains"],
  egg: ["allergen", "contains"],
  eggs: ["allergen", "contains"],
  tree: ["allergen"],
  nut: ["allergen", "contains"],
  nuts: ["allergen", "contains"],
  shellfish: ["allergen", "contains"],
  allergen: ["allergen", "contains"],
  allergens: ["allergen", "contains"],
  warning: ["warning", "caution", "hazard"],
  warnings: ["warning", "caution", "hazard"],
  caution: ["warning", "caution", "hazard"],
  danger: ["warning", "caution", "hazard"],
  hazard: ["warning", "caution", "hazard"],
  flammable: ["warning", "hazard"],
  choking: ["warning", "hazard", "children"],
  weight: ["netweight", "quantity"],
  quantity: ["netweight", "quantity"],
  contents: ["netweight", "quantity"],
  net: ["netweight", "quantity"],
  ingredient: ["ingredients"],
  ingredients: ["ingredients"],
  nutrition: ["nutrition", "facts"],
  epa: ["epa", "pesticide", "registration"],
  pesticide: ["epa", "pesticide"],
  disinfectant: ["epa", "pesticide"],
  registration: ["epa", "registration"],
  fda: ["fda"],
  origin: ["origin", "country"],
  country: ["origin", "country"],
  spelling: ["spelling", "typo"],
  misspelling: ["spelling", "typo"],
  misspelled: ["spelling", "typo"],
  grammar: ["grammar"],
  claim: ["claim", "marketing"],
  claims: ["claim", "marketing"],
  organic: ["claim", "marketing"],
  natural: ["claim", "marketing"],
  prop65: ["prop65", "warning"],
  barcode: ["barcode", "upc"],
  upc: ["barcode", "upc"],
};

function tokenize(text: string): string[] {
  const base = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));

  const out: string[] = [];
  for (let i = 0; i < base.length; i++) {
    const tok = base[i]!;
    out.push(tok);
    const syn = SYNONYMS[tok];
    if (syn) out.push(...syn);
    // Adjacent-word bigram captures short phrases like "net weight".
    if (i + 1 < base.length) out.push(`${tok}_${base[i + 1]}`);
  }
  return out;
}

// FNV-1a 32-bit hash. Combined with a salt to derive two independent hashes
// (bucket + sign) from one token.
function fnv1a(str: string, seed: number): number {
  let h = 2166136261 ^ seed;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Produce an L2-normalized embedding vector for the given text.
export function embed(text: string): number[] {
  const vec = new Float64Array(EMBED_DIM);
  if (!text || !text.trim()) return Array.from(vec);

  const counts = new Map<string, number>();
  for (const tok of tokenize(text)) {
    counts.set(tok, (counts.get(tok) ?? 0) + 1);
  }

  for (const [tok, tf] of counts) {
    const bucket = fnv1a(tok, 0) % EMBED_DIM;
    const sign = (fnv1a(tok, 0x9e3779b9) & 1) === 0 ? 1 : -1;
    // Sublinear term weighting dampens the effect of highly repeated tokens.
    const weight = (1 + Math.log(tf)) * sign;
    vec[bucket] += weight;
  }

  let norm = 0;
  for (let i = 0; i < EMBED_DIM; i++) norm += vec[i]! * vec[i]!;
  norm = Math.sqrt(norm);
  if (norm === 0) return Array.from(vec);
  const out = new Array<number>(EMBED_DIM);
  for (let i = 0; i < EMBED_DIM; i++) out[i] = vec[i]! / norm;
  return out;
}

// pgvector literal format: "[0.1,0.2,...]". Used for parameterized queries.
export function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}
