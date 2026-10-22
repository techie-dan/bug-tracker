import { describe, expect, it } from "vitest";
import { confirmationCount, intakeKind, isConfirmedCount, issueStage, parseIssueStageView } from "./issue-stage";

const bug = { beneficiaryUserId: "beneficiary", reporterId: "reporter", createdByAgent: null, claims: [] };

describe("issueStage", () => {
  it("calls every unconfirmed open issue reported, whoever filed it", () => {
    expect(issueStage({ status: "open", voteCount: 0, confirmed: false })).toBe("reported");
    expect(issueStage({ status: "open", voteCount: 5, confirmed: false })).toBe("reported");
  });

  it("calls a confirmed issue with fewer than three upvotes confirmed", () => {
    expect(issueStage({ status: "open", voteCount: 2, confirmed: true })).toBe("confirmed");
  });

  it("calls a confirmed issue with three upvotes ready", () => {
    expect(issueStage({ status: "open", voteCount: 3, confirmed: true })).toBe("ready");
    expect(issueStage({ status: "open", voteCount: 8, confirmed: true })).toBe("ready");
  });

  it("leaves the work status alone once someone starts it", () => {
    expect(issueStage({ status: "in_progress", voteCount: 4, confirmed: true })).toBeNull();
    expect(issueStage({ status: "resolved", voteCount: 0, confirmed: false })).toBeNull();
  });
});

describe("confirmationCount", () => {
  it("confirms on two independent owners", () => {
    const count = confirmationCount({
      createdByAgentId: "filer",
      undoneIds: new Set(),
      bug,
      accepts: [
        { id: "v1", agentId: "a", ownerUserId: "one" },
        { id: "v2", agentId: "b", ownerUserId: "two" },
      ],
    });
    expect(count).toBe(2);
    expect(isConfirmedCount(count)).toBe(true);
  });

  it("does not confirm two accepts from the same owner, the filer, or an undone review", () => {
    const count = confirmationCount({
      createdByAgentId: "filer",
      undoneIds: new Set(["gone"]),
      bug,
      accepts: [
        { id: "v1", agentId: "a", ownerUserId: "one" },
        { id: "v2", agentId: "b", ownerUserId: "one" },
        { id: "own", agentId: "filer", ownerUserId: "three" },
        { id: "gone", agentId: "c", ownerUserId: "four" },
        { id: "self", agentId: "d", ownerUserId: "reporter" },
      ],
    });
    expect(isConfirmedCount(count)).toBe(false);
  });
});

describe("intake", () => {
  it("keeps an open report an idea until it is confirmed and upvoted", () => {
    expect(intakeKind({ status: "open", voteCount: 5, confirmed: false })).toBe("idea");
    expect(intakeKind({ status: "open", voteCount: 2, confirmed: true })).toBe("idea");
    expect(intakeKind({ status: "open", voteCount: 3, confirmed: true })).toBe("issue");
  });

  it("keeps a started or finished report an issue", () => {
    expect(intakeKind({ status: "in_progress", voteCount: 4, confirmed: true })).toBe("issue");
    expect(intakeKind({ status: "closed", voteCount: 0, confirmed: false })).toBe("idea");
  });
});

describe("parseIssueStageView", () => {
  it("keeps the idea filters and the issue filter", () => {
    expect(parseIssueStageView("reported")).toBe("reported");
    expect(parseIssueStageView("confirmed")).toBe("confirmed");
    expect(parseIssueStageView("ready")).toBe("ready");
    expect(parseIssueStageView(undefined)).toBeNull();
  });
});
