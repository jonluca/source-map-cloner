#!/usr/bin/env tsx

import * as fs from "fs";
import * as path from "path";
import pMap from "p-map";
import { parse } from "csv-parse/sync";
import { execSync } from "child_process";
import { mkdirp } from "mkdirp";
import { cloneSourceMaps, type CloneOptions } from "../src/core/processor";
import { createNodeFetch } from "../src/fetchers";
import { createConsoleLogger } from "../src/utils/default-logger";

interface DomainResult {
  domain: string;
  success: boolean;
  sourceMapsFound: boolean;
  filesExtracted: number;
  totalSize: number;
  error?: string;
  duration: number;
}

class TopDomainTester {
  private resultsDir: string;
  private outputDir: string;
  private results: DomainResult[] = [];
  private startTime: number = Date.now();
  private logger = createConsoleLogger();

  constructor(private domains: string[]) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    this.resultsDir = path.join("results", `run-${timestamp}`);
    this.outputDir = path.join(this.resultsDir, "source-maps");

    fs.mkdirSync(this.resultsDir, { recursive: true });
    fs.mkdirSync(this.outputDir, { recursive: true });
  }

  async run() {
    const CONCURRENCY = 5;
    const LIMIT = 1000; // Test first 1000 domains

    console.log(`Starting test with ${Math.min(this.domains.length, LIMIT)} domains`);
    console.log(`Concurrency: ${CONCURRENCY}`);
    console.log(`Output directory: ${this.resultsDir}`);

    const domainsToTest = this.domains.slice(0, LIMIT);

    await pMap(
      domainsToTest,
      async (domain, index) => {
        console.log(`[${index + 1}/${domainsToTest.length}] Processing ${domain}`);
        const result = await this.testDomain(domain);
        this.results.push(result);
        this.logProgress(index + 1, domainsToTest.length);
      },
      { concurrency: CONCURRENCY },
    );

    await this.saveResults();
    this.printSummary();
  }

  private async testDomain(domain: string): Promise<DomainResult> {
    const startTime = Date.now();
    const domainOutputDir = path.join(this.outputDir, domain.replace(/[^a-z0-9.-]/gi, "_"));

    try {
      const url = `https://${domain}`;

      // Clone source maps into memory using the same approach as CLI
      const options: CloneOptions = {
        urls: [url],
        fetch: createNodeFetch(),
        logger: this.logger,
        crawl: false,
        headers: {},
        verbose: false,
        cleanupKnownInvalidFiles: true,
      };

      const result = await cloneSourceMaps(options);

      // Write files to disk
      let filesWritten = 0;
      for (const [filePath, content] of result.files) {
        const fullPath = path.join(domainOutputDir, filePath);
        const dir = path.dirname(fullPath);
        await mkdirp(dir);
        await fs.promises.writeFile(fullPath, content, "utf-8");
        filesWritten++;
      }

      return {
        domain,
        success: true,
        sourceMapsFound: result.stats.totalFiles > 0,
        filesExtracted: result.stats.totalFiles,
        totalSize: result.stats.totalSize,
        duration: Date.now() - startTime,
      };
    } catch (error: any) {
      return {
        domain,
        success: false,
        sourceMapsFound: false,
        filesExtracted: 0,
        totalSize: 0,
        error: error.message?.slice(0, 200),
        duration: Date.now() - startTime,
      };
    }
  }

  private logProgress(current: number, total: number) {
    const elapsed = (Date.now() - this.startTime) / 1000;
    const rate = current / elapsed;
    const eta = (total - current) / rate;

    const successful = this.results.filter((r) => r.success).length;
    const withSourceMaps = this.results.filter((r) => r.sourceMapsFound).length;

    console.log(
      `Progress: ${current}/${total} | Success: ${successful} | Source Maps: ${withSourceMaps} | ETA: ${Math.round(eta)}s`,
    );
  }

  private async saveResults() {
    const csvPath = path.join(this.resultsDir, "results.csv");
    const jsonPath = path.join(this.resultsDir, "results.json");
    const summaryPath = path.join(this.resultsDir, "summary.txt");

    // Save CSV
    const csvContent = [
      "domain,success,sourceMapsFound,filesExtracted,totalSize,duration,error",
      ...this.results.map(
        (r) =>
          `"${r.domain}",${r.success},${r.sourceMapsFound},${r.filesExtracted},${r.totalSize},${r.duration},"${r.error || ""}"`,
      ),
    ].join("\n");
    fs.writeFileSync(csvPath, csvContent);

    // Save JSON
    fs.writeFileSync(jsonPath, JSON.stringify(this.results, null, 2));

    // Save summary
    const total = this.results.length;
    const successful = this.results.filter((r) => r.success).length;
    const withSourceMaps = this.results.filter((r) => r.sourceMapsFound).length;
    const totalFiles = this.results.reduce((sum, r) => sum + r.filesExtracted, 0);
    const totalSize = this.results.reduce((sum, r) => sum + r.totalSize, 0);
    const totalDuration = (Date.now() - this.startTime) / 1000;

    const summary = [
      "=== Test Summary ===",
      `Date: ${new Date().toISOString()}`,
      `Total domains tested: ${total}`,
      `Successful requests: ${successful} (${((successful / total) * 100).toFixed(1)}%)`,
      `Domains with source maps: ${withSourceMaps} (${((withSourceMaps / total) * 100).toFixed(1)}%)`,
      `Total files extracted: ${totalFiles}`,
      `Total size: ${this.formatBytes(totalSize)}`,
      `Total duration: ${totalDuration.toFixed(1)}s`,
      `Average time per domain: ${(totalDuration / total).toFixed(1)}s`,
      "",
      "=== Top domains with source maps ===",
      ...this.results
        .filter((r) => r.sourceMapsFound)
        .toSorted((a, b) => b.filesExtracted - a.filesExtracted)
        .slice(0, 20)
        .map((r) => `${r.domain}: ${r.filesExtracted} files (${this.formatBytes(r.totalSize)})`),
    ].join("\n");

    fs.writeFileSync(summaryPath, summary);

    console.log(`\nResults saved to:`);
    console.log(`  CSV: ${csvPath}`);
    console.log(`  JSON: ${jsonPath}`);
    console.log(`  Summary: ${summaryPath}`);
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) {
      return "0 B";
    }
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  }

  private printSummary() {
    const total = this.results.length;
    const successful = this.results.filter((r) => r.success).length;
    const withSourceMaps = this.results.filter((r) => r.sourceMapsFound).length;
    const totalFiles = this.results.reduce((sum, r) => sum + r.filesExtracted, 0);
    const totalSize = this.results.reduce((sum, r) => sum + r.totalSize, 0);
    const totalDuration = (Date.now() - this.startTime) / 1000;

    console.log("\n=== Summary ===");
    console.log(`Total domains tested: ${total}`);
    console.log(`Successful requests: ${successful} (${((successful / total) * 100).toFixed(1)}%)`);
    console.log(`Domains with source maps: ${withSourceMaps} (${((withSourceMaps / total) * 100).toFixed(1)}%)`);
    console.log(`Total files extracted: ${totalFiles}`);
    console.log(`Total size: ${this.formatBytes(totalSize)}`);
    console.log(`Total duration: ${totalDuration.toFixed(1)}s`);
    console.log(`Average time per domain: ${(totalDuration / total).toFixed(1)}s`);

    if (withSourceMaps > 0) {
      console.log("\n=== Top 10 domains with source maps ===");
      this.results
        .filter((r) => r.sourceMapsFound)
        .toSorted((a, b) => b.filesExtracted - a.filesExtracted)
        .slice(0, 10)
        .forEach((r) => {
          console.log(`  ${r.domain}: ${r.filesExtracted} files (${this.formatBytes(r.totalSize)})`);
        });
    }
  }
}

