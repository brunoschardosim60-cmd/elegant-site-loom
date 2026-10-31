// @vitest-environment node
import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";

const sources = ["src/styles.css", "src/components/manifest-documents-editor.css"];

it("uses plain sRGB colours so older browsers render the same palette", async () => {
  for (const file of sources) {
    const css = (await readFile(file, "utf8")).replace(/\/\*[\s\S]*?\*\//g, "");
    expect(css, file).not.toMatch(/oklch\(|oklab\(|color-mix\(/);
  }
});

it("keeps the Tailwind theme colours equal to the :root tokens", async () => {
  const css = await readFile("src/styles.css", "utf8");
  const block = (start: string) => {
    const from = css.indexOf(start);
    return css.slice(from, css.indexOf("}", from));
  };
  const pairs = (text: string) =>
    Object.fromEntries([...text.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2]]));
  const root = pairs(block(":root {"));
  const theme = pairs(block("@theme inline {"));
  const checked = Object.entries(theme).filter(([name]) => name.startsWith("--color-"));
  expect(checked.length).toBeGreaterThan(30);
  for (const [name, value] of checked) {
    const token = `--${name.slice("--color-".length)}`;
    const expected = name === "--color-ring-offset-background" ? root["--background"] : root[token];
    if (expected === undefined) continue; // black/white have no semantic token
    expect(value, name).toBe(expected);
  }
});
