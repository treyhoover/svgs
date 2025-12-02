import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, basename } from "node:path";
import { google } from "@ai-sdk/google";
import { generateObject } from "ai";
import { z } from "zod";
import sharp from "sharp";

const SVG_DIR = "./svg";
const CATALOG_PATH = "./catalog.md";
const model = google("gemini-2.5-flash");

const descriptionSchema = z.object({
  description: z
    .string()
    .describe(
      "A 1-2 sentence description of the scene depicted in the illustration, focusing on the main subject and action"
    ),
});

async function svgToPng(svgBuffer: Buffer): Promise<Buffer> {
  return sharp(svgBuffer).png().toBuffer();
}

function addDescriptionToSvg(svgContent: string, description: string): string {
  const escapedDesc = description
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Remove existing <desc> element if present
  const withoutDesc = svgContent.replace(/<desc>[\s\S]*?<\/desc>\s*/gi, "");

  // Insert <desc> after opening <svg> tag
  return withoutDesc.replace(/(<svg[^>]*>)/i, `$1\n  <desc>${escapedDesc}</desc>`);
}

async function describeImage(pngBuffer: Buffer): Promise<string> {
  const { object } = await generateObject({
    model,
    schema: descriptionSchema,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            image: pngBuffer,
          },
          {
            type: "text",
            text: "Describe the scene depicted in this illustration.",
          },
        ],
      },
    ],
  });

  return object.description;
}

function hasDescTag(svgContent: string): boolean {
  return /<desc>[\s\S]*?<\/desc>/i.test(svgContent);
}

function extractDescTag(svgContent: string): string | null {
  const match = svgContent.match(/<desc>([\s\S]*?)<\/desc>/i);
  return match ? match[1] : null;
}

interface CatalogEntry {
  name: string;
  description: string;
}

async function generateCatalog(
  categories: Map<string, CatalogEntry[]>
): Promise<void> {
  const lines: string[] = [];

  for (const [category, entries] of categories) {
    const title = category.charAt(0).toUpperCase() + category.slice(1);
    lines.push(`## ${title}\n`);

    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      lines.push(`- **${entry.name}**: ${entry.description}`);
    }
    lines.push("");
  }

  await writeFile(CATALOG_PATH, lines.join("\n"), "utf-8");
  console.log(`Generated catalog at ${CATALOG_PATH}`);
}

async function main() {
  const categories = await readdir(SVG_DIR);
  const catalogData = new Map<string, CatalogEntry[]>();

  for (const category of categories) {
    const categoryPath = join(SVG_DIR, category);
    const files = await readdir(categoryPath);
    const svgFiles = files.filter((f) => f.endsWith(".svg"));

    if (svgFiles.length === 0) continue;

    console.log(`\n=== ${category} ===`);
    console.log(`Found ${svgFiles.length} SVG files to process\n`);

    const entries: CatalogEntry[] = [];

    for (const svgFile of svgFiles) {
      const svgPath = join(categoryPath, svgFile);

      try {
        const svgBuffer = await readFile(svgPath);
        const svgContent = svgBuffer.toString("utf-8");
        const name = basename(svgFile, ".svg");

        if (hasDescTag(svgContent)) {
          console.log(`Skipping: ${svgFile} (already has <desc> tag)`);
          const description = extractDescTag(svgContent);
          if (description) {
            entries.push({ name, description });
          }
          continue;
        }

        console.log(`Processing: ${svgFile}`);

        const pngBuffer = await svgToPng(svgBuffer);
        const description = await describeImage(pngBuffer);
        const updatedSvg = addDescriptionToSvg(svgContent, description);
        await writeFile(svgPath, updatedSvg, "utf-8");

        entries.push({ name, description });
        console.log(`  → "${description}"\n`);
      } catch (error) {
        console.error(`  ✗ Error processing ${svgFile}:`, error);
      }
    }

    catalogData.set(category, entries);
  }

  await generateCatalog(catalogData);
  console.log("\nDone!");
}

main();
