/**
 * Behaviour tests for the host half of dsh-pin-default-model.
 *
 * Exercises the pinned saveSelection replacement and the two management
 * routes against fake Cordis services that behave like the real ones.
 */
import { apply } from '../lib/index.js';

const results = [];
function check(label, actual, expected) {
	const ok = JSON.stringify(actual) === JSON.stringify(expected);
	results.push(ok);
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
	if (!ok) console.log(`   expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function makeService(initial) {
	const store = { ...initial };
	return {
		store,
		currentSelection: () => ({ ...store }),
		async saveSelection(next) {
			store.provider = next.provider;
			store.model = next.model;
			if (next.reasoningEffort === undefined) delete store.reasoningEffort;
			else store.reasoningEffort = next.reasoningEffort;
		},
	};
}

function makeContext(service, routes) {
	let cleanup;
	const ctx = {
		agentDefaultModel: service,
		sessionController: {
			modelCatalog: async () => ({ groups: [{ id: 'magpie', models: [{ id: 'group/x-call' }] }] }),
		},
		webServer: {
			register: (route) => { routes.set(route.path, route.handler); return () => routes.delete(route.path); },
		},
		logger: { info: () => {}, warn: () => {} },
		effect: (fn) => { cleanup = fn(); return cleanup; },
	};
	return { ctx, dispose: () => cleanup?.() };
}

function makeResponse() {
	return {
		status: null,
		headers: null,
		body: null,
		writeHead(status, headers) { this.status = status; this.headers = headers; },
		end(body) { this.body = body; },
		json() { return JSON.parse(this.body); },
	};
}

function makeRequest(method, payload) {
	const chunks = payload ? [Buffer.from(JSON.stringify(payload))] : [];
	return {
		method,
		headers: {},
		on(event, fn) {
			if (event === 'data') for (const chunk of chunks) fn(chunk);
			if (event === 'end') fn();
			if (event === 'error') { /* noop */ }
			return this;
		},
	};
}

const PIN = { provider: 'magpie', model: 'group/x-call' };

console.log('\n=== routes are registered ===');
{
	const routes = new Map();
	const service = makeService(PIN);
	const { ctx, dispose } = makeContext(service, routes);
	apply(ctx, {});
	check('view route', routes.has('/dsh-pin-model/view'), true);
	check('set route', routes.has('/dsh-pin-model/set'), true);
	dispose();
}

console.log('\n=== GET /view returns the pin and the catalog ===');
{
	const routes = new Map();
	const { ctx, dispose } = makeContext(makeService(PIN), routes);
	apply(ctx, {});
	const res = makeResponse();
	await routes.get('/dsh-pin-model/view')(makeRequest('GET'), res);
	const body = res.json();
	check('ok', body.ok, true);
	check('selection', body.selection, PIN);
	check('catalog groups', body.groups.length, 1);
	dispose();
}

console.log('\n=== a session switch does not move the default ===');
{
	const routes = new Map();
	const service = makeService(PIN);
	const { ctx, dispose } = makeContext(service, routes);
	apply(ctx, {});

	await service.saveSelection({ provider: 'workbuddy', model: 'deepseek-v4-pro' });
	check('default stays pinned', service.currentSelection(), PIN);
	dispose();
}

console.log('\n=== POST /set changes the pin ===');
{
	const routes = new Map();
	const service = makeService(PIN);
	const { ctx, dispose } = makeContext(service, routes);
	apply(ctx, {});

	const next = { provider: 'workbuddy-ai', model: 'deepseek-v4.1-flash-sg' };
	const res = makeResponse();
	await routes.get('/dsh-pin-model/set')(makeRequest('POST', next), res);
	const body = res.json();
	check('ok', body.ok, true);
	check('service default updated', service.currentSelection(), next);

	// A later session switch must still be refused.
	await service.saveSelection({ provider: 'apikeyfan', model: 'gpt-6.1-sol' });
	check('new pin holds', service.currentSelection(), next);
	dispose();
}

console.log('\n=== POST /set rejects an incomplete selection ===');
{
	const routes = new Map();
	const { ctx, dispose } = makeContext(makeService(PIN), routes);
	apply(ctx, {});
	const res = makeResponse();
	await routes.get('/dsh-pin-model/set')(makeRequest('POST', { provider: 'magpie' }), res);
	check('status', res.status, 400);
	check('ok false', res.json().ok, false);
	dispose();
}

console.log('\n=== unload restores the original method and removes routes ===');
{
	const routes = new Map();
	const service = makeService(PIN);
	const { ctx, dispose } = makeContext(service, routes);
	apply(ctx, {});
	dispose();
	check('routes removed', routes.size, 0);
	await service.saveSelection({ provider: 'workbuddy', model: 'glm-5.3-flash' });
	check('original behaviour restored', service.currentSelection(), { provider: 'workbuddy', model: 'glm-5.3-flash' });
}

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exitCode = failed === 0 ? 0 : 1;
