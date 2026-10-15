from dataclasses import dataclass


@dataclass(frozen=True)
class TranscriptChunk:
    index: int
    turns: tuple[str, ...]
    source_start: int
    source_end: int

    @property
    def chunk_id(self) -> str:
        return f"chunk-{self.index:04d}"

    @property
    def text(self) -> str:
        return "\n".join(self.turns)


def chunk_transcript(text: str, max_turns: int = 80, overlap_turns: int = 8) -> list[TranscriptChunk]:
    if max_turns < 1 or overlap_turns < 0 or overlap_turns >= max_turns:
        raise ValueError("overlap_turns must be >= 0 and less than max_turns")
    turns = tuple(line for line in text.splitlines() if line.strip())
    if not turns:
        return []
    chunks: list[TranscriptChunk] = []
    start = 0
    index = 0
    while start < len(turns):
        end = min(start + max_turns, len(turns))
        chunks.append(TranscriptChunk(index, turns[start:end], start, end))
        if end == len(turns):
            break
        start = end - overlap_turns
        index += 1
    return chunks
