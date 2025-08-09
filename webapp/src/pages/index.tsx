import { useState } from "react";
import Head from "next/head";
import { api } from "~/utils/api";
import JSZip from "jszip";
import { FileTree } from "~/components/FileTree";
import dynamic from "next/dynamic";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
});

function getLanguageFromPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "js":
    case "jsx":
      return "javascript";
    case "ts":
    case "tsx":
      return "typescript";
    case "css":
      return "css";
    case "scss":
    case "sass":
      return "scss";
    case "json":
      return "json";
    case "html":
      return "html";
    case "xml":
      return "xml";
    case "md":
      return "markdown";
    case "py":
      return "python";
    case "java":
      return "java";
    case "c":
    case "cpp":
    case "cc":
      return "cpp";
    case "cs":
      return "csharp";
    case "go":
      return "go";
    case "rs":
      return "rust";
    case "php":
      return "php";
    case "rb":
      return "ruby";
    case "swift":
      return "swift";
    case "kt":
      return "kotlin";
    case "yaml":
    case "yml":
      return "yaml";
    default:
      return "plaintext";
  }
}

export default function Home() {
  const [url, setUrl] = useState("");
  const [selectedFile, setSelectedFile] = useState<{ path: string; content: string } | null>(null);

  const { data: result, isPending: isLoading, error, mutate } = api.sourceMap.fetchSourceMap.useMutation({});

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url) {
      return;
    }

    mutate({ url });
  };

  const downloadFiles = async () => {
    if (!result?.files) {
      return;
    }

    const zip = new JSZip();

    // Add files to zip
    result.files.forEach((file) => {
      zip.file(file.path, file.content);
    });

    // Generate zip file
    const blob = await zip.generateAsync({ type: "blob" });

    // Create download link
    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = `source-map-${new URL(url).hostname}-${Date.now()}.zip`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(downloadUrl);
  };

  return (
    <>
      <Head>
        <title>Source Map Cloner</title>
        <meta name="description" content="Extract source maps from websites" />
        <link rel="icon" href="/favicon.ico" />
      </Head>
      <main className="min-h-screen bg-gradient-to-b from-gray-900 to-gray-800 text-white">
        <div className="container mx-auto px-4 py-16">
          <div className="mx-auto max-w-4xl">
            <h1 className="mb-8 bg-gradient-to-r from-blue-400 to-purple-600 bg-clip-text text-center text-5xl font-bold text-transparent">
              Source Map Cloner
            </h1>

            <div className="mb-8 rounded-lg bg-gray-800 p-8 shadow-xl">
              <form onSubmit={handleSubmit} className="space-y-6">
                <div>
                  <label htmlFor="url" className="mb-2 block text-sm font-medium text-gray-300">
                    Website URL
                  </label>
                  <input
                    type="url"
                    id="url"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://example.com"
                    className="w-full rounded-lg border border-gray-600 bg-gray-700 px-4 py-3 text-white placeholder-gray-400 focus:border-transparent focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    required
                  />
                </div>

                <button
                  type="submit"
                  disabled={isLoading || !url}
                  className="w-full rounded-lg bg-gradient-to-r from-blue-500 to-purple-600 px-6 py-3 font-semibold text-white transition-all duration-200 hover:from-blue-600 hover:to-purple-700 focus:ring-2 focus:ring-blue-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isLoading ? (
                    <span className="flex items-center justify-center">
                      <svg className="mr-3 h-5 w-5 animate-spin" viewBox="0 0 24 24">
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                          fill="none"
                        />
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                        />
                      </svg>
                      Fetching Source Maps...
                    </span>
                  ) : (
                    "Fetch Source Maps"
                  )}
                </button>
              </form>

              {error && (
                <div className="mt-6 rounded-lg border border-red-500 bg-red-900/50 p-4">
                  <p className="text-red-300">Error: {String(error)}</p>
                </div>
              )}

              {result && (
                <div className="mt-6 space-y-4">
                  <div className="rounded-lg border border-green-500 bg-green-900/50 p-4">
                    <p className="text-green-300">Successfully extracted {result.stats.totalFiles} source files!</p>
                    <p className="mt-1 text-sm text-green-300">
                      Total size: {(result.stats.totalSize / 1024).toFixed(2)} KB
                    </p>
                  </div>

                  <button
                    onClick={downloadFiles}
                    className="w-full rounded-lg bg-green-600 px-6 py-3 font-semibold text-white transition-colors duration-200 hover:bg-green-700 focus:ring-2 focus:ring-green-500 focus:outline-none"
                  >
                    Download as ZIP
                  </button>

                  <div className="mt-6">
                    <h3 className="mb-3 text-lg font-semibold text-gray-300">File Browser:</h3>
                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                      <div>
                        <h4 className="mb-2 text-sm font-medium text-gray-400">Directory Structure</h4>
                        <FileTree
                          data={result.directoryStructure}
                          onFileSelect={(path) => {
                            const file = result.files.find((f) => f.path === path);
                            if (file) {
                              setSelectedFile({ path: file.path, content: file.content });
                            }
                          }}
                        />
                      </div>
                      <div>
                        <h4 className="mb-2 text-sm font-medium text-gray-400">File Preview</h4>
                        {selectedFile ? (
                          <div className="overflow-hidden rounded-lg border border-gray-700 bg-gray-900">
                            <div className="border-b border-gray-700 bg-gray-800 px-4 py-2 font-mono text-sm text-gray-400">
                              {selectedFile.path}
                            </div>
                            <MonacoEditor
                              height="400px"
                              language={getLanguageFromPath(selectedFile.path)}
                              theme="vs-dark"
                              value={selectedFile.content}
                              options={{
                                readOnly: true,
                                minimap: { enabled: false },
                                scrollBeyondLastLine: false,
                                fontSize: 13,
                                wordWrap: "on",
                                automaticLayout: true,
                              }}
                            />
                          </div>
                        ) : (
                          <div className="flex h-[400px] items-center justify-center rounded-lg border border-gray-700 bg-gray-900">
                            <p className="text-gray-500">Select a file to preview</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {result.errors.length > 0 && (
                    <div className="mt-6">
                      <h3 className="mb-3 text-lg font-semibold text-yellow-300">Warnings:</h3>
                      <div className="rounded-lg border border-yellow-500 bg-yellow-900/20 p-4">
                        <ul className="space-y-1 text-sm text-yellow-300">
                          {result.errors.map((error, index) => (
                            <li key={index}>
                              {error.file ?? error.url}: {error.error}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="rounded-lg bg-gray-800 p-6 shadow-xl">
              <h2 className="mb-3 text-xl font-semibold text-gray-300">How it works</h2>
              <ul className="space-y-2 text-gray-400">
                <li className="flex items-start">
                  <span className="mr-2 text-blue-400">1.</span>
                  Enter a website URL to analyze
                </li>
                <li className="flex items-start">
                  <span className="mr-2 text-blue-400">2.</span>
                  The tool fetches all JavaScript files from the page
                </li>
                <li className="flex items-start">
                  <span className="mr-2 text-blue-400">3.</span>
                  Source maps are extracted and original source code is recovered
                </li>
                <li className="flex items-start">
                  <span className="mr-2 text-blue-400">4.</span>
                  Download all source files as a ZIP archive
                </li>
              </ul>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
