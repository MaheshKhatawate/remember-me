import axios from "axios";

export type RemoteSearchResult = {
	section?: string | undefined;
	title?: string | undefined;
	content: string;
	score: number;
};

const ragServiceUrl = () => process.env.RAG_SERVICE_URL?.replace(/\/$/, "");
const ragTimeoutMs = () => Number(process.env.RAG_SERVICE_TIMEOUT_MS ?? 60000);

/** True when a RAG_SERVICE_URL has been configured at all. */
export const isRagServiceConfigured = () => Boolean(ragServiceUrl());

/**
 * Sends the full README content to the Python RAG service so it can chunk,
 * embed, and (re)persist vectors in its own store. Throws on failure so the
 * caller can decide whether to fall back to the in-process index.
 */
export const indexReadmeRemote = async (
	content: string,
	sourcePath = "README.md",
): Promise<{ chunks: number }> => {
	const baseUrl = ragServiceUrl();
	if (!baseUrl) {
		throw new Error("RAG_SERVICE_URL is not configured");
	}

	const response = await axios.post(
		`${baseUrl}/index`,
		{ source_path: sourcePath, content },
		{ timeout: ragTimeoutMs() },
	);

	const chunks = response.data?.chunks;
	if (!Number.isInteger(chunks) || chunks < 0) throw new Error("Invalid RAG index response");
	return { chunks };
};

export class StaleRemoteIndex extends Error {}

/**
 * Performs semantic search against the Python RAG service and returns the
 * top-k most relevant README chunks for the given query.
 */
export const queryReadmeRemote = async (
	query: string,
	sourcePath = "README.md",
	topK = 4,
	revision?: string,
): Promise<RemoteSearchResult[]> => {
	const baseUrl = ragServiceUrl();
	if (!baseUrl) {
		throw new Error("RAG_SERVICE_URL is not configured");
	}

	const response = await axios.post<{ results: RemoteSearchResult[]; revision?: string }>(
		`${baseUrl}/query`,
		{ source_path: sourcePath, query, top_k: topK },
		{ timeout: ragTimeoutMs() },
	);

	if (revision && response.data.revision !== revision) throw new StaleRemoteIndex("Remote README revision differs");
	const results = response.data.results;
	if (!Array.isArray(results) || results.some((r) => !r || typeof r.content !== "string" || !Number.isFinite(r.score))) {
		throw new Error("Invalid RAG query response");
	}
	return results;
};

/** Lightweight reachability probe used by the /api/status endpoint. */
export const pingRagService = async (): Promise<{ reachable: boolean; detail?: string }> => {
	const baseUrl = ragServiceUrl();
	if (!baseUrl) {
		return { reachable: false, detail: "RAG_SERVICE_URL not configured" };
	}

	try {
		const { data } = await axios.get(`${baseUrl}/health`, { timeout: 3000 });
		return { reachable: true, detail: `${data.embedding_backend} · ${data.vector_store} · ${data.indexed_sources} source(s)` };
	} catch (error) {
		return {
			reachable: false,
			detail: error instanceof Error ? error.message : "unreachable",
		};
	}
};
