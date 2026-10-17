import { describe, expect, it } from "vitest";
import { messageForFailure, parseJson, readJson } from "./read-error";

describe("messageForFailure", () => {
  it("prefers the route's own error message", () => {
    expect(messageForFailure(422, { error: "Specific." }, "fallback")).toBe("Specific.");
  });

  it("explains a platform 413 that arrives as plain text", () => {
    expect(messageForFailure(413, null, "fallback")).toMatch(/too large/);
  });

  it("explains a platform timeout", () => {
    expect(messageForFailure(504, null, "fallback")).toMatch(/too long/);
  });

  it("uses the fallback for an unexplained client error", () => {
    expect(messageForFailure(400, { nope: true }, "fallback")).toBe("fallback");
  });
});

describe("parseJson / readJson", () => {
  it("returns null for HTML instead of throwing", async () => {
    expect(parseJson("<html>Gateway Timeout</html>")).toBeNull();
    expect(await readJson(new Response("Request Entity Too Large", { status: 413 }))).toBeNull();
  });

  it("parses JSON bodies", async () => {
    expect(await readJson(new Response('{"reply":"hi"}'))).toEqual({ reply: "hi" });
  });
});
