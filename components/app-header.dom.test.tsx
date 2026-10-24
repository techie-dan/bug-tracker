// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { switchActiveRoleAction } from "@/app/actions/auth";
import { selectTenantAction } from "@/app/(app)/tenants/actions";
import { labelInNameMismatches } from "@/lib/a11y/label-in-name";
import { AppHeader } from "./app-header";

vi.mock("next/image", () => ({
  default: (props: { alt?: string }) => <span data-testid="img" aria-hidden={props.alt === ""} />,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/issues",
}));

vi.mock("@/app/(app)/tenants/actions", () => ({
  selectTenantAction: vi.fn(),
}));

vi.mock("@/app/actions/auth", () => ({
  switchActiveRoleAction: vi.fn(),
  logoutAction: vi.fn(),
}));

vi.mock("@/app/actions/settings", () => ({
  setThemeAction: vi.fn(),
}));

const switchRole = vi.mocked(switchActiveRoleAction);
const selectTenant = vi.mocked(selectTenantAction);

afterEach(() => cleanup());

beforeEach(() => {
  switchRole.mockReset();
  switchRole.mockResolvedValue({ error: "refused" });
});

function renderHeader(props?: Partial<Parameters<typeof AppHeader>[0]>) {
  return render(
    <AppHeader
      {...{
        userName: "Ada Lovelace",
        role: "super_admin" as const,
        isRealSuperAdmin: true,
        isRealAdmin: true,
        workspaces: [{ id: "t1", name: "Ziki", slug: "ziki" }],
        activeTenantId: "t1",
        ...props,
      }}
    />,
  );
}

describe("account menu role switch", () => {
  it("keeps the account menu outside the blurred header layer", () => {
    renderHeader();
    const header = document.querySelector("header");
    expect(header?.className).not.toContain("backdrop-blur");
    const background = header?.querySelector(":scope > [aria-hidden='true']");
    expect(background?.className).toContain("backdrop-blur");
    const account = screen.getByRole("button", { name: /account menu/i });
    expect(account.parentElement?.parentElement?.className).toContain("shrink-0");
  });

  it("opens the account menu and asks to switch the active role", async () => {
    const user = userEvent.setup();
    renderHeader();

    await user.click(screen.getByRole("button", { name: /account menu/i }));

    expect(screen.getByRole("group", { name: /view as/i })).toBeTruthy();
    await user.click(screen.getByRole("radio", { name: /normal user/i }));

    expect(switchRole).toHaveBeenCalledWith("user", `${window.location.pathname}${window.location.search}`);
  });

  it("renders Escalations inside Agents, with the pending count on the menu (#763)", async () => {
    const user = userEvent.setup();
    renderHeader({ pendingEscalationsCount: 5 });
    expect(screen.getAllByLabelText("5 pending").length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: /agents/i }));
    const escalationsLink = screen.getByRole("menuitem", { name: /escalations/i });
    expect(escalationsLink.getAttribute("href")).toBe("/escalations");
  });

  it("renders the Workspace menu and its grouped links (#761)", async () => {
    const user = userEvent.setup();
    renderHeader();

    const manageBtn = screen.getByRole("button", { name: "Workspace" });
    expect(manageBtn).toBeTruthy();

    await user.click(manageBtn);

    expect(screen.getByRole("menuitem", { name: /projects/i })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /milestones/i })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /platforms/i })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /types/i })).toBeTruthy();
  });

  it("shows this person's points in the bar", () => {
    renderHeader({ userId: "ada", points: 128, solvedTasks: 4 });
    const link = screen.getByRole("link", { name: /128 pts of 500, 4 solved/i });
    expect(link.getAttribute("href")).toBe("/users/ada");
    expect(link.textContent).toContain("128");
  });

  it("keeps each control's visible text inside its accessible name", () => {
    const { container } = renderHeader({
      userId: "ada",
      points: 0,
      solvedTasks: 0,
      unreadCount: 3,
      pendingEscalationsCount: 5,
    });
    expect(labelInNameMismatches(container)).toEqual([]);
    const workspace = screen.getByRole("combobox", { name: /active workspace, ziki/i });
    expect(workspace.getAttribute("aria-label")).toBeNull();
    expect(workspace.querySelector("option[selected], option")?.textContent).toBe("Ziki");
  });

  it("switches the active workspace as soon as one is chosen", async () => {
    const user = userEvent.setup();
    renderHeader({
      workspaces: [
        { id: "t1", name: "Ziki", slug: "ziki" },
        { id: "t2", name: "Acme", slug: "acme" },
      ],
      activeTenantId: "t1",
    });

    const workspace = screen.getByRole("combobox", { name: /active workspace, ziki/i });
    expect((workspace as HTMLSelectElement).value).toBe("t1");
    await user.selectOptions(workspace, "t2");

    expect(selectTenant).toHaveBeenCalledTimes(1);
    const data = selectTenant.mock.calls[0][0] as FormData;
    expect(data.get("tenantId")).toBe("t2");
  });

  it("links to workspaces when the person has none", () => {
    renderHeader({ workspaces: [], activeTenantId: null });
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByRole("link", { name: "Workspaces" }).getAttribute("href")).toBe("/tenants");
  });

  it("shows the slug when two workspaces share a name", () => {
    renderHeader({
      workspaces: [
        { id: "t1", name: "Acme", slug: "acme" },
        { id: "t2", name: "Acme", slug: "acme-eu" },
      ],
      activeTenantId: "t1",
    });
    expect(screen.getByRole("option", { name: "Acme (acme)" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Acme (acme-eu)" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: /active workspace, acme \(acme\)/i })).toBeTruthy();
  });

  it("renders Docs & /llms.txt link in the account menu (#625)", async () => {
    const user = userEvent.setup();
    renderHeader();

    await user.click(screen.getByRole("button", { name: /account menu/i }));

    const docsLink = screen.getByRole("link", { name: /docs & \/llms\.txt/i });
    expect(docsLink).toBeTruthy();
    expect(docsLink.getAttribute("href")).toBe("/docs");
  });
});

describe("theme toggle in header (#659)", () => {
  it("renders the theme toggle button in the header toolbar", () => {
    renderHeader();
    const toggle = screen.getByTestId("theme-toggle");
    expect(toggle).toBeTruthy();
    expect(toggle.getAttribute("aria-label")).toMatch(/switch to (dark|light) mode/i);
  });

  it("renders the theme options in the account menu", async () => {
    const user = userEvent.setup();
    renderHeader();

    await user.click(screen.getByRole("button", { name: /account menu/i }));

    expect(screen.getByRole("group", { name: /theme preference/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Dark" })).toBeTruthy();
  });
});
