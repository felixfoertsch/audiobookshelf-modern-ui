import { expect, test } from '@playwright/test'

for (const prefix of ['']) {
	test(`Admin settings stays active on config children ${prefix || 'root'}`, async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1280, height: 900 })
		await page.goto(`${prefix}/`)
		await page.getByLabel('Username', { exact: true }).fill('admin')
		await page.getByLabel('Password', { exact: true }).fill('password')
		await page.getByRole('button', { name: 'Sign in', exact: true }).click()
		await expect(
			page.getByRole('link', { name: 'Admin settings', exact: true }),
		).toBeVisible()
		for (const route of ['/config', '/config/users', '/config/libraries']) {
			await page.goto(`${prefix}${route}`)
			const link = page.getByRole('link', {
				name: 'Admin settings',
				exact: true,
			})
			await expect(link).toHaveAttribute('aria-current', 'page')
			await expect(link).toHaveClass(/bg-accent/)
			await expect(link).toHaveClass(/font-medium/)
		}
	})
}
