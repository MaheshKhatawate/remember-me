import { beforeEach, expect, it, vi } from "vitest";
import { processMessage } from "../services/assistant.js";
import { StaleRemoteIndex } from "../utils/rag-client.js";

const io = vi.hoisted(() => ({
	read: vi.fn(), write: vi.fn(), audit: vi.fn(), snapshot: vi.fn(), replace: vi.fn(),
	index: vi.fn(), query: vi.fn(),
}));
vi.mock("../utils/github-repo.js", () => ({ readRepoFile: io.read }));
vi.mock("../utils/write-repo.js", () => ({ writeRepo: io.write }));
vi.mock("../models/resource.js", () => ({
	Resource: { create: io.audit }, ReadmeIndex: { findById: () => ({ lean: io.snapshot }), updateOne: io.replace },
}));
vi.mock("../utils/rag-client.js", async (original) => ({
	...await original<typeof import("../utils/rag-client.js")>(),
	isRagServiceConfigured: () => true, indexReadmeRemote: io.index, queryReadmeRemote: io.query,
}));

let file: { content: string; path: string; branch: string; sha: string };
beforeEach(() => {
	vi.resetAllMocks();
	io.audit.mockResolvedValue({});
	vi.stubEnv("GROQ_API_KEY", "");
	vi.stubEnv("GROQ_API", "");
	file = { content: "# Notebook\n", path: "README.md", branch: "main", sha: "0" };
	io.read.mockImplementation(async () => ({ ...file }));
	io.write.mockImplementation(async ({ content, sha }) => {
		expect(sha).toBe(file.sha);
		file = { ...file, content, sha: String(Number(sha) + 1) };
		return { sha: file.sha };
	});
	io.replace.mockImplementation(async (_filter, { $set }) => { io.snapshot.mockResolvedValue($set); });
	io.index.mockResolvedValue({ chunks: 2 });
});

it("keeps captures searchable through a RAG outage, including subsequent edits and deletes", async () => {
	io.query.mockRejectedValue(new Error("offline"));
	await processMessage("Remind me to return the library books on Friday");
	expect(file.content).toContain("## Reminders\n\n- return the library books on Friday");
	expect((await processMessage("When are library books due?")).message).toContain("Friday");

	await processMessage("/add Door - studio is teal");
	await processMessage("/update Door - studio is amber");
	await processMessage("/update Door - studio is amber");
	await processMessage("/add Door - studio is amber");
	await processMessage("/delete missing entry");
	expect(io.write).toHaveBeenCalledTimes(3);
	expect((await processMessage("/get Door")).message).toContain("amber");
	expect((await processMessage("/get teal")).message).toMatch(/No strong/);
	await processMessage("/remove Door");
	expect((await processMessage("Where is the studio?")).message).toMatch(/No strong/);
});

it("imports an existing notebook on first search and repairs a stale remote revision", async () => {
	file.content = "## Travel\n- Swiss rail pass";
	io.query.mockRejectedValueOnce(new StaleRemoteIndex()).mockResolvedValue([
		{ section: "Travel", content: "Swiss rail pass", score: 1 },
	]);
	expect((await processMessage("/find rail")).message).toContain("Swiss rail pass");
	expect(io.query).toHaveBeenCalledTimes(2);
	expect(io.write).not.toHaveBeenCalled();
});

it("never writes from a failed read and never publishes a failed GitHub edit", async () => {
	io.read.mockRejectedValueOnce(new Error("GitHub 503"));
	await expect(processMessage("/add milk")).rejects.toThrow("GitHub 503");
	expect(io.write).not.toHaveBeenCalled();
	io.write.mockRejectedValueOnce(new Error("GitHub 409"));
	await expect(processMessage("/add milk")).rejects.toThrow("GitHub 409");
	expect(io.index).not.toHaveBeenCalled();
	expect(io.replace.mock.lastCall?.[1].$set).toEqual({ dirty: true });
	expect(io.audit).toHaveBeenCalledTimes(2);
});

it("serializes simultaneous captures so both reach the README and its index", async () => {
	await Promise.all([processMessage("/add library books"), processMessage("/add spare keys")]);
	expect(file.content).toContain("library books");
	expect(file.content).toContain("spare keys");
	expect(io.index.mock.lastCall).toEqual([file.content, "README.md"]);
});


it("repairs the GitHub-to-index crash window on the next question", async () => {
	file.content = "## Notes\n- Updated mailbox code is 3942";
	io.snapshot.mockResolvedValue({ revision: "old", dirty: true, chunks: [] });
	io.query.mockRejectedValue(new Error("offline"));
	expect((await processMessage("/find mailbox code")).message).toContain("3942");
	expect(io.write).not.toHaveBeenCalled();
});
