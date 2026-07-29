import express from "express";
import mongoose from "mongoose";
import { pingRagService } from "../utils/rag-client.js";

const router = express.Router();

const mongoStateLabel = (state: number) => {
	switch (state) {
		case 0:
			return "disconnected";
		case 1:
			return "connected";
		case 2:
			return "connecting";
		case 3:
			return "disconnecting";
		default:
			return "unknown";
	}
};

router.get("/status", async (_req, res) => {
	const mongoState = mongoose.connection.readyState;
	const rag = await pingRagService();

	const githubConfigured = Boolean(
		process.env.GITHUB_OWNER && process.env.GITHUB_REPO && process.env.GITHUB_TOKEN,
	);

	return res.status(200).json({
		message: "ok",
		uptimeSeconds: Math.round(process.uptime()),
		mongo: {
			state: mongoStateLabel(mongoState),
			connected: mongoState === 1,
		},
		github: {
			configured: githubConfigured,
			owner: process.env.GITHUB_OWNER ?? null,
			repo: process.env.GITHUB_REPO ?? null,
			branch: process.env.GITHUB_BRANCH ?? "main",
		},
		ragService: {
			configured: Boolean(process.env.RAG_SERVICE_URL),
			reachable: rag.reachable,
			detail: rag.detail,
		},
		groqConfigured: Boolean(process.env.GROQ_API_KEY),
	});
});

export default router;
