import { describe, expect, it } from "vitest";
import { canAssignTicket } from "./ticket-assignment";

describe("canAssignTicket", () => {
  it("allows organization admins to assign to any user", () => {
    expect(
      canAssignTicket({
        actorId: "admin-1",
        actorRole: "user",
        membershipRole: "admin",
        currentAssigneeId: null,
        targetAssigneeId: "user-2",
      }),
    ).toBe(true);
  });

  it("denies a site-wide admin who is only a member", () => {
    expect(
      canAssignTicket({
        actorId: "admin-1",
        actorRole: "admin",
        membershipRole: "member",
        currentAssigneeId: null,
        targetAssigneeId: "user-2",
      }),
    ).toBe(false);
  });

  it("allows super admins to assign to any user", () => {
    expect(
      canAssignTicket({
        actorId: "super-1",
        actorRole: "super_admin",
        currentAssigneeId: "user-1",
        targetAssigneeId: "user-2",
      }),
    ).toBe(true);
  });

  it("allows organization admins to unassign tickets", () => {
    expect(
      canAssignTicket({
        actorId: "admin-1",
        actorRole: "user",
        membershipRole: "owner",
        currentAssigneeId: "user-2",
        targetAssigneeId: null,
      }),
    ).toBe(true);
  });

  it("refuses a normal user taking an unassigned ticket", () => {
    expect(
      canAssignTicket({
        actorId: "user-1",
        actorRole: "user",
        currentAssigneeId: null,
        targetAssigneeId: "user-1",
      }),
    ).toBe(false);
  });

  it("allows the beneficiary to take an unassigned ticket when the assignment is a claim", () => {
    expect(
      canAssignTicket({
        actorId: "user-1",
        actorRole: "user",
        currentAssigneeId: null,
        targetAssigneeId: "user-1",
        voteCount: 3,
        claimed: true,
      }),
    ).toBe(true);
  });

  it("prevents normal users from claiming tickets assigned to someone else", () => {
    expect(
      canAssignTicket({
        actorId: "user-1",
        actorRole: "user",
        currentAssigneeId: "user-2",
        targetAssigneeId: "user-1",
      }),
    ).toBe(false);
  });

  it("allows normal users to keep tickets already assigned to themselves", () => {
    expect(
      canAssignTicket({
        actorId: "user-1",
        actorRole: "user",
        currentAssigneeId: "user-1",
        targetAssigneeId: "user-1",
      }),
    ).toBe(true);
  });

  it("allows normal users to unassign tickets currently assigned to themselves", () => {
    expect(
      canAssignTicket({
        actorId: "user-1",
        actorRole: "user",
        currentAssigneeId: "user-1",
        targetAssigneeId: null,
      }),
    ).toBe(true);
  });

  it("prevents normal users from assigning tickets to other users", () => {
    expect(
      canAssignTicket({
        actorId: "user-1",
        actorRole: "user",
        currentAssigneeId: null,
        targetAssigneeId: "user-2",
      }),
    ).toBe(false);
  });

  it("prevents normal users from unassigning someone else's ticket", () => {
    expect(
      canAssignTicket({
        actorId: "user-1",
        actorRole: "user",
        currentAssigneeId: "user-2",
        targetAssigneeId: null,
      }),
    ).toBe(false);
  });

  describe("work readiness gate (#764)", () => {
    it("allows organization admins to assign tickets regardless of vote count", () => {
      expect(
        canAssignTicket({
          actorId: "admin-1",
          membershipRole: "admin",
          currentAssigneeId: null,
          targetAssigneeId: "user-1",
          voteCount: 0,
        }),
      ).toBe(true);

      expect(
        canAssignTicket({
          actorId: "super-1",
          actorRole: "super_admin",
          currentAssigneeId: null,
          targetAssigneeId: "user-1",
          voteCount: 0,
        }),
      ).toBe(true);
    });

    it("blocks assignment when voteCount is below the threshold of 3", () => {
      expect(
        canAssignTicket({
          actorId: "admin-1",
          actorRole: "admin",
          currentAssigneeId: null,
          targetAssigneeId: "user-1",
          voteCount: 2,
        }),
      ).toBe(false);

      expect(
        canAssignTicket({
          actorId: "user-1",
          actorRole: "user",
          currentAssigneeId: null,
          targetAssigneeId: "user-1",
          voteCount: 0,
        }),
      ).toBe(false);
    });

    it("lets an organization admin assign at 3 votes, and still refuses a member taking it", () => {
      expect(
        canAssignTicket({
          actorId: "admin-1",
          membershipRole: "admin",
          currentAssigneeId: null,
          targetAssigneeId: "user-1",
          voteCount: 3,
        }),
      ).toBe(true);

      expect(
        canAssignTicket({
          actorId: "user-1",
          actorRole: "user",
          currentAssigneeId: null,
          targetAssigneeId: "user-1",
          voteCount: 5,
        }),
      ).toBe(false);
    });

    it("allows unassigning even if voteCount is below 3", () => {
      expect(
        canAssignTicket({
          actorId: "user-1",
          actorRole: "user",
          currentAssigneeId: "user-1",
          targetAssigneeId: null,
          voteCount: 1,
        }),
      ).toBe(true);
    });
  });
});
