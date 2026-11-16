/**
 * Contract checks for the fetch-based client half of dsh-pin-default-model.
 *
 * Verifies the module loads through the DSH loader, registers one Settings
 * section, uses only `slots`/`locale`, and talks to the host over plain fetch.
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

check('module id', captured.id, 'dsh-pin-default-model');

const reactStub = {
	createElement: () => null,
	Fragment: {},
	useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
	useMemo: (factory) => factory(),
	useCallback: (fn) => fn,
	useEffect: () => {},
	useRef: () => ({ current: null }),
};
const jsxStub = { jsx: () => null, jsxs: () => null, Fragment: {} };

const moduleExports = captured.factory((name) => {
	if (name === 'react') return reactStub;
	if (name === 'react/jsx-runtime') return jsxStub;
	throw new Error(`unexpected require: ${name}`);
});

check('exported name', moduleExports.name, 'dsh-pin-default-model');
check('client inject is minimal', moduleExports.inject, ['slots', 'locale']);
check('apply is a function', typeof moduleExports.apply, 'function');

// --- run apply() against a stub context ------------------------------------
const sections = [];
const dictionaryNamespaces = [];
let sectionSpec = null;

const ctx = {
	effect: (fn) => { fn(); return () => {}; },
	locale: {
		register: (namespace) => { dictionaryNamespaces.push(namespace); },
		bind: (namespace) => (key) => `${namespace}:${key}`,
	},
	slots: {
		inject: (slotName, register) => {
			if (slotName === 'settings.section') register();
			return () => {};
		},
		register: (spec) => {
			sections.push({ name: spec.name, id: spec.id, order: spec.order, priority: spec.priority });
			sectionSpec = spec;
			return () => {};
		},
	},
};

moduleExports.apply(ctx);

check('locale namespace', dictionaryNamespaces, ['dsh-pin-default-model']);
check('registers one settings section', sections.length, 1);
check('section slot type', sections[0]?.name, 'settings.section');
check('section id', sections[0]?.id, 'default-model-pin');

// No service dependencies: the section inject only supplies `t`.
const props = sectionSpec?.inject?.();
check('section inject exposes t', typeof props?.t, 'function');
check('section inject has no service reader', props?.readServices, undefined);

// --- fetch-based contract guards ------------------------------------------
check('uses GET view route', source.includes('"/dsh-pin-model/view"'), true);
check('uses POST set route', source.includes('"/dsh-pin-model/set"'), true);
check('does not depend on configForms', source.includes('configForms'), false);
check('does not call ctx.get', /ctx\.get\s*\(/.test(source), false);
check('does not use remote services', source.includes('ctx.remote'), false);
check('renders a placeholder instead of null/null', source.includes('labelOf(pinned, t("notSet"))'), true);

// --- manifest wiring -------------------------------------------------------
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
check('client half is exported', Boolean(manifest.exports['./client']), true);
check('client half is packaged', manifest.files.includes('client'), true);
check('dsh.client is declared', Boolean(manifest.dsh?.client?.platform), true);
check('host inject includes webServer', manifest.dsh.client.inject.length >= 2, true);

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exitCode = failed === 0 ? 0 : 1;
