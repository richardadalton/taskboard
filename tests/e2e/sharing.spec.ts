import { test, expect } from '@playwright/test'

// Sharing tests verify that role-based affordances are server-driven:
// the same list renders different controls for owners vs collaborators.
//
// Full sharing tests require two authenticated sessions. These are integration-level
// stubs that test the affordance structure the server returns.

test.describe('role-based affordances', () => {
  test('owner sees invite and delete controls', async ({ page }) => {
    await page.goto('/')
    await page.click('button:has-text("New list")')
    await page.fill('input[name="name"]', 'Owner List')
    await page.click('button:has-text("Create")')
    await page.click('a.list-card-link')

    // Owner affordances — server decides these, not the client
    await expect(page.locator('button:has-text("Rename")')).toBeVisible()
    await expect(page.locator('button:has-text("Delete list")')).toBeVisible()
    await expect(page.locator('button:has-text("Invite someone")')).toBeVisible()

    // Owner must NOT see a "Leave list" button
    await expect(page.locator('button:has-text("Leave list")')).not.toBeVisible()
  })

  test('invite form — owner can open and cancel', async ({ page }) => {
    await page.goto('/')
    await page.click('button:has-text("New list")')
    await page.fill('input[name="name"]', 'Invite Test')
    await page.click('button:has-text("Create")')
    await page.click('a.list-card-link')

    await page.click('button:has-text("Invite someone")')
    await expect(page.locator('input[name="email"]')).toBeVisible()

    await page.click('button:has-text("Cancel")')
    await expect(page.locator('input[name="email"]')).not.toBeVisible()
    await expect(page.locator('button:has-text("Invite someone")')).toBeVisible()
  })

  test('rename list — inline form, save updates header fragment', async ({ page }) => {
    await page.goto('/')
    await page.click('button:has-text("New list")')
    await page.fill('input[name="name"]', 'Original Name')
    await page.click('button:has-text("Create")')
    await page.click('a.list-card-link')

    await page.click('button:has-text("Rename")')
    await expect(page.locator('input.input-list-name')).toBeVisible()
    await page.fill('input.input-list-name', 'Renamed List')
    await page.click('button[type="submit"]:has-text("Save")')

    // Server returned updated header fragment
    await expect(page.locator('.list-name')).toContainText('Renamed List')
    await expect(page.locator('input.input-list-name')).not.toBeVisible()
  })

  test('delete list — confirm fragment, then redirect home', async ({ page }) => {
    await page.goto('/')
    await page.click('button:has-text("New list")')
    await page.fill('input[name="name"]', 'Doomed List')
    await page.click('button:has-text("Create")')
    await page.click('a.list-card-link')

    await page.click('button:has-text("Delete list")')

    // Server returned confirm-delete fragment
    await expect(page.locator('button:has-text("Delete forever")')).toBeVisible()
    await expect(page.locator('button:has-text("Cancel")')).toBeVisible()

    await page.click('button:has-text("Delete forever")')

    // HX-Redirect sent by server — htmx navigated to home
    await expect(page).toHaveURL('/')
    await expect(page.locator('.list-grid')).not.toContainText('Doomed List')
  })
})
