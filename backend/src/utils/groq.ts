import { ChatGroq } from "@langchain/groq";

export const groqModel = () => {
	const apiKey = process.env.GROQ_API_KEY || process.env.GROQ_API;
	return apiKey ? new ChatGroq({
		apiKey, model: process.env.GROQ_MODEL || "openai/gpt-oss-20b",
		temperature: 0, timeout: 15000, maxRetries: 0,
	}) : null;
};
