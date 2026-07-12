import test from "node:test";
import assert from "node:assert/strict";
import { isSafeStoredFileUrl } from "./proofing";

// Regression guard for stored artwork-reference validation. A version's fileUrl
// (and previewUrl) is caller-supplied and later drives content hashing, proof
// export, and the object-serving owner lookup, so it must only ever be an
// object-storage path (/objects/...) or a seed asset (/artwork/...). This test
// pins the shape defense; traversal / scheme / backslash inputs must be
// rejected so a caller can never point hashing or serving at an arbitrary file.
// (Cross-tenant ownership binding is enforced separately at write time via
// resolveObjectOwner + canAccessObjectOwner, which requires the DB.)

test("accepts well-formed object-storage and seed paths", () => {
  assert.equal(isSafeStoredFileUrl("/objects/uploads/abc-123.png"), true);
  assert.equal(isSafeStoredFileUrl("/objects/uploads/2f1a9c4e-1.pdf"), true);
  assert.equal(isSafeStoredFileUrl("/artwork/seed/box-front.png"), true);
});

test("rejects path traversal", () => {
  assert.equal(isSafeStoredFileUrl("/objects/../../etc/passwd"), false);
  assert.equal(isSafeStoredFileUrl("/artwork/../../../etc/shadow"), false);
  assert.equal(isSafeStoredFileUrl("/objects/uploads/..%2f..%2fsecret"), false);
});

test("rejects absolute filesystem paths and scheme URLs", () => {
  assert.equal(isSafeStoredFileUrl("/etc/passwd"), false);
  assert.equal(isSafeStoredFileUrl("file:///etc/passwd"), false);
  assert.equal(isSafeStoredFileUrl("http://evil.test/x.png"), false);
  assert.equal(isSafeStoredFileUrl("https://example.com/objects/x.png"), false);
});

test("rejects backslashes, null bytes, and non-allowlisted prefixes", () => {
  assert.equal(isSafeStoredFileUrl("/objects\\uploads\\x.png"), false);
  assert.equal(isSafeStoredFileUrl("/objects/uploads/x.png\0.txt"), false);
  assert.equal(isSafeStoredFileUrl("/private/uploads/x.png"), false);
  assert.equal(isSafeStoredFileUrl("objects/uploads/x.png"), false);
  assert.equal(isSafeStoredFileUrl(""), false);
});
