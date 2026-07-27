import { test } from "@playwright/test";

import { signInAsTestUser } from "./helpers";

test("signs the preview user into the dashboard", async ({ page }) => {
  await signInAsTestUser(page);
});
