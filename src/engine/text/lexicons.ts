/**
 * Hand-built lexicons for the eight signals. These are deliberately small,
 * inspectable word lists rather than an opaque model: a creator reading the
 * evidence strings needs to be able to see exactly why a line scored.
 */

/** Sentence openers that reliably stop a scroll. */
export const HOOK_OPENERS = [
  'here is', "here's", 'the truth', 'the reason', 'the problem', 'the mistake', 'the trick',
  'nobody', 'no one', 'most people', 'everyone', 'everybody', 'if you', 'you need', 'you should',
  'stop', 'never', 'always', 'listen', 'look', 'watch', 'imagine', 'picture this', 'what if',
  'i used to', 'i spent', 'i tried', 'it turns out', 'turns out', 'this is why', "that's why",
  'the fastest', 'the only', 'the biggest', 'the worst', 'the best', 'let me', 'consider',
];

/** Words that open a loop the listener now needs closed. */
export const CURIOSITY = [
  'secret', 'hidden', 'nobody', 'surprising', 'counterintuitive', 'weird', 'strange', 'until',
  'before', 'later', 'coming', 'wait', 'catch', 'twist', 'except', 'unless', 'however', 'although',
  'but', 'actually', 'though', 'mystery', 'unknown', 'overlooked', 'ignored', 'missed', 'buried',
  'question', 'why', 'how', 'what', 'reason', 'cause', 'behind', 'underneath', 'really',
];

/** Contrast markers — the pivot that makes a line feel like it is going somewhere. */
export const CONTRAST = ['but', 'however', 'actually', 'instead', 'except', 'though', 'although', 'yet', 'whereas', 'rather'];

/** Resolution markers — the payoff half of a curiosity gap. */
export const PAYOFF = [
  'so', 'therefore', 'which means', 'that means', 'the result', 'the answer', 'in short',
  'the point', 'bottom line', 'ultimately', 'and that', "that's how", "that's why", 'because of that',
  'ends up', 'turns into', 'leads to', 'the takeaway', 'the fix', 'the solution', 'works because',
];

/** Valence lexicon. Magnitude matters more than sign — both poles hold attention. */
export const VALENCE: Record<string, number> = {
  amazing: 0.9, incredible: 0.9, insane: 0.95, brilliant: 0.8, love: 0.7, best: 0.6, perfect: 0.7,
  huge: 0.6, massive: 0.7, powerful: 0.6, breakthrough: 0.8, winning: 0.6, beautiful: 0.6,
  transformed: 0.7, exploded: 0.8, skyrocketed: 0.85, thrilled: 0.7, favorite: 0.5, obsessed: 0.75,
  terrible: -0.85, awful: -0.85, worst: -0.8, hate: -0.8, broken: -0.6, failed: -0.75, failure: -0.75,
  disaster: -0.9, painful: -0.7, brutal: -0.8, wrong: -0.5, mistake: -0.6, stupid: -0.7, useless: -0.7,
  dangerous: -0.75, scary: -0.7, terrifying: -0.85, collapsed: -0.8, destroyed: -0.85, lost: -0.5,
  wasted: -0.7, trap: -0.65, risk: -0.5, expensive: -0.4, struggle: -0.6, frustrating: -0.7,
  hard: -0.35, difficult: -0.4, impossible: -0.7, quit: -0.6, fired: -0.75, panic: -0.8,
};

export const INTENSIFIERS = ['very', 'extremely', 'absolutely', 'completely', 'totally', 'insanely', 'ridiculously', 'genuinely', 'utterly', 'wildly'];

/** Verbs that make a soundbite land. */
export const STRONG_VERBS = [
  'break', 'broke', 'build', 'built', 'ship', 'shipped', 'kill', 'killed', 'destroy', 'change',
  'changed', 'fix', 'fixed', 'lose', 'lost', 'win', 'won', 'double', 'triple', 'cut', 'slash',
  'burn', 'burned', 'launch', 'launched', 'scale', 'scaled', 'crush', 'beat', 'skip', 'delete',
  'rewrite', 'replace', 'prove', 'proved', 'discover', 'found', 'realize', 'realized', 'learn',
];

/** Units and quantifiers that signal concreteness. */
export const UNITS = [
  'percent', '%', 'dollars', '$', 'hours', 'hour', 'minutes', 'minute', 'seconds', 'second',
  'days', 'day', 'weeks', 'week', 'months', 'month', 'years', 'year', 'times', 'x', 'million',
  'billion', 'thousand', 'k', 'gb', 'mb', 'ms', 'fps', 'kg', 'miles', 'people', 'subscribers', 'views',
];

/** Pronouns that need an antecedent — a clip opening on one is not self-contained. */
export const DANGLING_REFS = ['it', 'this', 'that', 'they', 'them', 'these', 'those', 'he', 'she', 'him', 'her', 'his', 'hers', 'their'];

/** Common English suffixes for the light stemmer. Order matters — longest first. */
export const SUFFIXES = ['ational', 'iveness', 'fulness', 'ousness', 'ization', 'ability', 'ically', 'ations', 'ingly', 'edly', 'ments', 'ness', 'tion', 'ment', 'ance', 'ence', 'able', 'ible', 'ing', 'ers', 'est', 'ies', 'ied', 'ly', 'ed', 'es', 's'];

/**
 * Discourse-management phrases. These are how a speaker steers their own talk —
 * they carry almost no information, but they *look* like hooks to a naive
 * scorer because they are short, first-person and direct. A clip that opens on
 * one ("Let me be specific", "I want to say that plainly") is a clip about
 * nothing, so they are penalised rather than rewarded.
 */
export const META_TALK = [
  'let me', 'i want to say', 'i should say', 'i will say', 'i want to be', 'i am going to',
  'what i mean', 'what i am saying', 'to be clear', 'to be fair', 'be careful here',
  'as i said', 'like i said', 'as i mentioned', 'going back to', 'anyway', 'moving on',
  'the last thing', 'one more thing', 'that is the whole', 'that is it', 'thanks for',
  'i will let you go', 'i will put', 'in the description', 'a few people asked',
  'here is where it gets', 'this is the part', 'i actually wanted to talk',
  'and then i will', 'okay so', 'now here', 'so anyway', 'let us talk about',
];

/** Fragments that only make sense with what came before them. */
export const CONTINUATION_OPENERS = [
  'and', 'but', 'so', 'because', 'which', 'then', 'or', 'also', 'plus', 'though',
  'anyway', 'again', 'still', 'yet', 'however', 'therefore', 'meanwhile',
];
