import type { PrismTheme } from 'prism-react-renderer';

/**
 * Custom code theme based on oneDark, with background/text colors
 * matched to `docStyles.codeBlock` (#1f2937) and `docStyles.pre` (#e5e7eb).
 */
export const codeTheme: PrismTheme = {
  plain: {
    backgroundColor: '#1f2937',
    color: '#e5e7eb',
  },
  styles: [
    {
      types: ['comment', 'prolog', 'cdata'],
      style: { color: 'hsl(220, 10%, 40%)' },
    },
    {
      types: ['doctype', 'punctuation', 'entity'],
      style: { color: 'hsl(220, 14%, 71%)' },
    },
    {
      types: [
        'attr-name',
        'class-name',
        'maybe-class-name',
        'boolean',
        'constant',
        'number',
        'atrule',
      ],
      style: { color: 'hsl(29, 54%, 61%)' },
    },
    {
      types: ['keyword'],
      style: { color: 'hsl(286, 60%, 67%)' },
    },
    {
      types: ['property', 'tag', 'symbol', 'deleted', 'important'],
      style: { color: 'hsl(355, 65%, 65%)' },
    },
    {
      types: [
        'selector',
        'string',
        'char',
        'builtin',
        'inserted',
        'regex',
        'attr-value',
      ],
      style: { color: 'hsl(95, 38%, 62%)' },
    },
    {
      types: ['variable', 'operator', 'function'],
      style: { color: 'hsl(207, 82%, 66%)' },
    },
    {
      types: ['url'],
      style: { color: 'hsl(187, 47%, 55%)' },
    },
    {
      types: ['deleted'],
      style: { textDecorationLine: 'line-through' },
    },
    {
      types: ['inserted'],
      style: { textDecorationLine: 'underline' },
    },
    {
      types: ['italic'],
      style: { fontStyle: 'italic' },
    },
    {
      types: ['important', 'bold'],
      style: { fontWeight: 'bold' },
    },
    {
      types: ['important'],
      style: { color: 'hsl(220, 14%, 71%)' },
    },
  ],
};
