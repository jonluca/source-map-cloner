import fs from "node:fs/promises";
import path from "node:path";

/** Write an extracted file without following links already present in the output tree. */
export async function writeSourceFile(outputDirectory: string, sourcePath: string, content: string): Promise<void> {
  const outputPath = path.resolve(outputDirectory);
  const destination = path.resolve(outputPath, sourcePath);
  const relativePath = path.relative(outputPath, destination);
  if (
    !relativePath ||
    relativePath === ".." ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error(`Source path escapes the output directory: ${sourcePath}`);
  }

  await fs.mkdir(outputPath, { recursive: true });
  // The explicitly selected output directory may itself be a link.
  const root = await fs.realpath(outputPath);
  const parts = relativePath.split(path.sep);
  const fileName = parts.pop()!;
  let parent = root;

  for (const part of parts) {
    parent = path.join(parent, part);
    try {
      await fs.mkdir(parent);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
    }
    if (!(await fs.lstat(parent)).isDirectory()) {
      throw new Error(`Output path is not a directory or is a symbolic link: ${parent}`);
    }
  }

  // Rename a fresh file so existing file symlinks and hard links cannot redirect the write.
  const temporaryDirectory = await fs.mkdtemp(path.join(parent, ".source-map-cloner-"));
  try {
    const temporaryFile = path.join(temporaryDirectory, "source");
    await fs.writeFile(temporaryFile, content, "utf8");
    await fs.rename(temporaryFile, path.join(parent, fileName));
  } finally {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
}
