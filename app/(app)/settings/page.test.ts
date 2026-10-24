import { beforeEach, describe, expect, it, vi } from "vitest";

const requireUser = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth-helpers", () => ({ requireUser }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
  },
}));
vi.mock("@/auth", () => ({
  auth: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock("@/components/account-data-settings", () => ({
  AccountDataSettings: () => null,
}));

import { prisma } from "@/lib/prisma";
import SettingsPage from "./page";

describe("SettingsPage resilience", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUser.mockResolvedValue({ id: "user-1", name: "Ada Lovelace", email: "ada@example.com", role: "user" });
  });

  it("renders cleanly with full user settings", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      name: "Ada Lovelace",
      email: "ada@example.com",
      theme: "dark",
      emailNotifications: true,
      notifyMentions: true,
      notifyAssignments: true,
      notifyStatusChanges: true,
      keyboardShortcuts: true,
    } as unknown as Awaited<ReturnType<typeof prisma.user.findUnique>>);

    const element = await SettingsPage();
    expect(element).toBeDefined();
    expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
  });

  it("falls back gracefully when full settings query throws due to missing columns", async () => {
    vi.mocked(prisma.user.findUnique)
      .mockRejectedValueOnce(new Error("The column User.theme does not exist in the current database."))
      .mockResolvedValueOnce({
        name: "Ada Lovelace",
        email: "ada@example.com",
      } as unknown as Awaited<ReturnType<typeof prisma.user.findUnique>>);

    const element = await SettingsPage();
    expect(element).toBeDefined();
    expect(prisma.user.findUnique).toHaveBeenCalledTimes(2);
  });

  it("renders agent audit log and manage agents links when agent platform is enabled (#628)", async () => {
    process.env.AGENT_PLATFORM = "true";
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      name: "Ada Lovelace",
      email: "ada@example.com",
    } as unknown as Awaited<ReturnType<typeof prisma.user.findUnique>>);

    const element = await SettingsPage();
    expect(element).toBeDefined();

    function collectHrefs(node: unknown, hrefs: string[] = []): string[] {
      if (!node || typeof node !== "object") return hrefs;
      const anyNode = node as { props?: { href?: string; children?: unknown } };
      if (anyNode.props?.href) hrefs.push(anyNode.props.href);
      if (Array.isArray(anyNode.props?.children)) {
        for (const child of anyNode.props.children) collectHrefs(child, hrefs);
      } else if (anyNode.props?.children) {
        collectHrefs(anyNode.props.children, hrefs);
      }
      return hrefs;
    }

    const hrefs = collectHrefs(element);
    expect(hrefs).toContain("/settings/audit");
    expect(hrefs).toContain("/settings/agents");
    expect(hrefs).toContain("/settings/agents/pair");
    expect(hrefs).toContain("/settings/webhooks");
    delete process.env.AGENT_PLATFORM;
  });

  it("renders agent links by default without explicit env vars", async () => {
    delete process.env.AGENT_PLATFORM;
    delete process.env.NEXT_PUBLIC_AGENT_PLATFORM;

    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      name: "Ada Lovelace",
      email: "ada@example.com",
    } as unknown as Awaited<ReturnType<typeof prisma.user.findUnique>>);

    const element = await SettingsPage();
    expect(element).toBeDefined();

    function collectHrefs(node: unknown, hrefs: string[] = []): string[] {
      if (!node || typeof node !== "object") return hrefs;
      const anyNode = node as { props?: { href?: string; children?: unknown } };
      if (anyNode.props?.href) hrefs.push(anyNode.props.href);
      if (Array.isArray(anyNode.props?.children)) {
        for (const child of anyNode.props.children) collectHrefs(child, hrefs);
      } else if (anyNode.props?.children) {
        collectHrefs(anyNode.props.children, hrefs);
      }
      return hrefs;
    }

    const hrefs = collectHrefs(element);
    expect(hrefs).toContain("/settings/agents");
    expect(hrefs).toContain("/settings/agents/pair");
    expect(hrefs).toContain("/settings/audit");
  });

  it("hides agent links when agent platform is explicitly disabled via AGENT_PLATFORM=false", async () => {
    process.env.AGENT_PLATFORM = "false";
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      name: "Ada Lovelace",
      email: "ada@example.com",
    } as unknown as Awaited<ReturnType<typeof prisma.user.findUnique>>);

    const element = await SettingsPage();
    expect(element).toBeDefined();

    function collectHrefs(node: unknown, hrefs: string[] = []): string[] {
      if (!node || typeof node !== "object") return hrefs;
      const anyNode = node as { props?: { href?: string; children?: unknown } };
      if (anyNode.props?.href) hrefs.push(anyNode.props.href);
      if (Array.isArray(anyNode.props?.children)) {
        for (const child of anyNode.props.children) collectHrefs(child, hrefs);
      } else if (anyNode.props?.children) {
        collectHrefs(anyNode.props.children, hrefs);
      }
      return hrefs;
    }

    const hrefs = collectHrefs(element);
    expect(hrefs).not.toContain("/settings/agents");
    expect(hrefs).not.toContain("/settings/agents/pair");
    expect(hrefs).not.toContain("/settings/audit");
    delete process.env.AGENT_PLATFORM;
  });
});
