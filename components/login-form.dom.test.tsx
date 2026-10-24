// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loginAction } from "@/app/actions/auth";
import { LoginForm } from "./login-form";

vi.mock("@/app/actions/auth", () => ({ loginAction: vi.fn(), googleSignInAction: vi.fn() }));

const login = vi.mocked(loginAction);

beforeEach(() => login.mockReset());
afterEach(() => cleanup());

async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Email"), "ada@example.com");
  await user.type(screen.getByLabelText("Password"), "correct horse");
  await user.click(screen.getByRole("button", { name: "Sign in" }));
}

describe("LoginForm second step (#648)", () => {
  it("shows no code field until the account needs one", () => {
    render(<LoginForm />);
    expect(screen.queryByLabelText("Authentication code")).toBeNull();
  });

  it("asks for the code after the password is accepted, then sends it with the sign-in", async () => {
    const user = userEvent.setup();
    login.mockResolvedValueOnce({ error: "Enter the code from your authenticator app.", needsCode: true });
    render(<LoginForm />);
    await fillAndSubmit(user);

    const field = await screen.findByLabelText("Authentication code");
    expect(field).toHaveAttribute("autocomplete", "one-time-code");
    expect(screen.getByRole("alert")).toHaveTextContent("Enter the code from your authenticator app.");
    await waitFor(() => expect(field).toHaveFocus());

    login.mockResolvedValueOnce(undefined);
    await user.type(field, "123456");
    await user.click(screen.getByRole("button", { name: "Verify and sign in" }));
    await waitFor(() => expect(login).toHaveBeenCalledTimes(2));
    const sent = login.mock.calls[1][1] as FormData;
    expect(sent.get("email")).toBe("ada@example.com");
    expect(sent.get("password")).toBe("correct horse");
    expect(sent.get("totp")).toBe("123456");
  });

  it("goes back to the plain form if the email or password is changed and fails", async () => {
    const user = userEvent.setup();
    login.mockResolvedValueOnce({ error: "Enter the code from your authenticator app.", needsCode: true });
    render(<LoginForm />);
    await fillAndSubmit(user);
    await screen.findByLabelText("Authentication code");

    login.mockResolvedValueOnce({ error: "Invalid email or password", field: "email" });
    await user.type(screen.getByLabelText("Authentication code"), "123456");
    await user.click(screen.getByRole("button", { name: "Verify and sign in" }));
    await waitFor(() => expect(screen.queryByLabelText("Authentication code")).toBeNull());
    expect(screen.getByRole("alert")).toHaveTextContent("Invalid email or password");
  });
});
