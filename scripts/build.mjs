#!/usr/bin/env node
import path from "node:path";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";

const rootDir = process.cwd();
const srcDir = path.join(rootDir, "src");
const distDir = path.join(rootDir, "dist");

await rm(distDir, { recursive: true, force: true });

for (const sourcePath of await collectTypeScriptFiles(srcDir)) {
  const relativePath = path.relative(srcDir, sourcePath);
  const outputPath = path.join(distDir, relativePath.replace(/\.ts$/, ".js"));
  const sourceCode = await readFile(sourcePath, "utf8");
  const transformed = rewriteRelativeImports(stripTypeScriptTypes(sourceCode, { mode: "strip" }));
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, transformed, "utf8");
}

async function collectTypeScriptFiles(dir) {
  const { readdir } = await import("node:fs/promises");
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectTypeScriptFiles(fullPath)));
    } else if (entry.isFile() && fullPath.endsWith(".ts")) {
      files.push(fullPath);
    }
  }
  return files;
}

function rewriteRelativeImports(code) {
  return code
    .replace(/(from\s+["'])(\.\.?\/[^"']+)(["'])/g, (_match, prefix, specifier, suffix) => {
      return `${prefix}${appendJsExtension(specifier)}${suffix}`;
    })
    .replace(/(import\(\s*["'])(\.\.?\/[^"']+)(["']\s*\))/g, (_match, prefix, specifier, suffix) => {
      return `${prefix}${appendJsExtension(specifier)}${suffix}`;
    });
}

function appendJsExtension(specifier) {
  return specifier.endsWith(".js") ? specifier : `${specifier}.js`;
}
