import { expect, test } from '@playwright/test'
import { fixtureUsers } from './fixture-api'
import { signIn, socketControl } from './socket-controls'

for (const prefix of [''])
	test(`real socket reconnect revalidates once ${prefix || 'root'}`, async ({
		page,
	}) => {
		await signIn(page, prefix)
		await page.goto(`${prefix}/item/podcast-1`)
		await expect(
			page.getByRole('heading', { name: 'Field Notes', exact: true }),
		).toBeVisible()
		await expect
			.poll(async () => (await socketControl(page, prefix)).connections)
			.toBe(1)
		await page.evaluate(() => {
			const events: string[] = []
			Object.assign(window, { fixtureEvents: events })
			window.addEventListener('abs:socket', (event) =>
				events.push((event as CustomEvent).detail.event),
			)
		})
		for (const cycle of [1, 2]) {
			const before = await socketControl(page, prefix)
			await socketControl(page, prefix, { action: 'disconnect' })
			await expect
				.poll(async () => (await socketControl(page, prefix)).connections)
				.toBe(0)
			const title = `Reconnected Field Notes ${prefix || 'root'} ${cycle}`
			await socketControl(page, prefix, { action: 'title', title })
			const revalidated = page.waitForRequest(
				(request) =>
					new URL(request.url()).pathname === `${prefix}/api/items/podcast-1` &&
					request.headers().authorization ===
						`Bearer ${fixtureUsers.find((user) => user.username === 'listener')?.accessToken}`,
			)
			await socketControl(page, prefix, { action: 'reconnect' })
			await revalidated
			await expect(
				page.getByRole('heading', { name: title, exact: true }),
			).toBeVisible()
			await expect
				.poll(async () => (await socketControl(page, prefix)).authCount)
				.toBe(before.authCount + 1)
			await expect
				.poll(async () => (await socketControl(page, prefix)).connections)
				.toBe(1)
		}
		await socketControl(page, prefix, {
			action: 'event',
			event: 'item_updated',
			payload: { id: 'podcast-1' },
		})
		await expect
			.poll(() =>
				page.evaluate(
					() =>
						(Reflect.get(window, 'fixtureEvents') as string[]).filter(
							(event) => event === 'item_updated',
						).length,
				),
			)
			.toBe(1)
		const events = await page.evaluate(
			() => Reflect.get(window, 'fixtureEvents') as string[],
		)
		expect(events.filter((event) => event === 'init')).toHaveLength(2)
		expect(events.filter((event) => event === 'reconnect')).toHaveLength(2)
		await socketControl(page, prefix, { action: 'title', title: 'Field Notes' })
	})
