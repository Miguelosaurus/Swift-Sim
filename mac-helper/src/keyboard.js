const SHIFT_USAGE = 225;

const characterMap = buildCharacterMap();

export function textToKeyEvents(text) {
  const events = [];
  for (const character of text) {
    if (character === "\r") continue;
    const key = characterMap.get(character);
    if (!key) {
      throw new Error(`Unsupported keyboard character: ${JSON.stringify(character)}`);
    }
    if (key.shift) events.push({ type: "down", usage: SHIFT_USAGE });
    events.push({ type: "down", usage: key.usage });
    events.push({ type: "up", usage: key.usage });
    if (key.shift) events.push({ type: "up", usage: SHIFT_USAGE });
  }
  return events;
}

export function namedKeyEvents(name) {
  const usages = {
    backspace: 42,
    tab: 43,
    enter: 40,
    escape: 41,
  };
  const usage = usages[name];
  if (!usage) throw new Error(`Unsupported keyboard key: ${name}`);
  return [
    { type: "down", usage },
    { type: "up", usage },
  ];
}

function buildCharacterMap() {
  const map = new Map();
  for (let index = 0; index < 26; index += 1) {
    const usage = 4 + index;
    map.set(String.fromCharCode(97 + index), { usage, shift: false });
    map.set(String.fromCharCode(65 + index), { usage, shift: true });
  }

  const digits = "1234567890";
  const shiftedDigits = "!@#$%^&*()";
  for (let index = 0; index < digits.length; index += 1) {
    const usage = 30 + index;
    map.set(digits[index], { usage, shift: false });
    map.set(shiftedDigits[index], { usage, shift: true });
  }

  for (const [plain, shifted, usage] of [
    ["-", "_", 45], ["=", "+", 46], ["[", "{", 47], ["]", "}", 48],
    ["\\", "|", 49], [";", ":", 51], ["'", "\"", 52], ["`", "~", 53],
    [",", "<", 54], [".", ">", 55], ["/", "?", 56],
  ]) {
    map.set(plain, { usage, shift: false });
    map.set(shifted, { usage, shift: true });
  }

  map.set(" ", { usage: 44, shift: false });
  map.set("\n", { usage: 40, shift: false });
  map.set("\t", { usage: 43, shift: false });
  return map;
}
