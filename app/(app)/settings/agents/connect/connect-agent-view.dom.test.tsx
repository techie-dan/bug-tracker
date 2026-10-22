// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkAgentConnectionAction } from "./actions";
import { ConnectAgentView } from "./connect-agent-view";

vi.mock("./actions", () => ({
  checkAgentConnectionAction: vi.fn(),
}));

vi.mock("@/components/ui/toast", () => ({
  useToast: () => vi.fn(),
}));

const mockCheckConnection = vi.mocked(checkAgentConnectionAction);

const mockTemplates = {
  claude: "Claude Code Snippet with origin https://ziki.dev",
  chatgpt: "ChatGPT Snippet for project alpha",
  node: "// Node.js poller snippet",
  python: "# Python 3 poller snippet",
  mcp: '{ "mcpServers": { "ziki": {} } }',
};

afterEach(() => cleanup());

beforeEach(() => {
  mockCheckConnection.mockReset();
  mockCheckConnection.mockResolvedValue({ connected: false });
});

describe("ConnectAgentView (#610)", () => {
  it("renders the four connection tabs and active project", () => {
    render(
      <ConnectAgentView
        templates={mockTemplates}
        siteUrl="https://ziki.dev"
        projectId="proj_1"
        projectName="Test Project"
      />,
    );

    expect(screen.getByRole("tab", { name: /claude code/i })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /chatgpt/i })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /script/i })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /claude desktop \(mcp\)/i })).toBeTruthy();
    expect(screen.getByText(/Test Project/)).toBeTruthy();
    expect(screen.getByText(/\(proj_1\)/)).toBeTruthy();
    expect(screen.getByText(mockTemplates.claude)).toBeTruthy();
  });

  it("switches to the ChatGPT tab when clicked", async () => {
    const user = userEvent.setup();
    render(
      <ConnectAgentView
        templates={mockTemplates}
        siteUrl="https://ziki.dev"
        projectId="proj_1"
        projectName="Test Project"
      />,
    );

    await user.click(screen.getByRole("tab", { name: /chatgpt/i }));
    expect(screen.getByText(mockTemplates.chatgpt)).toBeTruthy();
  });

  it("shows the Claude Desktop (MCP) config and its file name", async () => {
    const user = userEvent.setup();
    render(
      <ConnectAgentView templates={mockTemplates} siteUrl="https://ziki.dev" projectId="proj_1" projectName="Test Project" />,
    );

    await user.click(screen.getByRole("tab", { name: /claude desktop \(mcp\)/i }));
    expect(screen.getByText(mockTemplates.mcp)).toBeTruthy();
    expect(screen.getByRole("button", { name: /copy claude_desktop_config\.json/i })).toBeTruthy();
    expect(screen.getByText(/The config holds no key/)).toBeTruthy();
  });

  it("switches to Script tab and toggles between Node and Python", async () => {
    const user = userEvent.setup();
    render(
      <ConnectAgentView
        templates={mockTemplates}
        siteUrl="https://ziki.dev"
        projectId="proj_1"
        projectName="Test Project"
      />,
    );

    await user.click(screen.getByRole("tab", { name: /script/i }));
    expect(screen.getByText(mockTemplates.node)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /python 3/i }));
    expect(screen.getByText(mockTemplates.python)).toBeTruthy();
  });

  it("verifies connection and turns button green when agent call is detected", async () => {
    const user = userEvent.setup();
    mockCheckConnection.mockResolvedValue({
      connected: true,
      agent: { id: "a1", name: "My Claude Agent", model: "Claude" },
    });

    render(
      <ConnectAgentView
        templates={mockTemplates}
        siteUrl="https://ziki.dev"
        projectId="proj_1"
        projectName="Test Project"
      />,
    );

    const btn = screen.getByTestId("test-connection-btn");
    expect(btn.textContent).toContain("Test connection");

    await user.click(btn);

    expect(mockCheckConnection).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "proj_1" }),
    );

    await vi.waitFor(() => {
      expect(btn.textContent).toContain("Connected");
      expect(screen.getByText(/My Claude Agent/)).toBeTruthy();
    });
  });
});
