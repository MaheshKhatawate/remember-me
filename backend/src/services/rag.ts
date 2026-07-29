import { ChatGroq } from "@langchain/groq";
import { Resource } from "../models/resource.js";
import { buildReadmeChunks } from "../utils/readme-markdown.js";
import { indexReadmeRemote, isRagServiceConfigured, queryReadmeRemote } from "../utils/rag-client.js";

const EMBEDDING_DIMENSION = 96;
const TOP_K = 4;

const tokenize = (value: string) =>
	value
		.toLowerCase()
		.replace(/[^a-z0-9\s-]/g, " ")
		.split(/\s+/)
		.map((token) => token.trim())
		.filter((token) => token.length > 2);

const hashToken = (token: string) => {
	let hash = 0;
	for (let index = 0; index < token.length; index += 1) {
		hash = (hash * 31 + token.charCodeAt(index)) >>> 0;
	}

	return hash;
};

export const embedText = (value: string) => {
	const vector = Array.from({ length: EMBEDDING_DIMENSION }, () => 0);
	const tokens = tokenize(value);

	for (const token of tokens) {
		const slot = hashToken(token) % EMBEDDING_DIMENSION;
		vector[slot] = (vector[slot] ?? 0) + 1;
	}

	const magnitude = Math.sqrt(vector.reduce((sum, entry) => sum + entry * entry, 0)) || 1;
	return vector.map((entry) => Number((entry / magnitude).toFixed(6)));
};

const cosineSimilarity = (left: number[], right: number[]) => {
	let dot = 0;
	let leftMagnitude = 0;
	let rightMagnitude = 0;

	for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
		const leftValue = left[index] ?? 0;
		const rightValue = right[index] ?? 0;
		dot += leftValue * rightValue;
		leftMagnitude += leftValue * leftValue;
		rightMagnitude += rightValue * rightValue;
	}

	if (leftMagnitude === 0 || rightMagnitude === 0) {
		return 0;
	}

	return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
};

/**
 * Re-indexes the README. Prefers delegating chunking + embedding to the
 * standalone Python RAG microservice (true decoupled architecture); if that
 * service is not configured or is unreachable, falls back to the in-process
 * hash-embedding index stored in MongoDB so the system keeps working.
 */
export const syncReadmeIndex = async (readmeContent: string, sourcePath = "README.md") => {
	if (isRagServiceConfigured()) {
		try {
			const remote = await indexReadmeRemote(readmeContent, sourcePath);
			return { remote: true, chunks: remote.chunks };
		} catch (error) {
			console.warn(
				`RAG service indexing failed, falling back to local index: ${error instanceof Error ? error.message : error
				}`,
			);
		}
	}

	const chunks = buildReadmeChunks(readmeContent);
	await Resource.deleteMany({ kind: "readme_chunk", sourcePath });

	if (chunks.length === 0) {
		return { remote: false, chunks: 0 };
	}

	const records = chunks.map((chunk) => ({
		kind: "readme_chunk",
		sourcePath,
		section: chunk.section ?? null,
		title: chunk.heading ?? null,
		content: chunk.text,
		embedding: embedText(chunk.text),
		metadata: { type: chunk.type },
	}));

	await Resource.insertMany(records);
	return { remote: false, chunks: records.length };
};

/**
 * Performs semantic retrieval. Prefers the Python RAG microservice; falls
 * back to the local cosine-similarity search over MongoDB-stored chunks.
 */
export const searchReadme = async (query: string, sourcePath = "README.md", topK = TOP_K) => {
	if (isRagServiceConfigured()) {
		try {
			const remoteResults = await queryReadmeRemote(query, sourcePath, topK);
			if (remoteResults.length > 0) {
				return remoteResults;
			}
		} catch (error) {
			console.warn(
				`RAG service query failed, falling back to local search: ${error instanceof Error ? error.message : error
				}`,
			);
		}
	}

	const queryEmbedding = embedText(query);
	const documents = await Resource.find({ kind: "readme_chunk", sourcePath }).lean();

	return documents
		.map((document) => ({
			section: document.section as string | undefined,
			title: document.title as string | undefined,
			content: String(document.content ?? ""),
			score: cosineSimilarity(queryEmbedding, (document.embedding as number[]) ?? []),
		}))
		.filter((item) => item.content.trim().length > 0)
		.sort((left, right) => right.score - left.score)
		.slice(0, topK);
};

export const answerWithContext = async (
	query: string,
	context: Array<{ section?: string | undefined; title?: string | undefined; content: string; score: number }>,
) => {
	const apiKey = process.env.GROQ_API_KEY ?? process.env.GROQ_API;
	const formattedContext = context
		.map((item, index) => `${index + 1}. ${item.section ? `[${item.section}] ` : ""}${item.title ? `${item.title}: ` : ""}${item.content}`)
		.join("\n");

	if (!apiKey) {
		if (context.length === 0) {
			return `No strong README matches were found for: ${query}`;
		}

		return [`Best local matches for: ${query}`, formattedContext].filter(Boolean).join("\n");
	}

	const model = new ChatGroq({
		apiKey,
		model: "llama-3.1-8b-instant",
		temperature: 0.2,
	});

	try {
		const response = await model.invoke([
			{
				role: "system",
				content: "You are a concise assistant that answers questions using only the provided README context. Cite the most relevant links or sections and avoid inventing facts.",
			},
			{
				role: "user",
				content: `Question: ${query}\n\nContext:\n${formattedContext || "No context found."}`,
			},
		]);

		return typeof response.content === "string" ? response.content : String(response.content ?? "");
	} catch (groqError) {
		// Groq call failed (bad key, rate limit, network error, etc.) — log the
		// reason and fall back to returning the raw matched snippets so the user
		// still gets useful output instead of a 500.
		console.warn(
			`Groq answer synthesis failed, falling back to raw context: ${groqError instanceof Error ? groqError.message : groqError
			}`,
		);
		if (context.length === 0) {
			return `No strong README matches were found for: ${query}`;
		}
		return [`Best matches for: ${query}`, formattedContext].filter(Boolean).join("\n");
	}
};