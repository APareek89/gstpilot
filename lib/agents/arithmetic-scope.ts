// A supplied percentage is not evidence that a legal rate applies. Keep the
// arithmetic exception narrow and independent of historical tax-law defaults.
export function isPlainArithmetic(question: string, lane: string): boolean {
  return lane === 'calculation' && (question.match(/\d+(?:[.,]\d+)*/g)?.length ?? 0) >= 2 &&
    /(?:%|percent|multiply|divide|sum|\badd\b|subtract)/i.test(question) &&
    !/rate|applicab|correct|legal|current|latest|exempt|eligible|eligibility|refund|credit|\bitc\b|\btcs\b|late\s*fee|interest|threshold|regist|turnover\s*limit|due\s*date|notice|penalt|filing|return|tax\s*period|क्या.*(?:दर|लागू)|दर|छूट/i.test(question);
}
