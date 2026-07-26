import { expect, test, type Page } from "@playwright/test";
import { createProject, createTask, openTask, tab, uniqueName } from "./helpers.js";

const projectMarkdown = [
  "# Operating constraints",
  "",
  "- Keep **drafts** safe during polling",
  "- Read the [workspace guide](https://example.com/workspace-guide)",
  "",
  "Run `pnpm test` before handoff.",
  "Existing plain-text line breaks stay visible.",
].join("\n");

const taskMarkdown = [
  "## Handoff",
  "",
  "1. Preserve the saved context.",
  "2. Verify `Escape` only cancels editing.",
  "",
  "> Future agents need this decision.",
].join("\n");

async function expectWithinViewport(page: Page, selector: string): Promise<void> {
  const locator = page.locator(selector);
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
  expect((box?.x ?? 0) + (box?.width ?? Number.POSITIVE_INFINITY)).toBeLessThanOrEqual(375);
}

test("project context reads as Markdown and preserves an edit through polling", async ({ page }) => {
  const project = uniqueName("Project context Markdown");
  await createProject(page, project);
  await tab(page, "Project Context").click();

  await expect(page.getByText(/No context recorded yet\. Add persistent/)).toBeVisible();
  await expect(page.getByLabel("Project context", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Edit context", exact: true }).click();
  const editor = page.getByLabel("Project context", { exact: true });
  await editor.fill(projectMarkdown);

  const projectPoll = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      response.request().method() === "GET" &&
      /^\/api\/v1\/projects\/PRJ-\d+$/.test(url.pathname)
    );
  });
  await projectPoll;
  await expect(editor).toHaveValue(projectMarkdown);

  await page.getByRole("button", { name: "Save context", exact: true }).click();
  const preview = page.getByRole("region", { name: "Project context preview" });
  await expect(preview.getByRole("heading", { name: "Operating constraints", level: 1 })).toBeVisible();
  await expect(preview.getByRole("listitem")).toHaveCount(2);
  await expect(preview.getByRole("link", { name: "workspace guide" })).toHaveAttribute(
    "href",
    "https://example.com/workspace-guide",
  );
  await expect(preview.locator("code")).toContainText("pnpm test");
  await expect(page.getByLabel("Project context", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Edit context", exact: true }).click();
  await page.getByLabel("Project context", { exact: true }).fill("# Unsaved replacement");
  await page.getByLabel("Project context", { exact: true }).press("Escape");
  await expect(page.getByLabel("Project context", { exact: true })).toHaveCount(0);
  await expect(preview.getByRole("heading", { name: "Operating constraints", level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit context", exact: true })).toBeFocused();

  await page.reload();
  await expect(
    page.getByRole("region", { name: "Project context preview" }).getByRole("heading", {
      name: "Operating constraints",
      level: 1,
    }),
  ).toBeVisible();
});

test("task context saves Markdown and Escape cancels without closing the drawer", async ({ page }) => {
  const project = uniqueName("Task context Markdown");
  await createProject(page, project);
  await createTask(page, "Ready", "Record the durable handoff");
  const drawer = await openTask(page, "Record the durable handoff");

  await expect(drawer.getByText(/No task context recorded yet/)).toBeVisible();
  await drawer.getByRole("button", { name: "Edit context", exact: true }).click();
  await drawer.getByLabel("Task context", { exact: true }).fill("# Unsaved task context");
  await drawer.getByLabel("Task context", { exact: true }).press("Escape");
  await expect(drawer).toBeVisible();
  await expect(drawer.getByLabel("Task context", { exact: true })).toHaveCount(0);
  await expect(drawer.getByText(/No task context recorded yet/)).toBeVisible();

  await drawer.getByRole("button", { name: "Edit context", exact: true }).click();
  const editor = drawer.getByLabel("Task context", { exact: true });
  await editor.fill(taskMarkdown);

  const taskPoll = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      response.request().method() === "GET" &&
      /^\/api\/v1\/tasks\/TASK-\d+$/.test(url.pathname)
    );
  });
  await taskPoll;
  await expect(editor).toHaveValue(taskMarkdown);

  await drawer.getByRole("button", { name: "Save context", exact: true }).click();
  const preview = drawer.getByRole("region", { name: "Task context preview" });
  await expect(preview.getByRole("heading", { name: "Handoff", level: 2 })).toBeVisible();
  await expect(preview.getByRole("listitem")).toHaveCount(2);
  await expect(preview.locator("blockquote")).toContainText("Future agents need this decision.");

  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
  await page.reload();
  const reopened = await openTask(page, "Record the durable handoff");
  await expect(
    reopened
      .getByRole("region", { name: "Task context preview" })
      .getByRole("heading", { name: "Handoff", level: 2 }),
  ).toBeVisible();
});

test("project and task context controls remain usable at 375px", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  const project = uniqueName("Mobile context");
  await createProject(page, project);
  await tab(page, "Project Context").click();

  await page.getByRole("button", { name: "Edit context", exact: true }).click();
  await expect(page.getByRole("button", { name: "Cancel", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save context", exact: true })).toBeVisible();
  await page
    .getByLabel("Project context", { exact: true })
    .fill(`## Mobile project\n\nUnbroken_${"x".repeat(180)}`);
  await page.getByRole("button", { name: "Save context", exact: true }).click();

  await expectWithinViewport(page, ".page");
  await expectWithinViewport(page, ".context-document");

  await tab(page, "Board").click();
  await createTask(page, "Backlog", "Mobile context task");
  const drawer = await openTask(page, "Mobile context task");
  await drawer.getByRole("button", { name: "Edit context", exact: true }).click();
  await expect(drawer.getByRole("button", { name: "Cancel", exact: true })).toBeVisible();
  await expect(drawer.getByRole("button", { name: "Save context", exact: true })).toBeVisible();
  await drawer
    .getByLabel("Task context", { exact: true })
    .fill(`### Mobile task\n\nUnbroken_${"y".repeat(180)}\n\n\`inline-code\``);
  await drawer.getByRole("button", { name: "Save context", exact: true }).click();

  await expectWithinViewport(page, ".drawer");
  await expectWithinViewport(page, ".drawer .context-document");
  const overflow = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth - window.innerWidth,
    drawer: document.querySelector(".drawer")
      ? (document.querySelector(".drawer") as HTMLElement).scrollWidth -
        (document.querySelector(".drawer") as HTMLElement).clientWidth
      : Number.POSITIVE_INFINITY,
  }));
  expect(overflow.document).toBeLessThanOrEqual(0);
  expect(overflow.drawer).toBeLessThanOrEqual(0);
});
