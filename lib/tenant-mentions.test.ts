import { describe, expect, it, vi } from "vitest";
import { resolveTenantMentions, tenantMemberWhere } from "./tenant-mentions";

/** #502: mentions resolve only to members of the issue's tenant. */

const bob = "clxxxxxxxxxxxxxxxxxxxxxxx02";
const dave = "clxxxxxxxxxxxxxxxxxxxxxxx04";

/** Bob is in Zedu; Dave is only in Acme. */
function fakeDb() {
  const members: Record<string, { id: string; name: string; tenants: string[] }> = {
    [bob]: { id: bob, name: "Bob Builder", tenants: ["tenant-zedu"] },
    [dave]: { id: dave, name: "Dave Acme", tenants: ["tenant-acme"] },
  };
  const findMany = vi.fn(async ({ where }: { where: { id: { in: string[] }; memberships: { some: { tenantId: string } } } }) =>
    where.id.in
      .map((id) => members[id])
      .filter((user): user is (typeof members)[string] => Boolean(user))
      .filter((user) => user.tenants.includes(where.memberships.some.tenantId))
      .map(({ id, name }) => ({ id, name })),
  );
  return { db: { user: { findMany } } as never, findMany };
}

describe("resolveTenantMentions (#502)", () => {
  it("keeps a member's mention and canonicalises the name", async () => {
    const { db } = fakeDb();
    expect(await resolveTenantMentions(db, "tenant-zedu", `ping @[Bobby](${bob})`)).toBe(
      `ping @[Bob Builder](${bob})`,
    );
  });

  it("turns a mention of someone in another tenant into plain text", async () => {
    const { db } = fakeDb();
    expect(await resolveTenantMentions(db, "tenant-zedu", `ping @[Dave Acme](${dave}) and @[Bob](${bob})`)).toBe(
      `ping @Dave Acme and @[Bob Builder](${bob})`,
    );
  });

  it("asks only for members of the given tenant", async () => {
    const { db, findMany } = fakeDb();
    await resolveTenantMentions(db, "tenant-zedu", `@[Dave](${dave})`);
    expect(findMany.mock.calls[0]![0].where).toEqual({
      id: { in: [dave] },
      ...tenantMemberWhere("tenant-zedu"),
    });
    expect(tenantMemberWhere("tenant-zedu")).toEqual({ memberships: { some: { tenantId: "tenant-zedu" } } });
  });

  it("skips the lookup when nothing is mentioned", async () => {
    const { db, findMany } = fakeDb();
    expect(await resolveTenantMentions(db, "tenant-zedu", "no tags here")).toBe("no tags here");
    expect(findMany).not.toHaveBeenCalled();
  });
});
