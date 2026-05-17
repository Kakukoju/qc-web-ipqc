import csv
from collections import defaultdict
from io import StringIO


def _decode_csv(content: bytes) -> str:
    try:
        return content.decode("utf-8-sig")
    except UnicodeDecodeError:
        return content.decode("big5")


def parse_assay_process_csv(content: bytes) -> tuple[list[str], list[dict[str, str]]]:
    text = _decode_csv(content)
    reader = csv.reader(StringIO(text))

    try:
        raw_headers = next(reader)
    except StopIteration as exc:
        raise ValueError("CSV is empty") from exc

    headers = _make_unique_headers(raw_headers)
    if any(header == "" for header in headers):
        raise ValueError("CSV header contains an empty column name")

    records: list[dict[str, str]] = []
    for row in reader:
        if all((cell or "").strip() == "" for cell in row):
            break

        normalized = [cell if cell is not None else "" for cell in row]
        if len(normalized) < len(headers):
            normalized.extend([""] * (len(headers) - len(normalized)))
        elif len(normalized) > len(headers):
            normalized = normalized[: len(headers)]

        records.append(dict(zip(headers, normalized)))

    return headers, records


def _make_unique_headers(raw_headers: list[str]) -> list[str]:
    counts: defaultdict[str, int] = defaultdict(int)
    headers: list[str] = []

    for raw_header in raw_headers:
        header = (raw_header or "").strip()
        if header == "":
            headers.append(header)
            continue

        counts[header] += 1
        if counts[header] == 1:
            headers.append(header)
        else:
            headers.append(f"{header}__{counts[header]}")

    return headers
