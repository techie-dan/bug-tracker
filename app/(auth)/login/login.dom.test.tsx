// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import LoginPage from "./page";

vi.mock("@/lib/auth-mode", () => ({
  isPasswordAuthEnabled: () => false,
}));

vi.mock("@/lib/google-oauth", () => ({
  isGoogleOAuthConfigured: () => true,
}));

vi.mock("@/app/actions/auth", () => ({
  googleSignInAction: vi.fn(),
  loginAction: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("LoginPage OAuth error a11y (#653)", () => {
  it("announces OAuth failure with role='alert', aria-live='assertive' and aria-atomic='true'", async () => {
    const element = await LoginPage({
      searchParams: Promise.resolve({ error: "OAuthCallbackError" }),
    });
    render(element);

    const alert = screen.getByRole("alert");
    expect(alert).toBeInTheDocument();
    expect(alert).toHaveAttribute("aria-live", "assertive");
    expect(alert).toHaveAttribute("aria-atomic", "true");
    expect(alert).toHaveTextContent("Unable to complete Google sign-in. Please try again.");
  });

  it("announces Configuration error with Google failure message", async () => {
    const element = await LoginPage({
      searchParams: Promise.resolve({ error: "Configuration" }),
    });
    render(element);

    const alert = screen.getByRole("alert");
    expect(alert).toBeInTheDocument();
    expect(alert).toHaveTextContent("Unable to complete Google sign-in. Please try again.");
  });

  it("tells a two-factor account to use email and the code instead of Google", async () => {
    const element = await LoginPage({
      searchParams: Promise.resolve({ error: "TwoFactor" }),
    });
    render(element);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Sign in with email and password, then enter the code.",
    );
  });

  it("announces generic authentication error for other error codes", async () => {
    const element = await LoginPage({
      searchParams: Promise.resolve({ error: "CredentialsSignin" }),
    });
    render(element);

    const alert = screen.getByRole("alert");
    expect(alert).toBeInTheDocument();
    expect(alert).toHaveTextContent("Authentication failed. Please try again.");
  });

  it("includes diagnostic reason when provided", async () => {
    const element = await LoginPage({
      searchParams: Promise.resolve({
        error: "OAuthCallbackError",
        reason: "redirect_uri_mismatch",
      }),
    });
    render(element);

    const alert = screen.getByRole("alert");
    expect(alert).toBeInTheDocument();
    expect(alert).toHaveTextContent("Diagnostic: redirect_uri_mismatch");
  });

  it("renders no alert when there is no error", async () => {
    const element = await LoginPage({
      searchParams: Promise.resolve({}),
    });
    render(element);

    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("renders expired session status when expired parameter is present without error", async () => {
    const element = await LoginPage({
      searchParams: Promise.resolve({ expired: "1" }),
    });
    render(element);

    expect(screen.queryByRole("alert")).toBeNull();
    const status = screen.getByRole("status");
    expect(status).toBeInTheDocument();
    expect(status).toHaveTextContent("Your session ended. Sign in again to continue.");
  });
});
