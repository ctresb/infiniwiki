import { JSONParser } from '@streamparser/json';
import type { Category, Infobox, Reference, Section } from './types';

export type RenderEvent =
  | { type: 'displayTitle'; value: string }
  | { type: 'hatnote'; value: string }
  | { type: 'lead'; value: string }
  | { type: 'infobox'; value: Infobox }
  | { type: 'section'; value: Section }
  | { type: 'reference'; value: Reference }
  | { type: 'category'; value: Category };

export function createParser(onEvent: (e: RenderEvent) => void): JSONParser {
  const p = new JSONParser({
    paths: [
      '$.displayTitle',
      '$.hatnote',
      '$.lead',
      '$.infobox',
      '$.sections.*',
      '$.references.*',
      '$.categories.*',
    ],
  });

  p.onValue = ({ value, key, stack }) => {
    if (stack.length === 1 && typeof key === 'string') {
      if (key === 'displayTitle') onEvent({ type: 'displayTitle', value: value as string });
      else if (key === 'hatnote') onEvent({ type: 'hatnote', value: value as string });
      else if (key === 'lead') onEvent({ type: 'lead', value: value as string });
      else if (key === 'infobox') onEvent({ type: 'infobox', value: value as unknown as Infobox });
      return;
    }
    if (stack.length === 2) {
      const parentKey = stack[1]?.key;
      if (parentKey === 'sections') onEvent({ type: 'section', value: value as unknown as Section });
      else if (parentKey === 'references') onEvent({ type: 'reference', value: value as unknown as Reference });
      else if (parentKey === 'categories') onEvent({ type: 'category', value: value as unknown as Category });
    }
  };

  return p;
}
