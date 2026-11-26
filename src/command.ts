import type { Page } from "puppeteer-core";
import type { z } from "zod";

export type Flag = Readonly<{
  flag: string;
  description: string;
  required: boolean;
}>;

export type CliCommand = Readonly<{
  name: string;
  description: string;
  needsTarget: boolean;
  flags: readonly Flag[];
  toPayload: (
    opts: Readonly<Record<string, string>>,
  ) => Record<string, unknown>;
}>;

export const definePageCommand = <Schema extends z.ZodType>(
  cli: Omit<CliCommand, "needsTarget">,
  schema: Schema,
  run: (page: Page, params: z.output<Schema>) => Promise<string>,
) => ({
  cli: { ...cli, needsTarget: true },
  daemon: {
    needs: "page" as const,
    prepare: (input: unknown) => {
      const params = schema.parse(input);
      return (page: Page) => run(page, params);
    },
  },
});
