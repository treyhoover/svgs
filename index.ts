import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { google } from "@ai-sdk/google";
import { generateObject } from "ai";
import { z } from "zod";
import sharp from "sharp";

const SVG_DIR = "./svg";
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

async function main() {
  const files = await readdir(SVG_DIR);
  const svgFiles = files.filter((f) => f.endsWith(".svg"));

  console.log(`Found ${svgFiles.length} SVG files to process\n`);

  for (const svgFile of svgFiles) {
    const svgPath = join(SVG_DIR, svgFile);

    try {
      const svgBuffer = await readFile(svgPath);
      const svgContent = svgBuffer.toString("utf-8");
      console.log(`Processing: ${svgFile}`);

      const pngBuffer = await svgToPng(svgBuffer);
      const description = await describeImage(pngBuffer);
      const updatedSvg = addDescriptionToSvg(svgContent, description);
      await writeFile(svgPath, updatedSvg, "utf-8");

      console.log(`  → "${description}"\n`);
    } catch (error) {
      console.error(`  ✗ Error processing ${svgFile}:`, error);
    }
  }

  console.log("Done!");
}

main();
