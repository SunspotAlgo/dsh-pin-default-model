/**
 * dsh-pin-default-model — keeps the Host default model fixed.
 *
 * A model picked inside a session is applied to that session by
 * `agent.model.select()`, but `sessionController.selectModel()` also calls
 * `agentDefaultModel.saveSelection()`. That second call rewrites the profile
 * patch, so every later new session — hand-made or created by a scheduled
 * task — inherits whatever was picked last instead of a fixed default.
 *
 * This plugin replaces `saveSelection` on the live service object with one that
 * refuses to overwrite the pinned selection. The pin itself is changed only
 * through this plugin's own host route, so a session switch can never move it.
 *
 * The pin carries a routing triple: provider, model, and an optional
 * reasoning effort. When the effort is omitted the plugin does not interfere
 * with the effort at all and the provider default applies — that is the safe
 * default, because DSH rejects a request whose effort the model does not
 * support (`UNSUPPORTED_REASONING_EFFORT`).
 *
 * The browser half uses plain fetch against those routes, which avoids any
 * dependency on the settings-client services and keeps loading order simple.
 */

/** Cordis plugin identity (the name the profile patch inserts). */
export const name = 'dsh-pin-default-model';

/** Services this plugin uses on the host side. */
export const inject = ['agentDefaultModel', 'webServer', 'sessionController'];

/**
 * Pin used when the live service has no selection yet.
 * No reasoning effort: the provider default applies until the user locks one.
 */
const FALLBACK_PIN = { provider: 'magpie', model: 'group/x-call' };

/** How long to wait before the first drift check, letting the profile settle. */
const FIRST_CHECK_MS = 1500;

/** How often the live default is compared against the pin. */
const WATCH_INTERVAL_MS = 2000;

/**
 * Build a clean selection value.
 * @param value - a candidate selection from a request or the service.
 * @returns a normalized selection, or null when provider/model are missing.
 */
function cleanSelection(value) {
	const provider = typeof value?.provider === 'string' ? value.provider.trim() : '';
	const model = typeof value?.model === 'string' ? value.model.trim() : '';
	if (provider === '' || model === '') return null;
	const effort = value?.reasoningEffort;
	return {
		provider,
		model,
		...(typeof effort === 'string' && effort.trim() !== '' ? { reasoningEffort: effort.trim() } : {}),
	};
}

/**
 * Decide whether a live selection satisfies the pin.
 *
 * The effort only participates when the pin locks one. A pin without an effort
 * means "follow the provider default", so a session that changes only its
 * effort is left alone while a session that changes the route is still refused.
 * @param pin - the pinned selection.
 * @param live - the selection to test.
 * @returns true when the live selection already satisfies the pin.
 */
function satisfies(pin, live) {
	if (pin === undefined || live === undefined) return false;
	if (pin.provider !== live.provider || pin.model !== live.model) return false;
	if (pin.reasoningEffort === undefined) return true;
	return pin.reasoningEffort === live.reasoningEffort;
}

/**
 * Find one model in a provider-grouped catalog.
 * @param groups - provider groups from the model catalog.
 * @param provider - provider id.
 * @param model - model id.
 * @returns the catalog entry, or undefined when the route is not listed.
 */
function findModel(groups, provider, model) {
	const group = (groups ?? []).find((candidate) => candidate?.id === provider);
	if (group === undefined) return undefined;
	return (group.models ?? []).find((candidate) => candidate?.id === model);
}


/** Send a JSON response with a no-store cache policy. */
function sendJson(response, status, body) {
	const payload = JSON.stringify(body);
	response.writeHead(status, {
		'content-type': 'application/json; charset=utf-8',
		'cache-control': 'no-store',
		'content-length': Buffer.byteLength(payload),
	});
	response.end(payload);
}

/** Reject cross-origin writes to the local routes. */
function isSameOrigin(request) {
	const origin = request.headers?.origin;
	if (origin === undefined) return true;
	try {
		return new URL(origin).host === request.headers?.host;
	}
	catch {
		return false;
	}
}

