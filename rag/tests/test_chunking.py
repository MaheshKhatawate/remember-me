from app.chunking import build_readme_chunks


def test_splits_sections_and_bullets():
    content = (
        "# Title\n\n"
        "## Links\n\n"
        "- [Docker](https://docker.com) - platform\n"
        "- A plain note\n"
    )
    chunks = build_readme_chunks(content)

    types = {chunk.type for chunk in chunks}
    assert "section" in types
    assert "link" in types
    assert "line" in types

    link_chunk = next(chunk for chunk in chunks if chunk.type == "link")
    assert "Docker" in link_chunk.text
    assert link_chunk.section == "Links"


def test_empty_content_returns_no_chunks():
    assert build_readme_chunks("") == []


def test_section_without_bullets_still_produces_section_chunk():
    content = "# Title\n\nJust a paragraph of prose with no bullets.\n"
    chunks = build_readme_chunks(content)
    assert any(chunk.type == "section" for chunk in chunks)


def test_nested_headings_reset_current_section():
    content = "## A\n\n- item a\n\n### B\n\n- item b\n"
    chunks = build_readme_chunks(content)
    sections = {chunk.section for chunk in chunks if chunk.type == "line"}
    assert sections == {"A", "B"}
