// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { expect, it } from "vitest";

const bootstrap = `create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz); create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;`;

async function statusAfter(count: number) {
  const files = (await readdir("supabase/migrations")).filter((f) => f.endsWith(".sql")).sort();
  const db = new PGlite();
  try {
    await db.exec(bootstrap);
    for (const file of files.slice(0, count))
      await db.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
    const rows = (
      await db.query<{ migração: string; situação: string }>(
        await readFile("supabase/checks/migration-status.sql", "utf8"),
      )
    ).rows;
    return { files, rows };
  } finally {
    await db.close();
  }
}

it("lists every migration file and reports all of them applied on a complete database", async () => {
  const { files, rows } = await statusAfter(Infinity);
  expect(rows.map((row) => row["migração"])).toEqual(files.map((f) => f.replace(/\.sql$/, "")));
  expect(rows.filter((row) => row["situação"] !== "aplicada")).toEqual([]);
}, 60000);

it.each([4, 9, 12, 16, 17])(
  "reports exactly the migrations after the first %i as missing",
  async (count) => {
    const { files, rows } = await statusAfter(count);
    const missing = rows.filter((row) => row["situação"] === "FALTANDO").map((r) => r["migração"]);
    const expected = files
      .slice(count)
      .map((f) => f.replace(/\.sql$/, ""))
      // Applying the AI removal is meaningless before the AI objects exist.
      .filter((name) => name !== "20261013050000_reader_team_access");
    expect(missing).toEqual(expected);
  },
  60000,
);
