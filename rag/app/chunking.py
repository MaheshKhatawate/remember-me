"""Splits README markdown into section- and line-level chunks for embedding.

Mirrors the chunking strategy implemented in the Node backend
(src/utils/readme-markdown.ts: buildReadmeChunks) so that indexing behaves
consistently whether the local Node fallback or this Python service is used.
"""

import re
from dataclasses import dataclass
from typing import List

HEADING_PATTERN = re.compile(r"^(#{1,6})\s+(.*)$")
BULLET_PATTERN = re.compile(r"^\s*[-*+]\s+(.*)$")
LINK_PATTERN = re.compile(r"\[([^\]]+)\]\(([^)]+)\)")


@dataclass
class ReadmeChunk:
    id: str
    section: str
    heading: str
    text: str
    type: str  # "section" | "line" | "link"


def build_readme_chunks(content: str) -> List[ReadmeChunk]:
    lines = content.splitlines()
    chunks: List[ReadmeChunk] = []
    current_section = "README"
    section_buffer: List[str] = []

    def flush_section() -> None:
        nonlocal section_buffer
        section_text = "\n".join(section_buffer).strip()
        if any(line.strip() and not HEADING_PATTERN.match(line) for line in section_buffer):
            chunks.append(
                ReadmeChunk(
                    id=f"section-{len(chunks)}",
                    section=current_section,
                    heading=current_section,
                    text=section_text,
                    type="section",
                )
            )
        section_buffer = []

    fence = ""
    for line in lines:
        marker = re.match(r"^ {0,3}(`{3,}|~{3,})(.*)$", line)
        if fence:
            if marker and marker[1].startswith(fence) and not marker[2].strip():
                fence = ""
            section_buffer.append(line)
            continue
        if marker:
            fence = marker[1]
            section_buffer.append(line)
            continue
        heading_match = HEADING_PATTERN.match(line)
        if heading_match:
            flush_section()
            current_section = heading_match.group(2).strip()
            section_buffer.append(line)
            continue

        section_buffer.append(line)

        bullet_match = BULLET_PATTERN.match(line)
        if bullet_match:
            bullet_text = bullet_match.group(1).strip()
            chunks.append(
                ReadmeChunk(
                    id=f"line-{len(chunks)}",
                    section=current_section,
                    heading=current_section,
                    text=bullet_text,
                    type="link" if LINK_PATTERN.search(bullet_text) else "line",
                )
            )

    flush_section()

    return [chunk for chunk in chunks if chunk.text.strip()]
