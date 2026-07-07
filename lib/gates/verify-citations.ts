// The citation gate — deterministic, no model anywhere.
// Two checks on a generated answer: (1) every [chunk-id] tag must be one of the ids that
// retrieval ACTUALLY provided (set membership — an invented citation cannot pass, because
// there is no prose channel to persuade: the check is Set.has(), not a reader);
// (2) every claim-sentence must carry a tag, so untagged assertions can't sneak through.
// What this gate does NOT prove: that a citation is APT — citing a real-but-irrelevant
// chunk passes here and is caught later by evals/human review. Real vs invented is this
// gate's whole job, and it does it with arithmetic.

export const ABSTAIN_PHRASE = "the available sources don't cover this point";

export type CitationCheck = {
  ok: boolean;
  cited: string[];
  invalid_tags: string[];        // tags not in the provided set — invented or mangled
  untagged_sentences: string[];  // claim-sentences with no citation
};

// Models often cite subsections — [CGST-ACT/s17(5)] — even when told not to. The gate
// normalizes: the parenthetical is ignored for set-membership (the chunk IS the whole
// section), so a legally-precise citation is never punished for its precision.
const TAG_RE = /\[([A-Z]+-[A-Z]+\/[A-Za-z0-9./-]+?)(?:\([^)\]]{1,10}\))?\]/g;

// A sentence needs a citation when it asserts something about the law. Detector: legal
// assertions almost always carry a number, an amount, an identifier, or an obligation word.
// Pure navigation ("aap scenario dekh sakte hain", "let me explain both cases") carries none.
const CLAIM_MARKERS =
  /(\d|₹|%|section|rule\b|notification|circular|shall|must|liable|exempt|penalty|interest|late fee|registration|input tax credit|\bitc\b|due date|reverse charge|composition|per cent|per annum)/i;

// A sentence is exempt from the tagging rule if it plainly isn't a legal claim:
// the abstention phrase, questions back to the user, escalation advice, list intros,
// or short connective fragments.
function isExempt(sentence: string): boolean {
  const s = sentence.trim();
  return (
    // markdown layout is not a claim (the agent is instructed not to emit it; if it
    // does anyway, headings/table rows are structure, and their content re-appears in
    // prose or comes from calculator output)
    s.startsWith("#") ||
    s.startsWith("|") ||
    s.length < 25 ||
    s.split(/\s+/).length <= 6 ||
    s.toLowerCase().includes(ABSTAIN_PHRASE) ||
    s.endsWith("?") ||
    s.endsWith(":") ||
    /^(in short|in summary|note|also note|however|therefore|consult|please consult|you may want|your options|option \d)/i.test(s)
  );
}

export function verifyCitations(answer: string, providedIds: string[]): CitationCheck {
  const provided = new Set(providedIds);
  const cited = [...answer.matchAll(TAG_RE)].map((m) => m[1]);
  const invalid_tags = [...new Set(cited.filter((id) => !provided.has(id)))];

  const untagged_sentences: string[] = [];
  // Bullets may inherit a citation from their contiguous list block: a tagged intro line
  // followed by untagged sub-bullets is legitimate grounding (the block shares its source).
  // A blank line ends the block. Non-bullet prose stays strictly per-sentence.
  let blockHasTag = false;
  for (const line of answer.split("\n")) {
    if (!line.trim()) { blockHasTag = false; continue; }
    const lineHasTag = TAG_RE.test(line);
    TAG_RE.lastIndex = 0;
    if (lineHasTag) blockHasTag = true;
    const isBullet = /^\s*[-•*]\s/.test(line);
    for (const sentence of line.split(/(?<=[.!])\s+/)) {
      if (isExempt(sentence)) continue;
      if (!CLAIM_MARKERS.test(sentence)) continue; // no legal assertion → no tag required
      const tagged = TAG_RE.test(sentence);
      TAG_RE.lastIndex = 0;
      if (!tagged && !(isBullet && blockHasTag)) untagged_sentences.push(sentence.trim().slice(0, 120));
    }
  }

  return {
    ok: invalid_tags.length === 0 && untagged_sentences.length === 0,
    cited: [...new Set(cited)],
    invalid_tags,
    untagged_sentences,
  };
}
