export interface TopDomainList {
  listId: string;
  sourceUrl: string;
  domains: string[];
}

const DOMAIN_LIMIT = 1000;

function parseDomains(csv: string): string[] {
  const rows = csv
    .replace(/^\uFEFF/, "")
    .trim()
    .split(/\r?\n/);
  if (rows.length !== DOMAIN_LIMIT) {
    throw new Error(`Expected ${DOMAIN_LIMIT} Tranco domains, received ${rows.length} rows`);
  }

  const seen = new Set<string>();
  return rows.map((row, index) => {
    const [rank, domain, extra] = row.split(",");
    const labels = domain?.split(".") ?? [];
    if (
      rank !== String(index + 1) ||
      !domain ||
      extra !== undefined ||
      domain.length > 253 ||
      labels.length < 2 ||
      !labels.every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label)) ||
      !/[a-z]/i.test(labels.at(-1)!) ||
      seen.has(domain.toLowerCase())
    ) {
      throw new Error(`Invalid Tranco domain at row ${index + 1}`);
    }
    seen.add(domain.toLowerCase());
    return domain.toLowerCase();
  });
}

/** Fetch only the 1,000 domains exercised by the tester, pinned to a Tranco list ID. */
export async function fetchTopDomains(fetcher: typeof fetch = fetch): Promise<TopDomainList> {
  async function readText(url: string): Promise<string> {
    const response = await fetcher(url, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) {
      throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`);
    }
    return response.text();
  }

  const listId = (await readText("https://tranco-list.eu/top-1m-id")).trim();
  if (!/^[A-Z0-9]+$/.test(listId)) {
    throw new Error("Invalid Tranco list ID");
  }

  const sourceUrl = `https://tranco-list.eu/download/${listId}/${DOMAIN_LIMIT}`;
  const domains = parseDomains(await readText(sourceUrl));
  return { listId, sourceUrl, domains };
}
