import { test, expect } from '@playwright/test'

// These tests assume the app is running and the user is already logged in.
// For CI, use a test-only auth bypass (e.g. a TEST_USER_ID env var that skips OAuth).
//
// The HATEOAS contract under test: after each state transition, the server returns
// a fragment containing the correct affordances for the new state — not the old ones.

test.describe('task lifecycle', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    // Create a fresh list for each test
    await page.click('button:has-text("New list")')
    await page.fill('input[name="name"]', 'Test List')
    await page.click('button:has-text("Create")')
    await page.click('a.list-card-link')
    await expect(page).toHaveURL(/\/lists\/\d+/)
  })

  test('add a task — server returns fragment prepended to list', async ({ page }) => {
    await page.click('button:has-text("Add task")')
    await page.fill('input[name="title"]', 'Buy groceries')
    await page.selectOption('select[name="priority"]', 'high')
    await page.click('button[type="submit"]:has-text("Add task")')

    // htmx swapped in the fragment — no page reload
    const task = page.locator('.task-item').first()
    await expect(task).toContainText('Buy groceries')
    await expect(task.locator('.task-priority-high')).toBeVisible()

    // HATEOAS: server returned the complete button (active state affordance)
    await expect(task.locator('form[hx-post*="complete"] button')).toBeVisible()
    // Reopen button must NOT be present for an active task
    await expect(task.locator('form[hx-post*="reopen"]')).not.toBeVisible()
  })

  test('complete a task — server returns reopen affordance, not complete', async ({ page }) => {
    await page.click('button:has-text("Add task")')
    await page.fill('input[name="title"]', 'Write tests')
    await page.click('button[type="submit"]:has-text("Add task")')

    const task = page.locator('.task-item').first()
    await task.locator('form[hx-post*="complete"] button').click()

    // Server swapped in the completed-state fragment
    await expect(task).toHaveClass(/task-done/)
    await expect(task.locator('form[hx-post*="reopen"] button')).toBeVisible()
    await expect(task.locator('form[hx-post*="complete"]')).not.toBeVisible()
  })

  test('reopen a completed task — server returns active-state affordances', async ({ page }) => {
    await page.click('button:has-text("Add task")')
    await page.fill('input[name="title"]', 'Send invoice')
    await page.click('button[type="submit"]:has-text("Add task")')

    const task = page.locator('.task-item').first()
    await task.locator('form[hx-post*="complete"] button').click()
    await expect(task).toHaveClass(/task-done/)

    await task.locator('form[hx-post*="reopen"] button').click()
    await expect(task).not.toHaveClass(/task-done/)
    await expect(task.locator('form[hx-post*="complete"] button')).toBeVisible()
  })

  test('edit a task inline — form replaces item, save restores it', async ({ page }) => {
    await page.click('button:has-text("Add task")')
    await page.fill('input[name="title"]', 'Original title')
    await page.click('button[type="submit"]:has-text("Add task")')

    const task = page.locator('.task-item').first()
    await task.hover()
    await task.locator('button[aria-label="Edit task"]').click()

    // Task item replaced by edit form
    await expect(task.locator('input[name="title"]')).toBeVisible()
    await task.locator('input[name="title"]').fill('Updated title')
    await task.locator('button[type="submit"]:has-text("Save")').click()

    // Form replaced by updated task item
    await expect(task.locator('input[name="title"]')).not.toBeVisible()
    await expect(task).toContainText('Updated title')
  })

  test('cancel edit — server restores original task fragment', async ({ page }) => {
    await page.click('button:has-text("Add task")')
    await page.fill('input[name="title"]', 'Stable title')
    await page.click('button[type="submit"]:has-text("Add task")')

    const task = page.locator('.task-item').first()
    await task.hover()
    await task.locator('button[aria-label="Edit task"]').click()
    await task.locator('input[name="title"]').fill('Discarded change')
    await task.locator('button:has-text("Cancel")').click()

    // Server returned the original fragment — no JS state, no stale data
    await expect(task).toContainText('Stable title')
    await expect(task.locator('input[name="title"]')).not.toBeVisible()
  })

  test('delete — inline confirmation, then item removed', async ({ page }) => {
    await page.click('button:has-text("Add task")')
    await page.fill('input[name="title"]', 'To delete')
    await page.click('button[type="submit"]:has-text("Add task")')

    const task = page.locator('.task-item').first()
    await task.hover()
    await task.locator('button[aria-label="Delete task"]').click()

    // Server returned the confirm-delete fragment
    await expect(task.locator('button:has-text("Delete")')).toBeVisible()
    await expect(task.locator('button:has-text("Cancel")')).toBeVisible()

    await task.locator('button:has-text("Delete")').click()
    await expect(page.locator('#task-To_delete')).not.toBeVisible()
    await expect(page.locator('.task-list .task-item')).toHaveCount(0)
  })

  test('search filters tasks without page reload', async ({ page }) => {
    await page.click('button:has-text("Add task")')
    await page.fill('input[name="title"]', 'Alpha task')
    await page.click('button[type="submit"]:has-text("Add task")')

    await page.click('button:has-text("Add task")')
    await page.fill('input[name="title"]', 'Beta task')
    await page.click('button[type="submit"]:has-text("Add task")')

    const url = page.url()
    await page.fill('input[type="search"]', 'Alpha')
    await page.waitForTimeout(400) // debounce delay

    await expect(page).toHaveURL(url) // no navigation
    await expect(page.locator('.task-item')).toHaveCount(1)
    await expect(page.locator('.task-item')).toContainText('Alpha task')
  })
})
