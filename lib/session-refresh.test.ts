import { describe, expect, it } from "vitest";
import { acceptedSessionRefresh, sessionRefreshFor } from "./session-refresh";

const NOW = 1_800_000_000_000;
const token = { id: "u1", sv: 2 };

describe("session refresh after a two-factor change (Ziki #389)", () => {
  it("moves the token that was at the old version to the new one", () => {
    const refresh = sessionRefreshFor("u1", 3, NOW);
    expect(refresh).toMatchObject({ userId: "u1", from: 2, to: 3 });
    expect(acceptedSessionRefresh(token, { sessionRefresh: refresh }, NOW)).toBe(3);
  });

  it("reads the user from sub when id is missing, and treats a token without sv as version 0", () => {
    expect(acceptedSessionRefresh({ sub: "u1" }, { sessionRefresh: sessionRefreshFor("u1", 1, NOW) }, NOW)).toBe(1);
  });

  it("does nothing for an ordinary session update", () => {
    expect(acceptedSessionRefresh(token, undefined, NOW)).toBeNull();
    expect(acceptedSessionRefresh(token, { user: { name: "Ada" } }, NOW)).toBeNull();
  });

  it("won't revive a token that was already stale before the change", () => {
    const refresh = sessionRefreshFor("u1", 3, NOW);
    expect(acceptedSessionRefresh({ id: "u1", sv: 1 }, { sessionRefresh: refresh }, NOW)).toBeNull();
  });

  it("won't move another person's token", () => {
    const refresh = sessionRefreshFor("u1", 3, NOW);
    expect(acceptedSessionRefresh({ id: "u2", sv: 2 }, { sessionRefresh: refresh }, NOW)).toBeNull();
  });

  it("rejects a refresh the browser made up, or one with its numbers changed", () => {
    const forged = { userId: "u1", from: 2, to: 3, expires: NOW + 1000, proof: "00".repeat(32) };
    expect(acceptedSessionRefresh(token, { sessionRefresh: forged }, NOW)).toBeNull();

    const real = sessionRefreshFor("u1", 3, NOW);
    expect(acceptedSessionRefresh(token, { sessionRefresh: { ...real, expires: NOW + 10 ** 9 } }, NOW)).toBeNull();
    expect(acceptedSessionRefresh({ id: "u1", sv: 3 }, { sessionRefresh: { ...real, from: 3, to: 4 } }, NOW)).toBeNull();
    expect(acceptedSessionRefresh(token, { sessionRefresh: { ...real, proof: "short" } }, NOW)).toBeNull();
    expect(acceptedSessionRefresh(token, { sessionRefresh: { ...real, to: "3" } }, NOW)).toBeNull();
  });

  it("expires after a minute", () => {
    const refresh = sessionRefreshFor("u1", 3, NOW);
    expect(acceptedSessionRefresh(token, { sessionRefresh: refresh }, NOW + 59_000)).toBe(3);
    expect(acceptedSessionRefresh(token, { sessionRefresh: refresh }, NOW + 61_000)).toBeNull();
  });
});
