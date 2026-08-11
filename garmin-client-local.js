/**
 * Local GarminClient wrapper that fixes two issues in the published npm package:
 * 1. addCookies drops httpOnly / secure / sameSite — we pass them through so
 *    the browser context faithfully matches the cookies captured during login.
 * 2. The remote env patched garmin-client.js with a hard-coded executablePath
 *    that doesn't exist on macOS; here we let Playwright use its default chromium.
 */

import { GarminClient } from "@etweisberg/garmin-connect-mcp/dist/garmin-client.js";

export class LocalGarminClient extends GarminClient {
  async init() {
    if (this.initialized) return;

    let playwright;
    try {
      playwright = await import("playwright");
    } catch {
      throw new Error(
        "Playwright is required. Run: npm run setup"
      );
    }

    this.browser = await playwright.chromium.launch({ headless: true });
    const context = await this.browser.newContext();

    await context.addCookies(
      this.cookies.map((c) => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path ?? "/",
        secure: c.secure ?? false,
        httpOnly: c.httpOnly ?? false,
        sameSite: c.sameSite ?? "Lax",
      }))
    );

    this.page = await context.newPage();
    await this.page.goto(
      "https://connect.garmin.com/site-status/garmin-connect-status.json",
      { waitUntil: "domcontentloaded", timeout: 30000 }
    );
    this.initialized = true;
    console.error("Garmin browser session initialized");
  }
}
