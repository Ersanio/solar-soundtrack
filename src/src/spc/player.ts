/**
 * SPC700 playback.
 *
 * Wraps the DOM-free `SMWCentral.SPCPlayer.Backend` from the vendored SMW
 * Central player (Blargg's snes_spc via Emscripten). The player also ships a
 * playlist UI that expects about twenty specific elements in the page; none of
 * that is loaded — only the backend, which needs nothing but an AudioContext.
 *
 * The glue script is a classic script, not a module: it assigns
 * `window.SMWCentral` and resolves `spc.wasm` relative to
 * `document.currentScript.src`. So it is injected as a `<script>` tag rather
 * than imported, which keeps the wasm lookup working without bundler config.
 */

/** Matches the backend object in the vendored player. */
interface SpcBackend {
	/** -2 unsupported, 0 uninitialised, 1 ready. */
	status: number;
	locked: boolean;
	initialize(): void;
	/** Loads and starts playing, optionally fast-forwarded to `time` seconds. */
	loadSPC(spc: Uint8Array, time?: number): void;
	stopSPC(pause?: boolean): void;
	pause(): void;
	resume(): void;
	unlock(): void;
	/** Seconds since playback started, from the AudioContext clock. */
	getTime(): number;
	getVolume(): number;
	setVolume(volume: number, duration?: number): void;
}

declare global {
	interface Window {
		Module?: Record<string, unknown>;
		SMWCentral?: { SPCPlayer?: { Backend?: SpcBackend } };
	}
}

export class PlayerError extends Error {}

export type PlayerState = "idle" | "playing" | "paused";

let loading: Promise<SpcBackend> | undefined;

export const PLAYLIST_MARKUP_ID = "spc-player-container";

/**
 * Adds the bundle's own playlist markup to the page, hidden.
 *
 * The bundle is not just an emulator: alongside the backend it carries a
 * playlist UI that runs the moment the script evaluates and dereferences its
 * markup unconditionally, at file scope rather than inside a guarded entry
 * point:
 *
 *   const player = document.getElementById("spc-player-interface");
 *   const header = player.querySelector("#spc-player-header");
 *
 * With that markup absent it throws, and because the Emscripten runtime is
 * defined *below* it in the same file, the throw aborts the script before the
 * wasm is ever set up. The player would never become ready rather than merely
 * logging an error.
 *
 * Cutting the UI entry point out of the source does not help: more than one
 * place touches the DOM at load. Supplying the markup is the supported path and
 * the only one that does not chase upstream's internal structure. Letting the
 * UI initialise is harmless here: it registers no keyboard handlers (only
 * mouse/touch drag and resize), and nothing ever shows or clicks it.
 */
async function ensurePlaylistMarkup(markupUrl: string): Promise<void> {
	if (document.getElementById(PLAYLIST_MARKUP_ID)) return;

	const response = await fetch(markupUrl);
	if (!response.ok) {
		throw new PlayerError(
			`Could not load ${markupUrl} (HTTP ${response.status}). The emulator throws on load ` +
				`without its own markup; it lives in public/player/.`,
		);
	}

	const host = document.createElement("div");
	host.hidden = true;
	host.style.display = "none";
	host.innerHTML = await response.text();
	document.body.append(host);
}

/**
 * Loads the emulator and waits for its wasm module.
 *
 * Emscripten picks up a pre-existing global `Module`, so the ready callback is
 * planted before the script runs rather than polled for afterwards. The markup
 * has to be in the document first: the bundle touches it while evaluating.
 */
function loadBackend(baseUrl: string): Promise<SpcBackend> {
	loading ??= inject(baseUrl).catch((error: unknown) => {
		loading = undefined; // never cache a failure
		throw error;
	});

	return loading;
}

async function inject(baseUrl: string): Promise<SpcBackend> {
	if (typeof WebAssembly === "undefined") {
		throw new PlayerError("This browser has no WebAssembly support.");
	}

	await ensurePlaylistMarkup(`${baseUrl}/spc_player.html`);

	return await new Promise<SpcBackend>((resolve, reject) => {
		window.Module = {
			...(window.Module ?? {}),
			// Stated outright rather than inferred from document.currentScript.src.
			locateFile: (path: string) => `${baseUrl}/${path}`,
			onRuntimeInitialized: () => {
				const backend = window.SMWCentral?.SPCPlayer?.Backend;
				if (!backend) {
					reject(new PlayerError("The SPC player loaded but exposed no backend."));
					return;
				}
				if (backend.status === -2) {
					reject(new PlayerError("This browser cannot play audio (no AudioContext or WebAssembly)."));
					return;
				}
				resolve(backend);
			},
		};

		const script = document.createElement("script");
		script.src = `${baseUrl}/spc.js`;
		script.async = true;
		script.addEventListener(
			"error",
			() => reject(new PlayerError(`Could not load ${baseUrl}/spc.js. The emulator lives in public/player/.`)),
			{ once: true },
		);
		document.head.append(script);
	});
}

export class SpcPlayer {
	private backend: SpcBackend | null = null;
	private state: PlayerState = "idle";

	constructor(private readonly baseUrl = "player") {}

	get status(): PlayerState {
		return this.state;
	}

	get isReady(): boolean {
		return this.backend !== null;
	}

	/**
	 * Must be called from a user gesture: creating and resuming an AudioContext
	 * is blocked by autoplay policy otherwise.
	 */
	async init(): Promise<void> {
		const backend = await loadBackend(this.baseUrl);
		if (backend.status === 0) backend.initialize();
		backend.unlock();
		this.backend = backend;
	}

	/** Loads an SPC and plays it, optionally fast-forwarded to `atSeconds`. */
	play(spc: Uint8Array, atSeconds = 0): void {
		const backend = this.require();
		backend.loadSPC(spc, Math.max(0, atSeconds));
		backend.resume();
		this.state = "playing";
	}

	stop(): void {
		if (!this.backend) return;
		this.backend.stopSPC(true);
		this.state = "idle";
	}

	pause(): void {
		if (!this.backend || this.state !== "playing") return;
		this.backend.pause();
		this.state = "paused";
	}

	resume(): void {
		if (!this.backend || this.state !== "paused") return;
		this.backend.resume();
		this.state = "playing";
	}

	/** Seconds elapsed, or 0 when nothing is loaded. */
	getTime(): number {
		return this.backend?.getTime() ?? 0;
	}

	/** 0 to 1.5; the backend allows a little headroom above unity. */
	setVolume(volume: number): void {
		this.backend?.setVolume(Math.min(Math.max(volume, 0), 1.5));
	}

	private require(): SpcBackend {
		if (!this.backend) throw new PlayerError("The player has not been initialised yet.");
		return this.backend;
	}
}
