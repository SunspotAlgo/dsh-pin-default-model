/**
 * Render tests for the effort dropdown of dsh-pin-default-model.
 *
 * The catalogue hands `reasoning.efforts` over as an array of `{ id, name }`.
 * These tests render the real section component with a fake React and assert
 * that the dropdown lists real effort ids, that an unsupported locked effort
 * is reported, and that the follow-the-default choice is available.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const results = [];
function check(label, actual, expected) {
	const ok = JSON.stringify(actual) === JSON.stringify(expected);
	results.push(ok);
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
	if (!ok) console.log(`   expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const source = readFileSync(join(root, 'client/client.js'), 'utf8');
let captured = null;
const sandbox = { __ModuleLoader__: { load: (spec) => { captured = spec; } }, setTimeout, clearTimeout };
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(source, sandbox);

/** Collect every element in a rendered tree so dropdowns can be inspected. */
function collect(node, out = []) {
	if (node === null || node === undefined || typeof node === 'boolean') return out;
	if (Array.isArray(node)) {
		for (const child of node) collect(child, out);
		return out;
	}
	if (typeof node !== 'object') return out;
	if (node.type === 'option' || node.type === 'optgroup') out.push(node);
	collect(node.props?.children, out);
	return out;
}

/** Find a rendered element by its tag name. */
function find(node, type) {
	if (node === null || node === undefined || typeof node !== 'object') return undefined;
	if (Array.isArray(node)) {
		for (const child of node) {
			const hit = find(child, type);
			if (hit !== undefined) return hit;
		}
		return undefined;
	}
	if (node.type === type) return node;
	return find(node.props?.children, type);
}

/** A React stub whose state can be seeded per render. */
function makeReact(states) {
	let cursor = 0;
	return {
		createElement: (type, props) => ({ type, props }),
		Fragment: 'Fragment',
		useState: (initial) => {
			const index = cursor++;
			const value = states[index] !== undefined
				? states[index]
				: (typeof initial === 'function' ? initial() : initial);
			return [value, () => {}];
		},
		useEffect: () => {},
		useMemo: (factory) => factory(),
		useCallback: (fn) => fn,
		useRef: () => ({ current: null }),
	};
}

const jsx = { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), Fragment: 'Fragment' };

/**
 * Render the section with seeded state.
 * @param states - values for each useState call, in order.
 * @returns the rendered tree.
 */
function render(states) {
	const react = makeReact(states);
	const moduleExports = captured.factory((name) => {
		if (name === 'react') return react;
		if (name === 'react/jsx-runtime') return jsx;
		throw new Error(`unexpected require: ${name}`);
	});
	let Component = null;
	let props = null;
	const ctx = {
		effect: (fn) => { fn(); return () => {}; },
		locale: { register: () => {}, bind: () => (key) => key },
		slots: {
			inject: (name, register) => { if (name === 'settings.section') register(); },
			register: (spec, component) => { Component = component; props = spec.inject(); },
		},
	};
	moduleExports.apply(ctx);
	return Component({ t: (key) => key, ...props });
}

const GROUPS = [
	{
		id: 'magpie',
		name: 'Magpie',
		models: [
			{
				id: 'workbuddy/space-bunny',
				name: 'Space Bunny',
				reasoning: {
					efforts: [
						{ id: 'low', name: 'Low' },
						{ id: 'medium', name: 'Medium' },
						{ id: 'high', name: 'High' },
						{ id: 'xhigh', name: 'Extra High' },
						{ id: 'max', name: 'Max' },
					],
					defaultEffort: 'high',
				},
			},
			{ id: 'no-reasoning', name: 'Plain' },
		],
	},
];

console.log('\n=== the effort dropdown lists the real effort ids ===');
{
	// states: loading, pinned, groups, draft, busy, error, saved
	const tree = render([
		false,
		{ provider: 'magpie', model: 'workbuddy/space-bunny' },
		GROUPS,
		null,
		false,
		null,
		false,
	]);
	const options = collect(tree).filter((node) => node.type === 'option');
	const values = options.map((node) => node.props.value);
	check('lists every effort id', values.includes('low') && values.includes('high') && values.includes('max'), true);
	check('no index keys leaked in', values.includes('0') || values.includes('1'), false);
	check('offers the follow-the-default choice', values.includes(''), true);
	const high = options.find((node) => node.props.value === 'high');
	check('shows the effort display name', high?.props?.children, 'High · high');
}

console.log('\n=== a locked effort that the model cannot serve is reported ===');
{
	const tree = render([
		false,
		{ provider: 'magpie', model: 'no-reasoning', reasoningEffort: 'extreme' },
		GROUPS,
		null,
		false,
		null,
		false,
	]);
	const text = JSON.stringify(tree);
	check('warns about the incompatibility', text.includes('effortIncompatible'), true);
	check('names the offending effort', text.includes('extreme'), true);
}

console.log('\n=== a locked effort the model supports is not reported ===');
{
	const tree = render([
		false,
		{ provider: 'magpie', model: 'workbuddy/space-bunny', reasoningEffort: 'high' },
		GROUPS,
		null,
		false,
		null,
		false,
	]);
	const text = JSON.stringify(tree);
	check('no incompatibility warning', text.includes('effortIncompatible'), false);
}

console.log('\n=== high is suggested when nothing is locked yet ===');
{
	const tree = render([
		false,
		{ provider: 'magpie', model: 'workbuddy/space-bunny' },
		GROUPS,
		null,
		false,
		null,
		false,
	]);
	const text = JSON.stringify(tree);
	check('suggests locking high', text.includes('effortSuggested'), true);
	check('offers the lock-high action', text.includes('effortLockHigh'), true);
}

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exitCode = failed === 0 ? 0 : 1;
