import { beforeEach, describe, expect, it } from "vitest";
import { categorise } from "../utils/category.js";

// These tests exercise the heuristic classifier only (no Groq API key
// configured), which is the deterministic, dependency-free code path.
beforeEach(() => {
	delete process.env.GROQ_API_KEY;
	delete process.env.GROQ_API;
});

describe("categorise (heuristic fallback)", () => {
	it("classifies /add commands as CREATE and extracts the url", async () => {
		const result = await categorise("/add Docker https://docker.com Container platform");
		expect(result.intent).toBe("CREATE");
		expect(result.type).toBe("command");
		expect(result.urls).toContain("https://docker.com");
	});

	it("parses a title from before the url", async () => {
		const result = await categorise("/add Docker https://docker.com Container platform");
		expect(result.title).toBe("Docker");
	});

	it("classifies /update commands as UPDATE", async () => {
		const result = await categorise("/update Docker https://docker.com New description");
		expect(result.intent).toBe("UPDATE");
	});

	it("classifies /delete commands as DELETE", async () => {
		const result = await categorise("/delete Kubernetes");
		expect(result.intent).toBe("DELETE");
	});

	it("classifies /get commands as READ", async () => {
		const result = await categorise("/get Docker");
		expect(result.intent).toBe("READ");
	});

	it("classifies natural-language questions as READ", async () => {
		const result = await categorise("Find me all links related to machine learning");
		expect(result.intent).toBe("READ");
	});

	it("defaults ambiguous free-form text to CREATE with lower confidence", async () => {
		const result = await categorise("Just jotting this down for later");
		expect(result.intent).toBe("CREATE");
		expect(result.confidence).toBeLessThan(0.7);
	});

	it("extracts multiple urls when present", async () => {
		const result = await categorise("/add See https://a.com and https://b.com too");
		expect(result.urls).toEqual(["https://a.com", "https://b.com"]);
	});
});

it("routes reminders, short notes and named sections without an LLM", async () => {
	expect(await categorise("Buy milk")).toMatchObject({ intent: "CREATE", section: "Notes" });
	expect(await categorise("Remind me to buy milk")).toMatchObject({ intent: "CREATE", section: "Reminders", content: "buy milk" });
	expect(await categorise("/add@test_bot [Books] Dune - Frank Herbert")).toMatchObject({ section: "Books", title: "Dune", content: "Frank Herbert" });
	expect(await categorise("Where did I leave my keys")).toMatchObject({ intent: "READ" });
	await expect(categorise("/add")).rejects.toThrow(/include/i);
});
