import { useState } from "react";
import Head from "next/head";
import { api } from "~/utils/api";
import JSZip from "jszip";

export default function Home() {
  const [url, setUrl] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    fileCount: number;
    files: Array<{ path: string; content: string }>;
  } | null>(null);

  const fetchSourceMap = api.sourceMap.fetchSourceMap.useMutation({
    onSuccess: (data) => {
      setResult(data);
      setError(null);
      setIsLoading(false);
    },
    onError: (error) => {
      setError(error.message);
      setResult(null);
      setIsLoading(false);
    },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url) return;

    setIsLoading(true);
    setError(null);
    setResult(null);

    fetchSourceMap.mutate({ url });
  };

  const downloadFiles = async () => {
    if (!result || !result.files) return;

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
                  <p className="text-red-300">Error: {error}</p>
                </div>
              )}

              {result && (
                <div className="mt-6 space-y-4">
                  <div className="rounded-lg border border-green-500 bg-green-900/50 p-4">
                    <p className="text-green-300">Successfully extracted {result.fileCount} source files!</p>
                  </div>

                  <button
                    onClick={downloadFiles}
                    className="w-full rounded-lg bg-green-600 px-6 py-3 font-semibold text-white transition-colors duration-200 hover:bg-green-700 focus:ring-2 focus:ring-green-500 focus:outline-none"
                  >
                    Download as ZIP
                  </button>

                  <div className="mt-6">
                    <h3 className="mb-3 text-lg font-semibold text-gray-300">Extracted Files:</h3>
                    <div className="max-h-96 overflow-y-auto rounded-lg border border-gray-700 bg-gray-900 p-4">
                      <ul className="space-y-1">
                        {result.files.map((file, index) => (
                          <li key={index} className="font-mono text-sm text-gray-400">
                            {file.path}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
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
