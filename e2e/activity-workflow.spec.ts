import { expect, test } from "@playwright/test";
import { createProject, createTask, openTask, tab, uniqueName } from "./helpers.js";

test("project mutations appear in the activity timeline in reverse chronological order", async ({
  page,
}) => {
  const project = uniqueName("Activity workflow");
  await createProject(page, project);
  await createTask(page, "Ready", "Record the data model");

  const drawer = await openTask(page, "Record the data model");
  await drawer.getByLabel("Add progress").fill("Initial lease data model designed.");
  await drawer.getByRole("button", { name: "Add progress" }).click();
  await expect(drawer.getByText("Initial lease data model designed.")).toBeVisible();
  await page.keyboard.press("Escape");

  await tab(page, "Project Context").click();
  await page.getByLabel("Project context").fill("Project state persists between agents.");
  await page.getByRole("button", { name: "Save context" }).click();
  await expect(page.getByText(/38 characters/)).toBeVisible();

  await tab(page, "Activity").click();

  const entries = page.locator(".timeline .entry");
  await expect(entries.first()).toContainText("updated project context");

  const text = await page.locator(".timeline").innerText();
  const order = [
    "updated project context",
    "added progress to",
    "created",
    "created the project",
  ].map((phrase) => text.indexOf(phrase));

  expect(order.every((index) => index >= 0)).toBe(true);
  expect(order).toEqual([...order].sort((left, right) => left - right));

  // Filtering narrows the timeline to a single event type.
  await page.getByLabel("Filter by event type").selectOption("task.progress_added");
  await expect(page.locator(".timeline .entry")).toHaveCount(1);
  await expect(page.locator(".timeline .entry")).toContainText("Initial lease data model designed.");
});
