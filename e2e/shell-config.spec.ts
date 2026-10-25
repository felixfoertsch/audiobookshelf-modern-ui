import { expect, test } from '@playwright/test'
import { contrast } from './contrast'
import {
	appMenu,
	chooseTheme,
	closeSidebar,
	openSidebar,
	settleAnimations,
} from './shell-controls'

for (const prefix of [''])
	for (const width of [1280, 390])
		for (const theme of ['light', 'dark']) {
			test(`settings navigation, account and library affordance ${prefix || 'root'} ${width} ${theme}`, async ({
				page,
			}) => {
				await page.setViewportSize({ width, height: 900 })
				await page.goto(`${prefix}/`)
				await page.getByLabel('Username', { exact: true }).fill('admin')
				await page.getByLabel('Password', { exact: true }).fill('password')
				await page.getByRole('button', { name: 'Sign in', exact: true }).click()
				await chooseTheme(page, theme)
				const capture = async (name: string) => {
					await page.evaluate(() => {
						if (document.activeElement instanceof HTMLElement)
							document.activeElement.blur()
					})
					await page.mouse.move(0, 0)
					await settleAnimations(page)
					await page.screenshot({
						path: `/private/tmp/opencode/shell-config/${prefix ? 'abs' : 'root'}-${width}-${theme}-${name}.png`,
					})
				}
				await capture('home')
				const inset = await page.locator('#content').evaluate((node) => ({
					padding: parseFloat(getComputedStyle(node).paddingLeft),
					margin: parseFloat(getComputedStyle(node).marginLeft),
				}))
				expect(inset).toEqual({ padding: width < 640 ? 24 : 32, margin: 0 })
				await openSidebar(page)
				const library = page.getByRole('button', { name: /^Library:/ })
				const boundary = await library.evaluate((node) => {
					const canvas = document.createElement('canvas')
					canvas.width = canvas.height = 1
					const ctx = canvas.getContext('2d')
					if (!ctx) throw new Error('Canvas unavailable')
					const rgb = (color: string) => {
						ctx.fillStyle = color
						ctx.fillRect(0, 0, 1, 1)
						return Array.from(ctx.getImageData(0, 0, 1, 1).data).slice(0, 3)
					}
					const luminance = (values: number[]) =>
						values
							.map((x) => x / 255)
							.map((x) =>
								x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4,
							)
							.reduce((sum, x, i) => sum + x * [0.2126, 0.7152, 0.0722][i], 0)
					const style = getComputedStyle(node)
					const border = luminance(rgb(style.borderTopColor))
					const background = luminance(
						rgb(
							getComputedStyle(document.documentElement).getPropertyValue(
								'--glass-opaque',
							),
						),
					)
					return {
						width: parseFloat(style.borderTopWidth),
						ratio:
							(Math.max(border, background) + 0.05) /
							(Math.min(border, background) + 0.05),
					}
				})
				console.log(
					JSON.stringify({
						libraryBoundary: { prefix, viewport: width, theme, ...boundary },
					}),
				)
				expect(boundary.width).toBeGreaterThanOrEqual(1)
				expect(boundary.ratio).toBeGreaterThanOrEqual(3)
				await library.click()
				await expect(
					page.getByRole('menuitemradio', { name: 'Field Notes', exact: true }),
				).toBeVisible()
				await capture('library-dropdown')
				await page.keyboard.press('Escape')
				await closeSidebar(page)
				const debug = page.getByRole('switch', { name: 'Debug', exact: true })
				await expect(debug).not.toBeChecked()
				await settleAnimations(page)
				expect(
					(await contrast(debug, 'backgroundColor')).ratio,
				).toBeGreaterThanOrEqual(3)
				expect(
					(await contrast(debug, 'borderTopColor')).ratio,
				).toBeGreaterThanOrEqual(3)
				await expect(debug.locator('..')).toHaveText('Debug')
				await debug.click()
				await expect(debug).toBeChecked()
				await expect(page.locator('.dbo-overlay')).toBeVisible()
				await debug.click()
				await expect(debug).not.toBeChecked()
				await expect(page.locator('.dbo-overlay')).toHaveCount(0)
				await openSidebar(page)
				const triggerBox = await appMenu(page).boundingBox()
				await appMenu(page).click()
				await expect(page.getByRole('menuitem')).toHaveCount(2)
				await expect(page.getByRole('menuitemradio')).toHaveCount(3)
				const menuBox = await page.getByRole('menu').boundingBox()
				if (!menuBox || !triggerBox) throw new Error('Missing account geometry')
				expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(triggerBox.y)
				expect(Math.abs(menuBox.x - triggerBox.x)).toBeLessThanOrEqual(1)
				await capture('account-menu')
				await page.keyboard.press('Escape')
				await expect(appMenu(page)).toBeFocused()
				await page
					.getByRole('link', { name: 'Admin settings', exact: true })
					.click()
				await closeSidebar(page)
				const admin = page.getByRole('navigation', {
					name: 'Admin settings',
					exact: true,
				})
				await expect(
					admin.getByRole('link', { name: 'Server settings', exact: true }),
				).toHaveAttribute('aria-current', 'page')
				await admin
					.getByRole('link', { name: 'Server settings', exact: true })
					.focus()
				await page.keyboard.press('ArrowRight')
				await expect(
					admin.getByRole('link', { name: 'Backups', exact: true }),
				).toBeFocused()
				await settleAnimations(page)
				const styles = await admin.getByRole('link').evaluateAll((links) =>
					links.map((link) => {
						const style = getComputedStyle(link)
						return {
							current: link.getAttribute('aria-current') === 'page',
							focused: link === document.activeElement,
							background: style.backgroundColor,
							weight: style.fontWeight,
						}
					}),
				)
				const current = styles.find((style) => style.current)
				if (!current) throw new Error('Missing current section')
				for (const other of styles.filter((style) => !style.current)) {
					expect(current.background).not.toBe(other.background)
					expect(Number(current.weight)).toBeGreaterThan(Number(other.weight))
				}
				expect(styles.find((style) => style.focused)?.current).toBe(false)
				if (width === 1280)
					for (const link of await admin.getByRole('link').all()) {
						const box = await link.boundingBox()
						if (!box) throw new Error('Missing section link')
						expect(box.x).toBeGreaterThanOrEqual(0)
						expect(box.x + box.width).toBeLessThanOrEqual(width)
						expect(box.y + box.height).toBeLessThanOrEqual(900)
					}
				await expect(
					page.getByRole('checkbox', {
						name: 'Store covers with item',
						exact: true,
					}),
				).toBeVisible()
				await capture('admin-settings')
				if (width === 390) {
					await page.goto(`${prefix}/config/log`)
					const active = page
						.getByRole('navigation', { name: 'Admin settings', exact: true })
						.getByRole('link', { name: 'Logs', exact: true })
					await expect(active).toHaveAttribute('aria-current', 'page')
					await expect(active).toBeInViewport()
				}
				await openSidebar(page)
				await appMenu(page).click()
				await page
					.getByRole('menuitem', { name: 'User settings', exact: true })
					.click()
				await closeSidebar(page)
				await expect(
					page.getByRole('navigation', { name: 'User settings', exact: true }),
				).toBeVisible()
				await expect(
					page.getByRole('combobox', { name: 'Language', exact: true }),
				).toBeVisible()
				await capture('user-settings')
				await page
					.getByRole('link', { name: 'Personal stats', exact: true })
					.click()
				await expect(
					page.getByRole('link', { name: 'Personal stats', exact: true }),
				).toHaveAttribute('aria-current', 'page')
				expect(
					await page
						.locator('html')
						.evaluate((node) => getComputedStyle(node).scrollbarWidth),
				).toBe('none')
			})
		}
