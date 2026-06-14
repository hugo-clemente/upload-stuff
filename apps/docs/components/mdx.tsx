import defaultMdxComponents from 'fumadocs-ui/mdx';
import type { MDXComponents } from 'mdx/types';
import {
  createGenerator,
  createFileSystemGeneratorCache,
} from 'fumadocs-typescript';
import { AutoTypeTable, type AutoTypeTableProps } from 'fumadocs-typescript/ui';
import { Popup, PopupContent, PopupTrigger } from 'fumadocs-twoslash/ui';

// AutoTypeTable reads the workspace package source directly (not the built
// `dist`), so the API reference can never drift from the real types. The
// filesystem cache is required for the serverless (Vercel) build.
const generator = createGenerator({
  cache: createFileSystemGeneratorCache('.next/fumadocs-typescript'),
});

export function getMDXComponents(components?: MDXComponents) {
  return {
    ...defaultMdxComponents,
    Popup,
    PopupContent,
    PopupTrigger,
    AutoTypeTable: (props: Partial<AutoTypeTableProps>) => (
      <AutoTypeTable {...props} generator={generator} />
    ),
    ...components,
  } satisfies MDXComponents;
}

export const useMDXComponents = getMDXComponents;

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>;
}
