/** Standard English stoplist, plus the filler that dominates spoken transcripts. */
export const STOPWORDS = new Set<string>(
  `a about above after again against all am an and any are aren't as at be because been before being
   below between both but by can cannot could couldn't did didn't do does doesn't doing don't down during
   each few for from further had hadn't has hasn't have haven't having he he'd he'll he's her here here's
   hers herself him himself his how how's i i'd i'll i'm i've if in into is isn't it it's its itself let's
   me more most mustn't my myself no nor not of off on once only or other ought our ours ourselves out over
   own same shan't she she'd she'll she's should shouldn't so some such than that that's the their theirs
   them themselves then there there's these they they'd they'll they're they've this those through to too
   under until up very was wasn't we we'd we'll we're we've were weren't what what's when when's where
   where's which while who who's whom why why's with won't would wouldn't you you'd you'll you're you've
   your yours yourself yourselves
   gets getting gone goes doing done making made taking taken coming came saying said seeing seen
   putting put using used trying tried looking looked calling called giving given asking asked
   turns turned keeps kept starts started stops stopped works worked needs needed means meant
   happens happened talks talked tells told finds found feels felt seems seemed becomes became
   able sure able way ways time times day days point points case cases fact facts kind kinds
   something anything everything nothing someone anyone everyone nobody somebody everybody
   um uh er ah oh okay ok yeah yep nope like just really actually basically literally kinda sorta gonna
   wanna gotta stuff things thing lot lots bit right well now think know mean say said says going get got
   go goes went make makes made take takes took come comes came want wants one two also even still back
   thats theres im ive dont doesnt isnt youre were theyre lets`
    .split(/\s+/)
    .filter(Boolean),
);

/** Tokens that are stopwords for TF-IDF but are strong *signals* elsewhere. */
export const SIGNAL_STOPWORDS = new Set(['you', 'your', 'i', 'we', 'but', 'because', 'so']);
