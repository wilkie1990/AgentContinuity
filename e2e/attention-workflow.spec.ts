import { expect, test } from "@playwright/test";
import { createProject, createTask, openTask, uniqueName } from "./helpers.js";

test("Needs Attention polling surfaces and clears work without a page reload", async ({ page }) => {
  await createProject(page, uniqueName("Attention workflow"));
  await createTask(page, "Ready", "Resolve polling blocker");

  const drawer = await openTask(page, "Resolve polling blocker");
  await drawer.getByLabel("Add blocker").fill("A decision is required.");
  await drawer.getByLabel("Required action").fill("Choose the supported behaviour.");
  await drawer.getByRole("button", { name: "Add blocker" }).click();
  await expect(drawer.getByText("A decision is required.")).toBeVisible();

  await page.goto("/attention");
  await expect(page.getByRole("heading", { name: "Needs Attention" })).toBeVisible();
  await expect(page.getByText("Blocked", { exact: true })).toBeVisible({ timeout: 8_000 });
  await expect(page.getByText("Choose the supported behaviour.")).toBeVisible();

  const taskLink = page.getByRole("link", { name: /Open task/ });
  const taskKey = new URL(await taskLink.getAttribute("href")!, "http://local").searchParams.get("task");
  const blocker = await page.request.get(`/api/v1/tasks/${taskKey}`);
  const detail = (await blocker.json()) as { task: { activeBlockers: Array<{ key: string }> } };
  await page.request.post(`/api/v1/blockers/${detail.task.activeBlockers[0]!.key}/resolve`, {
    data: { resolution: "The supported behaviour is now documented.", actor: "e2e" },
  });

  await expect(page.getByText("Nothing needs attention")).toBeVisible({ timeout: 8_000 });
});
