// One polling backend owns this personal README. Serialize GitHub + index publication
// so a slow earlier sync cannot publish over a later edit.
let pending = Promise.resolve();

export function withReadme<T>(work: () => Promise<T>): Promise<T> {
	const result = pending.then(work);
	pending = result.then(() => undefined, () => undefined);
	return result;
}
