import axios from "axios";

const githubApiBaseUrl = "https://api.github.com";

const encodeRepoPath = (path: string) => path.split("/").map((segment) => encodeURIComponent(segment)).join("/");

const repoHeaders = (token: string) => ({
	Authorization: `Bearer ${token}`,
	Accept: "application/vnd.github+json",
	"X-GitHub-Api-Version": "2022-11-28",
	"User-Agent": "remember-me-backend",
});

const decodeContent = (content: string) => Buffer.from(content.replace(/\n/g, ""), "base64").toString("utf8");

export type RepoFileResult = {
	path: string;
	content: string;
	branch: string;
	sha?: string;
	htmlUrl?: string;
};

export const readRepoFile = async ({
	owner = process.env.GITHUB_OWNER,
	repo = process.env.GITHUB_REPO,
	token = process.env.GITHUB_TOKEN,
	branch = process.env.GITHUB_BRANCH ?? "main",
	path = "README.md",
}: {
	owner?: string;
	repo?: string;
	token?: string;
	branch?: string;
	path?: string;
} = {}): Promise<RepoFileResult> => {
	if (!owner || !repo || !token) {
		throw new Error("GITHUB_OWNER, GITHUB_REPO, and GITHUB_TOKEN must be configured");
	}

	const contentsUrl = `${githubApiBaseUrl}/repos/${owner}/${repo}/contents/${encodeRepoPath(path)}`;
	const response = await axios.get(contentsUrl, {
		headers: repoHeaders(token),
		params: { ref: branch },
	});

	return {
		path,
		branch,
		sha: response.data?.sha,
		htmlUrl: response.data?.html_url,
		content: decodeContent(response.data?.content ?? ""),
	};
};