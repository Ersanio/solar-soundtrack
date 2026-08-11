export function hex(value: number): string {
	return value.toString(16).toUpperCase();
}

export function hex2(value: number): string {
	return hex(value).padStart(2, "0");
}

export function hex4(value: number): string {
	return hex(value).padStart(4, "0");
}
