/** Repeated runs in a sequence of keys: a suffix array, its longest common prefixes, and the groups of positions that share one. */

/** The suffix array of `s`, by prefix doubling. */
export function suffixArray(s: Int32Array): Int32Array {
	const n = s.length;
	const sa = new Int32Array(n);
	let rank = new Int32Array(n);
	let next = new Int32Array(n);
	for (let i = 0; i < n; i++) {
		sa[i] = i;
	}

	// Ranks start as the keys themselves, compressed to 0..m.
	const sorted = Array.from(new Set(s)).sort((a, b) => a - b);
	const compress = new Map(sorted.map((v, i) => [v, i]));
	for (let i = 0; i < n; i++) {
		rank[i] = compress.get(s[i])!;
	}

	const second = (i: number, k: number) => (i + k < n ? rank[i + k] + 1 : 0);
	let classes = sorted.length;
	const temp = new Int32Array(n);
	for (let k = 1; ; k <<= 1) {
		// Radix sort by (rank[i], second(i)): the second key first, then a stable pass on the first.
		const counts = new Int32Array(Math.max(classes, n) + 2);
		for (let i = 0; i < n; i++) {
			counts[second(i, k)]++;
		}
		for (let i = 1; i < counts.length; i++) {
			counts[i] += counts[i - 1];
		}
		for (let i = n - 1; i >= 0; i--) {
			temp[--counts[second(i, k)]] = i;
		}

		counts.fill(0);
		for (let i = 0; i < n; i++) {
			counts[rank[i]]++;
		}
		for (let i = 1; i < counts.length; i++) {
			counts[i] += counts[i - 1];
		}
		for (let i = n - 1; i >= 0; i--) {
			const j = temp[i];
			sa[--counts[rank[j]]] = j;
		}

		next[sa[0]] = 0;
		classes = 1;
		for (let i = 1; i < n; i++) {
			const a = sa[i - 1];
			const b = sa[i];
			if (rank[a] !== rank[b] || second(a, k) !== second(b, k)) {
				classes++;
			}
			next[b] = classes - 1;
		}

		[rank, next] = [next, rank];
		if (classes === n || k >= n) {
			break;
		}
	}

	return sa;
}

/** `lcp[i]`: the common prefix of the suffixes at `sa[i - 1]` and `sa[i]` (Kasai). */
export function lcpArray(s: Int32Array, sa: Int32Array): Int32Array {
	const n = s.length;
	const rank = new Int32Array(n);
	for (let i = 0; i < n; i++) {
		rank[sa[i]] = i;
	}

	const lcp = new Int32Array(n);
	let h = 0;
	for (let i = 0; i < n; i++) {
		if (rank[i] > 0) {
			const j = sa[rank[i] - 1];
			while (i + h < n && j + h < n && s[i + h] === s[j + h]) {
				h++;
			}
			lcp[rank[i]] = h;
			if (h > 0) {
				h--;
			}
		} else {
			h = 0;
		}
	}

	return lcp;
}

/** A run of `length` keys found at every one of `positions`, sorted. */
export interface Repeat {
	length: number;
	positions: number[];
}

/**
 * Every group of two or more positions sharing a prefix of at least `minLength` that no longer
 * prefix shares among them all: the LCP intervals, each at its own length.
 */
export function repeats(s: Int32Array, minLength: number): Repeat[] {
	const n = s.length;
	if (n < 2) {
		return [];
	}

	const sa = suffixArray(s);
	const lcp = lcpArray(s, sa);
	const found: Repeat[] = [];
	const stack: { lcp: number; left: number }[] = [];
	for (let i = 1; i <= n; i++) {
		const value = i < n ? lcp[i] : 0;
		let left = i - 1;
		while (stack.length > 0 && stack[stack.length - 1].lcp > value) {
			const top = stack.pop()!;
			left = top.left;
			if (top.lcp >= minLength) {
				const positions = Array.from(sa.subarray(top.left, i)).sort((a, b) => a - b);
				found.push({ length: top.lcp, positions });
			}
		}
		if (stack.length === 0 || stack[stack.length - 1].lcp < value) {
			stack.push({ lcp: value, left });
		}
	}

	return found;
}
