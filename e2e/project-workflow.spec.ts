import { expect, test } from "@playwright/test";
import { column, createProject, createTask, dragCardTo, openTask, uniqueName } from "./helpers.js";

test("a human can take a task from creation to completion", async ({ page }) => {
  const project = uniqueName("Project workflow");
  await createProject(page, project);

  await createTask(page, "Backlog", "Design task claim model");
  await dragCardTo(page, "Design task claim model", "Ready");
  await expect(
    column(page, "Ready").getByRole("button", { name: /Design task claim model/ }),
  ).toBeVisible();

  const drawer = await openTask(page, "Design task claim model");

  await drawer.getByRole("button", { name: "Edit context", exact: true }).click();
  await drawer
    .getByLabel("Task context", { exact: true })
    .fill("Permanent assignment was rejected: sessions end.");
  await drawer.getByRole("button", { name: "Save context", exact: true }).click();
  await expect(drawer.getByRole("region", { name: "Task context preview" })).toContainText(
    "Permanent assignment was rejected: sessions end.",
  );

  await drawer.getByLabel("Add criterion").fill("Defines expiry behaviour");
  await drawer.getByRole("button", { name: "Add criterion" }).click();
  const criterion = drawer.getByText("Defines expiry behaviour");
  await expect(criterion).toBeVisible();

  // Completion is rejected while a criterion is open.
  await drawer.getByRole("button", { name: "Complete task" }).click();
  await expect(drawer.getByText(/incomplete acceptance criterion/i)).toBeVisible();

  // The checkbox is controlled by server state, so assert after the refetch rather than
  // relying on check()'s immediate state assertion.
  await drawer.getByRole("checkbox").first().click();
  await expect(drawer.getByRole("checkbox").first()).toBeChecked();

  await drawer.getByRole("button", { name: "Complete task" }).click();
  await expect(drawer.getByRole("button", { name: "Complete task" })).toHaveCount(0);

  await page.keyboard.press("Escape");
  await expect(
    column(page, "Done").getByRole("button", { name: /Design task claim model/ }),
  ).toBeVisible();

  // The context survives a reload, which is the whole point of the workspace.
  await page.reload();
  const reopened = await openTask(page, "Design task claim model");
  await expect(reopened.getByRole("region", { name: "Task context preview" })).toContainText(
    "Permanent assignment was rejected: sessions end.",
  );
  await reopened.getByRole("button", { name: "Edit context", exact: true }).click();
  await expect(reopened.getByLabel("Task context", { exact: true })).toHaveValue(
    "Permanent assignment was rejected: sessions end.",
  );
});
