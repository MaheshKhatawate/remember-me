import express from "express";
import { writeRepo } from "../utils/write-repo.js";
import { syncReadmeIndex } from "../services/rag.js";

const router = express.Router();

/**
 * Wipes the README, replacing it with the provided content (or an empty
 * file if none is given), commits the change to GitHub, and clears/rebuilds
 * the RAG index to match. This is destructive and irreversible via the bot
 * itself (though the old content remains in GitHub's commit history), so
 * the Telegram layer requires an explicit "CONFIRM" before calling this.
 */
router.post("/reset", async (req, res) => {
	try {
		const content = typeof req.body?.content === "string" ? req.body.content : "";

		const repoWrite = await writeRepo({
			content,
			path: "README.md",
			commitMessage: "RESET README content via Telegram",
		});

		const indexResult = await syncReadmeIndex(content);

		return res.status(200).json({
			message:
				content.length === 0
					? "README has been cleared and the search index reset."
					: "README has been reset to the provided content and the search index rebuilt.",
			branch: repoWrite.branch,
			sha: repoWrite.sha,
			...indexResult,
		});
	} catch (err) {
		return res.status(500).json({
			message: err instanceof Error ? err.message : "Failed to reset README",
		});
	}
});

export default router;
