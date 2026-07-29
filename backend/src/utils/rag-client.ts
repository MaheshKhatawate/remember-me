import axios from "axios";

export type RemoteSearchResult = {
	section?: string | undefined;
	title?: string | undefined;
	content: string;
	score: number;
};

const ragServiceUrl = () => process.env.RAG_SERVICE_URL?.replace(/\/$/, "");
const ragTimeoutMs = () => Number(process.env.RAG_SERVICE_TIMEOUT_MS ?? 8000);

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

	return { chunks: Number(response.data?.chunks ?? 0) };
};

/**
 * Performs semantic search against the Python RAG service and returns the
 * top-k most relevant README chunks for the given query.
 */
export const queryReadmeRemote = async (
	query: string,
	sourcePath = "README.md",
	topK = 4,
): Promise<RemoteSearchResult[]> => {
	const baseUrl = ragServiceUrl();
	if (!baseUrl) {
		throw new Error("RAG_SERVICE_URL is not configured");
	}

	const response = await axios.post<{ results: RemoteSearchResult[] }>(
		`${baseUrl}/query`,
		{ source_path: sourcePath, query, top_k: topK },
		{ timeout: ragTimeoutMs() },
	);

	return Array.isArray(response.data?.results) ? response.data.results : [];
};

/** Lightweight reachability probe used by the /api/status endpoint. */
export const pingRagService = async (): Promise<{ reachable: boolean; detail?: string }> => {
	const baseUrl = ragServiceUrl();
	if (!baseUrl) {
		return { reachable: false, detail: "RAG_SERVICE_URL not configured" };
	}

	try {
		await axios.get(`${baseUrl}/health`, { timeout: 3000 });
		return { reachable: true };
	} catch (error) {
		return {
			reachable: false,
			detail: error instanceof Error ? error.message : "unreachable",
		};
	}
};
