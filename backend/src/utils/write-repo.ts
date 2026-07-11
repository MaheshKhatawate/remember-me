import axios from "axios";

export type WriteRepoInput = {
	content: string;
	owner?: string;
	repo?: string;
	token?: string;
	branch?: string;
	path?: string;
	commitMessage?: string;
};

export type WriteRepoResult = {
	path: string;
	branch: string;
	commitMessage: string;
	htmlUrl?: string;
	sha?: string;
};

const githubApiBaseUrl = "https://api.github.com";

const encodeRepoPath = (path: string) =>
	path.split("/").map((segment) => encodeURIComponent(segment)).join("/");

const toBase64 = (value: string) => Buffer.from(value, "utf8").toString("base64");

export const writeRepo = async ({
	content,
	owner = process.env.GITHUB_OWNER,
	repo = process.env.GITHUB_REPO,
	token = process.env.GITHUB_TOKEN,
	branch = process.env.GITHUB_BRANCH ?? "main",
	path = "README.md",
	commitMessage,
}: WriteRepoInput): Promise<WriteRepoResult> => {
	if (!owner || !repo || !token) {
		throw new Error("GITHUB_OWNER, GITHUB_REPO, and GITHUB_TOKEN must be configured");
	}

	const filePath = encodeRepoPath(path);
	const contentsUrl = `${githubApiBaseUrl}/repos/${owner}/${repo}/contents/${filePath}`;
	let sha: string | undefined;

	try {
		const existingFile = await axios.get(contentsUrl, {
			headers: {
				Authorization: `Bearer ${token}`,
				Accept: "application/vnd.github+json",
				"X-GitHub-Api-Version": "2022-11-28",
				"User-Agent": "remember-me-backend",
			},
			params: {
				ref: branch,
			},
		});

		sha = existingFile.data?.sha;
	} catch (error) {
		if (!axios.isAxiosError(error) || error.response?.status !== 404) {
			throw error;
		}
	}

	const response = await axios.put(
		contentsUrl,
		{
			message: commitMessage ?? `Update ${path}`,
			content: toBase64(content),
			branch,
			...(sha ? { sha } : {}),
		},
		{
			headers: {
				Authorization: `Bearer ${token}`,
				Accept: "application/vnd.github+json",
				"X-GitHub-Api-Version": "2022-11-28",
				"User-Agent": "remember-me-backend",
			},
		},
	);

	return {
		path,
		branch,
		commitMessage: response.data?.commit?.message ?? commitMessage ?? `Update ${path}`,
		htmlUrl: response.data?.content?.html_url,
		sha: response.data?.content?.sha,
	};
};
