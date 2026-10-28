/**
 * Host half of `dsh-git-branch-pill`.
 *
 * The composer dock shows the Git branch of the Session's working directory.
 * Only the Host can answer that: the browser cannot run git, and the branch can
 * change underneath an open page (a checkout, or the worktree tool switching
 * the working directory). This half owns one authenticated fetch route below
 * `/api` and caches per path, so re-rendering the dock never spawns git.
 *
 * Nothing here writes to a repository: `GIT_OPTIONAL_LOCKS=0` keeps git from
 * taking optional locks in the working tree.
 */

import { execFile } from 'node:child_process'
import { isAbsolute } from 'node:path'

export const name = 'git-branch-pill'

/** Exact route below `/api`; the browser half requests the same path. */
export const ROUTE = '/api/git-branch'

/** How long one path's reading stays fresh for every caller. */
const CACHE_TTL_MS = 4000
/** A hung git must not hold a page request open. */
const GIT_TIMEOUT_MS = 4000
const MAX_BUFFER = 256 * 1024
const MAX_PATHS = 8
const MAX_PATH_LENGTH = 4096

/** path -> { at, value } */
const cache = new Map()

class BadRequest extends Error {
	constructor(message) {
		super(message)
		this.name = 'BadRequest'
	}
}

function ok(value) {
	return { ok: true, value }
}

function fail(error) {
	return {
		ok: false,
		error: {
			code: 'git-branch',
			message: error instanceof Error ? error.message : String(error),
			details: {},
		},
	}
}

/**
 * Run one read-only git command inside `cwd`.
 * A missing binary, a non-repository, a timeout and an aborted request all
 * resolve to `ok: false`; none of them is exceptional for this feature.
 * @param {string} cwd - directory the command runs in.
 * @param {string[]} args - git arguments.
 * @param {AbortSignal} [signal] - request signal.
 * @returns {Promise<{ ok: boolean, stdout: string }>} command outcome.
 */
function runGit(cwd, args, signal) {
	return new Promise((resolve) => {
		execFile(
			'git',
			['-C', cwd, ...args],
			{
				cwd,
				timeout: GIT_TIMEOUT_MS,
				maxBuffer: MAX_BUFFER,
				windowsHide: true,
				signal,
				env: {
					...process.env,
					GIT_OPTIONAL_LOCKS: '0',
					GIT_TERMINAL_PROMPT: '0',
					LC_ALL: 'C',
					LANG: 'C',
				},
			},
			(error, stdout) => {
				if (error === null || error === undefined) {
					resolve({ ok: true, stdout: String(stdout ?? '') })
					return
				}
				resolve({ ok: false, stdout: String(stdout ?? '') })
			},
		)
	})
}

function remember(path, value) {
	cache.set(path, { at: Date.now(), value })
	return value
}

/**
 * Read the branch facts of one directory.
 *
 * `repo: false` is a normal answer ("this directory is not a Git work tree"),
 * not a failure: the pill simply renders nothing there.
 * @param {string} path - absolute directory path.
 * @param {AbortSignal} [signal] - request signal.
 * @param {boolean} [force] - ignore the cache.
 * @returns {Promise<object>} branch facts keyed for the browser half.
 */
export async function readBranch(path, signal, force = false) {
	const cached = cache.get(path)
	if (force !== true && cached !== undefined && Date.now() - cached.at < CACHE_TTL_MS) return cached.value

	// `symbolic-ref` answers the branch even before the first commit, where
	// `rev-parse --abbrev-ref HEAD` still fails on an unborn HEAD.
	const symbolic = await runGit(path, ['symbolic-ref', '--quiet', '--short', 'HEAD'], signal)
	const branch = symbolic.ok ? symbolic.stdout.trim() : ''
	if (branch !== '') {
		return remember(path, { repo: true, branch, detached: false, oid: null, at: Date.now() })
	}

	const inside = await runGit(path, ['rev-parse', '--is-inside-work-tree'], signal)
	if (!inside.ok || inside.stdout.trim() !== 'true') return remember(path, { repo: false })

	// A repository with a detached HEAD has no branch name to show; the short
	// commit is the honest label there.
	const short = await runGit(path, ['rev-parse', '--short', 'HEAD'], signal)
	const oid = short.ok ? short.stdout.trim() : ''
	return remember(path, {
		repo: true,
		branch: null,
		detached: true,
		oid: oid === '' ? null : oid,
		at: Date.now(),
	})
}

/**
 * Read several directories for one request, keeping caller order.
 * @param {string[]} paths - absolute directory paths.
 * @param {AbortSignal} [signal] - request signal.
 * @param {boolean} [force] - ignore the cache.
 * @returns {Promise<Record<string, object>>} entries by path.
 */
export async function readMany(paths, signal, force = false) {
	const entries = {}
	for (const path of paths) {
		if (signal?.aborted === true) break
		entries[path] = await readBranch(path, signal, force)
	}
	return entries
}

function readPaths(payload) {
	if (typeof payload !== 'object' || payload === null || !Array.isArray(payload.paths)) {
		throw new BadRequest('payload.paths must be an array of absolute directory paths')
	}
	const paths = []
	for (const entry of payload.paths) {
		if (typeof entry !== 'string') continue
		if (entry === '' || entry.length > MAX_PATH_LENGTH || !isAbsolute(entry)) continue
		if (!paths.includes(entry)) paths.push(entry)
		if (paths.length >= MAX_PATHS) break
	}
	if (paths.length === 0) throw new BadRequest('no absolute directory path was supplied')
	return paths
}

/**
 * Register the route. The pill is a purely local reading, so the route stays
 * behind the same authenticated `/api` channel as every other Host feature.
 * @param {object} ctx - Host plugin context.
 */
export function apply(ctx) {
	ctx.inject(['connection'], (scoped) => {
		const connection = scoped.get('connection')
		if (connection === undefined || connection === null) return
		const routes = connection.fetch
		if (routes === undefined || routes === null || typeof routes.register !== 'function') return

		scoped.effect(
			() =>
				routes.register({
					path: ROUTE,
					methods: ['POST'],
					requestBody: 'buffered',
					fetch: async (request) => {
						try {
							let payload
							try {
								payload = await request.json()
							} catch {
								throw new BadRequest('body must be JSON')
							}
							const paths = readPaths(payload)
							const force = payload !== null && typeof payload === 'object' && payload.force === true
							const entries = await readMany(paths, request.signal, force)
							return Response.json(ok({ entries, generatedAt: Date.now() }))
						} catch (error) {
							return Response.json(fail(error))
						}
					},
				}),
			'git-branch-pill: /api/git-branch route',
		)
	})
}