/** Read and parse a bounded JSON request body. */
function readJsonBody(request, maxBytes = 65536) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		let size = 0;
		let done = false;
		request.on('data', (chunk) => {
			if (done) return;
			size += chunk.length;
			if (size > maxBytes) {
				done = true;
				reject(new Error('request body too large'));
				return;
			}
			chunks.push(chunk);
		});
		request.on('end', () => {
			if (done) return;
			done = true;
			const text = Buffer.concat(chunks).toString('utf8');
			if (text.trim() === '') return resolve({});
			try { resolve(JSON.parse(text)); }
			catch (error) { reject(new Error(`invalid json: ${error.message}`)); }
		});
		request.on('error', reject);
	});
}

/**
 * Pin the default model on the live service and expose management routes.
 * @param ctx - Host context carrying the injected services.
 * @param config - Plugin Config; its `provider`/`model` seed the first pin.
 */
export function apply(ctx, config) {
	const log = (level, message) => {
		const logger = ctx.logger;
		if (logger === undefined) return;
		const write = logger[level] ?? logger.info;
		if (typeof write === 'function') write.call(logger, message);
	};

	ctx.effect(() => {
		const service = ctx.agentDefaultModel;
		if (service === undefined) {
			log('warn', 'pin-default-model: agentDefaultModel is unavailable; nothing to pin');
			return;
		}
		const originalSave = service.saveSelection;
		if (typeof originalSave !== 'function') {
			log('warn', 'pin-default-model: saveSelection is missing; nothing to pin');
			return;
		}

		const originalOwn = Object.prototype.hasOwnProperty.call(service, 'saveSelection');

		// The live pin. `currentPin` is the single source of truth for what the
		// default is allowed to be; it changes only via this plugin's set route.
		let currentPin = cleanSelection({
			provider: config?.provider?.get?.(),
			model: config?.model?.get?.(),
			reasoningEffort: config?.reasoningEffort?.get?.(),
		}) ?? cleanSelection(service.currentSelection?.()) ?? { ...FALLBACK_PIN };
		let restoring = false;
		let settingFromRoute = false;

		const pinnedSave = function pinnedSaveSelection(next) {
			// A write issued by our own route or by the restore path is allowed.
			if (settingFromRoute || restoring || satisfies(currentPin, next)) {
				return Promise.resolve(originalSave.call(service, next));
			}
			log(
				'info',
				`pin-default-model: ignored a default-model change to ${String(next?.provider)}/${String(next?.model)}`
				+ `${next?.reasoningEffort === undefined ? '' : ` (${String(next.reasoningEffort)})`};`
				+ ` the default stays ${currentPin.provider}/${currentPin.model}`
				+ `${currentPin.reasoningEffort === undefined ? '' : ` (${currentPin.reasoningEffort})`}`,
			);
			queueMicrotask(() => { void hold(); });
			return Promise.resolve();
		};

		try {
			service.saveSelection = pinnedSave;
		}
		catch (error) {
			log('warn', `pin-default-model: could not replace saveSelection: ${String(error)}`);
			return;
		}

		/** Repair the live default if anything moved it away from the pin. */
		const hold = async () => {
			let live;
			try {
				live = service.currentSelection?.();
			}
			catch (error) {
				log('warn', `pin-default-model: cannot read the default selection: ${String(error)}`);
				return;
			}
			if (satisfies(currentPin, live)) return;
			log(
				'info',
				`pin-default-model: default drifted to ${String(live?.provider)}/${String(live?.model)}`
				+ `${live?.reasoningEffort === undefined ? '' : ` (${String(live.reasoningEffort)})`};`
				+ ` restoring ${currentPin.provider}/${currentPin.model}`
				+ `${currentPin.reasoningEffort === undefined ? '' : ` (${currentPin.reasoningEffort})`}`,
			);
			restoring = true;
			try {
				await originalSave.call(service, currentPin);
			}
			catch (error) {
				log('warn', `pin-default-model: restore failed: ${String(error)}`);
			}
			finally {
				restoring = false;
			}
		};

		/** Build the routable model catalog for the settings dropdown. */
		const catalog = async () => {
			const controller = ctx.sessionController;
			if (typeof controller?.modelCatalog !== 'function') return { groups: [] };
			try {
				const result = await controller.modelCatalog();
				return { groups: Array.isArray(result?.groups) ? result.groups : [] };
			}
			catch (error) {
				log('warn', `pin-default-model: catalog failed: ${String(error)}`);
				return { groups: [] };
			}
		};

		// --- host routes -----------------------------------------------------
		const routes = [];
		if (typeof ctx.webServer?.register === 'function') {
			routes.push(ctx.webServer.register({
				kind: 'exact',
				path: '/dsh-pin-model/view',
				handler: async (request, response) => {
					if (request.method !== 'GET') {
						response.writeHead(405, { allow: 'GET' });
						response.end();
						return;
					}
					try {
						const groups = await catalog();
						sendJson(response, 200, { ok: true, selection: currentPin, groups: groups.groups });
					}
					catch (error) {
						sendJson(response, 500, { ok: false, error: String(error) });
					}
				},
			}));
			routes.push(ctx.webServer.register({
				kind: 'exact',
				path: '/dsh-pin-model/set',
				handler: async (request, response) => {
					if (request.method !== 'POST') {
						response.writeHead(405, { allow: 'POST' });
						response.end();
						return;
					}
					if (!isSameOrigin(request)) {
						sendJson(response, 403, { ok: false, error: 'untrusted origin' });
						return;
					}
					try {
						const body = await readJsonBody(request);
						const next = cleanSelection(body);
						if (next === null) {
							sendJson(response, 400, { ok: false, error: 'provider and model are required' });
							return;
						}
						// DSH rejects a call whose effort the model does not support, so a
						// pin that could never be used must not be stored. The route is
						// checked here rather than left to fail at session creation.
						if (next.reasoningEffort !== undefined) {
							const groups = (await catalog()).groups;
							const entry = findModel(groups, next.provider, next.model);
							if (entry === undefined) {
								sendJson(response, 400, {
									ok: false,
									error: `model "${next.provider}/${next.model}" is not in the catalog; cannot verify the reasoning effort`,
								});
								return;
							}
							const supported = (entry.reasoning?.efforts ?? []).map((effort) => effort.id);
							if (!supported.includes(next.reasoningEffort)) {
								sendJson(response, 400, {
									ok: false,
									error: `model "${next.provider}/${next.model}" does not support reasoning effort "${next.reasoningEffort}"`
										+ `${supported.length === 0 ? ' (it offers no reasoning effort)' : ` (supported: ${supported.join(', ')})`}`,
								});
								return;
							}
						}
						currentPin = next;
						settingFromRoute = true;
						try {
							await originalSave.call(service, next);
						}
						finally {
							settingFromRoute = false;
						}
						log(
							'info',
							`pin-default-model: pin changed to ${next.provider}/${next.model}`
							+ `${next.reasoningEffort === undefined ? '' : ` (${next.reasoningEffort})`}`,
						);
						sendJson(response, 200, { ok: true, selection: currentPin });
					}
					catch (error) {
						sendJson(response, 500, { ok: false, error: String(error) });
					}
				},
			}));
		}
		else {
			log('warn', 'pin-default-model: webServer unavailable; settings page will be read-only');
		}

		const timer = setInterval(() => { void hold(); }, WATCH_INTERVAL_MS);
		if (typeof timer?.unref === 'function') timer.unref();

		const first = setTimeout(() => { void hold(); }, FIRST_CHECK_MS);
		if (typeof first?.unref === 'function') first.unref();

		log(
			'info',
			`pin-default-model: holding the default at ${currentPin.provider}/${currentPin.model}`
			+ `${currentPin.reasoningEffort === undefined ? ' (reasoning effort follows the provider default)' : ` (${currentPin.reasoningEffort})`}`,
		);

		return () => {
			clearInterval(timer);
			clearTimeout(first);
			for (const dispose of routes) dispose?.();
			try {
				if (originalOwn) service.saveSelection = originalSave;
				else delete service.saveSelection;
			}
			catch (error) {
				log('warn', `pin-default-model: could not restore saveSelection: ${String(error)}`);
			}
			log('info', 'pin-default-model: pin released');
		};
	}, 'dsh-pin-default-model: pinned default model');
}