async function fetchTopDomains(): Promise<string[]> {
  const listPath = path.join(__dirname, "top-1m.csv");

  if (fs.existsSync(listPath)) {
    console.log("Using cached domain list");
    const content = fs.readFileSync(listPath, "utf-8");
    const records = parse(content, { columns: false });
    return records.map((r: string[]) => r[1]);
  }

  console.log("Downloading Alexa Top 1M domains...");
  try {
    execSync(
      `curl -o ${listPath}.zip https://s3.amazonaws.com/alexa-static/top-1m.csv.zip && unzip -o ${listPath}.zip -d ${__dirname} && rm ${listPath}.zip`,
      { stdio: "inherit" },
    );
  } catch {
    console.error("Failed to download Alexa list, trying alternative source...");
    // Try alternative source or use a fallback list
    execSync(
      `curl -o ${listPath} https://raw.githubusercontent.com/opendns/public-domain-lists/master/opendns-top-domains.txt`,
      { stdio: "inherit" },
    );
    const content = fs.readFileSync(listPath, "utf-8");
    return content
      .split("\n")
      .map((d) => d.trim())
      .filter((d) => d.length > 0);
  }

  const content = fs.readFileSync(listPath, "utf-8");
  const records = parse(content, { columns: false });
  return records.map((r: string[]) => r[1]);
}

async function main() {
  try {
    console.log("Source Map Cloner - Top Domain Tester");
    console.log("=====================================\n");

    const domains = await fetchTopDomains();
    console.log(`Loaded ${domains.length} domains\n`);

    const tester = new TopDomainTester(domains);
    await tester.run();

    console.log("\n✅ Test completed successfully!");
  } catch (error) {
    console.error("❌ Error:", error);
    process.exit(1);
  }
}

// Run immediately
main().catch(console.error);
