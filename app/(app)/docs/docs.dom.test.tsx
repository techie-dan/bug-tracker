// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import DocsPage from "./page";
import * as clipboard from "@/lib/clipboard";

vi.mock("@/lib/clipboard", () => ({
  copyText: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("DocsPage", () => {
  it("renders main heading, descriptions, and /llms.txt links", () => {
    render(<DocsPage />);

    const h1 = screen.getByRole("heading", { name: /API Documentation & AI Integration/i, level: 1 });
    expect(h1).toBeTruthy();

    const llmsLinks = screen.getAllByRole("link", { name: /llms\.txt/i });
    expect(llmsLinks.length).toBeGreaterThan(0);
    expect(llmsLinks[0].getAttribute("href")).toBe("/llms.txt");
  });

  it("renders key API sections and interactive cURL examples", async () => {
    const copySpy = vi.mocked(clipboard.copyText).mockResolvedValue(true);
    const user = userEvent.setup();

    render(<DocsPage />);

    // Check headings
    expect(screen.getByRole("heading", { name: /1\. Authentication/i })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /Machine-Readable Spec Available/i })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /2\. Agent Protocol & Bidding Rules/i })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /3\. Core API Endpoints/i })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /4\. Error Codes & Handling/i })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /Discover Open Issues/i })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /Submit a Solution Bid/i })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /Submit Independent Test Verdict/i })).toBeTruthy();

    // Check copy button functionality
    const copyButtons = screen.getAllByRole("button", { name: /Copy command/i });
    expect(copyButtons.length).toBeGreaterThan(0);

    await user.click(copyButtons[0]);
    expect(copySpy).toHaveBeenCalled();
  });

  it("sends projectId on the examples whose routes reject a request without it", () => {
    // GET /api/v1/issues and POST /api/v1/issues/{id}/bid answer 400
    // "projectId is required" without it, so a copied example has to carry it.
    const { container } = render(<DocsPage />);
    const commands = Array.from(container.querySelectorAll("pre code"), (node) => node.textContent ?? "");
    const url = (fragment: string) => commands.find((command) => command.includes(fragment))?.match(/"(https:\/\/[^"]+)"/)?.[1];

    const list = url("/api/v1/issues?");
    const bid = url("/bid");
    expect(list).toBeDefined();
    expect(bid).toBeDefined();
    expect(new URL(list!).searchParams.get("projectId")).toBe("YOUR_PROJECT_ID");
    expect(new URL(list!).searchParams.get("status")).toBe("open");
    expect(new URL(bid!).searchParams.get("projectId")).toBe("YOUR_PROJECT_ID");
  });

  it("says where to find the projectId", () => {
    const { container } = render(<DocsPage />);
    expect(container.textContent).toContain("GET /api/v1/projects");
  });
});
