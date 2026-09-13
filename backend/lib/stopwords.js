// Common English stopwords excluded when scoring sentence/term importance.
const STOPWORDS = new Set([
  'a','about','above','after','again','against','all','am','an','and','any','are',
  "aren't",'as','at','be','because','been','before','being','below','between','both',
  'but','by','can','cannot','could',"couldn't",'did',"didn't",'do','does',"doesn't",
  'doing',"don't",'down','during','each','few','for','from','further','had',"hadn't",
  'has',"hasn't",'have',"haven't",'having','he',"he'd","he'll","he's",'her','here',
  "here's",'hers','herself','him','himself','his','how',"how's",'i',"i'd","i'll",
  "i'm","i've",'if','in','into','is',"isn't",'it',"it's",'its','itself',"let's",'me',
  'more','most',"mustn't",'my','myself','no','nor','not','of','off','on','once',
  'only','or','other','ought','our','ours','ourselves','out','over','own','same',
  "shan't",'she',"she'd","she'll","she's",'should',"shouldn't",'so','some','such',
  'than','that',"that's",'the','their','theirs','them','themselves','then','there',
  "there's",'these','they',"they'd","they'll","they're","they've",'this','those',
  'through','to','too','under','until','up','very','was',"wasn't",'we',"we'd",
  "we'll","we're","we've",'were',"weren't",'what',"what's",'when',"when's",'where',
  "where's",'which','while','who',"who's",'whom','why',"why's",'with',"won't",
  'would',"wouldn't",'you',"you'd","you'll","you're","you've",'your','yours',
  'yourself','yourselves','also','e.g','i.e','etc','using','used','use','one','two',
  'will','shall','may','might','must','can','probably','perhaps','just','now','suppose',
  'imagine','let','lets','say','says','said','thus','hence','therefore','whereas','either',
  'neither','every','another','still','even','yet','already','first','second','third','next',
]);

// Words frequent in lecture prose that make poor glossary/quiz terms.
const GENERIC_ACADEMIC_WORDS = new Set([
  'stage','stages','process','processes','students','student','able','main','called','known',
  'form','level','part','lecture','overview','point','points','key','exam','figure','example',
  'examples','important','different','many','much','several','various','since','however',
  'called','such','well','within','without','often','usually','main','overall','single',
  'produces','produced','occurs','takes','place','uses','make','makes','made','used','number',
  'molecule','molecules','thing','things','type','types','way','ways','result','results','amount',
  'time','times','send','sends','sent','sending','shows','show','shown','given','gives','means',
  'case','cases','side','hand','order','below','above','following','cont','continued','slide',
]);

module.exports = { STOPWORDS, GENERIC_ACADEMIC_WORDS };
