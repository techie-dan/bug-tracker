import { afterEach, describe, expect, it, vi } from "vitest";
import { openSecret, sealSecret } from "./secret-box";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("secret-box", () => {
  it("seals with NEXTAUTH_SECRET when AUTH_SECRET is unset", () => {
    vi.stubEnv("AUTH_SECRET", "");
    vi.stubEnv("NEXTAUTH_SECRET", '"nextauth-secret-long-enough"');
    const sealed = sealSecret("invite-token");
    expect(openSecret(sealed)).toBe("invite-token");
  });

  it("still seals with AUTH_SECRET when that is the only secret set", () => {
    vi.stubEnv("NEXTAUTH_SECRET", "");
    vi.stubEnv("AUTH_SECRET", "auth-secret-long-enough");
    expect(openSecret(sealSecret("invite-token"))).toBe("invite-token");
  });

  it("refuses to seal when neither secret is long enough", () => {
    vi.stubEnv("AUTH_SECRET", "");
    vi.stubEnv("NEXTAUTH_SECRET", "short");
    expect(() => sealSecret("invite-token")).toThrow(/NEXTAUTH_SECRET/);
  });
});
