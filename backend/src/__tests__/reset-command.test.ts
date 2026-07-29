import { beforeAll, describe, expect, it } from "vitest";

// bot.ts constructs a Telegraf instance at module load time, which requires
// a token to be present even though these tests never actually launch it.
beforeAll(() => {
	process.env.TELEGRAM_BOT_TOKEN ??= "test-token-not-used";
});

describe("parseResetCommand", () => {
	it("is not confirmed for a bare /reset", async () => {
		const { parseResetCommand } = await import("../services/bot.js");
		const result = parseResetCommand("/reset");
		expect(result.confirmed).toBe(false);
	});

	it("is not confirmed when CONFIRM is missing", async () => {
		const { parseResetCommand } = await import("../services/bot.js");
		const result = parseResetCommand("/reset please wipe it");
		expect(result.confirmed).toBe(false);
	});

	it("is confirmed with bare CONFIRM and produces empty replacement content", async () => {
		const { parseResetCommand } = await import("../services/bot.js");
		const result = parseResetCommand("/reset CONFIRM");
		expect(result.confirmed).toBe(true);
		expect(result.replacementContent).toBe("");
	});

	it("is confirmed case-insensitively", async () => {
		const { parseResetCommand } = await import("../services/bot.js");
		const result = parseResetCommand("/reset confirm");
		expect(result.confirmed).toBe(true);
	});

	it("extracts replacement content after CONFIRM", async () => {
		const { parseResetCommand } = await import("../services/bot.js");
		const result = parseResetCommand("/reset CONFIRM # Fresh Start\n\nNew content here.");
		expect(result.confirmed).toBe(true);
		expect(result.replacementContent).toBe("# Fresh Start\n\nNew content here.");
	});

	it("does not treat a word merely starting with 'confirm' as confirmation", async () => {
		const { parseResetCommand } = await import("../services/bot.js");
		const result = parseResetCommand("/reset confirmation please");
		expect(result.confirmed).toBe(false);
	});
});
