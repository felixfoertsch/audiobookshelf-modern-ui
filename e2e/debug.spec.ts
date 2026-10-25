import { expect, test } from '@playwright/test'

async function signIn(page: import('@playwright/test').Page, username: string) {
	await page.goto('/')
	await page.getByLabel('Username', { exact: true }).fill(username)
	await page.getByLabel('Password', { exact: true }).fill('password')
	await page.getByRole('button', { name: 'Sign in', exact: true }).click()
}

test('standalone runtime does not expose legacy debug overlay routes', async ({
	request,
}) => {
	for (const path of [
		'/internal-api/debug/issues',
		'/internal-api/debug/notes/item/book-1',
	]) {
		const response = await request.get(path)
		expect(response.status(), path).toBe(404)
	}
})

test('admin creates, edits, reloads, and removes debug notes and sub-items', async ({
	page,
}) => {
	await signIn(page, 'admin')
	await page.goto('/item/book-1')
	const toggle = page.getByRole('switch', { name: 'Debug', exact: true })
	await toggle.click()
	await expect(page.locator('.dbo-overlay')).toBeVisible()

	const note = 'Synthetic e2e note'
	const noteInput = page.getByLabel('Notes for this page…')
	await noteInput.fill(note)
	const firstSave = page.waitForResponse(
		(response) =>
			response.url().includes('/debug-api/notes/item/book-1') &&
			response.request().method() === 'PUT',
	)
	await noteInput.blur()
	expect((await firstSave).ok()).toBeTruthy()
	const routeStatus = page.getByRole('group', { name: 'Page status' })
	const routeQaSave = page.waitForResponse(
		(response) =>
			response.url().includes('/debug-api/notes/item/book-1') &&
			response.request().method() === 'PUT',
	)
	await routeStatus.getByRole('button', { name: 'QA', exact: true }).click()
	expect((await routeQaSave).request().postDataJSON()).toEqual({
		waitingOn: 'user',
	})
	await expect(
		routeStatus.getByRole('button', { name: 'QA', exact: true }),
	).toHaveAttribute('aria-pressed', 'true')

	await page.reload()
	await expect(page.locator('.dbo-overlay')).toHaveCount(0)
	await page.getByRole('switch', { name: 'Debug', exact: true }).click()
	await expect(page.getByLabel('Notes for this page…')).toHaveValue(note)
	const reloadedRouteStatus = page.getByRole('group', { name: 'Page status' })
	await expect(
		reloadedRouteStatus.getByRole('button', { name: 'QA', exact: true }),
	).toHaveAttribute('aria-pressed', 'true')

	const editedNote = 'Edited synthetic e2e note'
	const editSave = page.waitForResponse(
		(response) =>
			response.url().includes('/debug-api/notes/item/book-1') &&
			response.request().method() === 'PUT',
	)
	await page.getByLabel('Notes for this page…').fill(editedNote)
	await page.getByLabel('Notes for this page…').blur()
	expect((await editSave).ok()).toBeTruthy()

	const create = page.waitForResponse(
		(response) =>
			response.url().includes('/debug-api/sub-items') &&
			response.request().method() === 'POST',
	)
	await page.getByRole('button', { name: 'Add sub-item' }).click()
	await page.getByLabel('Sub-item name').fill('Synthetic check')
	await page.getByRole('button', { name: '/item/*' }).click()
	await page.getByRole('button', { name: 'Add', exact: true }).click()
	const created = await create
	expect(created.ok()).toBeTruthy()
	await expect(page.getByText('Synthetic check', { exact: true })).toBeVisible()
	const subItemStatus = page.getByRole('group', {
		name: 'Synthetic check status',
	})
	const subItemQaSave = page.waitForResponse(
		(response) =>
			response.url().includes('/debug-api/sub-items/status/') &&
			response.request().method() === 'PUT',
	)
	await subItemStatus.getByRole('button', { name: 'QA', exact: true }).click()
	expect((await subItemQaSave).request().postDataJSON()).toEqual({
		status: 'QA',
	})
	await expect(
		subItemStatus.getByRole('button', { name: 'QA', exact: true }),
	).toHaveAttribute('aria-pressed', 'true')

	const remove = page.waitForResponse(
		(response) =>
			response.url().includes('/debug-api/sub-items/') &&
			response.request().method() === 'DELETE',
	)
	await page.getByRole('button', { name: 'Delete Synthetic check' }).click()
	expect((await remove).ok()).toBeTruthy()
	await expect(page.getByText('Synthetic check', { exact: true })).toHaveCount(
		0,
	)

	const clearNote = page.waitForResponse(
		(response) =>
			response.url().includes('/debug-api/notes/item/book-1') &&
			response.request().method() === 'PUT',
	)
	await page.getByLabel('Notes for this page…').fill('')
	await page.getByLabel('Notes for this page…').blur()
	expect((await clearNote).ok()).toBeTruthy()
})

test('ordinary user has no debug toggle or debug API requests', async ({
	page,
}) => {
	const requests: string[] = []
	page.on('request', (request) => {
		if (request.url().includes('/debug-api/')) requests.push(request.url())
	})
	await signIn(page, 'listener')
	await expect(
		page.getByRole('switch', { name: 'Debug', exact: true }),
	).toHaveCount(0)
	await page.goto('/item/book-1')
	await expect(
		page.getByRole('switch', { name: 'Debug', exact: true }),
	).toHaveCount(0)
	expect(requests).toEqual([])
})
