import type { components } from '@lumin/api-client';

// Pure view-model bits for the editor's options section (P3-l l-4, ADR-037). A `choice` option carries
// enumerated OptionChoice rows the customer picks one of; a `text` option carries an engraving maxChars
// instead. The wire data is untouched — this is presentation only.

type OptionChoice = components['schemas']['OptionChoice'];

/**
 * Order a choice option's choices for display (ADR-037): by displayOrder, then label as a stable tiebreak
 * when two share an order. Sort only — the API's choices[] stays intact.
 */
export function sortChoices(choices: OptionChoice[]): OptionChoice[] {
  return [...choices].sort(
    (a, b) => a.displayOrder - b.displayOrder || a.label.localeCompare(b.label),
  );
}
