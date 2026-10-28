/**
 * Browser half of `dsh-git-branch-pill`.
 *
 * One ambient entry in `conversation.composer.dock`, right after the session
 * stats: the Git branch of the Session's working directory.
 *
 * Behaviour:
 *   - The Session's `cwd` comes from the ordinary session list; a worktree or
 *     directory switch therefore moves the pill with the Session.
 *   - The reading is fetched from this package's Host route and cached per path,
 *     so several dock renders share one request.
 *   - Nothing renders when the directory is not a Git work tree, so workspaces
 *     without Git keep the dock exactly as it was.
 *   - A detached HEAD shows the short commit instead of a branch name.
 *   - Refreshes on window focus, on visibility change, and every 20 seconds
 *     while visible; a failed request keeps the last known reading.
 */
window.__ModuleLoader__.load({
	id: 'dsh-git-branch-pill',
	factory(require) {
		const React = require('react')
		const h = React.createElement

		const NS = 'gitBranchPill'
		const ENDPOINT = 'api/git-branch'
		const CACHE_TTL_MS = 4000
		const POLL_MS = 20000
		const STYLE_ID = 'dsh-git-branch-pill/composer-pill'

		const zh = {
			'branch.title': '当前分支：{branch} · {path}',
			'branch.title.detached': '游离 HEAD：{oid} · {path}',
		}

		const en = {
			'branch.title': 'Current branch: {branch} · {path}',
			'branch.title.detached': 'Detached HEAD: {oid} · {path}',
		}

		const CSS = `
.bpill-anchor{min-width:0;font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));display:inline-flex}
.bpill-pill{box-sizing:border-box;max-width:100%;border-radius:var(--dsw-radius-sm);color:var(--dsw-alias-label-tertiary);font:inherit;line-height:inherit;white-space:nowrap;background:0 0;border:none;align-items:center;gap:6px;padding:1px 8px;display:inline-flex;font-variant-numeric:tabular-nums}
.bpill-pill svg{flex:none;width:14px;height:14px}
.bpill-label{min-width:0;max-width:220px;overflow:hidden;text-overflow:ellipsis;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
`

		/** Install the pill stylesheet once per page; the effect removes it on dispose. */
		function installStyles() {
			if (typeof document === 'undefined') return undefined
			const existing = document.querySelector(`style[data-plugin-css=${JSON.stringify(STYLE_ID)}]`)
			if (existing !== null) return undefined
			const tag = document.createElement('style')
			tag.dataset.plugin = 'dsh-git-branch-pill'
			tag.dataset.pluginCss = STYLE_ID
			tag.textContent = CSS
			document.head.appendChild(tag)
			return () => {
				tag.remove()
			}
		}

		/** Resolve the route below the page base so forwarded deployments keep working. */
		function endpointUrl() {
			if (typeof document === 'undefined') return ENDPOINT
			try {
				return new URL(ENDPOINT, document.baseURI).href
			} catch {
				return ENDPOINT
			}
		}

		/** path -> { at, value }; shared by every mounted pill. */
		const cache = new Map()
		/** path -> Promise, so concurrent renders dedupe into one request. */
		const inflight = new Map()

		/**
		 * Read one directory's branch facts through the Host route.
		 * @param {string} path - absolute working directory.
		 * @param {boolean} force - bypass the client cache and the Host cache.
		 * @returns {Promise<object | undefined>} facts, or undefined when nothing is known yet.
		 */
		function readBranch(path, force) {
			const hit = cache.get(path)
			if (!force && hit !== undefined && Date.now() - hit.at < CACHE_TTL_MS) return Promise.resolve(hit.value)
			const running = inflight.get(path)
			if (running !== undefined) return running

			const request = (async () => {
				try {
					const response = await fetch(endpointUrl(), {
						method: 'POST',
						headers: { 'content-type': 'application/json' },
						credentials: 'same-origin',
						body: JSON.stringify(force ? { paths: [path], force: true } : { paths: [path] }),
					})
					if (!response.ok) throw new Error(`HTTP ${response.status}`)
					const payload = await response.json()
					if (payload === null || typeof payload !== 'object' || payload.ok !== true) throw new Error('unexpected payload')
					const entries = payload.value?.entries
					const entry = entries !== null && typeof entries === 'object' ? entries[path] : undefined
					const value = entry !== null && typeof entry === 'object' ? entry : { repo: false }
					cache.set(path, { at: Date.now(), value })
					return value
				} catch {
					// A transient failure must not invent a branch; keep the last reading.
					const previous = cache.get(path)
					return previous === undefined ? undefined : previous.value
				} finally {
					inflight.delete(path)
				}
			})()

			inflight.set(path, request)
			return request
		}

		/**
		 * Branch facts of one working directory, refreshed while mounted.
		 * @param {string | undefined} path - the Session's cwd.
		 * @returns {object | undefined} facts for rendering.
		 */
		function useBranch(path) {
			const [value, setValue] = React.useState(undefined)
			React.useEffect(() => {
				if (path === undefined || path === '') {
					setValue(undefined)
					return undefined
				}
				let live = true
				const load = (force) => {
					readBranch(path, force).then((next) => {
						if (live && next !== undefined) setValue(next)
					})
				}
				load(false)
				const onFocus = () => load(true)
				const onVisibility = () => {
					if (document.visibilityState === 'visible') load(true)
				}
				window.addEventListener('focus', onFocus)
				document.addEventListener('visibilitychange', onVisibility)
				const timer = setInterval(() => {
					if (document.visibilityState === 'visible') load(true)
				}, POLL_MS)
				return () => {
					live = false
					window.removeEventListener('focus', onFocus)
					document.removeEventListener('visibilitychange', onVisibility)
					clearInterval(timer)
				}
			}, [path])
			return value
		}

		function BranchIcon() {
			return h(
				'svg',
				{ viewBox: '0 0 16 16', width: 14, height: 14, fill: 'none', 'aria-hidden': 'true', focusable: 'false' },
				h('circle', { cx: 4.5, cy: 12, r: 1.7, stroke: 'currentColor', strokeWidth: 1.4 }),
				h('circle', { cx: 4.5, cy: 4, r: 1.7, stroke: 'currentColor', strokeWidth: 1.4 }),
				h('circle', { cx: 11.5, cy: 6.5, r: 1.7, stroke: 'currentColor', strokeWidth: 1.4 }),
				h('path', { d: 'M4.5 5.7v4.6', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' }),
				h('path', { d: 'M11.5 8.2c0 1.7-1.4 2.2-3.4 2.5', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' }),
			)
		}

		/**
		 * Pure presentation, kept hook-free so the pill contract stays testable
		 * without a renderer.
		 * @param {Function} t - localized text lookup.
		 * @param {object | undefined} branch - facts from the Host route.
		 * @param {string} [path] - working directory, used in the tooltip.
		 * @returns {object | null} one pill vnode, or null to render nothing.
		 */
		function branchPill(t, branch, path) {
			if (branch === undefined || branch === null || branch.repo !== true) return null
			const detached = branch.detached === true
			const label = detached
				? typeof branch.oid === 'string' ? branch.oid : ''
				: typeof branch.branch === 'string' ? branch.branch : ''
			if (label === '') return null
			const title = detached
				? t('branch.title.detached', { oid: label, path: path ?? '' })
				: t('branch.title', { branch: label, path: path ?? '' })
			return h(
				'span',
				{ className: 'bpill-anchor', 'data-composer-stat': 'git-branch' },
				h(
					'span',
					{ className: 'bpill-pill', title },
					h(BranchIcon, null),
					h('span', { className: 'bpill-label' }, label),
				),
			)
		}

		function BranchPill(props) {
			const cwd = props.useSessions((sessions) => sessions.byId[props.sessionId]?.cwd)
			const branch = useBranch(cwd)
			return branchPill(props.t, branch, cwd)
		}

		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'git-branch-pill: dictionaries')
			ctx.effect(() => installStyles(), 'git-branch-pill: styles')
			const t = ctx.locale.bind(NS)

			ctx.slots.inject('conversation.composer.dock', () =>
				ctx.slots.register(
					{
						name: 'conversation.composer.dock',
						id: 'git-branch',
						// After the session stats (`activity` 0, `usage` 1) and before
						// the context meter the owner renders after this slot.
						order: 2,
						locale: NS,
					},
					(props) => h(BranchPill, { ...props, t }),
				),
			)
		}

		return {
			name: 'git-branch-pill',
			inject: ['slots', 'locale'],
			apply,
			// Exposed for the package's own harness; not part of the slot contract.
			__test: { branchPill },
		}
	},
})
