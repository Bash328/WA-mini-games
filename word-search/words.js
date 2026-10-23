/* ============================================================
   word-search/words.js — the word list for Word Search.

   A plain script (no modules) that sets globalThis.WordSearchWords, so the
   page can load it with a <script> tag and the test can import it for the
   same effect. The list is grouped by theme for readability only; the
   generator treats every word the same and picks by length:

     easy    4-5 letters
     medium  4-6 letters
     hard    5-7 letters

   Rules for a word in this file: lowercase a-z only, 4 to 7 letters, a
   common English word, never a proper noun, never a slur or a vulgar word.
   Duplicates are removed at load time (a word stays in the first theme that
   has it), so adding a word to two themes can never put it in a puzzle twice.
   ============================================================ */
(function (g) {
  "use strict";

  const THEMES = {
    animals: [
      "bear", "beaver", "bird", "bison", "camel", "cheetah", "chicken", "cougar", "crab", "crane",
      "crow", "deer", "dingo", "dolphin", "donkey", "duck", "eagle", "falcon", "ferret", "finch",
      "gecko", "goat", "goose", "gorilla", "heron", "horse", "hound", "husky", "iguana", "jaguar",
      "koala", "lemur", "leopard", "lion", "llama", "lobster", "lynx", "monkey", "moose", "mouse",
      "mule", "otter", "panda", "parrot", "peacock", "pelican", "penguin", "pigeon", "pony", "poodle",
      "rabbit", "raccoon", "raven", "robin", "salmon", "seal", "shark", "sheep", "shrimp", "skunk",
      "sloth", "snail", "snake", "spider", "squid", "stork", "swan", "tiger", "toad", "toucan",
      "trout", "turkey", "turtle", "walrus", "whale", "wolf", "wombat", "zebra",
    ],
    food: [
      "apple", "apricot", "avocado", "bacon", "bagel", "banana", "beef", "berry", "biscuit", "bread",
      "butter", "cabbage", "cake", "candy", "carrot", "cereal", "cheese", "cherry", "chili", "cookie",
      "corn", "cream", "curry", "donut", "flour", "fruit", "garlic", "ginger", "grape", "gravy",
      "honey", "juice", "lemon", "lentil", "lettuce", "lime", "mango", "maple", "melon", "milk",
      "mint", "muffin", "noodle", "oats", "olive", "onion", "orange", "pancake", "papaya", "pasta",
      "peach", "peanut", "pear", "peas", "pepper", "pickle", "pizza", "plum", "potato", "pretzel",
      "prune", "pudding", "pumpkin", "radish", "raisin", "rice", "salad", "salsa", "sauce", "soup",
      "spice", "spinach", "steak", "sugar", "sushi", "syrup", "toast", "tomato", "tuna", "turnip",
      "vanilla", "waffle", "walnut", "wheat", "yogurt",
    ],
    nature: [
      "acorn", "beach", "bloom", "branch", "breeze", "brook", "bush", "cactus", "canyon", "cave",
      "cliff", "cloud", "coast", "comet", "coral", "creek", "dawn", "desert", "dune", "dusk",
      "earth", "fern", "field", "fire", "flower", "forest", "frost", "garden", "glacier", "grass",
      "grove", "hail", "hill", "island", "jungle", "lake", "leaf", "meadow", "mist", "moon",
      "moss", "ocean", "orchid", "pebble", "pine", "planet", "plant", "pond", "prairie", "rain",
      "rainbow", "reed", "reef", "river", "rock", "root", "rose", "sand", "seed", "shade",
      "shell", "shrub", "snow", "soil", "spring", "star", "stone", "storm", "stream", "sunset",
      "swamp", "tide", "tree", "valley", "vine", "volcano", "wave", "wind", "wood", "world",
    ],
    home: [
      "attic", "basket", "blanket", "blind", "board", "bottle", "bowl", "broom", "brush", "bucket",
      "cabinet", "candle", "carpet", "chair", "clock", "closet", "cloth", "couch", "counter", "curtain",
      "cushion", "desk", "dish", "door", "drawer", "dresser", "fork", "frame", "fridge", "glass",
      "hammer", "kettle", "kitchen", "knife", "lamp", "ladder", "latch", "laundry", "mirror", "napkin",
      "oven", "pantry", "pillow", "plate", "quilt", "radio", "rack", "shelf", "shower", "sink",
      "sofa", "spoon", "stool", "stove", "table", "teapot", "toilet", "towel", "tray", "vase",
      "wall", "window",
    ],
    travel: [
      "airport", "atlas", "baggage", "bike", "boat", "bridge", "cabin", "camera", "canoe", "caravan",
      "castle", "city", "coach", "compass", "cruise", "deck", "detour", "ferry", "flight", "guide",
      "harbor", "helmet", "highway", "hostel", "hotel", "journey", "lane", "launch", "metro", "motor",
      "museum", "path", "pier", "plane", "port", "rail", "resort", "road", "route", "sail",
      "ship", "shore", "suitcase", "taxi", "tent", "ticket", "tour", "town", "trail", "train",
      "tram", "trip", "tunnel", "village", "visa", "voyage", "walk", "wing", "yacht",
    ],
    sport: [
      "arena", "arrow", "ball", "basket", "catch", "chess", "club", "court", "dance", "dart",
      "dive", "fence", "goal", "golf", "hockey", "jump", "kick", "league", "match", "medal",
      "pitch", "player", "point", "pool", "puck", "race", "racket", "relay", "ride", "ring",
      "rugby", "score", "serve", "shoot", "skate", "soccer", "sport", "squash", "stadium", "swim",
      "team", "tennis", "track", "trophy", "volley", "winner", "yoga",
    ],
    school: [
      "answer", "book", "brain", "chalk", "class", "clever", "color", "crayon", "draw", "dream",
      "essay", "exam", "facts", "folder", "grade", "idea", "learn", "lesson", "letter", "library",
      "logic", "math", "music", "name", "note", "page", "paper", "pencil", "poem", "pupil",
      "quiz", "read", "rhyme", "ruler", "school", "science", "shape", "sketch", "solve", "spell",
      "story", "study", "teach", "test", "word", "write",
    ],
    body: [
      "ankle", "blood", "bone", "breath", "cheek", "chest", "chin", "elbow", "face", "finger",
      "foot", "hair", "hand", "head", "heart", "heel", "knee", "lung", "mouth", "muscle",
      "neck", "nerve", "nose", "palm", "pulse", "scalp", "shin", "skin", "skull", "spine",
      "stomach", "throat", "thumb", "tooth", "wrist",
    ],
  };

  // keep only clean, lowercase 4-7 letter words, and keep one copy of a word
  const clean = {};
  const seen = new Set();
  const ALL = [];
  Object.keys(THEMES).forEach(function (theme) {
    clean[theme] = THEMES[theme].filter(function (w) {
      if (typeof w !== "string" || !/^[a-z]{4,7}$/.test(w) || seen.has(w)) return false;
      seen.add(w);
      return true;
    });
    ALL.push.apply(ALL, clean[theme]);
  });

  const BY_LENGTH = { 4: [], 5: [], 6: [], 7: [] };
  ALL.forEach(function (w) { BY_LENGTH[w.length].push(w); });

  g.WordSearchWords = { THEMES: clean, ALL: ALL, BY_LENGTH: BY_LENGTH };
})(globalThis);
