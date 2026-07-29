import express from "express";
import { readRepoFile } from "../utils/github-repo.js";
import { compactReadmeText } from "../utils/readme-markdown.js";
import { syncReadmeIndex } from "../services/rag.js";

const router = express.Router();

router.post("/sync", async (_req, res) => {
	try {
		const readmeFile = await readRepoFile({ path: "README.md" });
		const content = compactReadmeText(readmeFile.content ?? "");
		const result = await syncReadmeIndex(content);

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
