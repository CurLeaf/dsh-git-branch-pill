/**
 * Browser-half harness: the module-loader contract, the dock registration, and
 * the hook-free pill presentation. No DOM and no React renderer are involved:
 * the harness supplies the module table `require` and captures the factory.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'

let definition
globalThis.window = {
	__ModuleLoader__: {
		load: (candidate) => {
			definition = candidate
		},
	},
}

await import(pathToFileURL(new URL('../dist/client.js', import.meta.url).pathname).href)

const fakeReact = {
	createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
	useState: (initial) => [initial, () => {}],
	useEffect: () => {},
}

/** Materialize the factory the way the page's module table does. */
function materialize() {
	return definition.factory((id) => {
		if (id === 'react') return fakeReact
		throw new Error(`unexpected module: ${id}`)
	})
}

test('registers as a lazy CJS factory under the package name', () => {
	assert.equal(definition.id, 'dsh-git-branch-pill')
	assert.equal(typeof definition.factory, 'function')
})

test('declares the client services it consumes', () => {
	const plugin = materialize()
	assert.equal(plugin.name, 'git-branch-pill')
	assert.deepEqual(plugin.inject, ['slots', 'locale'])
	assert.equal(typeof plugin.apply, 'function')
})

test('adds one ordered entry to conversation.composer.dock', () => {
	const plugin = materialize()
	const registrations = []
	const dictionaries = []
	const ctx = {
		effect: (fn) => fn(),
		locale: {
			register: (ns, value) => {
				dictionaries.push({ ns, value })
			},
			bind: (ns) => (key, params) => `${ns}:${key}${params === undefined ? '' : JSON.stringify(params)}`,
		},
		slots: {
			inject: (name, run) => {
				assert.equal(name, 'conversation.composer.dock')
				return run()
			},
			register: (options, component) => {
				registrations.push({ options, component })
				return () => {}
			},
		},
	}
	plugin.apply(ctx)

	assert.equal(dictionaries.length, 1)
	assert.equal(dictionaries[0].ns, 'gitBranchPill')
	assert.equal(registrations.length, 1)
	assert.equal(registrations[0].options.name, 'conversation.composer.dock')
	assert.equal(registrations[0].options.id, 'git-branch')
	assert.equal(registrations[0].options.order, 2)
	assert.equal(typeof registrations[0].component, 'function')
})

test('renders nothing without a repository reading', () => {
	const { branchPill } = materialize().__test
	const t = (key, params) => `${key}:${JSON.stringify(params)}`
	assert.equal(branchPill(t, undefined, '/w'), null)
	assert.equal(branchPill(t, { repo: false }, '/w'), null)
	assert.equal(branchPill(t, { repo: true, branch: '', detached: false }, '/w'), null)
})

test('renders the branch with its working directory in the tooltip', () => {
	const { branchPill } = materialize().__test
	const t = (key, params) => `${key}:${JSON.stringify(params)}`
	const vnode = branchPill(t, { repo: true, branch: 'feat/dock', detached: false }, '/work/repo')
	assert.equal(vnode.type, 'span')
	assert.equal(vnode.props['data-composer-stat'], 'git-branch')
	const pill = vnode.children[0]
	assert.equal(pill.type, 'span')
	assert.match(pill.props.title, /feat\/dock/)
	assert.match(pill.props.title, /\/work\/repo/)
	assert.equal(pill.children[1].children[0], 'feat/dock')
})

test('renders the short commit on a detached HEAD', () => {
	const { branchPill } = materialize().__test
	const t = (key, params) => `${key}:${JSON.stringify(params)}`
	const vnode = branchPill(t, { repo: true, branch: null, detached: true, oid: '1a2b3c4' }, '/work/repo')
	const pill = vnode.children[0]
	assert.equal(pill.children[1].children[0], '1a2b3c4')
	assert.match(pill.props.title, /detached/)
})
