import { afterEach, describe, expect, it } from "vitest";
import { absoluteUrl, getSiteUrl } from "./site-url";

const ORIGINAL_AUTH = process.env.AUTH_URL;
const ORIGINAL_NEXTAUTH = process.env.NEXTAUTH_URL;
const ORIGINAL_SITE = process.env.NEXT_PUBLIC_SITE_URL;
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_ALLOW = process.env.SITE_URL_ALLOW_LOOPBACK;

function setNodeEnv(value: string | undefined) {
  (process.env as { NODE_ENV?: string }).NODE_ENV = value;
}

afterEach(() => {
  if (ORIGINAL_AUTH === undefined) delete process.env.AUTH_URL;
  else process.env.AUTH_URL = ORIGINAL_AUTH;
  if (ORIGINAL_NEXTAUTH === undefined) delete process.env.NEXTAUTH_URL;
  else process.env.NEXTAUTH_URL = ORIGINAL_NEXTAUTH;
  if (ORIGINAL_SITE === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
  else process.env.NEXT_PUBLIC_SITE_URL = ORIGINAL_SITE;
  if (ORIGINAL_ALLOW === undefined) delete process.env.SITE_URL_ALLOW_LOOPBACK;
  else process.env.SITE_URL_ALLOW_LOOPBACK = ORIGINAL_ALLOW;
  setNodeEnv(ORIGINAL_NODE_ENV);
});

describe("getSiteUrl", () => {
  it("strips trailing slash from AUTH_URL", () => {
    process.env.AUTH_URL = "https://contributors.zedu.chat/bug-tracker/";
    delete process.env.NEXTAUTH_URL;
    expect(getSiteUrl()).toBe("https://contributors.zedu.chat/bug-tracker");
  });

  it("strips /api/auth from NEXTAUTH_URL", () => {
    delete process.env.AUTH_URL;
    process.env.NEXTAUTH_URL =
      "https://contributors.zedu.chat/bug-tracker/api/auth";
    expect(getSiteUrl()).toBe("https://contributors.zedu.chat/bug-tracker");
  });

  it("uses ziki.dev in production when the auth URL is localhost", () => {
    setNodeEnv("production");
    process.env.AUTH_URL = "http://localhost:3000/api/auth";
    delete process.env.NEXTAUTH_URL;
    delete process.env.NEXT_PUBLIC_SITE_URL;
    delete process.env.SITE_URL_ALLOW_LOOPBACK;
    expect(getSiteUrl()).toBe("https://ziki.dev");
    expect(absoluteUrl("/tenants?invite=abc")).toBe("https://ziki.dev/tenants?invite=abc");
  });

  it("keeps localhost for a production server that opts in", () => {
    setNodeEnv("production");
    process.env.AUTH_URL = "http://localhost:3000/api/auth";
    process.env.SITE_URL_ALLOW_LOOPBACK = "true";
    expect(getSiteUrl()).toBe("http://localhost:3000");
  });
});

describe("absoluteUrl", () => {
  it("joins path under the site origin including basePath", () => {
    process.env.AUTH_URL = "https://contributors.zedu.chat/bug-tracker";
    expect(absoluteUrl("/issues/abc")).toBe(
      "https://contributors.zedu.chat/bug-tracker/issues/abc",
    );
    expect(absoluteUrl("/zedu-mark.svg")).toBe(
      "https://contributors.zedu.chat/bug-tracker/zedu-mark.svg",
    );
  });
});
