import test from "node:test";
import assert from "node:assert/strict";
import type { Request } from "express";
import {
  CreateAnnotationBody,
  AddCommentReplyBody,
  CreateApprovalDecisionBody,
  BulkPackageActionBody,
  CreatePackageVersionBody,
  UpdateAnnotationBody,
} from "@workspace/api-zod";
import { currentUser } from "../lib/identity";

// Regression guard for the proofing audit trail: the reviewer identity written to
// annotations, comments, approvals, versions and audit events must always come
// from the authenticated Clerk session — never from the request body. Otherwise a
// signed-in user could impersonate another reviewer in the decision history.

function fakeReq(fields: Record<string, unknown>): Request {
  return fields as unknown as Request;
}

test("currentUser derives identity from the session and ignores spoofed body", () => {
  const req = fakeReq({
    userName: "Real Reviewer",
    userEmail: "real.reviewer@dollartree.com",
    body: { author: "Victim", reviewer: "Victim", createdBy: "Victim" },
  });
  const who = currentUser(req);
  assert.equal(who.name, "Real Reviewer");
  assert.equal(who.email, "real.reviewer@dollartree.com");
});

test("currentUser falls back to the email local-part when no display name is set", () => {
  const who = currentUser(fakeReq({ userEmail: "jane.doe@dollartree.com" }));
  assert.equal(who.name, "jane.doe");
});

test("currentUser falls back to 'Reviewer' when the session has no name or email", () => {
  assert.equal(currentUser(fakeReq({})).name, "Reviewer");
});

test("annotation input contract drops client-supplied author/authorRole", () => {
  const parsed = CreateAnnotationBody.parse({
    type: "pin",
    text: "note",
    author: "Victim",
    authorRole: "Admin",
  }) as Record<string, unknown>;
  assert.ok(!("author" in parsed), "author must not survive the input contract");
  assert.ok(!("authorRole" in parsed));
  assert.equal(parsed["type"], "pin");
});

test("annotation update contract drops client-supplied resolvedBy", () => {
  const parsed = UpdateAnnotationBody.parse({
    status: "resolved",
    resolvedBy: "Victim",
  }) as Record<string, unknown>;
  assert.ok(!("resolvedBy" in parsed));
  assert.equal(parsed["status"], "resolved");
});

test("comment reply input contract drops client-supplied author", () => {
  const parsed = AddCommentReplyBody.parse({
    text: "hi",
    author: "Victim",
    authorRole: "Admin",
  }) as Record<string, unknown>;
  assert.ok(!("author" in parsed));
  assert.ok(!("authorRole" in parsed));
});

test("approval decision input contract drops client-supplied reviewer", () => {
  const parsed = CreateApprovalDecisionBody.parse({
    decision: "approve",
    reviewer: "Victim",
    reviewerRole: "Admin",
  }) as Record<string, unknown>;
  assert.ok(!("reviewer" in parsed), "reviewer must not survive the input contract");
  assert.ok(!("reviewerRole" in parsed));
  assert.equal(parsed["decision"], "approve");
});

test("version input contract drops client-supplied createdBy", () => {
  const parsed = CreatePackageVersionBody.parse({
    label: "v2",
    createdBy: "Victim",
  }) as Record<string, unknown>;
  assert.ok(!("createdBy" in parsed));
  assert.equal(parsed["label"], "v2");
});

test("bulk action keeps the assignee target but has no actor identity field", () => {
  const parsed = BulkPackageActionBody.parse({
    ids: [1],
    action: "assign",
    assignee: "Dana Whitfield",
    reviewer: "Victim",
  }) as Record<string, unknown>;
  assert.ok(!("reviewer" in parsed), "actor identity must not be client-supplied");
  assert.equal(parsed["assignee"], "Dana Whitfield");
});
