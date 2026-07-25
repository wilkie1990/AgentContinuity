import { expect, type Locator, type Page } from "@playwright/test";

let counter = 0;

export function uniqueName(prefix: string): string {
  counter += 1;
  return `${prefix} ${Date.now().toString(36)}-${counter}`;
}

/** Creates a project through the human UI and lands on its board. */
export async function createProject(page: Page, name: string): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: "+ New project" }).first().click();

  const dialog = page.getByRole("dialog", { name: "New project" });
  await dialog.getByLabel("Name").fill(name);
  await dialog.getByLabel("Objective").fill("Prove persistent project execution");
  await dialog.getByRole("button", { name: "Create project" }).click();

  await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
}

/** Scoped to the project header so a project name never collides with a tab label. */
export function tab(page: Page, label: string): Locator {
  return page.locator(".tabs").getByRole("link", { name: label, exact: true });
}

export function column(page: Page, label: string): Locator {
  return page.locator(".column").filter({ has: page.getByRole("heading", { name: label, level: 4 }) });
}

export async function createTask(page: Page, columnLabel: string, title: string): Promise<void> {
  const target = column(page, columnLabel);
  await target.getByRole("button", { name: `Add task to ${columnLabel}` }).click();
  await target.getByLabel(`New task in ${columnLabel}`).fill(title);
  await target.getByLabel(`New task in ${columnLabel}`).press("Enter");
  await expect(target.getByRole("button", { name: new RegExp(title) })).toBeVisible();
}

/**
 * dnd-kit listens to pointer events, so the drag is driven manually rather than through
 * Playwright's HTML5 drag helper.
 */
export async function dragCardTo(page: Page, cardTitle: string, columnLabel: string): Promise<void> {
  const card = page.getByRole("button", { name: new RegExp(cardTitle) }).first();
  const target = column(page, columnLabel);

  const from = await card.boundingBox();
  const to = await target.boundingBox();
  if (!from || !to) throw new Error("Could not measure the drag source or target.");

  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  // Several intermediate moves are needed to pass the sensor activation constraint.
  await page.mouse.move(from.x + from.width / 2 + 20, from.y + from.height / 2 + 10, { steps: 5 });
  await page.mouse.move(to.x + to.width / 2, to.y + 90, { steps: 12 });
  await page.mouse.up();
}

export async function openTask(page: Page, title: string): Promise<Locator> {
  await page.getByRole("button", { name: new RegExp(title) }).first().click();
  const drawer = page.getByRole("dialog", { name: /^Task / });
  await expect(drawer).toBeVisible();
  return drawer;
}
