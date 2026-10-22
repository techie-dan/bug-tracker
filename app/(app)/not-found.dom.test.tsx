// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";

const authMock = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: authMock }));

import AppNotFound from "./not-found";
import IssueNotFound from "./issues/not-found";
import PersonNotFound from "./users/[id]/not-found";
import ProjectNotFound from "./projects/[slug]/not-found";
import AgentNotFound from "./settings/agents/[agentId]/not-found";
import RedesignNotFound from "./redesigns/[id]/not-found";
import EscalationNotFound from "./escalations/[id]/not-found";

describe("in-app 404 pages", () => {
  beforeEach(() => {
    cleanup();
    authMock.mockReset();
  });

  it("stays general when no page names what is missing", () => {
    render(<AppNotFound />);
    expect(screen.getByRole("heading", { name: "We couldn't find that page" })).toBeInTheDocument();
    expect(screen.queryByText(/issue/i, { selector: "h1" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to issues" })).toHaveAttribute("href", "/issues");
  });

  it.each([
    ["a person", PersonNotFound, "We couldn't find that person", "Go to team", "/team"],
    ["a project", ProjectNotFound, "We couldn't find that project", "Your projects", "/projects"],
    ["an agent", AgentNotFound, "We couldn't find that agent", "Your agents", "/settings/agents"],
    ["a redesign", RedesignNotFound, "We couldn't find that redesign proposal", "All redesigns", "/redesigns"],
    ["an escalation", EscalationNotFound, "We couldn't find that escalation", "All escalations", "/escalations"],
  ])("names %s and links back to its list", (_kind, Page, heading, link, href) => {
    render(<Page />);
    expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: link })).toHaveAttribute("href", href);
  });

  it("names an issue, without a sign-in link for someone signed in", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    render(await IssueNotFound());
    expect(screen.getByRole("heading", { name: "We couldn't find that issue" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to issues" })).toHaveAttribute("href", "/issues");
    expect(screen.queryByRole("link", { name: "Sign in" })).not.toBeInTheDocument();
  });

  it("offers a signed-out visitor a sign-in link for an issue", async () => {
    authMock.mockResolvedValue(null);
    render(await IssueNotFound());
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
    expect(screen.getByText(/only visible after you sign in/)).toBeInTheDocument();
  });
});
