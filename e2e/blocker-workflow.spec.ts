import { expect, test } from "@playwright/test";
import { column, createProject, createTask, openTask, uniqueName } from "./helpers.js";

test("adding a blocker moves the task to Blocked and resolving it moves the task back", async ({
  page,
}) => {
  const project = uniqueName("Blocker workflow");
  await createProject(page, project);
  await createTask(page, "Ready", "Clarify provider behaviour");

  const drawer = await openTask(page, "Clarify provider behaviour");
  await drawer.getByLabel("Add blocker").fill("Expected provider behaviour is unclear.");
  await drawer.getByLabel("Required action").fill("Confirm whether legacy behaviour is preserved.");
  await drawer.getByRole("button", { name: "Add blocker" }).click();

  await expect(drawer.getByText("Expected provider behaviour is unclear.")).toBeVisible();
  await page.keyboard.press("Escape");

  await expect(
    column(page, "Blocked").getByRole("button", { name: /Clarify provider behaviour/ }),
  ).toBeVisible();
  await expect(column(page, "Ready").getByRole("button", { name: /Clarify provider/ })).toHaveCount(0);

  const reopened = await openTask(page, "Clarify provider behaviour");
  await reopened.getByLabel("Resolve").fill("Confirmed that existing behaviour must be preserved.");
  await reopened.getByRole("button", { name: "Resolve" }).click();
  await expect(reopened.getByText("No active blockers.")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(column(page, "Blocked").getByRole("button", { name: /Clarify provider/ })).toHaveCount(
    0,
  );
  await expect(
    column(page, "Ready").getByRole("button", { name: /Clarify provider behaviour/ }),
  ).toBeVisible();
});
