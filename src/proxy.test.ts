import { afterEach, expect, test } from "bun:test";
import { NextRequest } from "next/server";
import { proxy } from "./proxy";

const run = (authorization?: string) =>
  proxy(new NextRequest("https://rundown.example/api/rundown/runs", { headers: authorization ? { authorization } : {} }));
const basic = (user: string, password: string) => `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;

afterEach(() => {
  delete process.env.SITE_PASSWORD;
  delete process.env.FLY_APP_NAME;
  delete process.env.VERCEL;
});

test("asks for the password when it is missing or wrong", () => {
  process.env.SITE_PASSWORD = "coys";
  expect(run()?.status).toBe(401);
  expect(run(basic("producer", "wrong"))?.status).toBe(401);
});

test("lets the right password through with any user name", () => {
  process.env.SITE_PASSWORD = "coys";
  expect(run(basic("producer", "coys"))).toBeUndefined();
});

test("refuses to serve a Fly deploy that has no password set", () => {
  process.env.FLY_APP_NAME = "rundown-spurs";
  expect(run()?.status).toBe(503);
});

test("refuses to serve a Vercel deploy that has no password set", () => {
  process.env.VERCEL = "1";
  expect(run()?.status).toBe(503);
});
