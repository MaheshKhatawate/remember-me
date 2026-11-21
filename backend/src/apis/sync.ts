import express from "express";
import { readRepoFile } from "../utils/github-repo.js";
import { withReadme } from "../services/readme-queue.js";
import { syncReadmeIndex } from "../services/rag.js";

const router = express.Router();

router.post("/sync", async (_req, res) => {
	try {
		const { readmeFile, result } = await withReadme(async () => {
			const readmeFile = await readRepoFile();
			const result = await syncReadmeIndex(readmeFile.content);
			return { readmeFile, result };
		});

		return res.status(200).json({
			message: `Synced README (${result.chunks} chunk${result.chunks === 1 ? "" : "s"}) using the ${
				result.remote ? "remote RAG service" : "local index"
			}.`,
			branch: readmeFile.branch,
			sha: readmeFile.sha,
			...result,
		});
	} catch (err) {
		return res.status(500).json({
			message: err instanceof Error ? err.message : "Failed to sync README",
		});
	}
});

export default router;
