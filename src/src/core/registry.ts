import type { MmlCompiler } from "./types";

/**
 * Holds the available compiler implementations.
 *
 * Adding "Addmusic 5" later is a two-line change in `src/compilers/index.ts` —
 * nothing else in the app knows which compiler it is talking to.
 */
export class CompilerRegistry {
	private readonly byId = new Map<string, MmlCompiler>();

	register(compiler: MmlCompiler): this {
		if (this.byId.has(compiler.id)) {
			throw new Error(`Duplicate compiler id: ${compiler.id}`);
		}
		this.byId.set(compiler.id, compiler);
		return this;
	}

	get(id: string): MmlCompiler | undefined {
		return this.byId.get(id);
	}

	list(): MmlCompiler[] {
		return [...this.byId.values()];
	}

	/**
	 * Pick the compiler that best claims this source. Falls back to the first
	 * registered one so the UI always has something to run.
	 */
	detect(source: string): MmlCompiler | undefined {
		let best: MmlCompiler | undefined;
		let bestScore = 0;
		for (const compiler of this.byId.values()) {
			const score = compiler.detect(source);
			if (score > bestScore) {
				best = compiler;
				bestScore = score;
			}
		}
		return best ?? this.list()[0];
	}
}
