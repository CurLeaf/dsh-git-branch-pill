/**
 * Host-half harness: branch detection against real temporary repositories and
 * the `/api/git-branch` handler shape.
 */

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'

import { apply, readBranch, ROUTE } from '../dist/index.js'

const git = (cwd, args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

const commit = (cwd, message = 'init') =>
	git(cwd, ['-c', 'user.name=test', '-c', 'user.email=test@example.com', 'commit', '--allow-empty', '-q', '-m', message])

let root

before(async () => {
	root = await mkdtemp(join(tmpdir(), 'git-branch-pill-'))
})

after(async () => {
	await rm(root, { recursive: true, force: true })
})

/** One repository on `feat/dock` with a single commit. */
async function makeRepo(name) {
	const dir = join(root, name)
	await mkdir(dir, { recursive: true })
	git(dir, ['init', '-q'])
	git(dir, ['symbolic-ref', 'HEAD', 'refs/heads/feat/dock'])
	commit(dir)
	return dir
}

test('reports the checked-out branch', async () => {
	const dir = await makeRepo('branch')
	const value = await readBranch(dir)
	assert.equal(value.repo, true)
	assert.equal(value.branch, 'feat/dock')
	assert.equal(value.detached, false)
})

test('reads the repository from a nested directory', async () => {
	const dir = await makeRepo('nested')
	const deep = join(dir, 'src', 'work')
	await mkdir(deep, { recursive: true })
	const value = await readBranch(deep)
	assert.equal(value.repo, true)
	assert.equal(value.branch, 'feat/dock')
})

test('reports a branch name before the first commit', async () => {
	const dir = join(root, 'unborn')
	await mkdir(dir, { recursive: true })
	git(dir, ['init', '-q'])
	git(dir, ['symbolic-ref', 'HEAD', 'refs/heads/wip/empty'])
	const value = await readBranch(dir)
	assert.equal(value.repo, true)
	assert.equal(value.branch, 'wip/empty')
})

test('falls back to the short commit on a detached HEAD', async () => {
	const dir = await makeRepo('detached')
	git(dir, ['checkout', '-q', '--detach'])
	const value = await readBranch(dir, undefined, true)
	assert.equal(value.repo, true)
	assert.equal(value.detached, true)
	assert.equal(value.branch, null)
	assert.match(value.oid, /^[0-9a-f]{7,}$/)
})

test('answers repo:false outside a work tree', async () => {
	const dir = join(root, 'plain')
	await mkdir(dir, { recursive: true })
	const value = await readBranch(dir)
	assert.equal(value.repo, false)
})

test('caches a path until it is forced', async () => {
	const dir = await makeRepo('cached')
	const first = await readBranch(dir)
	assert.equal(first.branch, 'feat/dock')
	git(dir, ['checkout', '-q', '-b', 'feat/next'])
	const cached = await readBranch(dir)
	assert.equal(cached.branch, 'feat/dock')
	const refreshed = await readBranch(dir, undefined, true)
	assert.equal(refreshed.branch, 'feat/next')
})

test('serves the route with the browser-half shape', async () => {
	let route
	const ctx = {
		inject: (services, run) => {
			assert.deepEqual(services, ['connection'])
			run({
				get: (name) => {
					assert.equal(name, 'connection')
					return { fetch: { register: (candidate) => { route = candidate; return async () => {} } } }
				},
				effect: (fn) => { fn() },
			})
		},
	}
	apply(ctx)
	assert.equal(route.path, ROUTE)
	assert.equal(route.path, '/api/git-branch')
	assert.deepEqual(route.methods, ['POST'])

	const dir = await makeRepo('routed')
	const response = await route.fetch(
		new Request('http://local/api/git-branch', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ paths: [dir] }),
		}),
	)
	const payload = await response.json()
	assert.equal(payload.ok, true)
	assert.equal(payload.value.entries[dir].branch, 'feat/dock')
	assert.equal(typeof payload.value.generatedAt, 'number')

	const refused = await route.fetch(
		new Request('http://local/api/git-branch', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ paths: ['relative/path'] }),
		}),
	)
	const refusedPayload = await refused.json()
	assert.equal(refusedPayload.ok, false)
	assert.equal(refusedPayload.error.code, 'git-branch')
})
