import { beforeEach, describe, expect, it } from "vitest";
import { embedText } from "../services/rag.js";
import { isRagServiceConfigured } from "../utils/rag-client.js";

describe("embedText (local hash-embedding fallback)", () => {
	it("returns a unit-length vector", () => {
		const vector = embedText("Docker container platform");
		const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
		expect(magnitude).toBeCloseTo(1, 2);
	});

	it("is deterministic for the same input", () => {
		expect(embedText("Kubernetes orchestration")).toEqual(embedText("Kubernetes orchestration"));
	});

	it("produces different vectors for unrelated text", () => {
		const a = embedText("Docker container platform");
		const b = embedText("Recipe for chocolate cake");
		expect(a).not.toEqual(b);
	});

	it("handles empty input without throwing", () => {
		expect(() => embedText("")).not.toThrow();
	});
});

describe("isRagServiceConfigured", () => {
	beforeEach(() => {
		delete process.env.RAG_SERVICE_URL;
	});

	it("is false when RAG_SERVICE_URL is unset", () => {
		expect(isRagServiceConfigured()).toBe(false);
	});

	it("is true once RAG_SERVICE_URL is set", () => {
		process.env.RAG_SERVICE_URL = "http://localhost:8001";
		expect(isRagServiceConfigured()).toBe(true);
	});
});
