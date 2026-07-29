import express from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

const writeRepoMock = vi.fn();
const syncReadmeIndexMock = vi.fn();

vi.mock("../utils/write-repo.js", () => ({
	writeRepo: (...args: unknown[]) => writeRepoMock(...args),
}));

vi.mock("../services/rag.js", () => ({
	syncReadmeIndex: (...args: unknown[]) => syncReadmeIndexMock(...args),
}));

const buildApp = async () => {
	const { default: resetRouter } = await import("../apis/reset.js");
	const app = express();
	app.use(express.json());
	app.use("/api", resetRouter);
	return app;
};

const postJson = async (app: express.Express, path: string, body: unknown) => {
	const server = app.listen(0);
	const address = server.address();
	const port = typeof address === "object" && address ? address.port : 0;

	try {
		const response = await fetch(`http://127.0.0.1:${port}${path}`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});
		return { status: response.status, body: await response.json() };
	} finally {
		server.close();
	}
};

describe("POST /api/reset", () => {
	beforeEach(() => {
		writeRepoMock.mockReset();
		syncReadmeIndexMock.mockReset();
	});

	it("wipes the README to empty content when no content is provided", async () => {
		writeRepoMock.mockResolvedValue({ branch: "main", sha: "abc123" });
		syncReadmeIndexMock.mockResolvedValue({ remote: false, chunks: 0 });

		const app = await buildApp();
		const { status, body } = await postJson(app, "/api/reset", {});

		expect(status).toBe(200);
		expect(writeRepoMock).toHaveBeenCalledWith(
			expect.objectContaining({ content: "", path: "README.md" }),
		);
		expect(syncReadmeIndexMock).toHaveBeenCalledWith("");
		expect(body.message).toMatch(/cleared/i);
		expect(body.chunks).toBe(0);
	});

	it("replaces the README with provided content when given", async () => {
		writeRepoMock.mockResolvedValue({ branch: "main", sha: "def456" });
		syncReadmeIndexMock.mockResolvedValue({ remote: true, chunks: 2 });

		const app = await buildApp();
		const { status, body } = await postJson(app, "/api/reset", { content: "# Fresh start\n" });

		expect(status).toBe(200);
		expect(writeRepoMock).toHaveBeenCalledWith(
			expect.objectContaining({ content: "# Fresh start\n" }),
		);
		expect(syncReadmeIndexMock).toHaveBeenCalledWith("# Fresh start\n");
		expect(body.message).toMatch(/reset to the provided content/i);
	});

	it("returns 500 with the error message when the GitHub write fails", async () => {
		writeRepoMock.mockRejectedValue(new Error("GITHUB_TOKEN must be configured"));

		const app = await buildApp();
		const { status, body } = await postJson(app, "/api/reset", {});

		expect(status).toBe(500);
		expect(body.message).toMatch(/GITHUB_TOKEN/);
	});
});
