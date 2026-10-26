import { describe, expect, it } from "vitest";
import { basicAuthCredentials, checkBasicAuth } from "@/lib/auth/basic-auth";

const env = { SOV_BASIC_AUTH_USER: "team", SOV_BASIC_AUTH_PASSWORD: "s3cret:pässword" };
const header = (user: string, password: string) =>
  `Basic ${Buffer.from(`${user}:${password}`, "utf8").toString("base64")}`;

describe("basicAuthCredentials", () => {
  it("is off unless both the user and the password are set", () => {
    expect(basicAuthCredentials({})).toBeNull();
    expect(basicAuthCredentials({ SOV_BASIC_AUTH_USER: "team" })).toBeNull();
    expect(basicAuthCredentials({ SOV_BASIC_AUTH_PASSWORD: "pw" })).toBeNull();
    expect(basicAuthCredentials({ SOV_BASIC_AUTH_USER: " ", SOV_BASIC_AUTH_PASSWORD: "pw" })).toBeNull();
    expect(basicAuthCredentials(env)).toEqual({ user: "team", password: "s3cret:pässword" });
  });
});

describe("checkBasicAuth", () => {
  it("lets every request through when basic auth is off", () => {
    expect(checkBasicAuth(null, {})).toBeNull();
  });

  it("challenges a request with no credentials", async () => {
    const response = checkBasicAuth(null, env);
    expect(response?.status).toBe(401);
    expect(response?.headers.get("www-authenticate")).toBe('Basic realm="Meadowlark", charset="UTF-8"');
    expect(response?.headers.get("cache-control")).toBe("no-store");
    expect(await response?.text()).not.toContain("s3cret");
  });

  it("rejects a wrong user, a wrong password or a malformed header", () => {
    for (const value of [
      header("team", "nope"),
      header("other", "s3cret:pässword"),
      header("team", "s3cret:pässwor"),
      "Bearer abc",
      "Basic !!!",
      `Basic ${Buffer.from("no-colon").toString("base64")}`,
      "Basic",
    ]) {
      expect(checkBasicAuth(value, env)?.status, value).toBe(401);
    }
  });

  it("accepts the right credentials, with a colon and non-ASCII characters in the password", () => {
    expect(checkBasicAuth(header("team", "s3cret:pässword"), env)).toBeNull();
    expect(checkBasicAuth(header("team", "s3cret:pässword").replace("Basic", "basic"), env)).toBeNull();
  });
});
